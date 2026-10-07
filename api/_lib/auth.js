// ── ล็อกอินและสิทธิ์ของ API ──
//
// เดิม API เปิดให้ทุกคนเรียกได้ และหน้าล็อกอินเช็กรหัสในเบราว์เซอร์ (ส่งรหัสพนักงานทุกคนไปให้เครื่องลูกค้าด้วย)
// ตอนนี้: เช็กรหัสที่เซิร์ฟเวอร์ → ได้ token อายุ 12 ชั่วโมง → แนบไปกับทุกคำขอ
//
// ตรวจสิทธิ์จริงเมื่อเปิด "บังคับล็อกอินทุกเครื่อง" (ตั้งค่าร้าน) เท่านั้น
// ปิดอยู่ = เปิดกว้างแบบเดิม ร้านที่ยังไม่แจกรหัสพนักงานใช้ต่อได้
import crypto from 'node:crypto';
import { query } from './db.js';
import { defaultBranchId, isKnownBranch } from './branch.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ALL_BRANCHES = '*';

// ── กุญแจเซ็น token ──
// ตั้ง API_SECRET ใน .env ได้ ไม่ตั้ง = สุ่มครั้งแรกแล้วเก็บในตาราง Settings (รีสตาร์ตแล้ว token เดิมยังใช้ได้)
let secretPromise = null;
const getSecret = () => {
  if (process.env.API_SECRET) return Promise.resolve(process.env.API_SECRET);
  if (!secretPromise) {
    secretPromise = (async () => {
      const res = await query(`SELECT [value] FROM dbo.Settings WHERE [key] = 'api_secret'`);
      if (res.recordset.length && res.recordset[0].value) return String(res.recordset[0].value);
      const fresh = crypto.randomBytes(32).toString('hex');
      await query(`INSERT INTO dbo.Settings ([key], [value]) VALUES ('api_secret', @v)`, { v: fresh });
      return fresh;
    })().catch(err => { secretPromise = null; throw err; });
  }
  return secretPromise;
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

export async function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${hmac(await getSecret(), body)}`;
}

export async function verifyToken(token) {
  const text = String(token || '');
  const dot = text.indexOf('.');
  if (dot <= 0) return null;
  const body = text.slice(0, dot);
  const sig = text.slice(dot + 1);
  let secret;
  try { secret = await getSecret(); } catch { return null; }
  const expected = hmac(secret, body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ── เปิดบังคับล็อกอินอยู่ไหม (อ่านจากตั้งค่าร้าน cache 30 วิ) ──
let enforceCache = { value: false, at: 0 };
export async function loginEnforced() {
  if (Date.now() - enforceCache.at < 30 * 1000) return enforceCache.value;
  try {
    const res = await query(`SELECT [value] FROM dbo.Settings WHERE [key] = 'pos_settings'`);
    const settings = res.recordset.length ? JSON.parse(res.recordset[0].value || '{}') : {};
    enforceCache = { value: !!(settings && settings.requireLogin === true), at: Date.now() };
  } catch {
    enforceCache = { value: enforceCache.value, at: Date.now() }; // อ่านไม่ได้ → ใช้ค่าล่าสุดที่รู้
  }
  return enforceCache.value;
}
export const clearEnforceCache = () => { enforceCache = { value: enforceCache.value, at: 0 }; };

// ── กันเดารหัส: ผิด 5 ครั้งติดกัน ล็อกผู้ใช้นั้น 5 นาที ──
const failures = new Map(); // userId -> { count, until }
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60 * 1000;

const isTrue = (v) => v === true || v === 1 || v === '1' || String(v).toUpperCase() === 'TRUE';
export const roleOf = (u) => {
  if (isTrue(u.isAdmin) || String(u.username || '').toLowerCase() === 'admin') return 'admin';
  if (isTrue(u.isCashier)) return 'cashier';
  return 'staff';
};

export async function login(data) {
  const userId = String(data.userId ?? '').trim();
  const pin = String(data.pin ?? '');
  if (!userId || !pin) return { success: false, error: 'กรุณาเลือกผู้ใช้และกรอกรหัส' };

  const lock = failures.get(userId);
  if (lock && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return { success: false, error: `ใส่รหัสผิดหลายครั้ง — ลองใหม่ในอีก ${mins} นาที` };
  }

  const res = await query(
    `SELECT id, username, pin, canCheckout, isAdmin, isCashier, branch FROM dbo.Users WHERE CAST(id AS NVARCHAR(60)) = @id`,
    { id: userId }
  );
  const row = res.recordset[0];
  const stored = Buffer.from(row ? String(row.pin ?? '') : '');
  const entered = Buffer.from(pin);
  const ok = !!row && stored.length > 0 && stored.length === entered.length && crypto.timingSafeEqual(stored, entered);
  if (!ok) {
    const cur = failures.get(userId) || { count: 0, until: 0 };
    const count = cur.count + 1;
    failures.set(userId, count >= LOCK_AFTER ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
    return { success: false, error: 'รหัสผ่านไม่ถูกต้อง' };
  }
  failures.delete(userId);

  const user = {
    id: /^\d{1,15}$/.test(String(row.id)) ? Number(row.id) : String(row.id),
    username: row.username || '',
    branch: String(row.branch || '').trim(),
    canCheckout: row.canCheckout === null ? true : !!row.canCheckout,
    isAdmin: !!row.isAdmin,
    isCashier: !!row.isCashier
  };
  const token = await signToken({ uid: String(row.id), role: roleOf(row), branch: user.branch });
  return { success: true, token, user };
}

// ── นโยบายสิทธิ์ของแต่ละคำสั่ง ──
// ไม่ต้องล็อกอิน: หน้าลูกค้าสแกน QR สั่งเอง และ Print Server (ไม่มีคนล็อกอิน)
// kioskPaidOrder (ออกบิลทันทีไม่ผ่านพนักงาน) ไม่เปิดสาธารณะแล้ว — ลูกค้าแจ้งโอน (kioskPaymentRequest) แล้วพนักงานยืนยันเป็นคนออกบิล
const PUBLIC = new Set(['ping', 'login', 'getStatic', 'getKitchenQueue', 'kioskPaymentRequest', 'getKioskPayment']);

// เฉพาะแอดมินสำนักงานใหญ่ — ของที่มีผลกับทุกสาขา
const HQ_ONLY = new Set([
  'saveBranches', 'saveUsers', 'getUsers', 'saveSettings', 'resetAllSheetData', 'clearSalesData',
  'upsertMenu', 'deleteMenu', 'saveMenu', 'saveMenuOrder', 'upsertCategory', 'deleteCategory', 'saveCategories',
  'upsertPromotion', 'deletePromotion', 'savePromotions', 'saveDiscounts', 'uploadImage',
  'saveBOM', 'upsertIngredient', 'deleteIngredient'
]);

// แอดมิน (รวมผู้จัดการสาขา) — ตั้งค่าของสาขาตัวเอง
const ADMIN = new Set(['cancelTaxInvoice', 'deleteTaxCustomer', 'savePrinters', 'saveMenuBranch', 'getMenuBranch', 'getBOM', 'nextId', 'getSalesReport', 'initSheets']);

// แคชเชียร์ขึ้นไป — หน้าหลังบ้านที่แคชเชียร์เข้าได้
const BACKOFFICE = new Set(['getTaxInvoices', 'issueTaxInvoice', 'reissueTaxInvoice', 'getTaxCustomers', 'saveTaxCustomer', 'saveBranchTables', 'stockIn', 'getStock', 'getIngredients']);

const RANK = { staff: 1, cashier: 2, admin: 3 };
const need = (action) => {
  if (HQ_ONLY.has(action)) return 'hq';
  if (ADMIN.has(action)) return 'admin';
  if (BACKOFFICE.has(action)) return 'cashier';
  return 'staff';
};

const deny = (auth, error) => ({ ok: false, response: { success: false, auth, error } });

// ตรวจสิทธิ์ก่อนทำคำสั่ง
//   token ถูกต้อง + พนักงานผูกสาขาเดียว → บังคับใช้สาขาใน token (กันส่ง branchId ของสาขาอื่นมาเอง)
//   แอดมินสำนักงานใหญ่ = สาขา "ทุกสาขา" หรือสาขาหลัก → ทำได้ทุกสาขา
export async function authorize(action, token, data, params) {
  const user = token ? await verifyToken(token) : null;
  let hq = false;
  if (user) {
    const main = await defaultBranchId();
    hq = user.role === 'admin' && (user.branch === ALL_BRANCHES || (!!main && user.branch === main));
    // สาขาใน token ที่ไม่มีในหน้าตั้งค่าสาขา (พิมพ์ผิด/สาขาถูกลบ) → ไม่บังคับ ให้ลงสาขาหลักแบบเดิม
    if (!hq && user.branch && user.branch !== ALL_BRANCHES && await isKnownBranch(user.branch)) {
      if (data && typeof data === 'object') data.branchId = user.branch;
      if (params && typeof params === 'object' && ('branch' in params || action === 'getLive' || action === 'getMenuBranch' || action === 'getStock')) params.branch = user.branch;
    }
  }

  if (PUBLIC.has(action) || !(await loginEnforced())) return { ok: true, user };
  if (!user) return deny('required', 'ต้องล็อกอินก่อน (หรือหมดเวลาใช้งาน กรุณาล็อกอินใหม่)');

  const level = need(action);
  if (level === 'hq') {
    return hq ? { ok: true, user } : deny('forbidden', 'คำสั่งนี้ใช้ได้เฉพาะแอดมินสำนักงานใหญ่');
  }
  if ((RANK[user.role] || 0) < RANK[level]) return deny('forbidden', 'ไม่มีสิทธิ์ใช้คำสั่งนี้');
  return { ok: true, user };
}
