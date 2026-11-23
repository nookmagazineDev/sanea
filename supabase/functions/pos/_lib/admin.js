// ── ข้อมูลหลังบ้าน: เมนู / หมวดหมู่ / โปรโมชั่น / ผู้ใช้ / เครื่องพิมพ์ / ส่วนลด / ตั้งค่า / รูปภาพ ──
import { query, withTransaction, insertRows } from './db.js';
import { toText, toBit, toJson, CATEGORY_SPEC } from './rows.js';
import { nextIds } from './ids.js';
import { clearBranchCache, branchForWrite, defaultBranchId } from './branch.js';
import { getBranchTables } from './read.js';
import { env } from './env.js';
import { Buffer } from 'node:buffer';

const MENU_COLS = ['id','category','name','nameEn','description','descriptionEn','price','image','isActive','bundledItems','popupConfig','prices','categories','printerId','branches','memberOnly'];
const CATEGORY_COLS = Object.keys(CATEGORY_SPEC);

const menuValues = (item) => ([
  String(item.id), item.category || '', toText(item.name), toText(item.nameEn),
  toText(item.description), toText(item.descriptionEn), Number(item.price) || 0, toText(item.image),
  item.isActive !== false ? 1 : 0,
  toJson(item.bundledItems, '[]'), toJson(item.popupConfig, '{}'),
  toJson(item.prices, '[]'), toJson(item.categories, '[]'), toText(item.printerId),
  // สาขาที่ขายเมนูนี้ — [] = ทุกสาขา
  JSON.stringify(Array.isArray(item.branches) ? item.branches.map(String).filter(Boolean) : []),
  // เฉพาะสมาชิก
  item.memberOnly === true ? 1 : 0
]);

// ค่าเริ่มต้นของแต่ละคอลัมน์ยกมาจากสคริปต์เดิมทั้งหมด
// (ป๊อปอัพชุดที่ 1 เปิดเป็นค่าเริ่มต้น ชุด 2–6 ปิด, hasDining เปิด)
const categoryValues = (c) => {
  const out = [String(c.slug), toText(c.name), toText(c.nameEn), c.icon || '📌', c.isActive !== false ? 1 : 0];
  for (let i = 1; i <= 6; i++) {
    const has = i === 1 ? (c.hasPopup1 !== false) : (c[`hasPopup${i}`] === true);
    out.push(has ? 1 : 0);
    out.push(toText(c[`popup${i}Category`]));
    out.push(toJson(c[`popup${i}Items`], '[]'));
    out.push(Number(c[`popup${i}Min`]) || 0);
    out.push(Number(c[`popup${i}Max`]) || 0);
    out.push(toJson(c[`popup${i}ItemsMax`], '{}'));
    out.push(c[`popup${i}Free`] === true ? 1 : 0);
  }
  out.push(c.hasDining !== false ? 1 : 0);
  out.push(['staff', 'customer'].includes(c.visibility) ? c.visibility : 'all');
  return out;
};

// UPDATE ก่อน ถ้าไม่โดนแถวไหนค่อย INSERT — แทน "หาแถวในชีทแล้วเขียนทับ" ของเดิม
async function upsert(table, columns, values, keyColumn) {
  const params = {};
  columns.forEach((col, i) => { params[`c${i}`] = values[i]; });
  const keyIndex = columns.indexOf(keyColumn);
  const setList = columns.map((col, i) => (i === keyIndex ? null : `[${col}] = @c${i}`)).filter(Boolean).join(', ');
  const res = await query(`UPDATE dbo.${table} SET ${setList} WHERE [${keyColumn}] = @c${keyIndex}`, params);
  if (res.rowsAffected[0] === 0) {
    await query(
      `INSERT INTO dbo.${table} (${columns.map(c => `[${c}]`).join(', ')}) VALUES (${columns.map((c, i) => `@c${i}`).join(', ')})`,
      params
    );
  }
  return { success: true };
}

