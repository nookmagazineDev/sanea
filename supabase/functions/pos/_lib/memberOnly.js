// เมนูเฉพาะสมาชิก (หลังบ้าน > เมนู > "เฉพาะสมาชิก") — ตรวจซ้ำที่เซิร์ฟเวอร์ตอนลูกค้าสั่งเอง
// หน้าเว็บล็อกปุ่มไว้แล้ว แต่ต้องกันคนยิงคำขอเองโดยไม่ล็อกอิน: มีเมนูสมาชิกในออเดอร์ = ต้องมีเลขสมาชิก
// และ verifyToken (ได้จากการพิมพ์รหัส 6 หลักในบัตรสมาชิก LINE) ที่ระบบสมาชิกยืนยันว่าเป็นของสมาชิกคนนั้นจริง
import { query } from './db.js';
import { verifyKioskMember } from './crm.js';
import { getMemberMenuSettings } from './memberMenu.js';

// รหัสเมนูทั้งหมดในออเดอร์: จานหลัก + ตัวเลือกจากป๊อปอัพ/แอดออน
const menuIdsOf = (items) => {
  const ids = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.food && it.food.id !== undefined && it.food.id !== null) ids.add(String(it.food.id));
    for (const p of [...(Array.isArray(it && it.allPopups) ? it.allPopups : []), ...(Array.isArray(it && it.addOns) ? it.addOns : [])]) {
      if (p && p.id !== undefined && p.id !== null) ids.add(String(p.id));
    }
  }
  return ids;
};

// คืน null = สั่งได้ · คืน { success: false, memberOnly: true, error } = ปฏิเสธ
export async function memberOnlyProblem(items, { memberId, verifyToken } = {}, branchId = '') {
  const ids = menuIdsOf(items);
  if (!ids.size) return null;
  let rows = [];
  try {
    rows = (await query(`SELECT id, name FROM dbo.Menu WHERE memberOnly = 1`)).recordset;
  } catch { return null; }   // ฐานข้อมูลยังไม่ได้รัน sql:init (ยังไม่มีคอลัมน์) = ยังไม่มีเมนูสมาชิก
  const hit = rows.filter(r => ids.has(String(r.id)));
  if (!hit.length) return null;
  const names = hit.map(r => r.name).join(', ');
  if (!/^MB-\d{7}$/.test(String(memberId || ''))) {
    return { success: false, memberOnly: true, error: `เมนู ${names} สั่งได้เฉพาะสมาชิก กรุณาใส่เลขสมาชิกก่อน` };
  }
  // หลังบ้านปิด "ต้องใส่รหัส 6 หลัก" → มีเลขสมาชิกก็สั่งได้
  if (!(await getMemberMenuSettings()).requireCode) return null;
  if (!String(verifyToken || '')) {
    return { success: false, memberOnly: true, error: `เมนู ${names} สั่งได้เฉพาะสมาชิก กรุณาล็อกอินสมาชิกก่อน` };
  }
  const v = await verifyKioskMember({ memberId, verifyToken }, branchId);
  if (!v || !v.success) {
    // ระบบสมาชิกช้า/ปิดอยู่ชั่วคราว ≠ ล็อกอินหมดเวลา → ให้ลองใหม่ ไม่ต้องล็อกอินใหม่
    if (!(v && v.verify)) return { success: false, memberOnly: true, retry: true, error: `เชื่อมระบบสมาชิกไม่ได้ชั่วคราว กรุณากดส่งอีกครั้ง (เมนู ${names})` };
    return { success: false, memberOnly: true, error: `ล็อกอินสมาชิกหมดเวลาหรือไม่ถูกต้อง กรุณาล็อกอินใหม่ก่อนสั่งเมนู ${names}` };
  }
  return null;
}
