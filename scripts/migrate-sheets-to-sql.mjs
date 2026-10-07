// ย้ายข้อมูลจาก Google Sheet เดิม → SQL Server (รันครั้งเดียวตอนสลับระบบ)
//
// เตรียมก่อนรัน:
//   1) Deploy สคริปต์ gas_complete_script.js เวอร์ชันล่าสุด (ตัวที่มี action=exportSheet)
//   2) สร้างตารางด้วย  npm run sql:init
//   3) ใส่ค่าในไฟล์ .env:  GAS_EXPORT_URL=<URL /exec ของสคริปต์>  และค่าการต่อ SQL_*
//
// วิธีรัน:
//   node --env-file=.env scripts/migrate-sheets-to-sql.mjs            → ดูว่ามีข้อมูลเท่าไรบ้าง (ไม่เขียนอะไร)
//   node --env-file=.env scripts/migrate-sheets-to-sql.mjs --write    → ย้ายจริง (ล้างตารางปลายทางก่อนเขียน)
//   node --env-file=.env scripts/migrate-sheets-to-sql.mjs --write --only Orders,Menu
import { query, insertRows, getPool, explainConnectError } from '../api/_lib/db.js';
import { toThaiClock } from '../api/_lib/time.js';

const GAS_URL = process.env.GAS_EXPORT_URL || '';
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const onlyArg = args.find(a => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : [];
const PAGE = Number(process.env.MIGRATE_PAGE_SIZE || 2000);

// s=ข้อความ n=ตัวเลข b=จริง/เท็จ d=วันที่(เก็บเป็นเวลาไทย) ts=วันที่ที่คำนวณจากคอลัมน์ข้อความอีกตัว
const S = 's', N = 'n', B = 'b', D = 'd';

// แผนที่ ชีทเดิม → ตารางใหม่
// from = ชื่อหัวตารางในชีท (ชีทที่หัวเป็นภาษาไทยใช้เลขลำดับคอลัมน์แทน เริ่มที่ 0)
const PLAN = [
  { sheet: 'Orders', table: 'Orders', columns: [
      ['Timestamp', S, 'Timestamp'], ['OrderNumber', S, 'OrderNumber'], ['CustomerName', S, 'CustomerName'],
      ['Address', S, 'Address'], ['ItemDetail', S, 'ItemDetail'], ['DiningOption', S, 'DiningOption'],
      ['Price', N, 'Price'], ['TotalAmount', N, 'TotalAmount'], ['Status', S, 'Status'],
      ['OrderStartTime', S, 'OrderStartTime'], ['CompletionTime', S, 'CompletionTime'],
      ['RecordedBy', S, 'RecordedBy'], ['Quantity', N, 'Quantity']
    ], derive: { TsLocal: (row, get) => toThaiClock(get('Timestamp')) } },

  { sheet: 'TableOrders', table: 'TableOrders', columns: [
      ['TableNumber', S, 'TableNumber'], ['SessionId', S, 'SessionId'], ['ItemName', S, 'ItemName'],
      ['ItemNameEn', S, 'ItemNameEn'], ['ItemPrice', N, 'ItemPrice'], ['Quantity', N, 'Quantity'],
      ['Options', S, 'Options'], ['Timestamp', S, 'Timestamp'], ['Status', S, 'Status'], ['RecordedBy', S, 'RecordedBy']
    ] },

  { sheet: 'Menu', table: 'Menu', columns: [
      ['id', S, 'id'], ['category', S, 'category'], ['name', S, 'name'], ['nameEn', S, 'nameEn'],
      ['description', S, 'description'], ['descriptionEn', S, 'descriptionEn'], ['price', N, 'price'],
      ['image', S, 'image'], ['isActive', B, 'isActive'], ['bundledItems', S, 'bundledItems'],
      ['popupConfig', S, 'popupConfig'], ['prices', S, 'prices'], ['categories', S, 'categories'],
      ['printerId', S, 'printerId']
    ] },

  { sheet: 'Categories', table: 'Categories', columns: categoryPlan() },

  { sheet: 'Promotions', table: 'Promotions', columns: [
      ['id', S, 'id'], ['name', S, 'name'], ['nameEn', S, 'nameEn'], ['price', N, 'price'], ['origPrice', S, 'origPrice']
    ] },

  { sheet: 'Users', table: 'Users', columns: [
      ['id', S, 'id'], ['username', S, 'username'], ['pin', S, 'pin'], ['canCheckout', B, 'canCheckout'],
      ['isAdmin', B, 'isAdmin'], ['isCashier', B, 'isCashier'], ['branch', S, 'branch']
    ] },

  { sheet: 'Discounts', table: 'Discounts', columns: [
      ['id', S, 'id'], ['name', S, 'name'], ['type', S, 'type'], ['value', N, 'value'], ['categories', S, 'categories']
    ] },

  { sheet: 'Settings', table: 'Settings', columns: [['key', S, 'key'], ['value', S, 'value']] },

  { sheet: 'Printers', table: 'Printers', columns: [
      ['id', S, 'id'], ['name', S, 'name'], ['ip', S, 'ip'], ['type', S, 'type'], ['printMode', S, 'printMode']
    ] },

  { sheet: 'LiquorStorage', table: 'LiquorStorage', columns: [
      ['timestamp', S, 'timestamp'], ['type', S, 'type'], ['customerName', S, 'customerName'], ['phone', S, 'phone'],
      ['productName', S, 'productName'], ['qty', N, 'qty'], ['note', S, 'note'], ['staff', S, 'staff'],
      ['category', S, 'category'], ['unit', S, 'unit']
    ] },

  { sheet: 'Waste', table: 'Waste', columns: [
      ['timestamp', S, 'timestamp'], ['branch', S, 'branch'], ['itemName', S, 'itemName'], ['category', S, 'category'],
      ['qty', N, 'qty'], ['unit', S, 'unit'], ['note', S, 'note'], ['staff', S, 'staff']
    ], derive: { TsLocal: (row, get) => toThaiClock(get('timestamp')) } },

  { sheet: 'PaymentApprovals', table: 'PaymentApprovals', columns: [
      ['id', S, 'id'], ['timestamp', S, 'timestamp'], ['tableNo', S, 'tableNo'], ['orderNumber', S, 'orderNumber'],
      ['amount', N, 'amount'], ['requestedBy', S, 'requestedBy'], ['status', S, 'status'],
      ['approver', S, 'approver'], ['respondedAt', S, 'respondedAt']
    ] },

  { sheet: 'OutstandingBills', table: 'OutstandingBills', columns: [
      ['id', S, 'id'], ['shiftId', S, 'shiftId'], ['tableNo', S, 'tableNo'], ['customerName', S, 'customerName'],
      ['phone', S, 'phone'], ['total', N, 'total'], ['items', S, 'items'], ['createdAt', S, 'createdAt'], ['status', S, 'status']
    ] },

  { sheet: 'Shifts', table: 'Shifts', columns: [
      ['id', S, 'id'], ['openTime', S, 'openTime'], ['closeTime', S, 'closeTime'], ['openStaff', S, 'openStaff'],
      ['closeStaff', S, 'closeStaff'], ['openCash', N, 'openCash'], ['closeCash', N, 'closeCash'],
      ['totalSales', N, 'totalSales'], ['totalCash', N, 'totalCash'], ['totalCard', N, 'totalCard'],
      ['totalTransfer', N, 'totalTransfer'], ['totalOrders', N, 'totalOrders'], ['status', S, 'status'], ['note', S, 'note']
    ] },

  { sheet: 'PaymentSummary', table: 'PaymentSummary', columns: [
      ['timestamp', S, 'timestamp'], ['orderNumber', S, 'orderNumber'], ['tableNo', S, 'tableNo'],
      ['paymentMethod', S, 'paymentMethod'], ['grandTotal', N, 'grandTotal'], ['staff', S, 'staff'],
      ['shiftId', S, 'shiftId'], ['splitDetail', S, 'splitDetail']
    ] },

  // ชีทฝั่งสต็อกหัวตารางเป็นภาษาไทย — จับคู่ด้วยลำดับคอลัมน์แทนชื่อ
  { sheet: 'วัตถุดิบ', table: 'Ingredients', columns: [
      ['id', S, 0], ['name', S, 1], ['nameEn', S, 2], ['unit', S, 3], ['minStock', N, 4],
      ['costPerUnit', N, 5], ['category', S, 6], ['note', S, 7], ['purchaseUnit', S, 8], ['unitsPerPurchase', N, 9]
    ], skipIfEmpty: 0 },

  { sheet: 'BOM', table: 'Bom', columns: [
      ['menuId', S, 0], ['menuName', S, 1], ['menuNameEn', S, 2], ['ingId', S, 3], ['ingName', S, 4],
      ['qty', N, 5], ['unit', S, 6], ['costPerUnit', N, 7], ['note', S, 8]
    ], skipIfEmpty: 0 },

  { sheet: 'รับวัตถุดิบ', table: 'StockIn', columns: [
      ['ts', D, 0], ['ingId', S, 1], ['ingName', S, 2], ['usageQty', N, 3], ['usageUnit', S, 4],
      ['costPerUsageUnit', N, 5], ['total', N, 6], ['staff', S, 7], ['note', S, 8],
      ['purchaseQty', N, 9], ['purchaseUnit', S, 10], ['pricePerPurchase', N, 11]
    ], skipIfEmpty: 1 },

  { sheet: 'ตัดสต็อก', table: 'StockOut', columns: [
      ['ts', D, 0], ['orderNumber', S, 1], ['tableNo', S, 2], ['menuId', S, 3], ['menuName', S, 4],
      ['menuQty', N, 5], ['ingId', S, 6], ['ingName', S, 7], ['deductQty', N, 8], ['unit', S, 9], ['cost', N, 10]
    ], skipIfEmpty: 6 }
];

function categoryPlan() {
  const plan = [['slug', S, 'slug'], ['name', S, 'name'], ['nameEn', S, 'nameEn'], ['icon', S, 'icon'], ['isActive', B, 'isActive']];
  for (let i = 1; i <= 6; i++) {
    plan.push([`hasPopup${i}`, B, `hasPopup${i}`]);
    plan.push([`popup${i}Category`, S, `popup${i}Category`]);
    plan.push([`popup${i}Items`, S, `popup${i}Items`]);
    plan.push([`popup${i}Min`, N, `popup${i}Min`]);
    plan.push([`popup${i}Max`, N, `popup${i}Max`]);
    plan.push([`popup${i}ItemsMax`, S, `popup${i}ItemsMax`]);
    plan.push([`popup${i}Free`, B, `popup${i}Free`]);
  }
  plan.push(['hasDining', B, 'hasDining']);
  return plan;
}

// ── แปลงค่าจากชีทให้เป็นค่าที่เขียนลง SQL ได้ ──
const conv = {
  [S]: v => (v === null || v === undefined || v === '' ? null : String(v)),
  [N]: v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },
  [B]: v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v).trim().toLowerCase();
    return (s === 'true' || s === '1' || s === 'yes' || s === 'ใช่') ? 1 : 0;
  },
  [D]: v => toThaiClock(v)
};

