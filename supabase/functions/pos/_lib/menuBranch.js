// ── เมนูรายสาขา ──
// เมนูกลางชุดเดียว + ส่วนที่แต่ละสาขาปรับเอง (ตาราง MenuBranch)
// getStatic?branch=X ส่งเมนูที่ปรับของสาขา X แล้วมาให้ หน้าร้าน/หน้าลูกค้าสั่งเอง/ตัวพิมพ์อัตโนมัติจึงไม่ต้องคำนวณเอง
import { query } from './db.js';

const parseMap = (v) => {
  if (!v) return {};
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch { return {}; }
};

// แถวที่สาขานี้ปรับไว้ ('' = ยังไม่มีตาราง/ไม่ระบุสาขา → ไม่มีอะไรปรับ)
export async function getMenuBranchRows(branchId) {
  if (!branchId) return [];
  try {
    const res = await query(
      `SELECT menuId, isAvailable, priceMap, printerId FROM dbo.MenuBranch WHERE branchId = @b`,
      { b: branchId }
    );
    return res.recordset.map(r => ({
      menuId: String(r.menuId),
      isAvailable: r.isAvailable === null || r.isAvailable === undefined ? null : Boolean(r.isAvailable),
      priceMap: parseMap(r.priceMap),
      printerId: r.printerId ? String(r.printerId) : ''
    }));
  } catch {
    return [];
  }
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

// ปรับเมนูกลางตามสาขา
//   printers = ปริ้นเตอร์ทุกสาขา (มี branchId) — ใช้แปลงปริ้นเตอร์ของเมนูกลางเป็นตัวที่ชื่อเดียวกันในสาขานี้
export function applyBranchMenu(menu, rows, printers, branchId) {
  if (!branchId) return menu;
  const byMenu = new Map(rows.map(r => [r.menuId, r]));
  const mine = printers.filter(p => !p.branchId || String(p.branchId) === String(branchId));
  const mineIds = new Set(mine.map(p => String(p.id)));

  // เมนูกลางชี้ปริ้นเตอร์ของอีกสาขา (เช่น "บาร์" ของสาขาหลัก) → ใช้ปริ้นเตอร์ชื่อเดียวกันของสาขานี้
  const localPrinterFor = (printerId) => {
    const id = String(printerId || '');
    if (!id || mineIds.has(id)) return id;
    const source = printers.find(p => String(p.id) === id);
    const twin = source && mine.find(p => norm(p.name) && norm(p.name) === norm(source.name));
    return twin ? String(twin.id) : id; // หาไม่เจอ → หน้าเว็บตกไปใช้ปริ้นเตอร์ครัวเอง
  };

  // เมนูที่ตั้งให้ขายเฉพาะบางสาขา — สาขาอื่นไม่เห็นเลย (หน้าขาย หน้าลูกค้า ป๊อปอัพ)
  const soldHere = (item) => !Array.isArray(item.branches) || item.branches.length === 0 ||
    item.branches.some(b => String(b) === String(branchId));

  return menu.filter(soldHere).map(item => {
    const row = byMenu.get(String(item.id));
    const out = { ...item, printerId: localPrinterFor(item.printerId) };
    if (!row) return out;

    if (row.isAvailable === false) out.isActive = false;
    if (row.printerId) out.printerId = row.printerId;

    const map = row.priceMap;
    const has = (key) => Object.prototype.hasOwnProperty.call(map, key) && map[key] !== '' && map[key] !== null && Number.isFinite(Number(map[key]));
    if (Array.isArray(item.prices) && item.prices.length > 0) {
      out.prices = item.prices.map(p => (p && has(String(p.name || '')) ? { ...p, price: Number(map[String(p.name || '')]) } : p));
    }
    if (has('')) out.price = Number(map['']);
    return out;
  });
}
