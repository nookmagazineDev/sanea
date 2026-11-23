// เวลาทั้งระบบใช้ "นาฬิกาหน้าร้าน" คือเวลาไทย (Asia/Bangkok, +07:00)
//
// หน้าบ้านส่ง timestamp มาเป็นข้อความรูปแบบ 2026-09-11T14:30:00+07:00 (getThaiTimeISO)
// บางจุดที่ฝั่งเซิร์ฟเวอร์เคยเขียนเองใช้ new Date().toISOString() ซึ่งเป็นเวลา UTC
// ทั้งสองแบบต้องลงคอลัมน์ TsLocal เป็นเวลาไทยเหมือนกัน ไม่งั้นรายงาน "ยอดขายวันนี้" จะเพี้ยน 7 ชั่วโมง
const OFFSET_MS = 7 * 60 * 60 * 1000;

// Date ที่ "ส่วน UTC" ของมันคือเวลาไทย — ไดรเวอร์ mssql (useUTC: true) จะเขียนลง DATETIME2 ตามนั้นพอดี
export function toThaiClock(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;       // ข้อความที่แปลงเป็นวันที่ไม่ได้ → ปล่อยว่าง (แถวยังอยู่ในรายงานเหมือนเดิม)
  return new Date(d.getTime() + OFFSET_MS);
}

// ข้อความเวลาไทยแบบที่หน้าบ้านใช้ (ใช้ตอนเซิร์ฟเวอร์เป็นคนออกเวลาเอง)
export function thaiTimeISO(date = new Date()) {
  const t = new Date(date.getTime() + OFFSET_MS);
  return t.toISOString().replace('Z', '+07:00');
}

// ขอบช่วงวันของรายงาน: '2026-09-11' → ต้นวัน/ท้ายวันตามเวลาไทย
export function dayStart(ymd) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}
export function dayEnd(ymd) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? null : d;
}
