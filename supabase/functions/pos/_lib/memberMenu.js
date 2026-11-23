// เมนูเฉพาะสมาชิก — ตั้งค่า (หลังบ้าน > เมนูสมาชิก) และโควตาต่อวันของสมาชิกแต่ละคน
//   • จำการล็อกอินของลูกค้าได้กี่วัน (ส่งให้ระบบสมาชิกเป็นอายุ verifyToken)
//   • จำกัดการสั่งเมนูสมาชิก: รวมทุกเมนู (totalLimit) และ/หรือแยกแต่ละเมนู (perMenu) — นับเป็นชิ้น รวมทุกสาขา
//   • นับกันโควตาไว้ตั้งแต่ลูกค้าแจ้งโอน (held) · ปฏิเสธ/ยกเลิกบิล = คืนสิทธิ์ (released)
import { query, withTransaction, lockKey } from './db.js';

const KEY = 'member_menu_settings';
export const DEFAULT_MEMBER_MENU = {
  rememberDays: 30, requireCode: false, dayStart: '00:00', limitEnabled: false, totalLimit: null, applyKiosk: true, applyStaff: true, perMenu: {}
};
const posInt = (v, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null; };

export const normalizeMemberMenu = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  const per = {};
  for (const [id, v] of Object.entries(s.perMenu && typeof s.perMenu === 'object' ? s.perMenu : {})) {
    const n = posInt(v, 999); if (n) per[String(id).slice(0, 60)] = n;
  }
  return {
    rememberDays: Math.max(0, Math.min(90, parseInt(s.rememberDays, 10) >= 0 ? parseInt(s.rememberDays, 10) : DEFAULT_MEMBER_MENU.rememberDays)),
    requireCode: s.requireCode === true,   // หน้าลูกค้าสั่งเอง: ต้องใส่รหัส 6 หลักจากบัตร LINE ก่อนสั่งเมนูสมาชิกไหม (ปิด = ใส่เลขสมาชิก/เบอร์โทรก็สั่งได้)
    dayStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.dayStart || '')) ? s.dayStart : '00:00',
    limitEnabled: s.limitEnabled === true,
    totalLimit: posInt(s.totalLimit, 999),
    applyKiosk: s.applyKiosk !== false,
    applyStaff: s.applyStaff !== false,
    perMenu: per
  };
};

export async function getMemberMenuSettings() {
  try {
    const res = await query(`SELECT [value] FROM dbo.Settings WHERE [key] = '${KEY}'`);
    return normalizeMemberMenu(res.recordset.length ? JSON.parse(res.recordset[0].value) : null);
  } catch { return normalizeMemberMenu(null); }
}
export async function saveMemberMenuSettings(data) {
  const clean = normalizeMemberMenu(data.settings);
  const value = JSON.stringify(clean);
  const res = await query(`UPDATE dbo.Settings SET [value] = @value WHERE [key] = '${KEY}'`, { value });
  if (res.rowsAffected[0] === 0) await query(`INSERT INTO dbo.Settings ([key], [value]) VALUES ('${KEY}', @value)`, { value });
  return { success: true, settings: clean };
}

// วันทำการตามเวลาไทย: เวลาก่อน dayStart ยังนับเป็นวันก่อนหน้า
export const businessDay = (settings, at = Date.now()) => {
  const [h, m] = String((settings && settings.dayStart) || '00:00').split(':').map(Number);
  return new Date(at + 7 * 3600e3 - ((h || 0) * 60 + (m || 0)) * 60e3).toISOString().slice(0, 10);
};

const memberOnlyMenus = async (runner = query) => {
  try { return (await runner(`SELECT id, name FROM dbo.Menu WHERE memberOnly = 1`)).recordset.map(r => ({ id: String(r.id), name: r.name })); }
  catch { return []; }
};

