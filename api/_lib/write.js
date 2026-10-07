// ── คำสั่งบันทึกฝั่งงานขาย: ออเดอร์ / โต๊ะ / ชำระเงิน / กะ (เดิมอยู่ใน doPost) ──
import { query, withTransaction, insertRows } from './db.js';
import { toThaiClock, thaiTimeISO } from './time.js';
import { toText, toNum } from './rows.js';
import { deductStock } from './stock.js';
import { branchForWrite, requestedBranch, branchFilter } from './branch.js';

const ORDER_INSERT_COLS = ['Timestamp','OrderNumber','CustomerName','Address','ItemDetail','DiningOption','Price','TotalAmount','Status','OrderStartTime','CompletionTime','RecordedBy','Quantity','TsLocal','BranchId'];
const PAYMENT_COLS = ['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail','BranchId'];
const TABLE_COLS   = ['TableNumber','SessionId','ItemName','ItemNameEn','ItemPrice','Quantity','Options','Timestamp','Status','RecordedBy','BranchId'];

// รวมตัวเลือกของรายการอาหารเป็นข้อความบรรทัดเดียว (เหมือน itemOptionText เดิม)
// ใช้ทั้งออเดอร์จากเครื่องขายและออเดอร์ที่ลูกค้าสั่งเองจากคีออส ให้ได้รูปแบบเดียวกัน
export function itemOptionText(item) {
  const parts = [];
  if (item.food && item.food.priceName) parts.push(item.food.priceName);
  if (item.spice && item.spice.name) parts.push('ความเผ็ด: ' + item.spice.name);
  if (item.allPopups && item.allPopups.length > 0) item.allPopups.forEach(p => parts.push(p.name));
  if (item.promo && item.promo.id !== 'none' && item.promo.name) parts.push(item.promo.name);
  if (item.fromPopupOf) parts.push('พ่วงกับ ' + item.fromPopupOf);
  if (item.note && String(item.note).trim()) parts.push('📝 ' + String(item.note).trim());
  return parts.join(', ');
}

