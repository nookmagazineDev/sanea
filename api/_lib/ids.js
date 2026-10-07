// รหัสของเมนูและหมวดหมู่ — รูปแบบ SN + ตัวเลข 5 หลัก (SN00001 … SN99999)
//
// เดิมเมนูใช้ Date.now() (เลข 13 หลัก) และหมวดหมู่ใช้ cat_<timestamp> หรือคำที่พิมพ์เอง
// อ่านยากและเดาไม่ได้ว่าอันไหนมาก่อนหลัง จึงเปลี่ยนมาใช้เลขเรียงชุดเดียวกัน
//
// เมนูกับหมวดหมู่ใช้ "ชุดเลขเดียวกัน" ไม่แยกกัน — รหัสหนึ่งตัวจึงชี้ไปที่ของชิ้นเดียวเสมอ
// ไม่มีทางที่ SN00007 จะเป็นได้ทั้งเมนูและหมวดหมู่ เวลาไล่ปัญหาจะไม่สับสน
export const ID_PREFIX = 'SN';
export const ID_DIGITS = 5;

export const formatId = (n) => `${ID_PREFIX}${String(n).padStart(ID_DIGITS, '0')}`;

// รหัสรูปแบบใหม่หรือยัง — ใช้ตอนย้ายรหัสเพื่อข้ามตัวที่แปลงไปแล้ว
export const isHlId = (value) => new RegExp(`^${ID_PREFIX}\\d{${ID_DIGITS}}$`).test(String(value ?? ''));

export const idNumber = (value) => (isHlId(value) ? Number(String(value).slice(ID_PREFIX.length)) : 0);

// เลขที่ใช้ไปแล้วสูงสุดจากทั้งตารางเมนูและหมวดหมู่
const MAX_SQL = `
  SELECT MAX(n) AS maxN FROM (
    SELECT TRY_CAST(SUBSTRING(id, 3, ${ID_DIGITS}) AS INT) AS n
      FROM dbo.Menu       WHERE id   LIKE '${ID_PREFIX}[0-9][0-9][0-9][0-9][0-9]' AND LEN(id)   = ${ID_PREFIX.length + ID_DIGITS}
    UNION ALL
    SELECT TRY_CAST(SUBSTRING(slug, 3, ${ID_DIGITS}) AS INT) AS n
      FROM dbo.Categories WHERE slug LIKE '${ID_PREFIX}[0-9][0-9][0-9][0-9][0-9]' AND LEN(slug) = ${ID_PREFIX.length + ID_DIGITS}
  ) t`;

// ออกรหัสใหม่ n ตัวถัดไป — เรียกในทรานแซกชันที่ถือล็อกอยู่ ถ้าต้องกันสองคนกดพร้อมกัน
export async function nextIds(runner, count = 1) {
  const res = await runner(MAX_SQL);
  const max = Number(res.recordset[0]?.maxN) || 0;
  return Array.from({ length: count }, (_, i) => formatId(max + 1 + i));
}

export async function nextId(runner) {
  const [id] = await nextIds(runner, 1);
  return id;
}
