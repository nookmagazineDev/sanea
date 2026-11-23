// ── คำสั่งบันทึกฝั่งงานขาย: ออเดอร์ / โต๊ะ / ชำระเงิน / กะ (เดิมอยู่ใน doPost) ──
import { query, withTransaction, insertRows, lockKey } from './db.js';
import { holdMemberMenu, releaseMemberMenu } from './memberMenu.js';
import { toThaiClock, thaiTimeISO } from './time.js';
import { toText, toNum } from './rows.js';
import { deductStock } from './stock.js';
import { branchForWrite, requestedBranch, branchFilter } from './branch.js';
import { billPayload, queueBill, sendBillNow, flushCrmQueue } from './crm.js';

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

// ── เลขบิล ──
// ทุกคำขอที่ออกเลขบิลของคำนำหน้าเดียวกันต่อคิวกันที่ lockKey('bill:<คำนำหน้า>') (สาขาเดียวกันทำทีละบิล ต่างสาขาไม่รอกัน)
// แล้วบวก 1 ที่ตาราง BillCounters — ไม่ต้องไล่อ่านบิลเก่าทั้งหมด จึงเร็วเท่าเดิมแม้บิลสะสมเป็นแสนใบ
// เลขออกในทรานแซกชันเดียวกับบิล: บันทึกบิลไม่สำเร็จ = ตัวนับย้อนกลับด้วย เลขจึงต่อเนื่องไม่ข้าม (เลขที่ใบกำกับภาษีอย่างย่อ)
const lockBill = (runner, prefix) => lockKey(runner, 'bill:' + prefix);

// ฐานข้อมูลที่ยังไม่ได้รัน sql:init ไม่มีตาราง BillCounters → ใช้วิธีเดิม (อ่านเลขสูงสุดจากบิล)
// Supabase: ตาราง BillCounters สร้างไว้แล้วตั้งแต่แรก
async function hasBillCounters() { return true; }

// เลขสูงสุดที่มีอยู่ในบิลเดิมของคำนำหน้านี้ (ใช้ครั้งแรกตอนยังไม่มีตัวนับ / ฐานข้อมูลยังไม่มีตาราง)
async function maxBillNumber(runner, prefix) {
  const res = await runner(`SELECT OrderNumber FROM dbo.Orders WHERE OrderNumber LIKE @pat`, { pat: `${prefix}-#%` });
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-#(\\d+)$`);
  let max = 0;
  for (const row of res.recordset) {
    const m = re.exec(String(row.OrderNumber || '').trim());
    if (m) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > max) max = n; }
  }
  return max;
}

const formatBill = (prefix, n) => `${prefix}-#${String(n).padStart(3, '0')}`;

// เลขบิลถัดไป (เช่น A-#007) — ต้องเรียกหลัง lockBill(runner, prefix) ในทรานแซกชันเดียวกัน
async function nextOrderNumber(runner, prefix) {
  if (!(await hasBillCounters(runner))) return formatBill(prefix, (await maxBillNumber(runner, prefix)) + 1);
  const up = await runner(
    `UPDATE dbo.BillCounters SET LastNo = LastNo + 1, UpdatedAt = SYSUTCDATETIME() WHERE Prefix = @p RETURNING LastNo AS n`, { p: prefix });
  if (up.recordset.length) return formatBill(prefix, up.recordset[0].n);
  const n = (await maxBillNumber(runner, prefix)) + 1;
  await runner(`INSERT INTO dbo.BillCounters (Prefix, LastNo) VALUES (@p, @n)`, { p: prefix, n });
  return formatBill(prefix, n);
}

