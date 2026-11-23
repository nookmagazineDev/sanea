// การเชื่อมต่อฐานข้อมูล Supabase (Postgres) — ใช้ร่วมกันทุก action
//
// โค้ดคำสั่งของระบบเขียนไว้แบบ SQL Server (มาจาก HumLai-POS) จึงแปลงไวยากรณ์ที่ใช้บ่อยให้เป็น Postgres ตรงนี้ที่เดียว:
//   [Column]            → "column"          (คอลัมน์ทุกตัวในฐานข้อมูลเป็นตัวพิมพ์เล็ก)
//   ISNULL( / LEN(      → COALESCE( / length(
//   SYSUTCDATETIME()    → เวลา UTC ปัจจุบัน
//   NVARCHAR(n|MAX)     → varchar(n) / text
//   @name               → $1, $2, … (ชื่อเดิมใช้ซ้ำได้)
// คำสั่งที่ต่างกันมาก (TOP, MERGE, OUTPUT, ล็อก) เขียนเป็น Postgres ไว้ในไฟล์นั้น ๆ แล้ว
//
// ผลลัพธ์คืนรูปแบบเดิม { recordset, rowsAffected: [n] } และชื่อคีย์กลับเป็นตัวพิมพ์เดิม (OrderNumber, isActive ...)
import postgres from 'npm:postgres@3.4.5';
import { env } from './env.js';

// ชื่อคอลัมน์/ชื่อเล่นที่โค้ดอ่านจากผลลัพธ์ — Postgres คืนเป็นตัวพิมพ์เล็กหมด ต้องแปลงกลับให้ตรงกับที่โค้ดใช้
const CANON = [
  // Orders / TableOrders / PaymentSummary
  'RowId', 'Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount',
  'Status', 'OrderStartTime', 'CompletionTime', 'RecordedBy', 'Quantity', 'TsLocal', 'BranchId',
  'TableNumber', 'SessionId', 'ItemName', 'ItemNameEn', 'ItemPrice', 'Options', 'KitchenPrinted',
  'timestamp', 'orderNumber', 'tableNo', 'paymentMethod', 'grandTotal', 'staff', 'shiftId', 'splitDetail',
  'ClientRef', 'DiscountName', 'DiscountAmount', 'DiscountKind',
  // Menu / Categories / Promotions / Users / Discounts / Settings / Printers / Branches / MenuBranch
  'Seq', 'id', 'category', 'name', 'nameEn', 'description', 'descriptionEn', 'price', 'image', 'isActive',
  'bundledItems', 'popupConfig', 'prices', 'categories', 'printerId', 'sortOrder', 'branches', 'memberOnly',
  'slug', 'icon', 'hasDining', 'visibility', 'origPrice',
  'username', 'pin', 'canCheckout', 'isAdmin', 'isCashier', 'branch', 'type', 'value', 'key', 'ip', 'printMode',
  'billPrefix', 'phone', 'address', 'taxId', 'receiptFooter', 'posId', 'menuId', 'branchId', 'isAvailable', 'priceMap',
  // Liquor / Waste / approvals / outstanding / shifts
  'customerName', 'productName', 'qty', 'note', 'unit', 'itemName', 'kind', 'itemType',
  'requestedBy', 'status', 'approver', 'respondedAt', 'amount', 'total', 'items', 'createdAt',
  'openTime', 'closeTime', 'openStaff', 'closeStaff', 'openCash', 'closeCash', 'totalSales', 'totalCash', 'totalCard',
  'totalTransfer', 'totalOrders',
  // Stock / BOM
  'minStock', 'costPerUnit', 'purchaseUnit', 'unitsPerPurchase', 'menuName', 'menuNameEn', 'ingId', 'ingName',
  'totalIn', 'totalOut', 'usageQty', 'deductQty',
  // Tax invoices
  'invoiceNo', 'issuedAt', 'buyerName', 'buyerTaxId', 'buyerAddress', 'buyerBranch', 'itemsJson', 'subtotal', 'vatRate',
  'vatAmount', 'sellerJson', 'issuedBy', 'cancelled', 'cancelledAt', 'cancelReason', 'useCount', 'lastUsedAt',
  // Kiosk payments / CRM / print queue / member menu / bill counters
  'tableNo', 'dining', 'payloadJson', 'requestedAt', 'respondedBy',
  'MemberId', 'PayloadJson', 'Attempts', 'NextAttempt', 'LastError', 'Points', 'Balance', 'CreatedAt', 'SentAt',
  'JobId', 'PrinterIp', 'PrinterName', 'PrinterType', 'Label', 'Stage', 'Error', 'Warning', 'Confirmed', 'StepsJson',
  'ClaimedAt', 'ClaimedBy', 'FinishedAt', 'Agent', 'Version', 'LastSeen',
  'MenuId', 'MenuName', 'Qty', 'Channel', 'OrderRef', 'UsageDay', 'Prefix', 'LastNo',
  'UpdatedAt', 'costPerUsageUnit', 'pricePerPurchase', 'purchaseQty', 'ts', 'usageUnit', 'cost', 'menuQty',
  // หมวดหมู่: ป๊อปอัพ 6 ชุด
  ...[1, 2, 3, 4, 5, 6].flatMap(i => [`hasPopup${i}`, `popup${i}Category`, `popup${i}Items`, `popup${i}Min`, `popup${i}Max`, `popup${i}ItemsMax`, `popup${i}Free`]),
  // ชื่อเล่นในคำสั่ง (AS ...)
  'maxN', 'n', 'r', 'ago', 'at', 's'
];
const canonOf = new Map();
for (const name of CANON) { const k = name.toLowerCase(); if (!canonOf.has(k)) canonOf.set(k, name); }
// ชื่อเดียวกันที่ต่างตัวพิมพ์ในคนละตาราง (Status/status, Timestamp/timestamp …) — เลือกตามตารางไม่ได้
// จึงคืนให้ทั้งสองแบบ: ตัวที่อยู่ในรายการก่อนเป็นหลัก แล้วใส่อีกแบบไว้ด้วย
const twins = new Map();
for (const name of CANON) {
  const k = name.toLowerCase();
  if (canonOf.get(k) !== name) { if (!twins.has(k)) twins.set(k, new Set()); twins.get(k).add(name); }
}