// เมนูสมาชิกในออเดอร์ → Map(menuId → { name, qty })
//   หน้าลูกค้า: { food: { id }, quantity, allPopups[] } · หน้าขาย: { name, qty } (แถวบิลไม่มีรหัสเมนู ใช้ชื่อแทน)
export const memberItemsOf = (items, menus) => {
  const byId = new Map(menus.map(m => [m.id, m])); const byName = new Map(menus.map(m => [m.name, m]));
  const out = new Map();
  const add = (m, q) => { if (!m || !(q > 0)) return; const cur = out.get(m.id) || { name: m.name, qty: 0 }; cur.qty += q; out.set(m.id, cur); };
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    const qty = Math.max(1, parseInt(it.quantity ?? it.qty, 10) || 1);
    if (it.food) {
      add(byId.get(String(it.food.id)), qty);
      for (const p of [...(it.allPopups || []), ...(it.addOns || [])]) if (p) add(byId.get(String(p.id)), qty);
    } else add(byName.get(String(it.name || '')), qty);
  }
  return out;
};

// ที่ใช้ไปแล้ววันนี้ (held + used) ไม่นับรายการของ ref นี้เอง (ส่งคำขอซ้ำ/แก้ตะกร้าแล้วส่งใหม่)
// ตอนจดการใช้ (holdMemberMenu) ต่อคิวตามเลขสมาชิกไว้แล้ว จึงไม่ต้องล็อกช่วงข้อมูลในตาราง (เดิมล็อกทับสมาชิกคนอื่นจนติดกันเอง)
async function usedToday(runner, memberId, day, exceptRef = '') {
  const rows = (await runner(
    `SELECT MenuId, SUM(Qty) AS qty FROM dbo.MemberMenuUsage
      WHERE MemberId = @memberId AND UsageDay = @day AND [Status] IN ('held','used') AND OrderRef <> @ref GROUP BY MenuId`,
    { memberId, day, ref: exceptRef })).recordset;
  const byMenu = {}; let total = 0;
  for (const r of rows) { byMenu[String(r.MenuId)] = Number(r.qty) || 0; total += Number(r.qty) || 0; }
  return { total, byMenu };
}

// สิทธิ์ที่เหลือวันนี้ (แสดงในหน้าลูกค้า/หน้าขาย)
export const quotaView = (settings, used, menus, channel) => {
  const on = settings.limitEnabled && (channel === 'staff' ? settings.applyStaff : settings.applyKiosk);
  const total = on && settings.totalLimit ? { limit: settings.totalLimit, used: used.total, left: Math.max(0, settings.totalLimit - used.total) } : null;
  const perMenu = {};
  for (const m of menus) {
    const lim = on ? settings.perMenu[m.id] || null : null;
    const u = used.byMenu[m.id] || 0;
    const leftOwn = lim ? Math.max(0, lim - u) : null;
    const left = [leftOwn, total ? total.left : null].filter(v => v !== null);
    perMenu[m.id] = { name: m.name, limit: lim, used: u, left: left.length ? Math.min(...left) : null };   // left null = ไม่จำกัด
  }
  return { enabled: on, total, menus: perMenu };
};

export const problemOf = (settings, used, wanted, channel) => {
  if (!settings.limitEnabled || !(channel === 'staff' ? settings.applyStaff : settings.applyKiosk)) return null;
  let want = 0;
  for (const [id, w] of wanted) {
    want += w.qty;
    const lim = settings.perMenu[id];
    if (lim && (used.byMenu[id] || 0) + w.qty > lim) {
      const left = Math.max(0, lim - (used.byMenu[id] || 0));
      return `${w.name} สั่งได้ ${lim} ชิ้นต่อวัน · วันนี้สั่งได้อีก ${left} ชิ้น`;
    }
  }
  if (settings.totalLimit && used.total + want > settings.totalLimit) {
    return `เมนูสมาชิกสั่งได้รวม ${settings.totalLimit} ชิ้นต่อวัน · วันนี้สั่งได้อีก ${Math.max(0, settings.totalLimit - used.total)} ชิ้น`;
  }
  return null;
};

