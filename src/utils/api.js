// ปลายทาง API ของระบบ POS
//
// ทุกหน้าเรียกผ่านปลายทางเดียวกันที่นี่ที่เดียว
//
// ค่าเริ่มต้น = Google Apps Script ของเสน่ห์ (ข้อมูลอยู่ใน Google Sheet — โค้ดฝั่งนั้นคือ gas_complete_script.js)
// พร้อมย้ายไป SQL Server เมื่อไร ตั้ง VITE_API_URL ตอน build (ไม่ต้องแก้โค้ด):
//   VITE_API_URL=/api/pos npm run build                                  ← API บน Vercel โดเมนเดียวกับหน้าเว็บ
//   VITE_API_URL=https://pos-api.example.com/api/pos npm run build       ← API อยู่คนละที่
const GOOGLE_SHEET_API = 'https://script.google.com/macros/s/AKfycbzxzhnOhSPWssbEfRVG8doa4G4fQ_98B9_Kog34gguPrG7fgbY5gPnuvTIoneJcmdKgrA/exec';
const configured = String(import.meta.env.VITE_API_URL || '').trim();

export const API_URL = configured || GOOGLE_SHEET_API;

// URL แบบเต็มสำหรับส่งให้โปรแกรมอื่นเรียก (Print Server อยู่คนละเครื่อง ใช้ path สั้น ๆ ไม่ได้)
export const apiUrlAbsolute = () => {
  if (/^https?:\/\//i.test(API_URL)) return API_URL;
  if (typeof window === 'undefined') return API_URL;
  return new URL(API_URL, window.location.origin).href;
};

// รหัสถัดไปสำหรับเมนู/หมวดหมู่ที่กำลังจะสร้าง — รูปแบบ SN + เลข 5 หลัก
// ขอจากเซิร์ฟเวอร์เป็นหลัก (เป็นตัวเดียวที่เห็นข้อมูลครบทุกเครื่อง)
// ถ้าเรียกไม่ได้ค่อยคำนวณเองจากรายการที่โหลดมาแล้ว เพื่อให้ยังกดเพิ่มรายการได้ตอนเน็ตสะดุด
export const nextItemId = async (existingIds = []) => {
  try {
    const res = await fetch(`${API_URL}?action=nextId`);
    const data = await res.json();
    if (data && data.success && Array.isArray(data.ids) && data.ids[0]) return data.ids[0];
  } catch {
    // ตกไปใช้การคำนวณฝั่งเครื่องด้านล่าง
  }
  const max = existingIds.reduce((best, value) => {
    const s = String(value ?? '');
    return /^SN\d{5}$/.test(s) ? Math.max(best, Number(s.slice(2))) : best;
  }, 0);
  return `SN${String(max + 1).padStart(5, '0')}`;
};

// ── token ล็อกอิน ──
// เซิร์ฟเวอร์เช็กรหัสแล้วคืน token มา — แนบไปกับทุกคำขอที่ยิงไป API_URL ให้อัตโนมัติ
// (GET ต่อ &token= / POST ใส่ _token ใน body) หน้าต่าง ๆ จึงไม่ต้องแก้ทีละจุด
// เก็บไว้ในหน่วยความจำเท่านั้น — รีเฟรชหน้าแล้วต้องล็อกอินใหม่เหมือนเดิม
let authToken = '';
export const setAuthToken = (token) => { authToken = token || ''; };
export const hasAuthToken = () => !!authToken;

// เซิร์ฟเวอร์ตอบว่า token หมดอายุ/ไม่มี → แจ้ง App ให้พากลับหน้าล็อกอิน
export const AUTH_REQUIRED_EVENT = 'pos_auth_required';

const isApiRequest = (url) => {
  const s = String(url || '');
  if (s.startsWith(API_URL)) return true;
  if (typeof window === 'undefined') return false;
  try { return new URL(s, window.location.origin).href.startsWith(apiUrlAbsolute()); } catch { return false; }
};

if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !window.__posApiFetchPatched) {
  window.__posApiFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (typeof input !== 'string' || !isApiRequest(url)) return originalFetch(input, init);

    let nextUrl = input;
    let nextInit = init;
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (authToken) {
      if (method === 'GET') {
        nextUrl = `${input}${input.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`;
      } else if (init && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            nextInit = { ...init, body: JSON.stringify({ ...body, _token: authToken }) };
          }
        } catch { /* body ไม่ใช่ JSON — ส่งตามเดิม */ }
      }
    }

    const promise = originalFetch(nextUrl, nextInit);
    // ดูคำตอบแบบไม่รบกวนผู้เรียก (no-cors อ่านไม่ได้ก็ข้าม)
    promise.then(res => {
      if (!res || res.type === 'opaque') return;
      res.clone().json().then(json => {
        if (json && json.auth === 'required') window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      }).catch(() => {});
    }).catch(() => {});
    return promise;
  };
}

// ล็อกอินที่เซิร์ฟเวอร์ — คืน { success, user, token } หรือ { success:false, error, legacy }
// legacy = API รุ่นเก่ายังไม่มีคำสั่ง login ให้หน้าล็อกอินเช็กรหัสเองแบบเดิม
export const apiLogin = async (userId, pin) => {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'login', userId: String(userId), pin: String(pin) })
    });
    const json = await res.json().catch(() => null);
    if (!json) return { success: false, error: `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${res.status})` };
    if (json.success !== true && /Unknown action/i.test(json.error || '')) return { success: false, legacy: true };
    return json;
  } catch {
    return { success: false, error: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ต' };
  }
};
