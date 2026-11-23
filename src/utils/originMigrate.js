// ย้ายค่าตั้งของเครื่องจากที่อยู่เว็บเดิม (hum-lai-pos.vercel.app) มาที่อยู่ใหม่ (เซิร์ฟเวอร์ร้าน)
// เบราว์เซอร์เก็บค่าในเครื่อง (localStorage) แยกตามที่อยู่เว็บ ย้ายที่อยู่แล้วค่าเดิมจะไม่ตามมาเอง
// หน้าเปลี่ยนทางบน Vercel (scripts/build-vercel-redirect.mjs) ส่งค่ามาใน #migrate=... (หลัง # ไม่ถูกส่งไปเซิร์ฟเวอร์ไหน)
//   ค่าตั้งเครื่อง: รับเฉพาะ key ที่ระบุไว้ และเฉพาะค่าที่เครื่องนี้ยังไม่มี — ลิงก์แปลก ๆ เขียนทับค่าที่ตั้งไว้แล้วไม่ได้
//   บิลค้างส่ง (pending_orders): ถามพนักงานก่อนรับเข้าเสมอ แล้วแอปส่งขึ้นระบบ + พิมพ์ใบกำกับภาษีตามให้เหมือนบิลค้างปกติ
const KEYS = ['device_branch', 'printers_config', 'printer_receipt_ip', 'printer_kitchen_ip', 'waste_branch', 'kiosk_member_login'];
const MAX_LEN = 20000;
const MAX_PENDING = 300;

const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

// บิลค้างจากเครื่องเดิม → ตรวจรูปแบบ แล้วถามก่อนรับ (ไม่ซ้ำกับที่มีอยู่แล้ว ดูจาก clientRef)
function importPending(raw) {
  let list;
  try { list = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(list)) return;
  list = list.filter(e => e && e.payload && e.payload.action === 'insertOrder' && Array.isArray(e.payload.rows)).slice(0, MAX_PENDING);
  if (!list.length) return;
  let current = [];
  try { current = JSON.parse(localStorage.getItem('pending_orders') || '[]'); } catch { current = []; }
  if (!Array.isArray(current)) current = [];
  const known = new Set(current.map(e => e && e.payload && e.payload.clientRef).filter(Boolean));
  const fresh = list.filter(e => !e.payload.clientRef || !known.has(e.payload.clientRef));
  if (!fresh.length) return;
  const lines = fresh.slice(0, 8).map(e => {
    const p = e.payload.payment || {};
    return `• โต๊ะ ${p.tableNo || '-'} · ${p.paymentMethod || '-'} · ฿${money(p.grandTotal)}${e.at ? ' · ' + String(e.at).slice(0, 16).replace('T', ' ') : ''}`;
  });
  const more = fresh.length > 8 ? `\n…และอีก ${fresh.length - 8} บิล` : '';
  const ok = window.confirm(
    `เครื่องนี้มีบิลที่ยังส่งขึ้นระบบไม่สำเร็จจากที่อยู่เว็บเดิม ${fresh.length} บิล\n\n${lines.join('\n')}${more}\n\n` +
    'กด "ตกลง" เพื่อนำเข้าแล้วส่งขึ้นระบบต่อ (บิลที่เคยส่งสำเร็จแล้วจะไม่ถูกบันทึกซ้ำ)\nถ้าไม่รู้จักบิลเหล่านี้ กด "ยกเลิก"');
  if (!ok) return;
  localStorage.setItem('pending_orders', JSON.stringify([...current, ...fresh]));
}

export function importFromOldOrigin() {
  try {
    const m = /^#migrate=([A-Za-z0-9_-]+)$/.exec(window.location.hash || '');
    if (!m) return;
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const data = JSON.parse(json);
    if (data && typeof data === 'object') {
      for (const key of KEYS) {
        const v = data[key];
        if (typeof v !== 'string' || !v || v.length > MAX_LEN) continue;
        if (localStorage.getItem(key) !== null) continue;
        localStorage.setItem(key, v);
      }
      if (typeof data.pending_orders === 'string') importPending(data.pending_orders);
    }
  } catch { /* ลิงก์เสีย/ไม่มีที่เก็บ — ข้ามไป ตั้งค่าเครื่องใหม่เองได้ */ }
  // ลบ #migrate ออกจากแถบที่อยู่ ไม่ให้ติดไปกับบุ๊กมาร์ก/การแชร์ลิงก์
  try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* */ }
}
