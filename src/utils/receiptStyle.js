// รูปแบบใบเสร็จ (หลังบ้าน > ใบเสร็จ) — โลโก้ ขนาดโลโก้ และรายละเอียดที่แสดงบนหัวใบ
// เครื่องพิมพ์ความร้อน 80mm กว้าง 576 จุด · 58mm กว้าง 384 จุด (1 จุด = 1 พิกเซลของรูปโลโก้)
export const PAPER_DOTS = { 80: 576, 58: 384 };

export const DEFAULT_RECEIPT = {
  logo: '', logoSrc: '', logoWidth: 240, logoThreshold: 160, paper: 80,
  showName: true, showAddress: true, showPhone: true
};

export const normalizeReceipt = (rs) => ({ ...DEFAULT_RECEIPT, ...(rs && typeof rs === 'object' ? rs : {}) });

// ส่วนที่แนบไปกับหัวใบเสร็จของทุกงานพิมพ์ (Print Server พิมพ์โลโก้ตามรูปนี้ตรง ๆ)
export const receiptHeaderStyle = (rs) => {
  const r = normalizeReceipt(rs);
  return {
    logo: r.logo || '', logoWidth: r.logoWidth, paper: r.paper,
    showName: r.showName !== false, showAddress: r.showAddress !== false, showPhone: r.showPhone !== false
  };
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// ย่อรูปต้นฉบับที่อัปโหลด (ไม่เกิน maxW) เก็บไว้ปรับขนาด/ความเข้มใหม่ภายหลังได้โดยไม่ต้องอัปโหลดอีก
export const shrinkSource = async (dataUrl, maxW = 800) => {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);   // เก็บพื้นโปร่งใสไว้ตามเดิม
  return c.toDataURL('image/png');
};

// โลโก้สำหรับพิมพ์: ย่อเป็นกว้าง width จุด วางบนพื้นขาว แล้วแปลงเป็นขาว-ดำตามความเข้ม (threshold)
// ได้ภาพเดียวกับที่เครื่องพิมพ์ความร้อนพิมพ์ออกมา → ตัวอย่างบนจอตรงกับของจริง
export const makePrintLogo = async (src, width, threshold = 160) => {
  const img = await loadImage(src);
  const w = Math.max(16, Math.round(width));
  const h = Math.max(1, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2];
    const v = g < threshold ? 0 : 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
};

// โลโก้ในใบเสร็จแบบ HTML (พรีวิว/พิมพ์ผ่านเบราว์เซอร์): ความกว้างเป็น % ของหน้ากระดาษ ให้สัดส่วนเท่ากับที่เครื่องพิมพ์ความร้อนพิมพ์
export const logoHtml = (h) => {
  if (!h || !h.logo) return '';
  const dots = PAPER_DOTS[Number(h.paper) === 58 ? 58 : 80];
  const pct = Math.min(100, Math.round((Number(h.logoWidth) || 240) / dots * 1000) / 10);
  return `<div class="c" style="margin-bottom:4px"><img src="${h.logo}" alt="" style="width:${pct}%;max-width:100%;image-rendering:pixelated"></div>`;
};