// เลขบิลถัดไปของคำนำหน้าหนึ่ง ๆ (เช่น SELF-#007)
// ต้องเรียกในทรานแซกชันที่จับล็อกอยู่ ไม่งั้นสองคำขอพร้อมกันจะได้เลขเดียวกัน
async function nextOrderNumber(runner, prefix) {
  const res = await runner(
    `SELECT OrderNumber FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK) WHERE OrderNumber LIKE @pat`,
    { pat: `${prefix}-#%` }
  );
  const re = new RegExp(`^${prefix}-#(\\d+)$`);
  let max = 0;
  for (const row of res.recordset) {
    const m = re.exec(String(row.OrderNumber || '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}-#${String(max + 1).padStart(3, '0')}`;
}

// ตัวนำหน้าเลขบิลของสาขา (หลังบ้าน > สาขา) — ไม่ได้ตั้งใช้รหัสสาขา ตรงกับ branchPrefix() ฝั่งหน้าเว็บ
// เลขบิล = เลขที่ใบกำกับภาษีอย่างย่อ ต้องเรียงต่อเนื่องชุดเดียวต่อสาขา ทั้งบิลหน้าร้านและบิลที่ลูกค้าสแกน QR
const cleanPrefix = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Zก-๙]/g, '');
async function branchBillPrefix(runner, branchId) {
  let set = '';
  try {
    const res = await runner(`SELECT billPrefix FROM dbo.Branches WHERE id = @id`, { id: String(branchId || '') });
    set = res.recordset.length ? res.recordset[0].billPrefix : '';
  } catch { /* ยังไม่มีตารางสาขา */ }
  return cleanPrefix(set) || cleanPrefix(branchId) || 'POS';
}

// PaymentSummary.ClientRef (กันบิลซ้ำตอนหน้าเว็บส่งซ้ำ) — ฐานข้อมูลที่ยังไม่ได้รัน sql:init ไม่มีคอลัมน์นี้
// จำเฉพาะตอนเจอแล้ว — รัน sql:init ทีหลังก็ใช้ได้ทันทีโดยไม่ต้องเปิด API ใหม่
let clientRefReady = false;
async function hasClientRef() {
  if (clientRefReady) return true;
  try {
    const res = await query(`SELECT COL_LENGTH('dbo.PaymentSummary', 'ClientRef') AS n`);
    clientRefReady = !!(res.recordset[0] && res.recordset[0].n);
  } catch { /* ถือว่ายังไม่มี */ }
  return clientRefReady;
}

// id ของกะที่เปิดค้างอยู่ — คีออสไม่รู้จักกะ จึงต้องให้ฝั่งเซิร์ฟเวอร์ผูกให้ตอนบันทึกยอด
async function openShiftId(runner) {
  const res = await runner(`SELECT TOP (1) id FROM dbo.Shifts WHERE LOWER(ISNULL([status], '')) = 'open' ORDER BY Seq DESC`);
  return res.recordset.length ? String(res.recordset[0].id) : '';
}

// ออเดอร์คีออสของ sessionId นี้ที่บันทึกไปแล้ว (ถ้ามี) — คืนเลขบิลเดิมเพื่อกันบิลซ้ำตอนยิงซ้ำ
async function findKioskOrderBySession(runner, sessionId) {
  if (!sessionId) return '';
  const res = await runner(
    `SELECT TOP (50) [Options] FROM dbo.TableOrders WHERE SessionId = @sid ORDER BY RowId DESC`,
    { sid: String(sessionId) }
  );
  for (const row of res.recordset) {
    const m = /ชำระแล้ว\s+(\S+)/.exec(String(row.Options || ''));
    if (m) return m[1];
  }
  return '';
}

export async function handleKioskPaidOrder(data) {
  const table   = String(data.tableNumber || '');
  const items   = data.items || [];
  const total   = Number(data.total) || 0;
  const method  = data.paymentMethod || 'เงินโอน (QR)';
  const time    = data.timestamp || thaiTimeISO();
  const by      = 'Self-Order';
  const session = String(data.sessionId || Date.now());
  if (items.length === 0) return { success: false, error: 'ไม่มีรายการอาหารในออเดอร์' };
  // สาขามาจากลิงก์ QR ของโต๊ะ (?b=) — ลิงก์แบบเก่าไม่มี ใช้สาขาหลัก
  const branchId = await branchForWrite(data);

  const result = await withTransaction(async (runner) => {
    // ยิงซ้ำเพราะเน็ตมือถือหลุดกลางทางเป็นเรื่องปกติ — sessionId เดิมต้องได้เลขบิลเดิมกลับไป
    const dup = await findKioskOrderBySession(runner, session);
    if (dup) return { success: true, orderNumber: dup, duplicate: true };

    const orderNo = await nextOrderNumber(runner, await branchBillPrefix(runner, branchId));
    const name    = table ? `โต๊ะ ${table} (สั่งเอง)` : 'สั่งเอง';
    const addr    = table ? `โต๊ะ ${table}` : 'สั่งเอง';
    const tsLocal = toThaiClock(time);

    // 1) บิลในตาราง Orders — สถานะ Pending เพื่อให้จอครัวเห็นทันที
    const orderRows = [];
    for (const item of items) {
      const qty    = Number(item.quantity) || 1;
      const unit   = Number(item.food && item.food.price) || 0;
      const dining = (item.dining && item.dining.name) ? item.dining.name : 'ทานที่ร้าน';
      orderRows.push([time, orderNo, name, addr, (item.food && item.food.name) || '', dining, unit * qty, total, 'Pending', time, null, by, qty, tsLocal, branchId]);
      const opt = itemOptionText(item);
      if (opt) orderRows.push([time, orderNo, name, addr, '↳ ' + opt, dining, 0, total, 'Pending', time, null, by, null, tsLocal, branchId]);
    }
    await insertRows('Orders', ORDER_INSERT_COLS, orderRows, runner);

    // 2) ยอดชำระ — ผูกกับกะที่เปิดอยู่ ให้สรุปกะและรายงานนับยอดจากคีออสด้วย
    const shiftId = await openShiftId(runner);
    await insertRows('PaymentSummary', PAYMENT_COLS, [[time, orderNo, table, method, total, by, shiftId, null, branchId]], runner);

    // 3) รายการรายโต๊ะ สถานะ paid — โต๊ะยังโชว์ว่ามีลูกค้า แต่ระบบไม่เก็บเงินซ้ำ
    const tableRows = items.map(item => {
      const opt = itemOptionText(item);
      const paidNote = '💳 ชำระแล้ว ' + orderNo;
      return [table, session, (item.food && item.food.name) || '', (item.food && item.food.nameEn) || '',
        Number(item.food && item.food.price) || 0, Number(item.quantity) || 1,
        opt ? `${opt} | ${paidNote}` : paidNote, time, 'paid', by, branchId];
    });
    await insertRows('TableOrders', TABLE_COLS, tableRows, runner);

    return { success: true, orderNumber: orderNo };
  });

  // 4) ตัดสต็อกตาม BOM — อยู่นอกทรานแซกชันโดยตั้งใจ บิลกับยอดเงินบันทึกไปแล้ว
  //    ห้ามล้มทั้งคำขอเพราะตัดสต็อกไม่ได้ (ร้านที่ยังไม่ตั้ง BOM ก็ต้องขายได้)
  if (result.success && !result.duplicate) {
    try {
      const deduct = items
        .filter(item => item.food && item.food.id)
        .map(item => ({ menuId: String(item.food.id), menuName: item.food.name || '', qty: Number(item.quantity) || 1 }));
      if (deduct.length > 0) await deductStock({ orderNumber: result.orderNumber, tableNo: table, items: deduct, branchId });
    } catch (err) {
      console.error('kioskPaidOrder deductStock:', err);
    }
  }
  return result;
}

// ── รายการอาหารรายโต๊ะ ──
export async function addTableOrder(data) {
  const tableNumber = data.tableNumber || '';
  const sessionId   = data.sessionId   || String(Date.now());
  const items       = data.items       || [];
  const timestamp   = data.timestamp   || thaiTimeISO();
  const recordedBy  = data.recordedBy  || '';
  const branchId    = await branchForWrite(data);
  const rows = items.map(item => [
    tableNumber, sessionId, (item.food && item.food.name) || '', (item.food && item.food.nameEn) || '',
    Number(item.food && item.food.price) || 0, Number(item.quantity) || 1,
    itemOptionText(item), timestamp, 'pending', recordedBy, branchId
  ]);
  await insertRows('TableOrders', TABLE_COLS, rows);
  return { success: true, sessionId };
}

export async function clearAllTableOrders(data = {}) {
  // ล้างทุกแถวรวมรายการที่ลูกค้าจ่ายมาแล้วจากคีออส — ของพวกนั้นถูกบันทึกเป็นบิลตั้งแต่ตอนจ่ายแล้ว
  // ระบุสาขามา = ล้างเฉพาะโต๊ะของสาขานั้น ไม่ไปล้างโต๊ะของสาขาอื่น
  const branchId = requestedBranch(data);
  await query(`DELETE FROM dbo.TableOrders WHERE 1 = 1${branchFilter(branchId)}`, { branchId });
  return { success: true };
}

export async function clearTableOrders(data) {
  const tableNumber = String(data.tableNumber || '');
  // includePaid = ปิดโต๊ะจบจริง ๆ → ล้างรายการที่จ่ายแล้วด้วย
  const includePaid = data.includePaid === true;
  // โต๊ะ 1 ของแต่ละสาขาคือคนละโต๊ะ — ต้องล้างเฉพาะของสาขาที่ขอ
  const branchId = requestedBranch(data);
  await query(
    `DELETE FROM dbo.TableOrders WHERE TableNumber = @t${branchFilter(branchId)}
       ${includePaid ? '' : `AND ISNULL([Status], '') <> 'paid'`}`,
    { t: tableNumber, branchId }
  );
  return { success: true };
}

export async function deleteTableOrderItem(data) {
  const res = await query(
    `DELETE FROM dbo.TableOrders
      WHERE RowId = (SELECT TOP (1) RowId FROM dbo.TableOrders
                      WHERE TableNumber = @t
                        AND SessionId = @s
                        AND ISNULL(ItemName, '') = @n${branchFilter(requestedBranch(data))}
                      ORDER BY RowId DESC)`,
    { t: String(data.tableNumber || ''), s: String(data.sessionId || ''), n: String(data.itemName || ''), branchId: requestedBranch(data) }
  );
  return { success: res.rowsAffected[0] > 0 };
}

export async function moveTable(data) {
  // ย้ายทั้งโต๊ะ = ลูกค้าย้ายที่นั่งจริง จึงยกรายการที่จ่ายมาแล้วจากคีออสไปด้วย
  const res = await query(
    `UPDATE dbo.TableOrders SET TableNumber = @to WHERE TableNumber = @from${branchFilter(requestedBranch(data))}`,
    { to: String(data.toTable || ''), from: String(data.fromTable || ''), branchId: requestedBranch(data) }
  );
  return { success: res.rowsAffected[0] > 0 };
}

// ย้าย/แยกเฉพาะบางรายการไปอีกโต๊ะ (จับคู่ด้วย sessionId+itemName+options+price ตามจำนวนที่เลือก)
export async function moveTableItems(data) {
  const fromTable = String(data.fromTable || '');
  const toTable   = String(data.toTable   || '');
  const need = {};
  (data.keys || []).forEach(k => {
    const sig = `${k.sessionId || ''}|${k.itemName || ''}|${k.options || ''}|${Number(k.price) || 0}`;
    need[sig] = (need[sig] || 0) + 1;
  });

  const res = await query(
    `SELECT RowId, SessionId, ItemName, [Options], ItemPrice FROM dbo.TableOrders
      WHERE TableNumber = @from AND ISNULL([Status], '') <> 'paid'${branchFilter(requestedBranch(data))}
      ORDER BY RowId ASC`,
    { from: fromTable, branchId: requestedBranch(data) }
  );

  const moving = [];
  for (const row of res.recordset) {
    const sig = `${row.SessionId ?? ''}|${row.ItemName ?? ''}|${row.Options ?? ''}|${Number(row.ItemPrice) || 0}`;
    if (need[sig] > 0) { moving.push(row.RowId); need[sig] -= 1; }
  }
  if (moving.length === 0) return { success: false };

  const params = { to: toTable };
  const names = moving.map((id, i) => { params[`r${i}`] = id; return `@r${i}`; });
  await query(`UPDATE dbo.TableOrders SET TableNumber = @to WHERE RowId IN (${names.join(', ')})`, params);
  return { success: true };
}

// ── บิล ──
// rows = อาเรย์ 13 ช่องเรียงตามหัวตารางเดิม (หน้าบ้านส่งมาแบบนี้ตั้งแต่ยุคชีท)
export async function insertOrder(data) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  // บิลค้างในเครื่องที่ส่งซ้ำจากหน้าเว็บรุ่นเก่าไม่มี branchId → ลงสาขาหลัก
  const branchId = await branchForWrite(data);
  // หน้าเว็บรุ่นใหม่ให้เซิร์ฟเวอร์ออกเลขบิล (assignNumber) — เลขเดียวต่อสาขา ออกในทรานแซกชันที่ล็อกอยู่ จึงไม่ซ้ำแม้มีหลายเครื่อง
  // หน้าเว็บรุ่นเก่า / บิลค้างเก่าที่มีเลขมาแล้ว ใช้เลขที่ส่งมาเหมือนเดิม
  const assign = !!data.assignNumber;
  const clientRef = toText(data.clientRef);
  const useRef = assign && !!clientRef && await hasClientRef();
  const result = await withTransaction(async (runner) => {
    if (useRef) {
      // ส่งซ้ำ (เน็ตหลุดหลังเซิร์ฟเวอร์บันทึกแล้ว) → คืนเลขบิลเดิม ไม่บันทึกซ้ำ
      const dup = await runner(
        `SELECT TOP (1) orderNumber FROM dbo.PaymentSummary WITH (UPDLOCK, HOLDLOCK) WHERE ClientRef = @ref`,
        { ref: clientRef }
      );
      if (dup.recordset.length) return { success: true, orderNumber: dup.recordset[0].orderNumber, duplicate: true };
    }
    const orderNo = assign
      ? await nextOrderNumber(runner, await branchBillPrefix(runner, branchId))
      : toText(data.payment && data.payment.orderNumber) || toText(rows[0] && rows[0][1]);
    if (rows.length > 0) {
      const values = rows.map(r => {
        const row = Array.isArray(r) ? r : [];
        const cells = Array.from({ length: 13 }, (_, i) => (row[i] === undefined ? null : row[i]));
        if (assign) cells[1] = orderNo;
        // ช่องว่างในชีทคือ '' — ในตารางเก็บเป็น NULL เพื่อให้คอลัมน์ตัวเลขรับได้
        return [
          toText(cells[0]), toText(cells[1]), toText(cells[2]), toText(cells[3]), toText(cells[4]),
          toText(cells[5]), toNum(cells[6]), toNum(cells[7]), toText(cells[8]), toText(cells[9]),
          toText(cells[10]), toText(cells[11]), toNum(cells[12]), toThaiClock(cells[0]), branchId
        ];
      });
      await insertRows('Orders', ORDER_INSERT_COLS, values, runner);
    }
    // บันทึกข้อมูลการชำระเงินในคำขอเดียวกัน — กันกรณีบิลถูกบันทึกแต่ payment หาย
    if (data.payment) {
      const p = data.payment;
      const row = [
        thaiTimeISO(), assign ? orderNo : toText(p.orderNumber), toText(p.tableNo), toText(p.paymentMethod),
        Number(p.grandTotal) || 0, toText(p.staff), toText(p.shiftId), toText(p.splitDetail), branchId
      ];
      if (useRef) await insertRows('PaymentSummary', [...PAYMENT_COLS, 'ClientRef'], [[...row, clientRef]], runner);
      else await insertRows('PaymentSummary', PAYMENT_COLS, [row], runner);
    }
    return { success: true, orderNumber: orderNo };
  });
  return result;
}