async function fetchSheet(name, offset, limit) {
  const url = `${GAS_URL}${GAS_URL.includes('?') ? '&' : '?'}action=exportSheet&name=${encodeURIComponent(name)}&offset=${offset}&limit=${limit}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`ดึงชีท ${name} ไม่สำเร็จ (HTTP ${res.status})`);
  const text = await res.text();
  const data = JSON.parse(text.replace(/^﻿/, ''));
  if (data.success === false) throw new Error(data.error || `ดึงชีท ${name} ไม่สำเร็จ`);
  return data;
}

async function migrateOne(plan) {
  const head = await fetchSheet(plan.sheet, 0, 1);
  const headers = (head.headers || []).map(h => String(h).trim());
  const total = Number(head.total) || 0;
  console.log(`\n📄 ${plan.sheet} → dbo.${plan.table}  (${total} แถวในชีท)`);
  if (!WRITE) return { sheet: plan.sheet, total, written: 0 };
  if (total === 0) return { sheet: plan.sheet, total, written: 0 };

  // หาตำแหน่งคอลัมน์: ชีทหัวอังกฤษจับด้วยชื่อ ชีทหัวไทยจับด้วยลำดับ
  const indexes = plan.columns.map(([col, , from]) => {
    if (typeof from === 'number') return from;
    const idx = headers.indexOf(from);
    if (idx === -1) console.warn(`   ⚠️  ไม่พบคอลัมน์ "${from}" ในชีท ${plan.sheet} — จะเว้นว่างไว้`);
    return idx;
  });

  const targetCols = plan.columns.map(([col]) => col);
  const deriveKeys = Object.keys(plan.derive || {});
  const allCols = [...targetCols, ...deriveKeys];

  await query(`DELETE FROM dbo.${plan.table}`);

  let written = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await fetchSheet(plan.sheet, offset, PAGE);
    const rows = page.rows || [];
    const values = [];
    for (const raw of rows) {
      if (plan.skipIfEmpty !== undefined) {
        const probe = raw[plan.skipIfEmpty];
        if (probe === '' || probe === null || probe === undefined) continue;   // แถวว่างท้ายชีท
      }
      const get = (headerName) => {
        const i = headers.indexOf(headerName);
        return i === -1 ? '' : raw[i];
      };
      const row = plan.columns.map(([, kind], c) => {
        const i = indexes[c];
        return i === -1 ? null : conv[kind](raw[i]);
      });
      for (const key of deriveKeys) row.push(plan.derive[key](raw, get));
      values.push(row);
    }
    written += await insertRows(plan.table, allCols, values);
    process.stdout.write(`   เขียนแล้ว ${written}/${total}\r`);
  }
  console.log(`   ✅ เขียนลง dbo.${plan.table} ${written} แถว          `);
  return { sheet: plan.sheet, total, written };
}

const run = async () => {
  if (!GAS_URL) throw new Error('ยังไม่ได้ตั้ง GAS_EXPORT_URL (URL /exec ของ Apps Script เดิม) ในไฟล์ .env');
  if (!WRITE) console.log('— โหมดดูอย่างเดียว ไม่เขียนข้อมูล (ใส่ --write เพื่อย้ายจริง) —');
  else console.log('⚠️  โหมดเขียนจริง: ตารางปลายทางจะถูกล้างก่อนเขียนข้อมูลใหม่');

  const plans = ONLY.length ? PLAN.filter(p => ONLY.includes(p.sheet) || ONLY.includes(p.table)) : PLAN;
  const summary = [];
  for (const plan of plans) {
    try {
      summary.push(await migrateOne(plan));
    } catch (err) {
      console.error(`   ❌ ${plan.sheet}: ${err.message}`);
      summary.push({ sheet: plan.sheet, error: err.message });
    }
  }

  console.log('\n── สรุป ──');
  for (const s of summary) {
    console.log(s.error ? `❌ ${s.sheet}: ${s.error}` : `${WRITE ? '✅' : '•'} ${s.sheet}: ${WRITE ? s.written + ' แถว' : s.total + ' แถวในชีท'}`);
  }
  const pool = await getPool();
  await pool.close();
};

run().catch(err => { console.error('\n' + explainConnectError(err)); process.exit(1); });
