// ชื่อร้านแบบตัวหนังสือ (ใช้แทนรูปโลโก้ จนกว่าจะได้ไฟล์โลโก้ที่ถูกต้อง)
// variant: 'light' = บนพื้นขาว (เสน่ห์ สีแดง + SA-NAE สีดำ) · 'dark' = บนพื้นดำ (เสน่ห์ สีขาว + SA-NAE สีแดง)
// size: ความสูงตัวอักษรหลักเป็น px — ชื่อภาษาอังกฤษปรับตามสัดส่วน
const RED = '#c8102e';

export default function Wordmark({ variant = 'light', size = 28, stacked = true, style }) {
  const dark = variant === 'dark';
  const sub = Math.max(8, Math.round(size * 0.34));
  return (
    <span
      role="img"
      aria-label="เสน่ห์ SA-NAE"
      style={{
        display: 'inline-flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'center' : 'baseline',
        gap: stacked ? Math.round(size * 0.06) : Math.round(size * 0.3), lineHeight: 1, flexShrink: 0, ...style
      }}
    >
      <span style={{ fontSize: size, fontWeight: 900, color: dark ? '#ffffff' : RED, letterSpacing: '0.01em', lineHeight: 1.15 }}>เสน่ห์</span>
      <span style={{
        fontSize: sub, fontWeight: 800, color: dark ? RED : '#141414', letterSpacing: '0.32em',
        paddingLeft: '0.32em', textTransform: 'uppercase'
      }}>SA-NAE</span>
    </span>
  );
}