export async function updateStatus(data) {
  const status = String(data.status || '');
  const res = await query(
    `UPDATE dbo.Orders
        SET [Status] = @status,
            CompletionTime = CASE WHEN LOWER(@status) = 'completed' AND @completion <> '' THEN @completion ELSE CompletionTime END
      WHERE ISNULL(OrderNumber, '') = @id OR ISNULL([Timestamp], '') = @id`,
    { status, completion: String(data.completionTime || ''), id: String(data.orderId ?? '') }
  );
  return { success: res.rowsAffected[0] > 0 };
}

export async function cancelOrder(data) {
  const res = await query(
    `UPDATE dbo.Orders SET [Status] = 'cancelled' WHERE ISNULL(OrderNumber, '') = @n`,
    { n: String(data.orderNumber || '') }
  );
  return { success: res.rowsAffected[0] > 0 };
}

// ── บิลค้าง (ตอนปิดกะมีโต๊ะยังไม่ชำระ) ──
export async function saveOutstandingBills(data) {
  const rows = (data.bills || []).map(b => ([
    b.id || `OB-${Date.now()}-${b.tableNo}`,
    toText(b.shiftId), String(b.tableNo || ''), toText(b.customerName), toText(b.phone),
    Number(b.total) || 0,
    typeof b.items === 'string' ? b.items : JSON.stringify(b.items || []),
    b.createdAt || thaiTimeISO(),
    b.status || 'unpaid'
  ]));
  await insertRows('OutstandingBills', ['id','shiftId','tableNo','customerName','phone','total','items','createdAt','status'], rows);
  return { success: true };
}

