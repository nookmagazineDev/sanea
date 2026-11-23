// แบนเนอร์สไลด์บนหน้าลูกค้าสั่งเอง — ตั้งค่าที่หลังบ้าน > ตั้งค่าแบนเนอร์
// เก็บรวมอยู่ในก้อนตั้งค่าร้าน (settings.banner) จึงไปถึงมือถือลูกค้าพร้อมข้อมูลเมนู ไม่ต้องมีตาราง/API เพิ่ม

export const LOGO_WIDE = '/logo-wide.png';
// สัดส่วนกว้าง:สูง ของสไลด์ — เท่ากับโลโก้เดิม (800×348) หัวจอจึงสูงเท่าเดิม
export const BANNER_RATIO = '23 / 10';
export const LOGO_SLIDE_ID = 'logo';
export const LINK_TYPES = ['none', 'member', 'category', 'url'];
// ลูกค้ากดปิดแบนเนอร์แล้ว จำไว้จนกว่าจะเปิดหน้าใหม่ (สแกน QR ใหม่ = แท็บใหม่)
export const BANNER_CLOSED_KEY = 'kiosk_banner_closed';

const LOGO_SLIDE = { id: LOGO_SLIDE_ID, kind: 'logo', url: LOGO_WIDE, on: true, link: { type: 'none', value: '' } };

export const DEFAULT_BANNER = {
  slides: [LOGO_SLIDE],
  interval: 4,       // วินาที, 0 = ไม่เลื่อนเอง
  showCaption: true, // ข้อความ "สั่งอาหารด้วยตนเอง" ใต้สไลด์
  sticky: true,      // ค้างไว้ด้านบนตอนลูกค้าเลื่อนจอ
  closable: true     // มีปุ่ม ✕ ให้ลูกค้าปิดเอง
};

// ลิงก์ที่ร้านพิมพ์เอง — รับเฉพาะ http/https กันลิงก์แปลก ๆ (javascript: ฯลฯ)
export const safeUrl = (value) => {
  const s = String(value || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : '';
};

const normLink = (link) => {
  const type = link && LINK_TYPES.includes(link.type) ? link.type : 'none';
  const value = type === 'category' || type === 'url' ? String((link && link.value) || '').trim() : '';
  return { type, value };
};

// ค่าที่บันทึกไว้ → รูปแบบที่ใช้งานได้เสมอ (ยังไม่เคยตั้งค่า = โลโก้รูปเดียวเหมือนเดิม)
export const resolveBanner = (settings) => {
  const raw = settings && settings.banner && typeof settings.banner === 'object' ? settings.banner : null;
  if (!raw) return DEFAULT_BANNER;
  const slides = (Array.isArray(raw.slides) ? raw.slides : []).map((s, i) => {
    if (!s || typeof s !== 'object') return null;
    if (s.kind === 'logo' || s.id === LOGO_SLIDE_ID) return { ...LOGO_SLIDE, on: s.on !== false, link: normLink(s.link) };
    const url = String(s.url || '').trim();
    if (!url) return null;
    return { id: String(s.id || `b${i}`), kind: 'image', url, name: String(s.name || ''), on: s.on !== false, link: normLink(s.link) };
  }).filter(Boolean);
  // โลโก้ต้องมีในรายการเสมอ (ปิดได้ แต่ลบไม่ได้) — มีได้ใบเดียว
  let seenLogo = false;
  const unique = slides.filter(s => {
    if (s.kind !== 'logo') return true;
    if (seenLogo) return false;
    seenLogo = true;
    return true;
  });
  if (!seenLogo) unique.unshift(LOGO_SLIDE);
  const interval = Number(raw.interval);
  return {
    slides: unique,
    interval: Number.isFinite(interval) && interval >= 0 ? Math.min(interval, 60) : DEFAULT_BANNER.interval,
    showCaption: raw.showCaption !== false,
    sticky: raw.sticky !== false,
    closable: raw.closable !== false
  };
};

export const activeSlides = (banner) => (banner && Array.isArray(banner.slides) ? banner.slides.filter(s => s.on) : []);

// ค้างจอ/ปุ่มปิด ใช้เมื่อมีรูปแบนเนอร์จริงเท่านั้น — เหลือแต่โลโก้ = หัวร้านธรรมดาแบบเดิม
export const hasPromoSlides = (banner) => activeSlides(banner).some(s => s.kind === 'image');