// เขียนทับทั้งตาราง (หน้าหลังบ้านกด "บันทึก" ส่งมาทั้งชุด) — ลำดับแถวคือลำดับที่ส่งมา
async function replaceAll(table, columns, rows) {
  await withTransaction(async (runner) => {
    await runner(`DELETE FROM dbo.${table}`);
    await insertRows(table, columns, rows, runner);
  });
  return { success: true, saved: rows.length };
}

// รายการที่หน้าบ้านส่งมาโดยยังไม่มีรหัส (กดเพิ่มใหม่แล้วเน็ตหลุดตอนขอรหัส) ให้ออกรหัสให้ตรงนี้
// ออกทีเดียวเป็นชุดเพื่อไม่ให้สองรายการในคำขอเดียวกันได้เลขซ้ำ
async function withIds(items, key) {
  const missing = items.filter(item => !item[key]);
  if (missing.length === 0) return items;
  const ids = await nextIds(query, missing.length);
  missing.forEach((item, i) => { item[key] = ids[i]; });
  return items;
}

// ── เมนู ──
export const upsertMenu = async (data) => {
  const item = data.item;
  if (!item) return { success: false };
  await withIds([item], 'id');
  return upsert('Menu', MENU_COLS, menuValues(item), 'id');
};

export const deleteMenu = async (data) => {
  const res = await query('DELETE FROM dbo.Menu WHERE CAST(id AS NVARCHAR(60)) = @id', { id: String(data.id ?? '') });
  return res.rowsAffected[0] > 0 ? { success: true } : { success: false, error: 'Not found' };
};

export const saveMenu = async (data) => {
  const items = await withIds([...(data.items || [])], 'id');
  return replaceAll('Menu', MENU_COLS, items.map(menuValues));
};

// ── ลำดับการแสดงเมนู ── รับรายการรหัสเมนูเรียงตามที่ต้องการ แก้เฉพาะคอลัมน์ sortOrder
// (ไม่เขียนเมนูทั้งแถวใหม่ — ค่าตั้งอื่นอย่างป๊อปอัพ/ราคาไม่ถูกแตะ)
export const saveMenuOrder = async (data) => {
  const ids = Array.isArray(data.ids) ? data.ids.map(v => String(v)).filter(Boolean) : [];
  if (ids.length === 0) return { success: false, error: 'ไม่มีรายการเมนู' };
  await withTransaction(async (runner) => {
    for (let i = 0; i < ids.length; i++) {
      await runner(`UPDATE dbo.Menu SET sortOrder = @o WHERE CAST(id AS NVARCHAR(60)) = @id`, { o: i + 1, id: ids[i] });
    }
  });
  return { success: true, saved: ids.length };
};

// ── หมวดหมู่ ──
export const upsertCategory = async (data) => {
  const c = data.item;
  if (!c) return { success: false };
  await withIds([c], 'slug');
  return upsert('Categories', CATEGORY_COLS, categoryValues(c), 'slug');
};

export const deleteCategory = async (data) => {
  const res = await query('DELETE FROM dbo.Categories WHERE slug = @slug', { slug: String(data.slug ?? '') });
  return { success: res.rowsAffected[0] > 0 };
};

export const saveCategories = async (data) => {
  const items = await withIds([...(data.categories || [])], 'slug');
  return replaceAll('Categories', CATEGORY_COLS, items.map(categoryValues));
};

// ── โปรโมชั่น ──
const promoValues = (p) => ([String(p.id ?? Date.now()), toText(p.name), toText(p.nameEn), Number(p.price) || 0, toText(p.origPrice)]);
const PROMO_COLS = ['id','name','nameEn','price','origPrice'];

export const upsertPromotion = (data) => {
  const promo = data.item;
  if (!promo || !promo.id) return { success: false };
  return upsert('Promotions', PROMO_COLS, promoValues(promo), 'id');
};