// ── อนุมัติการโอนผ่าน QR ──
export async function createPaymentApproval(data) {
  await insertRows('PaymentApprovals', ['id','timestamp','tableNo','orderNumber','amount','requestedBy','status','approver','respondedAt'], [[
    data.id || `APV-${Date.now()}`, thaiTimeISO(), toText(data.tableNo), toText(data.orderNumber),
    Number(data.amount) || 0, toText(data.requestedBy), 'pending', null, null
  ]]);
  return { success: true };
}

export async function respondPaymentApproval(data) {
  const res = await query(
    `UPDATE dbo.PaymentApprovals
        SET [status] = @status, approver = @approver, respondedAt = @at
      WHERE ISNULL(id, '') = @id`,
    { status: data.status || 'approved', approver: toText(data.approver), at: thaiTimeISO(), id: String(data.id || '') }
  );
  return res.rowsAffected[0] > 0 ? { success: true } : { success: false, error: 'Not found' };
}

// ── กะ ──
export async function openShift(data) {
  const shiftId = `SHIFT-${Date.now()}`;
  await insertRows('Shifts',
    ['id','openTime','closeTime','openStaff','closeStaff','openCash','closeCash','totalSales','totalCash','totalCard','totalTransfer','totalOrders','status','note'],
    [[shiftId, thaiTimeISO(), null, toText(data.staff), null, Number(data.openCash) || 0, 0, 0, 0, 0, 0, 0, 'open', null]]
  );
  return { success: true, shiftId };
}