const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]);

// ── แปลงคำสั่ง ──
const translated = new Map();
function translate(text) {
  let out = translated.get(text);
  if (out) return out;
  const names = [];
  // แปลงเฉพาะนอกเครื่องหมายคำพูดเดี่ยว (ข้อความในคำสั่งอย่าง N'...' ไม่ถูกแตะ)
  const parts = text.split(/('(?:[^']|'')*')/);
  const sqlText = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_, c) => `"${c.toLowerCase()}"`)
      .replace(/\bISNULL\s*\(/gi, 'COALESCE(')
      .replace(/\bLEN\s*\(/gi, 'length(')
      .replace(/\bSYSUTCDATETIME\s*\(\s*\)/gi, "(now() at time zone 'utc')")
      .replace(/\bNVARCHAR\s*\(\s*MAX\s*\)/gi, 'text')
      .replace(/\bNVARCHAR\s*\(\s*(\d+)\s*\)/gi, 'varchar($1)')
      .replace(/(^|[^A-Za-z0-9_])N$/, '$1')        // N'ข้อความ' → 'ข้อความ'
      .replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
        let idx = names.indexOf(name);
        if (idx === -1) { names.push(name); idx = names.length - 1; }
        return `$${idx + 1}`;
      });
  }).join('');
  out = { sqlText, names };
  translated.set(text, out);
  return out;
}

const paramValue = (v) => {
  if (v && typeof v === 'object' && v.__sqlType !== undefined) v = v.value;
  if (v === undefined) return null;
  if (v === true) return 1;          // BIT เดิม = smallint
  if (v === false) return 0;
  return v;
};

function shapeRows(result) {
  const cols = result.columns || [];
  const numeric = new Set(cols.filter(c => NUMERIC_OIDS.has(c.type)).map(c => c.name));
  const recordset = Array.from(result, (row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const val = v !== null && numeric.has(k) ? Number(v) : v;
      out[canonOf.get(k) || k] = val;
      const extra = twins.get(k);
      if (extra) for (const name of extra) out[name] = val;
    }
    return out;
  });
  return { recordset, rowsAffected: [result.count ?? recordset.length] };
}

// ── การเชื่อมต่อ (ใช้ซ้ำในฟังก์ชันเดียวกัน ไม่เปิดใหม่ทุกคำขอ) ──
let client = null;
export function getPool() {
  if (!client) {
    const url = env('SUPABASE_DB_URL');
    if (!url) throw new Error('ไม่พบ SUPABASE_DB_URL ในฟังก์ชัน');
    client = postgres(url, { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  return client;
}

async function run(conn, text, params = {}) {
  const { sqlText, names } = translate(text);
  const values = names.map(n => paramValue(params[n]));
  const result = await conn.unsafe(sqlText, values);
  return shapeRows(result);
}

// query('SELECT * FROM dbo.Menu WHERE id = @id', { id: 'SN00001' })
export const query = (text, params = {}) => run(getPool(), text, params);

// เผื่อโค้ดเดิมที่ห่อชนิดข้อมูลไว้ (Postgres เดาชนิดจากคอลัมน์เอง)
export const typed = (_type, value) => ({ __sqlType: _type, value });
export const sql = { MAX: 'max', VarBinary: () => 'bytea' };

// หลายคำสั่งในทรานแซกชันเดียว — ชนกัน (serialization / deadlock) แล้วลองใหม่เองสูงสุด 3 ครั้ง
const RETRY_CODES = new Set(['40001', '40P01']);
export async function withTransaction(fn, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getPool().begin((tx) => fn((text, params = {}) => run(tx, text, params)));
    } catch (err) {
      if (!RETRY_CODES.has(err && err.code)) throw err;
      if (attempt >= retries) throw new Error('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณากดอีกครั้ง');
      await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 120) * attempt));
    }
  }
}

// ต่อคิวตามชื่อ (เช่น "bill:SN" = ออกเลขบิลสาขา SN) จนจบทรานแซกชัน · ใช้ในทรานแซกชันเท่านั้น
export async function lockKey(runner, resource) {
  await runner(`SELECT pg_advisory_xact_lock(hashtext(@res))`, { res: String(resource).slice(0, 255) });
}

// เขียนหลายแถวในคำสั่งเดียว
export async function insertRows(table, columns, rows, runner = query) {
  if (!rows || rows.length === 0) return 0;
  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(2000 / perRow));
  let written = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params = {};
    const tuples = chunk.map((row, r) => {
      const names = columns.map((col, c) => {
        const key = `p${r}_${c}`;
        params[key] = row[c] === undefined ? null : row[c];
        return `@${key}`;
      });
      return `(${names.join(', ')})`;
    });
    await runner(
      `INSERT INTO dbo.${table} (${columns.map(c => `[${c}]`).join(', ')}) VALUES ${tuples.join(', ')}`,
      params
    );
    written += chunk.length;
  }
  return written;
}

export function explainConnectError(err) {
  return String((err && err.message) || err);
}
