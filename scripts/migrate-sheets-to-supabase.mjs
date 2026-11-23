// ย้ายข้อมูลเสน่ห์จาก Google Sheet (ผ่าน Apps Script เดิม) เข้า Supabase (schema dbo)
//
// ใช้: SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_... node scripts/migrate-sheets-to-supabase.mjs [--dir ข้อมูลที่ดาวน์โหลดไว้]
//   - ดึงข้อมูลจาก GAS_URL (ค่าเริ่มต้น = Apps Script ของเสน่ห์) ด้วยคำสั่งอ่านที่สคริปต์รุ่นเก่ามีอยู่แล้ว
//   - เขียนผ่าน Supabase Management API (SQL) — รันซ้ำได้: ล้างตารางที่ย้ายก่อนเขียนใหม่ทุกครั้ง
//
// สคริปต์ Google รุ่นเก่าส่งออกไม่ได้: บันทึกการทิ้ง สูตรอาหาร (BOM) และประวัติรับเข้า/ตัดสต็อกรายครั้ง
//   → สต็อกย้ายเป็นยอดคงเหลือปัจจุบัน (หนึ่งแถว "ยอดยกมา" ต่อวัตถุดิบ)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbzxzhnOhSPWssbEfRVG8doa4G4fQ_98B9_Kog34gguPrG7fgbY5gPnuvTIoneJcmdKgrA/exec';
const REF = process.env.SUPABASE_PROJECT_REF || 'gdcdbzwhucqkxrjlpege';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const BRANCH = { id: 'sanea', name: 'เสน่ห์', billPrefix: 'SN' };
const dirArg = process.argv.indexOf('--dir');
const DIR = dirArg > 0 ? process.argv[dirArg + 1] : '';

// ── ดึงข้อมูล ──
async function gas(action, extra = '') {
  if (DIR) {
    try { return JSON.parse(await readFile(join(DIR, `${action}.json`), 'utf8')); } catch { /* ไม่มีไฟล์ → ดึงใหม่ */ }
  }
  const res = await fetch(`${GAS_URL}?action=${action}${extra}`, { redirect: 'follow' });
  const json = await res.json();
  if (DIR) { await mkdir(DIR, { recursive: true }); await writeFile(join(DIR, `${action}.json`), JSON.stringify(json)); }
  return json;
}

// ── แปลงค่า ──
const t = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const bit = (v, fallback = null) => {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 1 || /^(true|1)$/i.test(String(v)) ? 1 : 0;
};
const js = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  return typeof v === 'string' ? v : JSON.stringify(v);
};
// เวลาไทย (เหมือน toThaiClock ใน API): "ส่วน UTC" ของค่าที่เก็บ = นาฬิกาหน้าร้าน
const thaiClock = (v) => {
  const d = new Date(String(v || ''));
  return isNaN(d.getTime()) ? null : new Date(d.getTime() + 7 * 3600e3).toISOString().replace('Z', '');
};