export async function closeShift(data) {
  const res = await query(
    `UPDATE dbo.Shifts
        SET closeTime = @closeTime, closeStaff = @staff, closeCash = @closeCash,
            totalSales = @totalSales, totalCash = @totalCash, totalCard = @totalCard,
            totalTransfer = @totalTransfer, totalOrders = @totalOrders,
            [status] = 'closed', note = @note
      WHERE id = @id`,
    {
      closeTime: thaiTimeISO(), staff: toText(data.staff), closeCash: Number(data.closeCash) || 0,
      totalSales: Number(data.totalSales) || 0, totalCash: Number(data.totalCash) || 0,
      totalCard: Number(data.totalCard) || 0, totalTransfer: Number(data.totalTransfer) || 0,
      totalOrders: Number(data.totalOrders) || 0, note: toText(data.note), id: String(data.shiftId || '')
    }
  );
  return res.rowsAffected[0] > 0 ? { success: true } : { success: false, error: 'ไม่พบกะ' };
}

export async function savePaymentRecord(data) {
  // รับ timestamp ได้ (ใช้ตอน backfill บิลย้อนหลังให้ตรงวันเดิม) — ไม่ส่งมาก็ใช้เวลาปัจจุบัน
  const ts = data.timestamp ? String(data.timestamp) : thaiTimeISO();
  await insertRows('PaymentSummary', PAYMENT_COLS, [[
    ts, toText(data.orderNumber), toText(data.tableNo), toText(data.paymentMethod),
    Number(data.grandTotal) || 0, toText(data.staff), toText(data.shiftId), toText(data.splitDetail),
    await branchForWrite(data)
  ]]);
  return { success: true };
}