// บิลที่เครื่องส่งเลขมาเอง (หน้าเว็บรุ่นเก่า/บิลค้างเก่า) → ขยับตัวนับให้ไม่ต่ำกว่าเลขนั้น กันเลขชนกันภายหลัง
const parseBill = (no) => { const m = /^(.+)-#(\d+)$/.exec(String(no || '').trim()); return m ? { prefix: m[1], n: parseInt(m[2], 10) } : null; };
async function bumpCounter(runner, prefix, n) {
  if (!(await hasBillCounters(runner))) return;
  await runner(`UPDATE dbo.BillCounters SET LastNo = @n, UpdatedAt = SYSUTCDATETIME() WHERE Prefix = @p AND LastNo < @n`, { p: prefix, n });
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
async function hasClientRef() { return true; }

// ส่วนลดของบิล (ชื่อ/ยอด/ประเภท) — ฐานข้อมูลที่ยังไม่ได้รัน sql:init ไม่มีคอลัมน์ → ข้ามไป บิลยังบันทึกได้ตามปกติ
async function hasDiscountCols() { return true; }
const cleanDiscount = (d) => {
  const amount = Math.round((Number(d && d.amount) || 0) * 100) / 100;
  if (!(amount > 0)) return null;
  return { name: toText(d.name).slice(0, 200) || 'ส่วนลด', amount, kind: d.kind === 'coupon' ? 'coupon' : 'store' };
};
async function saveBillDiscount(runner, orderNumber, discount) {
  const d = cleanDiscount(discount);
  if (!d || !orderNumber || !(await hasDiscountCols(runner))) return;
  await runner(`UPDATE dbo.PaymentSummary SET DiscountName = @name, DiscountAmount = @amount, DiscountKind = @kind WHERE orderNumber = @no`,
    { ...d, no: orderNumber });
}

// id ของกะที่เปิดค้างอยู่ — คีออสไม่รู้จักกะ จึงต้องให้ฝั่งเซิร์ฟเวอร์ผูกให้ตอนบันทึกยอด
async function openShiftId(runner) {
  const res = await runner(`SELECT id FROM dbo.Shifts WHERE LOWER(ISNULL([status], '')) = 'open' ORDER BY Seq DESC LIMIT 1`);
  return res.recordset.length ? String(res.recordset[0].id) : '';
}

// ออเดอร์คีออสของ sessionId นี้ที่บันทึกไปแล้ว (ถ้ามี) — คืนเลขบิลเดิมเพื่อกันบิลซ้ำตอนยิงซ้ำ
async function findKioskOrderBySession(runner, sessionId) {
  if (!sessionId) return '';
  const res = await runner(
    `SELECT [Options] FROM dbo.TableOrders WHERE SessionId = @sid ORDER BY RowId DESC LIMIT 50`,
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
  const prefix = await branchBillPrefix(query, branchId);

  const result = await withTransaction(async (runner) => {
    // ต่อคิวออกเลขบิลของสาขาก่อน — sessionId เดียวกันส่งซ้ำพร้อมกันก็ตรวจซ้ำได้ถูกต้อง
    await lockBill(runner, prefix);
    // ยิงซ้ำเพราะเน็ตมือถือหลุดกลางทางเป็นเรื่องปกติ — sessionId เดิมต้องได้เลขบิลเดิมกลับไป
    const dup = await findKioskOrderBySession(runner, session);
    if (dup) return { success: true, orderNumber: dup, duplicate: true };

    const orderNo = await nextOrderNumber(runner, prefix);
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
    // ลูกค้าใช้คูปองสมาชิกในหน้าสั่งเอง → บันทึกเป็นส่วนลดของบิล (รายงานส่วนลด)
    await saveBillDiscount(runner, orderNo, { name: 'คูปองสมาชิก (สั่งเอง)', amount: data.couponDiscount, kind: 'coupon' });

    // 3) รายการรายโต๊ะ สถานะ paid — โต๊ะยังโชว์ว่ามีลูกค้า แต่ระบบไม่เก็บเงินซ้ำ
    const tableRows = items.map(item => {
      const opt = itemOptionText(item);
      const paidNote = '💳 ชำระแล้ว ' + orderNo;
      return [table, session, (item.food && item.food.name) || '', (item.food && item.food.nameEn) || '',
        Number(item.food && item.food.price) || 0, Number(item.quantity) || 1,
        opt ? `${opt} | ${paidNote}` : paidNote, time, 'paid', by, branchId];
    });
    await insertRows('TableOrders', TABLE_COLS, tableRows, runner);

    // 4) ส่งแต้มเข้าระบบสมาชิก (ลูกค้าใส่เลขสมาชิกก่อนสั่ง) — เข้าคิวพร้อมบิล
    await queueBill(runner, branchId, billPayload({
      orderNumber: orderNo, memberId: data.memberId, paidTotal: total, channel: 'kiosk',
      couponIds: data.couponIds, couponRef: data.couponRef, couponDiscount: data.couponDiscount,
      rows: items.map(item => ({ name: (item.food && item.food.name) || '', price: (Number(item.food && item.food.price) || 0) * (Number(item.quantity) || 1), qty: Number(item.quantity) || 1 }))
    }));

    return { success: true, orderNumber: orderNo };
  }, { isolation: 'READ_COMMITTED' });
  if (result.success && !result.duplicate) {
    sendBillNow(branchId, result.orderNumber).then(() => flushCrmQueue()).catch(() => {});
  }

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
      WHERE RowId = (SELECT RowId FROM dbo.TableOrders
                      WHERE TableNumber = @t
                        AND SessionId = @s
                        AND ISNULL(ItemName, '') = @n${branchFilter(requestedBranch(data))}
                      ORDER BY RowId DESC LIMIT 1)`,
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
  // เลขบิลที่เครื่องส่งมาเอง (ไม่ให้เซิร์ฟเวอร์ออกเลข) — ต่อคิวตามคำนำหน้าของเลขนั้น
  const givenNo = assign ? '' : (toText(data.payment && data.payment.orderNumber) || toText(rows[0] && rows[0][1]));
  const given = parseBill(givenNo);
  const prefix = given ? given.prefix : await branchBillPrefix(query, branchId);
  const result = await withTransaction(async (runner) => {
    await lockBill(runner, prefix);
    if (useRef) {
      // ส่งซ้ำ (เน็ตหลุดหลังเซิร์ฟเวอร์บันทึกแล้ว) → คืนเลขบิลเดิม ไม่บันทึกซ้ำ
      const dup = await runner(
        `SELECT orderNumber FROM dbo.PaymentSummary WHERE ClientRef = @ref LIMIT 1`,
        { ref: clientRef }
      );
      if (dup.recordset.length) return { success: true, orderNumber: dup.recordset[0].orderNumber, duplicate: true };
    }
    const orderNo = assign ? await nextOrderNumber(runner, prefix) : givenNo;
    if (given) await bumpCounter(runner, given.prefix, given.n);
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
      // ส่วนลดที่ใช้กับบิลนี้ (ชื่อ/ยอด/ประเภท) → หลังบ้าน > รายงาน > ส่วนลด
      if (data.discount) await saveBillDiscount(runner, assign ? orderNo : toText(p.orderNumber), data.discount);
      // ระบบสมาชิก: เข้าคิวในทรานแซกชันเดียวกับบิล (บิลไม่ใช่สมาชิกก็ส่ง เพื่อให้ CRM รู้สัดส่วนยอดขายสมาชิก)
      if (orderNo) {
        await queueBill(runner, branchId, billPayload({
          orderNumber: orderNo, memberId: data.memberId, paidTotal: p.grandTotal, storeDiscount: data.storeDiscount, staff: p.staff, channel: 'pos',
          couponIds: data.couponIds, couponRef: data.couponRef, couponDiscount: data.couponDiscount, vouchers: data.vouchers, voucherRef: data.voucherRef,
          rows: rows.filter(Array.isArray).map(r => ({ name: toText(r[4]), price: toNum(r[6]), qty: toNum(r[12]) }))
        }));
      }
    }
    return { success: true, orderNumber: orderNo };
  }, { isolation: 'READ_COMMITTED' });
  // สมาชิก: ส่งทันทีเพื่อเอาแต้มไปพิมพ์ลงใบเสร็จ (รอสั้น ๆ) · ส่งไม่ได้ก็อยู่ในคิว ส่งซ้ำเองภายหลัง
  if (result.success && result.orderNumber) {
    // เมนูสมาชิก: จดว่าสมาชิกคนนี้สั่งไปแล้ววันนี้ (โควตาต่อวัน) · รับเงินแล้วจึงไม่ปฏิเสธ หน้าขายตรวจโควตาให้ก่อนชำระแล้ว
    if (data.memberId) {
      await holdMemberMenu({ memberId: data.memberId, channel: 'staff', branchId, ref: result.orderNumber, status: 'used', orderNumber: result.orderNumber, enforce: false,
        items: rows.filter(Array.isArray).map(r => ({ name: toText(r[4]), qty: toNum(r[12]) || 1 })) }).catch(err => console.error('[memberMenu] staff', err));
    }
    // จ่ายด้วย Voucher ก็ส่งทันที ให้ CRM ตัด Voucher เป็นใช้แล้วเร็วที่สุด
    if (data.memberId || (Array.isArray(data.vouchers) && data.vouchers.length)) {
      const crm = await sendBillNow(branchId, result.orderNumber);
      if (crm) result.crm = crm;
    }
    flushCrmQueue().catch(() => {});
  }
  return result;
}

// ค้นบิลด้วยเลขบิลตรง ๆ (ใช้ดัชนี IX_Orders_OrderNumber อ่านแค่แถวของบิลนั้น)
//   เดิมเขียนเป็น ISNULL(OrderNumber,'') = @id OR ISNULL([Timestamp],'') = @id — ฐานข้อมูลใช้ดัชนีไม่ได้
//   ต้องอ่านบิลทุกแถวทุกครั้งที่ครัวกด "สำเร็จแล้ว"/"ยกเลิก" และล็อกตารางบิลไว้ระหว่างนั้น หน้าอื่นต้องรอ ช่วงคนเยอะช้าหลายวินาทีและชนกับการออกบิลจนล้ม
// บิลรุ่นเก่ามากที่ไม่มีเลขบิล หน้าเว็บส่งเวลาสั่ง (เช่น 2026-01-31T12:00:00) มาแทน → ค้นด้วยเวลาเป็นทางสำรองเฉพาะกรณีนั้น
const looksLikeTimestamp = (v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v);

export async function updateStatus(data) {
  const status = String(data.status || '');
  const id = String(data.orderId ?? '').trim();
  if (!id || !status) return { success: false, error: 'ไม่ได้ระบุเลขบิลหรือสถานะ' };
  const params = { status, completion: String(data.completionTime || ''), id };
  const SET = `SET [Status] = CAST(@status AS varchar(30)),
            CompletionTime = CASE WHEN LOWER(CAST(@status AS varchar(30))) = 'completed' AND CAST(@completion AS varchar(40)) <> '' THEN CAST(@completion AS varchar(40)) ELSE CompletionTime END`;
  // ทรานแซกชันเดียว = ชนกับการออกบิลแล้วลองใหม่เองอัตโนมัติ (withTransaction) ไม่ตอบ error ให้ครัวต้องกดซ้ำ
  const affected = await withTransaction(async (runner) => {
    let res = await runner(`UPDATE dbo.Orders ${SET} WHERE OrderNumber = @id`, params);
    if (res.rowsAffected[0] === 0 && looksLikeTimestamp(id)) {
      res = await runner(`UPDATE dbo.Orders ${SET} WHERE OrderNumber IS NULL AND [Timestamp] = @id`, params);
    }
    return res.rowsAffected[0];
  }, { isolation: 'READ_COMMITTED' });
  if (affected > 0 && /cancel/i.test(status)) await releaseMemberMenu(id);
  return { success: affected > 0 };
}

export async function cancelOrder(data) {
  const n = String(data.orderNumber || '').trim();
  // เลขบิลว่าง = ไม่ทำอะไร (เดิม ISNULL(OrderNumber,'') = '' จะไปยกเลิกทุกแถวที่ไม่มีเลขบิล)
  if (!n) return { success: false, error: 'ไม่ได้ระบุเลขบิล' };
  const affected = await withTransaction(async (runner) =>
    (await runner(`UPDATE dbo.Orders SET [Status] = 'cancelled' WHERE OrderNumber = @n`, { n })).rowsAffected[0],
  { isolation: 'READ_COMMITTED' });
  if (affected > 0) await releaseMemberMenu(n);   // ยกเลิกบิล = คืนสิทธิ์เมนูสมาชิก
  return { success: affected > 0 };
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

// ══════════════════════════════════════════════════════════════════════
// เสน่ห์: ลูกค้าสั่งก่อน จ่ายทีหลัง (หน้าลูกค้าสแกน QR สั่งเอง)
// ══════════════════════════════════════════════════════════════════════
// 1) kioskOrder        ลูกค้ากด "ยืนยันสั่งอาหาร" → ลงรายการโต๊ะ (ยังไม่จ่าย) ทำเครื่องหมายว่ายังไม่พิมพ์ใบครัว
// 2) claimKioskTickets หน้าขายของสาขาดึงรอบที่ยังไม่พิมพ์ใบครัวไปพิมพ์ (เครื่องเดียวได้ไป ไม่พิมพ์ซ้ำ)
// 3) kioskPaymentRequest (payLater) → พนักงานยืนยันยอด → settleTableBill ออกบิลจากรายการในโต๊ะ ปิดบิล

const KIOSK_BY = 'Self-Order';

// รอบที่สั่งเข้าโต๊ะ — sessionId เดิมส่งซ้ำ (เน็ตหลุดแล้วกดใหม่) ไม่ลงซ้ำ
export async function kioskOrder(data) {
  const tableNumber = String(data.tableNumber || '').trim().slice(0, 50);
  const sessionId = String(data.sessionId || '').trim().slice(0, 80);
  const items = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
  if (!tableNumber) return { success: false, error: 'ไม่พบเลขโต๊ะ' };
  if (!sessionId) return { success: false, error: 'ไม่มีรหัสรายการ' };
  if (items.length === 0) return { success: false, error: 'ไม่มีรายการอาหาร' };
  const branchId = await branchForWrite(data);
  const timestamp = data.timestamp || thaiTimeISO();
  return await withTransaction(async (runner) => {
    await lockKey(runner, 'kiosk-order:' + sessionId);
    const dup = await runner(`SELECT 1 AS n FROM dbo.TableOrders WHERE SessionId = @s LIMIT 1`, { s: sessionId });
    if (dup.recordset.length) return { success: true, sessionId, duplicate: true };
    const rows = items.map(item => [
      tableNumber, sessionId, (item.food && item.food.name) || '', (item.food && item.food.nameEn) || '',
      Number(item.food && item.food.price) || 0, Number(item.quantity) || 1,
      itemOptionText(item), timestamp, 'pending', KIOSK_BY, branchId, 0
    ]);
    await insertRows('TableOrders', [...TABLE_COLS, 'KitchenPrinted'], rows, runner);
    return { success: true, sessionId };
  });
}

// หน้าขาย: รอบที่ลูกค้าสั่งผ่าน QR แต่ยังไม่พิมพ์ใบครัว — จองไว้ให้เครื่องที่ถามก่อน แล้วคืนรายการไปพิมพ์
export async function claimKioskTickets(data) {
  const branchId = await branchForWrite(data);
  const res = await query(
    `UPDATE dbo.TableOrders SET KitchenPrinted = 1
      WHERE RowId IN (SELECT RowId FROM dbo.TableOrders
                       WHERE KitchenPrinted = 0 AND ISNULL(BranchId, '') = ISNULL(@b, '')
                       ORDER BY RowId LIMIT 200 FOR UPDATE SKIP LOCKED)
      RETURNING RowId, TableNumber, SessionId, ItemName, ItemNameEn, ItemPrice, Quantity, [Options], [Timestamp]`,
    { b: branchId });
  const rounds = new Map();
  for (const r of res.recordset.sort((a, b) => a.RowId - b.RowId)) {
    const key = String(r.SessionId);
    if (!rounds.has(key)) rounds.set(key, { sessionId: key, tableNumber: r.TableNumber, timestamp: r.Timestamp, items: [] });
    rounds.get(key).items.push({ name: r.ItemName || '', nameEn: r.ItemNameEn || '', price: Number(r.ItemPrice) || 0, qty: Number(r.Quantity) || 1, options: r.Options || '' });
  }
  return { success: true, rounds: [...rounds.values()] };
}

// พิมพ์ใบครัวไม่สำเร็จ → คืนให้เครื่องอื่น/รอบถัดไปพิมพ์ใหม่
export async function releaseKioskTickets(data) {
  const ids = (Array.isArray(data.sessionIds) ? data.sessionIds : []).map(String).filter(Boolean).slice(0, 50);
  if (!ids.length) return { success: true, released: 0 };
  const params = {};
  const names = ids.map((id, i) => { params[`s${i}`] = id; return `@s${i}`; });
  const res = await query(`UPDATE dbo.TableOrders SET KitchenPrinted = 0 WHERE KitchenPrinted = 1 AND ISNULL([Status], '') <> 'paid' AND SessionId IN (${names.join(', ')})`, params);
  return { success: true, released: res.rowsAffected[0] };
}

// รายการค้างจ่ายของโต๊ะ (ทุกเครื่องในโต๊ะเดียวกัน) — ใช้ทั้งตอนลูกค้าขอชำระ และตอนพนักงานยืนยัน
export async function unpaidTableRows(runner, branchId, tableNumber) {
  const res = await runner(
    `SELECT RowId, SessionId, ItemName, ItemNameEn, ItemPrice, Quantity, [Options], [Timestamp], RecordedBy FROM dbo.TableOrders
      WHERE TableNumber = @t AND ISNULL([Status], '') <> 'paid' AND ISNULL(BranchId, '') = ISNULL(@b, '')
      ORDER BY RowId ASC`,
    { t: String(tableNumber || ''), b: branchId });
  return res.recordset;
}
export const rowsTotal = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.ItemPrice) || 0) * (Number(r.Quantity) || 1), 0) * 100) / 100;

// พนักงานยืนยันยอดโอนของบิลโต๊ะ → ออกเลขบิล + ลงบิล/ยอดชำระ + ทำเครื่องหมายรายการในโต๊ะว่าจ่ายแล้ว (ทรานแซกชันเดียว)
//   rowIds = รายการที่ลูกค้าเห็นตอนกดชำระ (ของที่สั่งเพิ่มหลังจากนั้นยังค้างในโต๊ะ ไม่ถูกปิดไปด้วย)
export async function settleTableBill({ branchId, tableNumber, rowIds, total, paymentMethod, memberId }) {
  const prefix = await branchBillPrefix(query, branchId);
  const time = thaiTimeISO();
  const result = await withTransaction(async (runner) => {
    // ยืนยันซ้ำไม่ได้อยู่แล้ว: respondKioskPayment จองรายการ (pending → approving) ก่อนเรียกตรงนี้
    await lockBill(runner, prefix);
    const want = new Set((rowIds || []).map(Number));
    const rows = (await unpaidTableRows(runner, branchId, tableNumber)).filter(r => !want.size || want.has(Number(r.RowId)));
    if (!rows.length) return { success: false, error: 'ไม่พบรายการค้างจ่ายของโต๊ะนี้ (อาจปิดบิลไปแล้ว)' };
    const orderNo = await nextOrderNumber(runner, prefix);
    const grand = Number(total) > 0 ? Math.round(Number(total) * 100) / 100 : rowsTotal(rows);
    const name = `โต๊ะ ${tableNumber} (สั่งเอง)`;
    const addr = `โต๊ะ ${tableNumber}`;
    const tsLocal = toThaiClock(time);
    const orderRows = [];
    for (const r of rows) {
      const qty = Number(r.Quantity) || 1;
      // ครัวทำไปแล้วตอนลูกค้าสั่ง → บิลนี้ไม่ต้องขึ้นจอครัวซ้ำ
      orderRows.push([time, orderNo, name, addr, r.ItemName || '', 'ทานที่ร้าน', (Number(r.ItemPrice) || 0) * qty, grand, 'Completed', r.Timestamp || time, time, KIOSK_BY, qty, tsLocal, branchId]);
      const opt = String(r.Options || '').split(' | ')[0].trim();
      if (opt) orderRows.push([time, orderNo, name, addr, '↳ ' + opt, 'ทานที่ร้าน', 0, grand, 'Completed', r.Timestamp || time, time, KIOSK_BY, null, tsLocal, branchId]);
    }
    await insertRows('Orders', ORDER_INSERT_COLS, orderRows, runner);
    const shiftId = await openShiftId(runner);
    await insertRows('PaymentSummary', PAYMENT_COLS, [[time, orderNo, String(tableNumber), paymentMethod || 'เงินโอน (QR พนักงานยืนยัน)', grand, KIOSK_BY, shiftId, null, branchId]], runner);
    const params = { no: '💳 ชำระแล้ว ' + orderNo };
    const names = rows.map((r, i) => { params[`r${i}`] = r.RowId; return `@r${i}`; });
    await runner(
      `UPDATE dbo.TableOrders SET [Status] = 'paid', KitchenPrinted = CASE WHEN KitchenPrinted = 0 THEN 1 ELSE KitchenPrinted END,
              [Options] = CASE WHEN ISNULL([Options], '') = '' THEN @no ELSE [Options] || ' | ' || @no END
        WHERE RowId IN (${names.join(', ')})`, params);
    await queueBill(runner, branchId, billPayload({
      orderNumber: orderNo, memberId, paidTotal: grand, channel: 'kiosk',
      rows: rows.map(r => ({ name: r.ItemName || '', price: (Number(r.ItemPrice) || 0) * (Number(r.Quantity) || 1), qty: Number(r.Quantity) || 1 }))
    }));
    return { success: true, orderNumber: orderNo, total: grand, items: rows };
  });
  if (result.success) sendBillNow(branchId, result.orderNumber).then(() => flushCrmQueue()).catch(() => {});
  return result;
}
