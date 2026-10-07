// ── คำสั่งอ่านข้อมูล (เดิมคือ doGet ใน Apps Script) ──
// รูปแบบคำตอบของทุก action เหมือนของเดิมทุกตัวอักษร หน้าบ้านจึงใช้ต่อได้ทันที
import { query } from './db.js';
import { dayStart, dayEnd } from './time.js';
import { requestedBranch, branchFilter, defaultBranchId } from './branch.js';
import { getMenuBranchRows, applyBranchMenu } from './menuBranch.js';
import {
  mapOrder, mapTableOrder, mapMenu, mapCategory, mapPromotion, mapUser, mapBranch, mapPrinter,
  mapDiscount, mapLiquor, mapWaste, mapApproval, mapOutstanding, mapShift, mapPayment,
  CATEGORY_SPEC
} from './rows.js';

const cols = (list) => list.map(c => `[${c}]`).join(', ');

const ORDER_COLS   = cols(['Timestamp','OrderNumber','CustomerName','Address','ItemDetail','DiningOption','Price','TotalAmount','Status','OrderStartTime','CompletionTime','RecordedBy','Quantity']);
const TABLE_COLS   = cols(['TableNumber','SessionId','ItemName','ItemNameEn','ItemPrice','Quantity','Options','Timestamp','Status','RecordedBy']);
const MENU_BASE    = ['id','category','name','nameEn','description','descriptionEn','price','image','isActive','bundledItems','popupConfig','prices','categories','printerId'];
const MENU_COLS    = cols([...MENU_BASE, 'branches']);
const CATEGORY_COLS= cols(Object.keys(CATEGORY_SPEC));
// ฐานข้อมูลที่ยังไม่ได้รัน sql:init (ยังไม่มีคอลัมน์ใหม่) → อ่านแบบเดิม หน้าร้านต้องโหลดเมนูได้เสมอ
const CATEGORY_BASE= cols(Object.keys(CATEGORY_SPEC).filter(k => k !== 'visibility'));
const PROMO_COLS   = cols(['id','name','nameEn','price','origPrice']);
const USER_COLS    = cols(['id','username','pin','canCheckout','isAdmin','isCashier','branch']);
const BRANCH_BASE  = ['id','name','billPrefix','phone','address','taxId','receiptFooter','isActive'];
const BRANCH_COLS  = cols([...BRANCH_BASE, 'posId']);
// branchId = คอลัมน์ BranchId (SQL ไม่สนตัวพิมพ์เล็ก/ใหญ่ ส่วนชื่อคีย์ที่ได้ตามที่เขียนใน SELECT)
const PRINTER_COLS = cols(['id','name','ip','type','printMode','branchId','categories']);
const DISCOUNT_COLS= cols(['id','name','type','value','categories']);
const LIQUOR_COLS  = cols(['timestamp','type','customerName','phone','productName','qty','note','staff','category','unit']);
const WASTE_BASE   = ['timestamp','branch','itemName','category','qty','unit','note','staff'];
const WASTE_COLS   = cols(WASTE_BASE);
const WASTE_COLS_KIND = cols([...WASTE_BASE, 'kind', 'itemType']);
const APPROVAL_COLS= cols(['id','timestamp','tableNo','orderNumber','amount','requestedBy','status','approver','respondedAt']);
const OUTSTAND_COLS= cols(['id','shiftId','tableNo','customerName','phone','total','items','createdAt','status']);
const SHIFT_COLS   = cols(['id','openTime','closeTime','openStaff','closeStaff','openCash','closeCash','totalSales','totalCash','totalCard','totalTransfer','totalOrders','status','note']);
const PAYMENT_COLS = cols(['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']);

// N แถวล่าสุดของตารางที่โตเรื่อย ๆ แต่ยังส่งกลับเรียงเก่า→ใหม่เหมือนลำดับแถวในชีท
// branchId = กรองเฉพาะแถวของสาขานั้น ('' = ทุกสาขา เหมือนเดิม)
async function lastRows(table, colList, mapper, limit, branchId = '') {
  const where = `WHERE 1 = 1${branchFilter(branchId)}`;
  const sqlText = limit
    ? `SELECT ${colList} FROM (SELECT TOP (@limit) RowId, ${colList} FROM dbo.${table} ${where} ORDER BY RowId DESC) t ORDER BY RowId ASC`
    : `SELECT ${colList} FROM dbo.${table} ${where} ORDER BY RowId ASC`;
  const res = await query(sqlText, { ...(limit ? { limit } : {}), branchId });
  return res.recordset.map(mapper);
}