// ── ฝากเหล้า / ของเสีย ──
export async function saveLiquorRecord(data) {
  await insertRows('LiquorStorage', ['timestamp','type','customerName','phone','productName','qty','note','staff','category','unit'], [[
    thaiTimeISO(), data.type || 'ฝาก', toText(data.customerName), toText(data.phone), toText(data.productName),
    Number(data.qty) || 0, toText(data.note), toText(data.staff), data.category || 'เหล้า', data.unit || 'ขวด'
  ]]);
  return { success: true };
}

// บันทึกการทิ้ง / การเตรียม / การนับสต็อก — ตาราง Waste เดียวกัน แยกด้วยคอลัมน์ kind (waste/prep/count)
// itemType: 'menu' (เมนูที่ขาย) / 'ingredient' (วัตถุดิบในระบบสต็อก)
async function saveKitchenLog(data, kind) {
  const ts = data.timestamp || thaiTimeISO();
  const itemType = data.itemType === 'ingredient' ? 'ingredient' : 'menu';
  await insertRows('Waste', ['timestamp','branch','itemName','category','qty','unit','note','staff','TsLocal','kind','itemType'], [[
    ts, toText(data.branch), toText(data.itemName), toText(data.category),
    Number(data.qty) || 0, toText(data.unit), toText(data.note), toText(data.staff), toThaiClock(ts), kind, itemType
  ]]);
  return { success: true };
}

export const saveWasteRecord = (data) => saveKitchenLog(data, 'waste');
export const savePrepRecord = (data) => saveKitchenLog(data, 'prep');
export const saveStockCount = (data) => saveKitchenLog(data, 'count');
