// ── ระบบสต็อก/BOM ──
// คงเหลือของวัตถุดิบ = ผลรวมที่รับเข้า − ผลรวมที่ตัดออก (ไม่มีคอลัมน์ "คงเหลือ" ให้เพี้ยน)
import { query, withTransaction, insertRows } from './db.js';
import { toText, toNum } from './rows.js';
import { toThaiClock } from './time.js';
import { branchForWrite } from './branch.js';

const STOCK_OUT_COLS = ['ts','orderNumber','tableNo','menuId','menuName','menuQty','ingId','ingName','deductQty','unit','cost','BranchId'];
const STOCK_IN_COLS  = ['ts','ingId','ingName','usageQty','usageUnit','costPerUsageUnit','total','staff','note','purchaseQty','purchaseUnit','pricePerPurchase','BranchId'];
const BOM_COLS       = ['menuId','menuName','menuNameEn','ingId','ingName','qty','unit','costPerUnit','note'];

// ตัดสต็อกตามสูตรของเมนูที่ขายไป — ร้านที่ยังไม่ได้ตั้ง BOM จะได้ deducted: 0 ไม่ใช่ error
export async function deductStock(data) {
  const items = (data.items || []).filter(i => i && i.menuId);
  if (items.length === 0) return { success: true, deducted: 0 };

  const params = {};
  const menuIds = items.map((item, i) => { params[`m${i}`] = String(item.menuId); return `@m${i}`; });
  const bomRes = await query(
    `SELECT b.menuId, b.ingId, b.ingName, b.qty, b.unit, ISNULL(i.costPerUnit, 0) AS costPerUnit
       FROM dbo.Bom b
       LEFT JOIN dbo.Ingredients i ON i.id = b.ingId
      WHERE b.menuId IN (${menuIds.join(', ')})
      ORDER BY b.RowId ASC`,
    params
  );

  const byMenu = new Map();
  for (const line of bomRes.recordset) {
    const key = String(line.menuId);
    if (!byMenu.has(key)) byMenu.set(key, []);
    byMenu.get(key).push(line);
  }

  const now = toThaiClock(new Date());   // เก็บเป็นเวลาไทยให้ตรงกับเวลาที่บันทึกบิล
  const branchId = await branchForWrite(data); // ตัดสต็อกของสาขาที่ขาย (ไม่ระบุ = สาขาหลัก)
  const rows = [];
  for (const ordered of items) {
    const lines = byMenu.get(String(ordered.menuId)) || [];
    const orderedQty = Number(ordered.qty) || 1;
    for (const line of lines) {
      const totalAmt = (Number(line.qty) || 0) * orderedQty;
      const cost = (Number(line.costPerUnit) || 0) * totalAmt;
      rows.push([now, toText(data.orderNumber), toText(data.tableNo), String(ordered.menuId),
        toText(ordered.menuName), orderedQty, toText(line.ingId), toText(line.ingName),
        totalAmt, toText(line.unit), cost, branchId]);
    }
  }
  if (rows.length > 0) await insertRows('StockOut', STOCK_OUT_COLS, rows);
  return { success: true, deducted: rows.length };
}