// ── เขียนลง Supabase ──
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN || 'proxy-injected'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// แถวเป็น JSON ก้อนเดียว → jsonb_to_recordset (ไม่ต้องหนีอักขระทีละค่า)
async function load(table, columns, rows) {
  if (!rows.length) { console.log(`  ${table}: 0`); return; }
  const types = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = '${table}'`);
  const typeOf = Object.fromEntries(types.map(r => [r.column_name, r.data_type]));
  const cols = columns.map(c => c.toLowerCase());
  for (const c of cols) if (!typeOf[c]) throw new Error(`ไม่มีคอลัมน์ ${table}.${c}`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(r => Object.fromEntries(cols.map((c, j) => [c, r[j] === undefined ? null : r[j]])));
    const payload = JSON.stringify(chunk);
    if (payload.includes('$mig$')) throw new Error('ข้อมูลมีตัวคั่น $mig$');
    const list = cols.map(c => `"${c}"`).join(', ');
    const defs = cols.map(c => `"${c}" ${typeOf[c] === 'USER-DEFINED' ? 'text' : typeOf[c]}`).join(', ');
    await sql(`INSERT INTO dbo.${table} (${list}) SELECT ${list} FROM jsonb_to_recordset($mig$${payload}$mig$::jsonb) AS x(${defs})`);
  }
  console.log(`  ${table}: ${rows.length}`);
}

async function main() {
  console.log('ดึงข้อมูลจาก Google Sheet…');
  const all = await gas('getAllData');
  const report = await gas('getReportData', '&from=2000-01-01&to=2100-12-31');
  const liquor = await gas('getLiquorRecords');
  const outstanding = await gas('getOutstandingBills');
  const ingredients = await gas('getIngredients');
  const stock = await gas('getStock');
  if (!Array.isArray(all.menu)) throw new Error('ดึงเมนูไม่สำเร็จ: ' + JSON.stringify(all).slice(0, 200));

  console.log('ล้างตารางที่จะย้ายเข้า…');
  await sql(`TRUNCATE dbo.menu, dbo.categories, dbo.promotions, dbo.users, dbo.discounts, dbo.printers, dbo.branches,
    dbo.orders, dbo.paymentsummary, dbo.shifts, dbo.liquorstorage, dbo.outstandingbills, dbo.ingredients, dbo.stockin, dbo.billcounters RESTART IDENTITY`);
  await sql(`DELETE FROM dbo.settings WHERE "key" IN ('pos_settings')`);

  console.log('เขียนข้อมูล…');
  await load('branches', ['id', 'name', 'billPrefix', 'isActive'], [[BRANCH.id, BRANCH.name, BRANCH.billPrefix, 1]]);

  await load('menu',
    ['id', 'category', 'name', 'nameEn', 'description', 'descriptionEn', 'price', 'image', 'isActive', 'bundledItems', 'popupConfig', 'prices', 'categories', 'printerId', 'branches', 'memberOnly'],
    all.menu.map(m => [String(m.id), t(m.category) || '', t(m.name), t(m.nameEn), t(m.description), t(m.descriptionEn), num(m.price) ?? 0, t(m.image),
      bit(m.isActive, 1), js(m.bundledItems, '[]'), js(m.popupConfig, '{}'), js(m.prices, '[]'), js(m.categories, '[]'), t(m.printerId), '[]', bit(m.memberOnly, 0)]));

  const catCols = ['slug', 'name', 'nameEn', 'icon', 'isActive'];
  for (let i = 1; i <= 6; i++) catCols.push(`hasPopup${i}`, `popup${i}Category`, `popup${i}Items`, `popup${i}Min`, `popup${i}Max`, `popup${i}ItemsMax`, `popup${i}Free`);
  catCols.push('hasDining', 'visibility');
  await load('categories', catCols, all.categories.map(c => {
    const row = [String(c.slug), t(c.name), t(c.nameEn), c.icon || '📌', bit(c.isActive, 1)];
    for (let i = 1; i <= 6; i++) {
      row.push(bit(c[`hasPopup${i}`], i === 1 ? 1 : 0), t(c[`popup${i}Category`]), js(c[`popup${i}Items`], '[]'),
        num(c[`popup${i}Min`]) ?? 0, num(c[`popup${i}Max`]) ?? 0, js(c[`popup${i}ItemsMax`], '{}'), bit(c[`popup${i}Free`], 0));
    }
    row.push(bit(c.hasDining, 1), ['staff', 'customer'].includes(c.visibility) ? c.visibility : 'all');
    return row;
  }));

  await load('promotions', ['id', 'name', 'nameEn', 'price', 'origPrice'],
    (all.promotions || []).map(p => [String(p.id), t(p.name), t(p.nameEn), num(p.price) ?? 0, t(p.origPrice)]));
  await load('users', ['id', 'username', 'pin', 'canCheckout', 'isAdmin', 'isCashier', 'branch'],
    (all.users || []).map(u => [String(u.id), t(u.username), t(u.pin), bit(u.canCheckout, 1), bit(u.isAdmin, 0), bit(u.isCashier, 0), t(u.branch)]));
  await load('discounts', ['id', 'name', 'type', 'value', 'categories'],
    (all.discounts || []).map(d => [String(d.id), t(d.name), t(d.type), num(d.value) ?? 0, js(d.categories, '[]')]));
  await load('printers', ['id', 'name', 'ip', 'type', 'printMode', 'branchId', 'categories'],
    (all.printers || []).map(p => [String(p.id), t(p.name), t(p.ip), t(p.type), p.printMode || 'combined', BRANCH.id, js(p.categories, '[]')]));
  if (all.settings && typeof all.settings === 'object') {
    await load('settings', ['key', 'value'], [['pos_settings', JSON.stringify(all.settings)]]);
  }

  // บิลเก่า: ใช้ชุดจาก getReportData (ครบทุกวัน) ถ้ามี ไม่งั้นใช้ getAllData
  const orders = (report.orders && report.orders.length >= (all.orders || []).length) ? report.orders : (all.orders || []);
  await load('orders',
    ['Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount', 'Status', 'OrderStartTime', 'CompletionTime', 'RecordedBy', 'Quantity', 'TsLocal', 'BranchId'],
    orders.map(o => [t(o.Timestamp), t(o.OrderNumber), t(o.CustomerName), t(o.Address), t(o.ItemDetail), t(o.DiningOption), num(o.Price), num(o.TotalAmount),
      t(o.Status), t(o.OrderStartTime), t(o.CompletionTime), t(o.RecordedBy), num(o.Quantity), thaiClock(o.Timestamp), BRANCH.id]));
  await load('paymentsummary', ['timestamp', 'orderNumber', 'tableNo', 'paymentMethod', 'grandTotal', 'staff', 'shiftId', 'splitDetail', 'BranchId'],
    (report.payments || []).map(p => [t(p.timestamp), t(p.orderNumber), t(p.tableNo), t(p.paymentMethod), num(p.grandTotal) ?? 0, t(p.staff), t(p.shiftId), js(p.splitDetail, null), BRANCH.id]));
  await load('shifts', ['id', 'openTime', 'closeTime', 'openStaff', 'closeStaff', 'openCash', 'closeCash', 'totalSales', 'totalCash', 'totalCard', 'totalTransfer', 'totalOrders', 'status', 'note'],
    (report.shifts || []).map(s => [String(s.id), t(s.openTime), t(s.closeTime), t(s.openStaff), t(s.closeStaff), num(s.openCash), num(s.closeCash), num(s.totalSales),
      num(s.totalCash), num(s.totalCard), num(s.totalTransfer), num(s.totalOrders), t(s.status), t(s.note)]));
  await load('liquorstorage', ['timestamp', 'type', 'customerName', 'phone', 'productName', 'qty', 'note', 'staff', 'category', 'unit'],
    (liquor.records || []).map(l => [t(l.timestamp), t(l.type), t(l.customerName), t(l.phone), t(l.productName), num(l.qty) ?? 0, t(l.note), t(l.staff), t(l.category), t(l.unit)]));
  await load('outstandingbills', ['id', 'shiftId', 'tableNo', 'customerName', 'phone', 'total', 'items', 'createdAt', 'status'],
    (outstanding.bills || []).map(b => [t(b.id), t(b.shiftId), t(b.tableNo), t(b.customerName), t(b.phone), num(b.total) ?? 0, js(b.items, '[]'), t(b.createdAt), t(b.status)]));
  await load('ingredients', ['id', 'name', 'nameEn', 'unit', 'minStock', 'costPerUnit', 'category', 'note', 'purchaseUnit', 'unitsPerPurchase'],
    (ingredients.ingredients || []).map(i => [String(i.id), t(i.name), t(i.nameEn), t(i.unit), num(i.minStock) ?? 0, num(i.costPerUnit) ?? 0, t(i.category), t(i.note),
      t(i.purchaseUnit) || t(i.unit), num(i.unitsPerPurchase) ?? 1]));
  // ยอดคงเหลือปัจจุบัน → แถวรับเข้า "ยอดยกมาจาก Google Sheet" หนึ่งแถวต่อวัตถุดิบ
  const now = thaiClock(new Date().toISOString());
  await load('stockin', ['ts', 'ingId', 'ingName', 'usageQty', 'usageUnit', 'costPerUsageUnit', 'total', 'staff', 'note', 'purchaseQty', 'purchaseUnit', 'pricePerPurchase', 'BranchId'],
    (stock.stock || []).filter(s => num(s.current)).map(s => [now, String(s.id), t(s.name), num(s.current), t(s.unit), num(s.price) ?? 0,
      (num(s.current) || 0) * (num(s.price) || 0), 'ย้ายระบบ', 'ยอดยกมาจาก Google Sheet', num(s.current), t(s.unit), num(s.price) ?? 0, BRANCH.id]));

  const check = await sql(`SELECT (SELECT COUNT(*) FROM dbo.menu) menu, (SELECT COUNT(*) FROM dbo.categories) categories, (SELECT COUNT(*) FROM dbo.users) users,
    (SELECT COUNT(DISTINCT ordernumber) FROM dbo.orders) bills, (SELECT COUNT(*) FROM dbo.paymentsummary) payments`);
  console.log('เสร็จแล้ว:', JSON.stringify(check[0]));
}

main().catch(err => { console.error('ย้ายข้อมูลไม่สำเร็จ:', err.message); process.exit(1); });