export const deletePromotion = async (data) => {
  const res = await query('DELETE FROM dbo.Promotions WHERE CAST(id AS NVARCHAR(60)) = @id', { id: String(data.id ?? '') });
  return { success: res.rowsAffected[0] > 0 };
};

export const savePromotions = (data) => replaceAll('Promotions', PROMO_COLS, (data.promotions || []).map(promoValues));

// ── ผู้ใช้ / เครื่องพิมพ์ / ส่วนลด ──
export const saveUsers = (data) => replaceAll('Users',
  ['id','username','pin','canCheckout','isAdmin','isCashier','branch'],
  (data.users || []).map(u => ([
    String(u.id ?? Date.now()), toText(u.username), toText(u.pin),
    u.canCheckout !== false ? 1 : 0,
    toBit(u.isAdmin) === 1 ? 1 : 0,
    toBit(u.isCashier) === 1 ? 1 : 0,
    toText(u.branch)
  ]))
);

// ── สาขา ──
// id ต้องไม่ซ้ำและไม่ว่าง — เป็นตัวผูกกับผู้ใช้/บิล/ของเสีย ถ้าหลุดจะหาข้อมูลเก่าของสาขาไม่เจอ
export const saveBranches = async (data) => {
  const list = Array.isArray(data.branches) ? data.branches : [];
  const seen = new Set();
  for (const b of list) {
    const id = String(b.id || '').trim();
    if (!id) return { success: false, error: 'มีสาขาที่ยังไม่ได้ใส่รหัส' };
    if (seen.has(id.toLowerCase())) return { success: false, error: `รหัสสาขา "${id}" ซ้ำกัน` };
    seen.add(id.toLowerCase());
  }
  clearBranchCache(); // สาขาหลัก (ตัวแรกในรายการ) อาจเปลี่ยน
  const base = ['id','name','billPrefix','phone','address','taxId','receiptFooter','isActive'];
  const baseRow = (b) => ([
    String(b.id).trim(), toText(b.name), toText(String(b.billPrefix || '').trim().toUpperCase()),
    toText(b.phone), toText(b.address), toText(b.taxId), toText(b.receiptFooter),
    b.isActive === false ? 0 : 1
  ]);
  try {
    return await replaceAll('Branches', [...base, 'posId'], list.map(b => [...baseRow(b), toText(b.posId)]));
  } catch {
    // ฐานข้อมูลที่ยังไม่ได้รัน sql:init (ยังไม่มีคอลัมน์ posId) — บันทึกแบบเดิมได้ถ้าไม่มีใครกรอก POS ID
    if (list.some(b => String(b.posId || '').trim())) {
      return { success: false, error: 'ฐานข้อมูลยังไม่มีช่อง POS ID — รัน npm run sql:init ก่อน แล้วบันทึกใหม่' };
    }
    return replaceAll('Branches', base, list.map(baseRow));
  }
};

// ผังโต๊ะของสาขาหนึ่ง — เขียนทับเฉพาะของสาขานั้น สาขาอื่นไม่ถูกแตะ
export const saveBranchTables = async (data) => {
  if (!Array.isArray(data.tables)) return { success: false, error: 'ไม่มีรายการโต๊ะ' };
  const branchId = await branchForWrite(data);
  if (!branchId) return { success: false, error: 'ยังไม่มีสาขาในระบบ — ตั้งค่าสาขาก่อน' };
  const all = await getBranchTables();
  all[branchId] = data.tables;
  const value = JSON.stringify(all);
  const res = await query(`UPDATE dbo.Settings SET [value] = @value WHERE [key] = 'branch_tables'`, { value });
  if (res.rowsAffected[0] === 0) {
    await query(`INSERT INTO dbo.Settings ([key], [value]) VALUES ('branch_tables', @value)`, { value });
  }
  return { success: true, branchId };
};