// รับวัตถุดิบเข้า — ราคาที่กรอกคือราคาต่อ "หน่วยซื้อ" (เช่น ต่อ 1 กก.)
// แปลงเป็นหน่วยใช้ (เช่น กรัม) ก่อนเก็บ แล้วอัปเดตต้นทุน/หน่วยใช้ล่าสุดให้ BOM คำนวณด้วยราคาล่าสุด
export async function recordStockIn(data) {
  const items = (data.items || []).filter(i => i && i.ingId);
  if (items.length === 0) return { success: true, recorded: 0 };

  const params = {};
  const ids = items.map((item, i) => { params[`i${i}`] = String(item.ingId); return `@i${i}`; });
  const ingRes = await query(
    `SELECT id, name, unit, costPerUnit, purchaseUnit, unitsPerPurchase FROM dbo.Ingredients WHERE id IN (${ids.join(', ')})`,
    params
  );
  const ingMap = new Map(ingRes.recordset.map(r => [String(r.id), r]));

  const now = toThaiClock(new Date());
  const branchId = await branchForWrite(data); // รับของเข้าสาขาไหน (ไม่ระบุ = สาขาหลัก)
  const rows = [];
  const costUpdates = [];
  for (const item of items) {
    const ing = ingMap.get(String(item.ingId));
    if (!ing) continue;                                   // ไม่มีวัตถุดิบรหัสนี้ → ข้าม (เหมือนของเดิม)
    const factor = Number(ing.unitsPerPurchase) || 1;      // หน่วยใช้ ต่อ 1 หน่วยซื้อ
    const qtyPurchase = Number(item.qty) || 0;
    const pricePerPurchase = (item.pricePerUnit !== undefined && item.pricePerUnit !== '' && item.pricePerUnit !== null)
      ? Number(item.pricePerUnit)
      : (Number(ing.costPerUnit) || 0) * factor;
    const usageQty  = qtyPurchase * factor;
    const usageCost = factor > 0 ? pricePerPurchase / factor : pricePerPurchase;
    const total     = qtyPurchase * pricePerPurchase;
    rows.push([now, String(ing.id), toText(ing.name), usageQty, toText(ing.unit), usageCost, total,
      item.staff || 'admin', toText(item.note), qtyPurchase, toText(ing.purchaseUnit), pricePerPurchase, branchId]);
    costUpdates.push({ id: String(ing.id), cost: Math.round(usageCost * 10000) / 10000 });
  }

  if (rows.length === 0) return { success: true, recorded: 0 };

  await withTransaction(async (runner) => {
    await insertRows('StockIn', STOCK_IN_COLS, rows, runner);
    for (const u of costUpdates) {
      await runner('UPDATE dbo.Ingredients SET costPerUnit = @cost WHERE id = @id', u);
    }
  });
  return { success: true, recorded: rows.length };
}

// บันทึกสูตรทั้งชุด (หน้าจัดการ BOM ส่งมาทั้งตาราง) — เขียนทับของเดิมทั้งหมดเหมือนเดิม
export async function saveBOM(data) {
  const rows = (data.rows || []).map(r => ([
    toText(r.menuId), toText(r.menuName), toText(r.menuNameEn), toText(r.ingId), toText(r.ingName),
    Number(r.qty) || 0, toText(r.unit), Number(r.costPerUnit) || 0, toText(r.note)
  ]));
  await withTransaction(async (runner) => {
    await runner('DELETE FROM dbo.Bom');
    await insertRows('Bom', BOM_COLS, rows, runner);
  });
  return { success: true, saved: rows.length };
}

export async function upsertIngredient(data) {
  const ing = data.ingredient || {};
  if (!ing.id) return { success: false, error: 'ไม่มีรหัสวัตถุดิบ' };
  const params = {
    id: String(ing.id), name: toText(ing.name), nameEn: toText(ing.nameEn), unit: toText(ing.unit),
    minStock: toNum(ing.minStock) ?? 0, costPerUnit: toNum(ing.costPerUnit) ?? 0,
    category: toText(ing.category), note: toText(ing.note),
    purchaseUnit: toText(ing.purchaseUnit), unitsPerPurchase: toNum(ing.unitsPerPurchase) ?? 1
  };
  const res = await query(
    `UPDATE dbo.Ingredients
        SET name = @name, nameEn = @nameEn, unit = @unit, minStock = @minStock, costPerUnit = @costPerUnit,
            category = @category, note = @note, purchaseUnit = @purchaseUnit, unitsPerPurchase = @unitsPerPurchase
      WHERE id = @id`, params);
  if (res.rowsAffected[0] === 0) {
    await query(
      `INSERT INTO dbo.Ingredients (id, name, nameEn, unit, minStock, costPerUnit, category, note, purchaseUnit, unitsPerPurchase)
       VALUES (@id, @name, @nameEn, @unit, @minStock, @costPerUnit, @category, @note, @purchaseUnit, @unitsPerPurchase)`, params);
  }
  return { success: true };
}

export async function deleteIngredient(data) {
  const res = await query('DELETE FROM dbo.Ingredients WHERE id = @id', { id: String(data.id || '') });
  return res.rowsAffected[0] > 0 ? { success: true } : { success: false, error: 'ไม่พบวัตถุดิบ' };
}