// ตรวจโควตาแล้วจดการใช้ (ทรานแซกชันเดียว กันสั่งพร้อมกันหลายเครื่องจนเกิน)
//   สมาชิกคนเดียวกันส่งพร้อมกันหลายเครื่อง → ต่อคิวทีละคำขอ (lockKey ตามเลขสมาชิก) · สมาชิกต่างคนไม่รอกัน
//   ref เดิมส่งซ้ำ → แทนที่รายการเดิมของ ref นั้น · enforce = false → จดอย่างเดียว ไม่ปฏิเสธ (บิลพนักงานที่รับเงินแล้ว)
export async function holdMemberMenu({ memberId, items, channel, branchId, ref, status = 'held', orderNumber = null, enforce = true }) {
  if (!/^MB-\d{7}$/.test(String(memberId || '')) || !ref) return { success: true, skipped: true };
  const settings = await getMemberMenuSettings();
  const menus = await memberOnlyMenus();
  const wanted = memberItemsOf(items, menus);
  if (!wanted.size) return { success: true, skipped: true };
  const day = businessDay(settings);
  try {
    return await withTransaction(async (runner) => {
      await lockKey(runner, 'member-menu:' + memberId);
      const used = await usedToday(runner, memberId, day, ref);
      const problem = enforce ? problemOf(settings, used, wanted, channel) : null;
      if (problem) return { success: false, memberQuota: true, error: problem };
      await runner(`UPDATE dbo.MemberMenuUsage SET [Status] = 'released' WHERE OrderRef = @ref AND [Status] IN ('held','used')`, { ref });
      for (const [id, w] of wanted) {
        await runner(`INSERT INTO dbo.MemberMenuUsage (MemberId, MenuId, MenuName, Qty, Channel, BranchId, OrderRef, OrderNumber, [Status], UsageDay)
          VALUES (@memberId, @id, @name, @qty, @channel, @branchId, @ref, @no, @status, @day)`,
        { memberId, id, name: w.name, qty: w.qty, channel, branchId: branchId || null, ref, no: orderNumber, status, day });
      }
      return { success: true };
    }, { isolation: 'READ_COMMITTED' });
  } catch (err) {
    // ฐานข้อมูลยังไม่ได้รัน sql:init (ยังไม่มีตาราง) → ไม่จำกัด ไม่ให้การขายสะดุด
    if (/Invalid object name/i.test(String(err && err.message))) return { success: true, skipped: true };
    throw err;
  }
}
export async function markMemberMenuUsed(ref, orderNumber) {
  try { await query(`UPDATE dbo.MemberMenuUsage SET [Status] = 'used', OrderNumber = @no WHERE OrderRef = @ref AND [Status] = 'held'`, { ref, no: orderNumber || null }); }
  catch { /* ยังไม่มีตาราง */ }
}
export async function releaseMemberMenu(refOrNumber) {
  if (!refOrNumber) return;
  try { await query(`UPDATE dbo.MemberMenuUsage SET [Status] = 'released' WHERE (OrderRef = @r OR OrderNumber = @r) AND [Status] IN ('held','used')`, { r: String(refOrNumber) }); }
  catch { /* ยังไม่มีตาราง */ }
}

export async function memberQuota(memberId, channel) {
  const settings = await getMemberMenuSettings();
  const menus = await memberOnlyMenus();
  let used = { total: 0, byMenu: {} };
  try { used = await usedToday(query, memberId, businessDay(settings)); } catch { /* ยังไม่มีตาราง */ }
  return { success: true, ...quotaView(settings, used, menus, channel) };
}

// หลังบ้าน: ตั้งค่า + เมนูสมาชิก + ใครสั่งอะไรวันนี้
export async function memberMenuToday() {
  const settings = await getMemberMenuSettings();
  const day = businessDay(settings);
  let menus = [];
  try { menus = (await query(`SELECT id, name, price FROM dbo.Menu WHERE memberOnly = 1 ORDER BY Seq`)).recordset.map(r => ({ id: String(r.id), name: r.name, price: Number(r.price) || 0 })); } catch { /* */ }
  let rows = [];
  try {
    rows = (await query(`SELECT MemberId, MenuId, MenuName, Qty, Channel, BranchId, OrderRef, OrderNumber, [Status], to_char(CreatedAt + interval '7 hours', 'YYYY-MM-DD HH24:MI:SS') AS at
      FROM dbo.MemberMenuUsage WHERE UsageDay = @day ORDER BY RowId DESC LIMIT 500`, { day })).recordset;
  } catch { /* ยังไม่มีตาราง */ }
  return { success: true, settings, day, menus, rows };
}