// ── เมนูรายสาขา ── เขียนทับเฉพาะของสาขานั้น เก็บเฉพาะเมนูที่ปรับจริง
export const saveMenuBranch = async (data) => {
  const branchId = await branchForWrite(data);
  if (!branchId) return { success: false, error: 'ยังไม่มีสาขาในระบบ — ตั้งค่าสาขาก่อน' };
  const rows = (Array.isArray(data.rows) ? data.rows : [])
    .map(r => {
      const priceMap = {};
      Object.entries(r && r.priceMap && typeof r.priceMap === 'object' ? r.priceMap : {}).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))) priceMap[k] = Number(v);
      });
      return {
        menuId: String(r && r.menuId != null ? r.menuId : '').trim(),
        isAvailable: r && r.isAvailable === false ? 0 : null,
        priceMap: Object.keys(priceMap).length ? JSON.stringify(priceMap) : null,
        printerId: toText(r && r.printerId)
      };
    })
    .filter(r => r.menuId && (r.isAvailable === 0 || r.priceMap || r.printerId));
  await withTransaction(async (runner) => {
    await runner(`DELETE FROM dbo.MenuBranch WHERE branchId = @b`, { b: branchId });
    await insertRows('MenuBranch', ['menuId','branchId','isAvailable','priceMap','printerId'],
      rows.map(r => [r.menuId, branchId, r.isAvailable, r.priceMap, r.printerId]), runner);
  });
  return { success: true, saved: rows.length, branchId };
};

// printMode (รวมใบเดียว/แยกใบ) ต้องเก็บด้วย ไม่งั้นเครื่องที่ sync จะทับค่าที่ตั้งไว้
// เขียนทับเฉพาะปริ้นเตอร์ของสาขาที่ส่งมา — สาขาอื่นไม่ถูกลบ
// (หน้าเว็บรุ่นเก่าไม่ส่ง branchId → ถือเป็นสาขาหลัก รวมแถวเก่าที่ยังไม่มีสาขา)
export const savePrinters = async (data) => {
  const branchId = await branchForWrite(data);
  const main = await defaultBranchId();
  const rows = (data.printers || []).map(p => ([
    toText(p.id), toText(p.name), toText(p.ip), toText(p.type), p.printMode || 'combined', branchId,
    // หมวดอาหารที่เครื่องนี้พิมพ์ ([] = ทุกหมวด)
    JSON.stringify(Array.isArray(p.categories) ? p.categories.map(String) : [])
  ]));
  await withTransaction(async (runner) => {
    await runner(
      `DELETE FROM dbo.Printers WHERE BranchId = @b OR (BranchId IS NULL AND @b = @main)`,
      { b: branchId || '', main: main || '' }
    );
    await insertRows('Printers', ['id','name','ip','type','printMode','BranchId','categories'], rows, runner);
  });
  return { success: true, saved: rows.length, branchId };
};

export const saveDiscounts = (data) => replaceAll('Discounts',
  ['id','name','type','value','categories'],
  (data.discounts || []).map(d => ([toText(d.id), toText(d.name), toText(d.type), Number(d.value) || 0, JSON.stringify(d.categories || [])]))
);

export const saveSettings = async (data) => {
  const value = JSON.stringify(data.settings || {});
  const res = await query(`UPDATE dbo.Settings SET [value] = @value WHERE [key] = 'pos_settings'`, { value });
  if (res.rowsAffected[0] === 0) {
    await query(`INSERT INTO dbo.Settings ([key], [value]) VALUES ('pos_settings', @value)`, { value });
  }
  return { success: true };
};

