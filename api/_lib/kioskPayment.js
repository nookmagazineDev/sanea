// ── ลูกค้าสแกน QR จ่ายเอง → พนักงานยืนยันยอด ──
//
// 1) หน้าลูกค้ากด "ฉันโอนเงินแล้ว" → kioskPaymentRequest (สถานะ pending)
// 2) หน้าขายของสาขานั้นดึง getPendingKioskPayments ทุกไม่กี่วินาที → เด้งการ์ดแจ้งเตือน
// 3) พนักงานกด ได้รับเงินแล้ว → respondKioskPayment(approve) → ออกบิล/บันทึกยอด/ลงคิวครัว (handleKioskPaidOrder เดิม)
//    หรือ ยังไม่ได้รับเงิน → rejected (ลูกค้ากดแจ้งโอนใหม่ได้)
// 4) หน้าลูกค้าดึง getKioskPayment ทุก 3 วิ → ขึ้นชำระเงินสำเร็จ / ยังไม่พบยอด
//
// id = sessionId ของหน้าลูกค้า (คงเดิมทุกครั้งที่กดซ้ำ) — handleKioskPaidOrder ใช้ sessionId กันบิลซ้ำอยู่แล้ว
import { query } from './db.js';
import { thaiTimeISO } from './time.js';
import { branchForWrite } from './branch.js';
import { handleKioskPaidOrder, itemOptionText } from './write.js';

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const COLS = 'id, branchId, tableNo, dining, payloadJson, total, [status], requestedAt, respondedAt, respondedBy, orderNumber';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// รายการแบบอ่านง่ายสำหรับการ์ดแจ้งเตือน / หน้ารอ
const displayItems = (items) => (Array.isArray(items) ? items : []).map(item => {
  const qty = Number(item.quantity) || 1;
  const unit = Number(item.food && item.food.price) || 0;
  return { name: (item.food && item.food.name) || '', qty, options: itemOptionText(item), amount: unit * qty };
});

const mapRow = (r) => {
  const payload = parse(r.payloadJson) || {};
  return {
    id: r.id,
    branchId: r.branchId || '',
    tableNo: r.tableNo || '',
    dining: r.dining || '',
    total: Number(r.total) || 0,
    status: r.status || 'pending',
    requestedAt: r.requestedAt || '',
    respondedAt: r.respondedAt || '',
    respondedBy: r.respondedBy || '',
    orderNumber: r.orderNumber || '',
    items: displayItems(payload.items)
  };
};

async function findById(id) {
  const res = await query(`SELECT ${COLS} FROM dbo.KioskPayments WHERE id = @id`, { id });
  return res.recordset[0] || null;
}

// หน้าลูกค้า: แจ้งว่าโอนแล้ว (กดซ้ำ/แจ้งใหม่หลังถูกปฏิเสธ = อัปเดตแถวเดิม)
export async function kioskPaymentRequest(data) {
  const id = text(data.sessionId, 60);
  const items = Array.isArray(data.items) ? data.items : [];
  const total = Math.round((Number(data.total) || 0) * 100) / 100;
  if (!id) return { success: false, error: 'ไม่มีรหัสรายการ' };
  if (items.length === 0) return { success: false, error: 'ไม่มีรายการอาหาร' };
  if (!(total > 0)) return { success: false, error: 'ยอดชำระไม่ถูกต้อง' };

  const branchId = await branchForWrite(data);
  const payload = JSON.stringify({
    branchId, tableNumber: text(data.tableNumber, 50), items, total, timestamp: data.timestamp || thaiTimeISO()
  });
  const now = thaiTimeISO();
  const row = {
    id, branchId, tableNo: text(data.tableNumber, 50), dining: text(data.dining, 50), payloadJson: payload, total, at: now
  };

  const existing = await findById(id);
  if (existing) {
    if (existing.status === 'approved') return { success: true, status: 'approved', orderNumber: existing.orderNumber || '' };
    if (existing.status === 'approving') return { success: true, status: 'pending' };
    await query(
      `UPDATE dbo.KioskPayments SET branchId = @branchId, tableNo = @tableNo, dining = @dining, payloadJson = @payloadJson,
          total = @total, [status] = 'pending', requestedAt = @at, respondedAt = NULL, respondedBy = NULL
        WHERE id = @id AND [status] IN ('pending', 'rejected')`, row);
    return { success: true, status: 'pending' };
  }
  await query(
    `INSERT INTO dbo.KioskPayments (id, branchId, tableNo, dining, payloadJson, total, [status], requestedAt)
     VALUES (@id, @branchId, @tableNo, @dining, @payloadJson, @total, 'pending', @at)`, row);
  return { success: true, status: 'pending' };
}