async function allRows(table, colList, mapper, orderBy = 'Seq') {
  const res = await query(`SELECT ${colList} FROM dbo.${table} ORDER BY ${orderBy} ASC`);
  return res.recordset.map(mapper);
}

export const getSettings = async () => {
  const res = await query(`SELECT [value] FROM dbo.Settings WHERE [key] = 'pos_settings'`);
  if (!res.recordset.length) return null;
  try { return JSON.parse(res.recordset[0].value); } catch { return null; }
};

// ผังโต๊ะของแต่ละสาขา — { [branchId]: [โต๊ะ...] } เก็บในแถว Settings 'branch_tables'
export const getBranchTables = async () => {
  const res = await query(`SELECT [value] FROM dbo.Settings WHERE [key] = 'branch_tables'`);
  if (!res.recordset.length) return {};
  try {
    const v = JSON.parse(res.recordset[0].value);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

// เมนูเรียงตามลำดับที่จัดไว้ในหน้าจัดการเมนู — เมนูที่ยังไม่เคยจัด (sortOrder ว่าง) ต่อท้ายตามลำดับที่สร้าง
// ฐานข้อมูลที่ยังไม่ได้รัน sql:init (ไม่มีคอลัมน์ sortOrder) → เรียงแบบเดิม ไม่ให้หน้าร้านโหลดเมนูไม่ขึ้น
const getMenuRows = () => allRows('Menu', MENU_COLS, mapMenu, 'ISNULL(sortOrder, 2147483647) ASC, Seq')
  .catch(() => allRows('Menu', cols(MENU_BASE), mapMenu, 'ISNULL(sortOrder, 2147483647) ASC, Seq'))
  .catch(() => allRows('Menu', cols(MENU_BASE), mapMenu));
const getCategoryRows = () => allRows('Categories', CATEGORY_COLS, mapCategory)
  .catch(() => allRows('Categories', CATEGORY_BASE, mapCategory));

// ตารางสาขาเพิ่มมาทีหลัง — เครื่องที่ยังไม่ได้รัน sql:init จะยังไม่มีตาราง
// ต้องไม่ทำให้ getStatic ทั้งก้อนพัง ไม่งั้นหน้าร้านโหลดเมนูไม่ขึ้น
const getBranches = () => allRows('Branches', BRANCH_COLS, mapBranch)
  .catch(() => allRows('Branches', cols(BRANCH_BASE), mapBranch))
  .catch(() => []);

// ข้อมูล "เย็น" — เปลี่ยนเฉพาะตอนแก้หลังบ้าน
// branchId = ส่งเมนูที่ปรับตามสาขานั้นแล้ว ('' = เมนูกลาง ใช้ในหน้าหลังบ้าน)
export async function buildStaticData(branchId = '') {
  const [categories, rawMenu, promotions, users, printers, discounts, settings, branches, branchTables, defaultBranch, menuBranchRows] = await Promise.all([
    getCategoryRows(),
    getMenuRows(),
    allRows('Promotions', PROMO_COLS, mapPromotion),
    // ไม่ส่งรหัสพนักงานออกไป — ใครก็เรียก getStatic ได้ (หน้าลูกค้าสั่งเอง) รหัสเช็กที่เซิร์ฟเวอร์ตอนล็อกอิน
    allRows('Users', USER_COLS, mapUser).then(list => list.map(({ pin, ...u }) => ({ ...u, hasPin: String(pin ?? '') !== '' }))),
    allRows('Printers', PRINTER_COLS, mapPrinter),
    allRows('Discounts', DISCOUNT_COLS, mapDiscount),
    getSettings(),
    getBranches(),
    getBranchTables(),
    defaultBranchId(),
    getMenuBranchRows(branchId)
  ]);
  const menu = applyBranchMenu(rawMenu, menuBranchRows, printers, branchId);
  return { categories, menu, promotions, users, printers, discounts, settings, branches, branchTables, defaultBranch };
}

const getTableOrders = (branchId = '') => lastRows('TableOrders', TABLE_COLS, mapTableOrder, 0, branchId);

export async function handleGet(action, params) {
  switch (action) {
    // ── ข้อมูลร้อน: หน้าบ้าน poll ทุก 20 วิ ──
    // ?branch= → เฉพาะโต๊ะ/บิลของสาขานั้น (หน้าร้านแต่ละสาขาเห็นแค่ของตัวเอง)
    case 'getLive': {
      const branchId = requestedBranch(params);
      const [tableOrders, orders, payments] = await Promise.all([
        getTableOrders(branchId),
        lastRows('Orders', ORDER_COLS, mapOrder, 300, branchId),
        lastRows('PaymentSummary', PAYMENT_COLS, mapPayment, 300, branchId)
      ]);
      return { tableOrders, orders, payments };
    }

    // ── คิวใบครัวสำหรับ Print Server: เฉพาะบิลที่ยังไม่เสร็จ ──
    // ?branch= → Print Server ของแต่ละสาขาพิมพ์เฉพาะใบครัวของร้านตัวเอง
    case 'getKitchenQueue': {
      const branchId = requestedBranch(params);
      const res = await query(
        `SELECT ${ORDER_COLS} FROM (
           SELECT TOP (200) RowId, ${ORDER_COLS} FROM dbo.Orders WHERE 1 = 1${branchFilter(branchId)} ORDER BY RowId DESC
         ) t
         WHERE OrderNumber IN (SELECT OrderNumber FROM (SELECT TOP (200) OrderNumber, [Status] FROM dbo.Orders WHERE 1 = 1${branchFilter(branchId)} ORDER BY RowId DESC) p WHERE LOWER(p.[Status]) = 'pending' AND p.OrderNumber IS NOT NULL)
         ORDER BY RowId ASC`,
        { branchId }
      );
      return { orders: res.recordset.map(mapOrder) };
    }

    // ?branch= → เมนูที่ปรับตามสาขา (เปิด/ปิดขาย ราคา ปริ้นเตอร์) — ไม่ส่ง = เมนูกลาง
    case 'getStatic':
      return await buildStaticData(requestedBranch(params));

    // รายชื่อพนักงานพร้อมรหัส — เฉพาะหน้าหลังบ้าน > พนักงาน (แอดมินสำนักงานใหญ่)
    case 'getUsers':
      return { success: true, users: await allRows('Users', USER_COLS, mapUser) };

    // ส่วนที่สาขาหนึ่งปรับจากเมนูกลาง — ใช้ในหน้าหลังบ้าน > เมนูรายสาขา
    case 'getMenuBranch':
      return { success: true, rows: await getMenuBranchRows(requestedBranch(params)) };

    case 'getAllData': {
      const [data, tableOrders, orders] = await Promise.all([
        buildStaticData(),
        getTableOrders(),
        lastRows('Orders', ORDER_COLS, mapOrder, 2000)
      ]);
      return { ...data, tableOrders, orders };
    }

    case 'getTableOrders': {
      const res = await query(
        `SELECT ${TABLE_COLS} FROM dbo.TableOrders
          WHERE TableNumber = @tableNumber AND ISNULL([Status], '') <> 'paid'${branchFilter(requestedBranch(params))}
          ORDER BY RowId ASC`,
        { tableNumber: String(params.tableNumber || ''), branchId: requestedBranch(params) }
      );
      return { success: true, orders: res.recordset.map(mapTableOrder) };
    }

    case 'getLiquorRecords':
      return { success: true, records: await lastRows('LiquorStorage', LIQUOR_COLS, mapLiquor) };

    // ?kind=prep → บันทึกการเตรียม / ?kind=count → บันทึกการนับสต็อก / ไม่ส่ง = บันทึกการทิ้ง (แถวเดิมที่ kind ว่างนับเป็นการทิ้ง)
    case 'getWasteRecords': {
      const kind = ['prep', 'count'].includes(String(params.kind || '')) ? String(params.kind) : 'waste';
      const prep = kind !== 'waste';
      try {
        const res = await query(
          `SELECT ${WASTE_COLS_KIND} FROM (SELECT TOP (1000) RowId, ${WASTE_COLS_KIND} FROM dbo.Waste
             WHERE ISNULL(kind, 'waste') = @kind ORDER BY RowId DESC) t ORDER BY RowId ASC`,
          { kind });
        return { success: true, records: res.recordset.map(mapWaste) };
      } catch {
        // ยังไม่ได้รัน sql:init (ไม่มีคอลัมน์ kind) → ทุกแถวคือการทิ้ง
        return { success: true, records: prep ? [] : await lastRows('Waste', WASTE_COLS, mapWaste) };
      }
    }

    // รายชื่อวัตถุดิบสำหรับหน้าบันทึกการทิ้ง/เตรียม — ส่งแค่ชื่อ/หน่วย/หมวด (ไม่ส่งต้นทุน) พนักงานทุกคนเรียกได้
    case 'getIngredientNames': {
      const res = await query(`SELECT id, name, unit, category FROM dbo.Ingredients ORDER BY Seq ASC`).catch(() => ({ recordset: [] }));
      return { success: true, ingredients: res.recordset.map(r => ({ id: String(r.id), name: r.name || '', unit: r.unit || '', category: r.category || '' })) };
    }

    // คำขออนุมัติ QR — เฉพาะที่ยัง pending หรือเพิ่งตอบใน 10 นาทีล่าสุด (เหมือนของเดิม)
    case 'getPaymentApprovals': {
      const cutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const res = await query(
        `SELECT ${APPROVAL_COLS} FROM dbo.PaymentApprovals
          WHERE [status] = 'pending'
             OR (respondedAt IS NOT NULL AND respondedAt <> '' AND TRY_CONVERT(datetimeoffset(3), respondedAt) >= TRY_CONVERT(datetimeoffset(3), @cutoff))
          ORDER BY RowId ASC`,
        { cutoff: cutoffIso }
      );
      return { success: true, approvals: res.recordset.map(mapApproval) };
    }

    case 'getOutstandingBills':
      return { success: true, bills: await lastRows('OutstandingBills', OUTSTAND_COLS, mapOutstanding) };

    case 'getShifts':
      return { success: true, shifts: await allRows('Shifts', SHIFT_COLS, mapShift) };

    // ?branch= → คงเหลือของสาขานั้น / ไม่ระบุ = รวมทุกสาขา
    case 'getStock':       return await getStockLevels(requestedBranch(params));
    case 'getIngredients': return await getIngredientsList();

    case 'getReportData': {
      const from = dayStart(params.from);
      const to   = dayEnd(params.to);
      const range = (col) => (from || to)
        ? `WHERE ${col} IS NULL OR (${from ? `${col} >= @from` : '1=1'} AND ${to ? `${col} <= @to` : '1=1'})`
        : '';
      const bounds = {};
      if (from) bounds.from = from;
      if (to)   bounds.to   = to;

      const [orders, payments, shifts, waste] = await Promise.all([
        // BranchId ให้หน้าใบกำกับภาษีของแต่ละสาขาเห็นเฉพาะบิลของร้านตัวเอง
        query(`SELECT ${ORDER_COLS}, [BranchId] FROM dbo.Orders ${range('TsLocal')} ORDER BY RowId ASC`, bounds)
          .then(r => r.recordset.map(row => ({ ...mapOrder(row), BranchId: row.BranchId ? String(row.BranchId) : '' }))),
        // payments ส่งทั้งหมดไม่กรองวัน — หน้าบ้านจับคู่ด้วยเลขบิล (เหมือนของเดิม)
        lastRows('PaymentSummary', PAYMENT_COLS, mapPayment),
        allRows('Shifts', SHIFT_COLS, mapShift),
        // รายงานนับเฉพาะการทิ้ง (บันทึกการเตรียมอยู่ตารางเดียวกันแต่ kind = 'prep')
        query(`SELECT ${WASTE_COLS} FROM dbo.Waste WHERE (${range('TsLocal').replace(/^WHERE /, '') || '1 = 1'}) AND ISNULL(kind, 'waste') = 'waste' ORDER BY RowId ASC`, bounds)
          .catch(() => query(`SELECT ${WASTE_COLS} FROM dbo.Waste ${range('TsLocal')} ORDER BY RowId ASC`, bounds))
          .then(r => r.recordset.map(mapWaste))
      ]);
      return { success: true, orders, payments, shifts, waste };
    }

    case 'getSalesReport': return await generateSalesReport();

    default:
      return null;   // ให้ router ตอบ Unknown action
  }
}

// ── สต็อก: คงเหลือ = รับเข้า − ตัดออก (เดิมคำนวณจาก 3 ชีท) ──
export async function getStockLevels(branchId = '') {
  const where = branchId ? 'WHERE BranchId = @branchId' : '';
  const res = await query(`
    SELECT i.id, i.name, i.nameEn, i.unit, i.minStock, i.costPerUnit, i.purchaseUnit, i.unitsPerPurchase,
           ISNULL(si.totalIn, 0)  AS totalIn,
           ISNULL(so.totalOut, 0) AS totalOut
      FROM dbo.Ingredients i
      LEFT JOIN (SELECT ingId, SUM(ISNULL(usageQty, 0))  AS totalIn  FROM dbo.StockIn  ${where} GROUP BY ingId) si ON si.ingId = i.id
      LEFT JOIN (SELECT ingId, SUM(ISNULL(deductQty, 0)) AS totalOut FROM dbo.StockOut ${where} GROUP BY ingId) so ON so.ingId = i.id
     ORDER BY i.Seq ASC`, { branchId });

  const stock = res.recordset.map(r => {
    const current = Number(r.totalIn) - Number(r.totalOut);
    const minimum = Number(r.minStock) || 0;
    return {
      id: String(r.id), name: r.name || '', nameEn: r.nameEn || '', unit: r.unit || '',
      current: Math.round(current * 100) / 100,
      minimum, price: Number(r.costPerUnit) || 0,
      purchaseUnit: r.purchaseUnit || '', unitsPerPurchase: Number(r.unitsPerPurchase) || 1,
      status: current <= 0 ? 'OUT' : current <= minimum ? 'LOW' : 'OK'
    };
  });
  return { success: true, branchId, stock, lowItems: stock.filter(s => s.status !== 'OK') };
}

export async function getIngredientsList() {
  const res = await query(`SELECT id, name, nameEn, unit, minStock, costPerUnit, category, note, purchaseUnit, unitsPerPurchase FROM dbo.Ingredients ORDER BY Seq ASC`);
  const ingredients = res.recordset.map(r => ({
    id: String(r.id), name: r.name || '', nameEn: r.nameEn || '', unit: r.unit || '',
    minStock: Number(r.minStock) || 0, costPerUnit: Number(r.costPerUnit) || 0,
    category: r.category || '', note: r.note || '',
    purchaseUnit: r.purchaseUnit || '', unitsPerPurchase: Number(r.unitsPerPurchase) || 1
  }));
  return { success: true, ingredients };
}

export async function getBomRows() {
  const res = await query(`SELECT menuId, menuName, menuNameEn, ingId, ingName, qty, unit, costPerUnit, note FROM dbo.Bom ORDER BY RowId ASC`);
  return { success: true, rows: res.recordset };
}

// ── สรุปยอดขายรวม (เหมือน generateSalesReport เดิม) ──
export async function generateSalesReport() {
  const [payRes, orderRes] = await Promise.all([
    query(`SELECT orderNumber, paymentMethod, grandTotal, splitDetail FROM dbo.PaymentSummary ORDER BY RowId ASC`),
    query(`SELECT ItemDetail, Price, [Status] FROM dbo.Orders ORDER BY RowId ASC`)
  ]);

  let totalSales = 0;
  let totalBills = 0;
  const paymentBreakdown = { 'เงินสด': 0, 'เงินโอน / QR': 0, 'บัตรเครดิต': 0 };
  const uniqueBills = new Set();

  for (const p of payRes.recordset) {
    const billNo = p.orderNumber;
    if (!billNo) continue;
    if (!uniqueBills.has(billNo)) { uniqueBills.add(billNo); totalBills++; }

    const grandTotal = Number(p.grandTotal) || 0;
    totalSales += grandTotal;

    const method = String(p.paymentMethod || '');
    if (method.includes('แยกจ่าย') || p.splitDetail) {
      let split = null;
      try { split = typeof p.splitDetail === 'string' ? JSON.parse(p.splitDetail) : p.splitDetail; } catch { /* ไม่ใช่ JSON → ข้าม */ }
      if (split) {
        paymentBreakdown['เงินสด']        += Number(split.cash || 0);
        paymentBreakdown['เงินโอน / QR']  += Number(split.transfer || 0);
        paymentBreakdown['บัตรเครดิต']    += Number(split.card || 0);
      }
    } else if (method.includes('สด') || method.toLowerCase() === 'cash') {
      paymentBreakdown['เงินสด'] += grandTotal;
    } else if (method.includes('โอน') || method.includes('QR') || method.toLowerCase() === 'transfer') {
      paymentBreakdown['เงินโอน / QR'] += grandTotal;
    } else if (method.includes('บัตร') || method.toLowerCase() === 'card') {
      paymentBreakdown['บัตรเครดิต'] += grandTotal;
    } else {
      paymentBreakdown['เงินสด'] += grandTotal;
    }
  }

  // จำนวนที่ขายได้รายเมนู ไม่นับแถวแอดออน/ป๊อปอัพ
  const menuSales = {};
  for (const o of orderRes.recordset) {
    if (String(o.Status || '').toLowerCase() === 'cancelled') continue;
    const detail = String(o.ItemDetail || '').trim();
    if (!detail) continue;
    if (detail.startsWith('↳') || detail.startsWith('ความเผ็ด') || detail.startsWith('ลูกค้า:')) continue;

    let qty = 1;
    let name = detail;
    const match = detail.match(/(.*?)\s*\(x(\d+)\)$/);
    if (match) { name = match[1].trim(); qty = parseInt(match[2], 10) || 1; }

    if (!menuSales[name]) menuSales[name] = { qty: 0, revenue: 0 };
    menuSales[name].qty += qty;
    menuSales[name].revenue += Number(o.Price) || 0;
  }

  return { success: true, totalSales, totalBills, paymentBreakdown, menuSales };
}