// รูปแบบใบเสร็จ: โลโก้ (PNG ขาว-ดำที่ย่อเป็นขนาดพิมพ์แล้ว + รูปต้นฉบับไว้ปรับขนาดใหม่) และรายละเอียดหัวใบ
const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const IMG_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const saveReceiptSettings = async (data) => {
  const s = data.receipt && typeof data.receipt === 'object' ? data.receipt : {};
  const logo = String(s.logo || '');
  const logoSrc = String(s.logoSrc || '');
  if (logo && (!PNG_URL.test(logo) || logo.length > 400000)) return { success: false, error: 'โลโก้ไม่ถูกต้องหรือใหญ่เกินไป' };
  if (logoSrc && (!IMG_URL.test(logoSrc) || logoSrc.length > 1500000)) return { success: false, error: 'รูปโลโก้ต้นฉบับใหญ่เกินไป (ไม่เกินประมาณ 1 MB)' };
  const paper = Number(s.paper) === 58 ? 58 : 80;
  const maxW = paper === 58 ? 384 : 576;
  const clean = {
    logo, logoSrc, paper,
    logoWidth: Math.max(48, Math.min(maxW, Math.round(Number(s.logoWidth) || 240))),
    logoThreshold: Math.max(40, Math.min(220, Math.round(Number(s.logoThreshold) || 160))),
    showName: s.showName !== false, showAddress: s.showAddress !== false, showPhone: s.showPhone !== false
  };
  const value = JSON.stringify(clean);
  const res = await query(`UPDATE dbo.Settings SET [value] = @value WHERE [key] = 'receipt_settings'`, { value });
  if (res.rowsAffected[0] === 0) await query(`INSERT INTO dbo.Settings ([key], [value]) VALUES ('receipt_settings', @value)`, { value });
  return { success: true, receipt: clean };
};

// ── ล้างข้อมูล ──
export const resetAllSheetData = async () => {
  await withTransaction(async (runner) => {
    for (const table of ['Categories', 'Menu', 'Promotions']) await runner(`DELETE FROM dbo.${table}`);
  });
  return { success: true, message: 'All data cleared' };
};

export const clearSalesData = async () => {
  const tables = ['Orders', 'TableOrders', 'PaymentSummary', 'PaymentApprovals', 'OutstandingBills', 'Shifts', 'StockOut', 'StockIn', 'LiquorStorage', 'Waste'];
  await withTransaction(async (runner) => {
    for (const table of tables) await runner(`DELETE FROM dbo.${table}`);
  });
  return { success: true, message: 'Sales and transaction data cleared successfully' };
};

// ── รูปภาพ: เก็บใน Supabase Storage (bucket "images" เปิดให้ดูได้) — แทน Google Drive / ImgBB ──
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function storeImage(rawBase64, mimeHint, folder, nameHint) {
  const m = /^data:([^;,]+)[;,]/.exec(String(rawBase64 || ''));
  const mimeType = MIME_EXT[m ? m[1] : mimeHint] ? (m ? m[1] : mimeHint) : 'image/jpeg';
  const base64 = String(rawBase64 || '').replace(/^data:[^,]*,/, '');
  if (!base64) return { success: false, error: 'ไม่พบไฟล์รูป' };
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 15 * 1024 * 1024) return { success: false, error: 'ไฟล์ใหญ่เกิน 15MB' };
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return { success: false, error: 'ฟังก์ชันยังไม่ได้ตั้งค่า Supabase Storage' };
  const safe = String(nameHint || folder).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || folder;
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.${MIME_EXT[mimeType]}`;
  const res = await fetch(`${url}/storage/v1/object/images/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': mimeType, 'x-upsert': 'false' },
    body: bytes
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    return { success: false, error: `อัปโหลดรูปไม่สำเร็จ (${res.status}) ${msg.slice(0, 120)}` };
  }
  return { success: true, fileId: path, url: `${url}/storage/v1/object/public/images/${path}` };
}

export const uploadImage = (data) => storeImage(data.base64, data.mimeType, 'menu', data.filename);
// หน้าจัดการเมนูเรียกตัวนี้ (เดิมฝากรูปที่ ImgBB) — ตอนนี้เก็บที่ Supabase Storage ของร้านเอง ไม่ต้องมีคีย์ ImgBB
export const uploadMenuImageHost = (data) => storeImage(data.base64, data.mimeType, 'menu', data.name);
export const uploadSlip = (data) => storeImage(data.base64, data.mimeType, 'slip', data.filename);