// หน้าลูกค้า: ถามสถานะ
export async function getKioskPayment(params) {
  const row = await findById(text(params.id, 60)).catch(() => null);
  if (!row) return { success: false, error: 'ไม่พบรายการ' };
  const status = row.status === 'approving' ? 'pending' : row.status;
  return { success: true, status, orderNumber: row.orderNumber || '', total: Number(row.total) || 0 };
}

// หน้าขาย: รายการที่รอยืนยันของสาขานี้ — รอนานสุดขึ้นก่อน (ตัดของเก่ากว่า 6 ชม. ทิ้ง กันค้างข้ามวัน)
export async function getPendingKioskPayments(params) {
  const branchId = text(params.branch, 60);
  const cutoff = thaiTimeISO(new Date(Date.now() - 6 * 3600 * 1000));
  try {
    const res = await query(
      `SELECT TOP (50) ${COLS} FROM dbo.KioskPayments
        WHERE [status] = 'pending' AND requestedAt >= @cutoff ${branchId ? 'AND branchId = @branchId' : ''}
        ORDER BY requestedAt ASC`,
      { cutoff, branchId });
    return { success: true, payments: res.recordset.map(mapRow) };
  } catch {
    return { success: true, payments: [] }; // ยังไม่ได้รัน sql:init
  }
}

// หน้าขาย: ยืนยัน / ปฏิเสธ — กดพร้อมกันหลายเครื่อง ใครกดก่อนได้ คนหลังได้ข้อความว่าจัดการไปแล้ว
export async function respondKioskPayment(data) {
  const id = text(data.id, 60);
  const by = text(data.by, 120);
  const at = thaiTimeISO();
  if (!id) return { success: false, error: 'ไม่ได้ระบุรายการ' };

  if (data.approve !== true) {
    const res = await query(
      `UPDATE dbo.KioskPayments SET [status] = 'rejected', respondedAt = @at, respondedBy = @by
        WHERE id = @id AND [status] = 'pending'`, { id, at, by });
    if (!res.rowsAffected[0]) return { success: false, error: 'รายการนี้ถูกจัดการไปแล้ว' };
    return { success: true, status: 'rejected' };
  }

  // จองรายการก่อน (pending → approving) กันสองเครื่องออกบิลซ้อนกัน
  const claim = await query(
    `UPDATE dbo.KioskPayments SET [status] = 'approving', respondedAt = @at, respondedBy = @by
      WHERE id = @id AND [status] = 'pending'`, { id, at, by });
  if (!claim.rowsAffected[0]) {
    const cur = await findById(id);
    if (cur && cur.status === 'approved') return { success: true, status: 'approved', already: true, payment: mapRow(cur) };
    return { success: false, error: 'รายการนี้ถูกจัดการไปแล้ว' };
  }

  const row = await findById(id);
  const payload = parse(row && row.payloadJson) || {};
  let result;
  try {
    result = await handleKioskPaidOrder({
      ...payload,
      branchId: row.branchId || payload.branchId,
      sessionId: id,
      paymentMethod: 'เงินโอน (QR พนักงานยืนยัน)'
    });
  } catch (err) {
    result = { success: false, error: err.message };
  }
  if (!result || !result.success) {
    await query(`UPDATE dbo.KioskPayments SET [status] = 'pending', respondedAt = NULL, respondedBy = NULL WHERE id = @id`, { id });
    return { success: false, error: (result && result.error) || 'บันทึกบิลไม่สำเร็จ' };
  }
  await query(`UPDATE dbo.KioskPayments SET [status] = 'approved', orderNumber = @no WHERE id = @id`, { id, no: result.orderNumber || '' });
  return { success: true, status: 'approved', payment: { ...mapRow(row), status: 'approved', orderNumber: result.orderNumber || '' } };
}
