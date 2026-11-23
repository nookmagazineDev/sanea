// ที่อยู่รูปเมนู — ใช้ร่วมกันทั้งหน้าขาย (POS) และหน้าลูกค้าสแกนสั่งเอง
// รูปจริงอยู่ใน public/images/<โฟลเดอร์หมวด>/<ชื่อเมนู>.png (หรือ .jpg/.svg) ไม่ได้อยู่ใน /images/menu/
import LOCAL_IMAGE_LIST from 'virtual:menu-image-files';

// ไฟล์ใน public/images ที่มีอยู่จริง (รายชื่อสร้างตอน build) — ไม่ลองโหลดชื่อไฟล์ที่ไม่มี
// รายชื่อว่าง (เช่นรันนอก Vite) = ไม่รู้ว่ามีไฟล์อะไรบ้าง ลองทุกแบบเหมือนเดิม
const LOCAL_IMAGES = new Set((LOCAL_IMAGE_LIST || []).map(p => String(p).normalize('NFC')));
const hasLocal = (path) => LOCAL_IMAGES.size === 0 || LOCAL_IMAGES.has(path.normalize('NFC'));

const CATEGORY_FOLDERS = {
  "ชุดอิ่มเดี่ยว": "ชุดอิ่มเดี่ยว",
  "ไก่ล้วนๆ": "ไก่ล้วนๆ",
  "ท๊อปปิ้งเสริม": "ท๊อปปิ้งเสริม",
  "น้ำจิ้ม": "น้ำจิ้ม",
  "ก๋วยเตี๊ยวลูกชิ้นไก่": "ก๋วยเตี๊ยวลูกชิ้นไก่",
  "ของทานเล่น": "ของทานเล่น",
  "เครื่องดื่ม": "เครื่องดื่ม",
  "ของหวาน": "ของหวาน",
  "Promotion": "Promotion",
  "SET": "กับแกล้ม3อย่าง  ทอด ต้ม ย่าง",
  "ของกินเล่น": "ของกินเล่น",
  "ย่าง": "ย่าง",
  "อาหารจานเดียว": "อาหารจานเดียว",
  "ต้ม": "ต้ม",
  "ผัด": "ผัด",
  "ยำ": "ยำ",
  "เบียร์": "เบียร์",
  "เหล้า": "เหล้า",
  "มิกเซอร์": "มิกเซอร์",
  "โชจู": "โชจู"
};

// รูปที่อัปโหลดไว้บน ImgBB เป็นไฟล์ขนาดเต็ม — ขอฉบับย่อผ่านตัวย่อรูปของ Vercel หรือของเซิร์ฟเวอร์ร้าน (api/_lib/imageProxy.js)
// ขนาดที่ขอได้ต้องตรงกับ images.sizes ใน vercel.json
// lh3.googleusercontent.com = รูปจาก Google Drive (ต้องมีใน remotePatterns ของ vercel.json ด้วย)
const OPTIMIZABLE_HOSTS = ['i.ibb.co', 'lh3.googleusercontent.com'];
export const IMAGE_WIDTHS = [256, 640, 1080];
const SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === '1';

const optimizedUrl = (url, width) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !OPTIMIZABLE_HOSTS.includes(u.hostname)) return null;
  } catch {
    return null;
  }
  const w = IMAGE_WIDTHS.find(x => x >= width) || IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
  // เปิดจากเซิร์ฟเวอร์ร้านเอง (npm run web:build) → ตัวย่อรูปของ API (/api/img) · บน Vercel ใช้ตัวย่อของ Vercel
  if (SELF_HOSTED) return `/api/img?url=${encodeURIComponent(url)}&w=${w}`;
  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;
};

// ลิงก์ Google Drive (เช่น drive.google.com/file/d/<ID>/view, open?id=<ID>, uc?id=<ID>)
// → ขอฉบับย่อจากตัวย่อรูปของ Google เอง ต้องแชร์ไฟล์เป็น "ทุกคนที่มีลิงก์" ไว้
const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com', 'lh3.googleusercontent.com'];

const driveFileId = (url) => {
  try {
    const u = new URL(url);
    if (!DRIVE_HOSTS.includes(u.hostname)) return null;
    const m = u.pathname.match(/\/d\/([\w-]{20,})/);
    if (m) return m[1];
    const id = u.searchParams.get('id');
    return id && /^[\w-]{20,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
};

// โหลดรูป Drive ตรง ๆ จากมือถือลูกค้าทุกคน Google จะจำกัดจำนวนครั้ง (ลูกค้าหลายโต๊ะใช้ Wi-Fi ร้านเดียวกัน
// = IP เดียวกัน) แล้วรูปไม่ขึ้นบางรูป → ให้ Vercel ดึงจาก Drive ครั้งเดียวแล้วเก็บแคชไว้แจกทุกคน (ข้อแรก)
// ถ้าตัวย่อของ Vercel ใช้ไม่ได้ ค่อยโหลดตรงจาก Drive (ข้อ 2-3) เหมือนเดิม
const driveResizedUrls = (url, width) => {
  const id = driveFileId(url);
  if (!id) return [];
  const viaVercel = optimizedUrl(`https://lh3.googleusercontent.com/d/${id}=w1080`, width);
  return [
    ...(viaVercel ? [viaVercel] : []),
    `https://lh3.googleusercontent.com/d/${id}=w${width}`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`
  ];
};

// ลำดับรูปที่จะลองโหลด (เน้นรูปภาพถ่ายเหมือนจริงก่อน)
// width = ความกว้างที่ต้องใช้จริงโดยประมาณ (px รวมความคมจอแล้ว)
// .webp = ไฟล์ย่อของรูปถ่าย (กว้างไม่เกิน 800px) โหลดเร็วกว่า PNG ต้นฉบับมาก — ลองก่อนเสมอ
export const menuImageCandidates = (food, width = 640) => {
  if (!food) return [];
  const folder = CATEGORY_FOLDERS[food.category] || food.category || 'uncategorized';
  const fileName = (food.name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  // รายการในตะกร้าอาจเป็นตัวแปรของเมนู (id ต่อท้าย) — ใช้ id ของเมนูหลักหาไฟล์
  const id = food.baseId || food.id;
  const list = [];
  // 1. รูปที่แอดมินอัปโหลด/ใส่ลิงก์ไว้เอง (เช่นรูปใน Google Drive) — มาก่อนเสมอ
  //    เพราะเป็นรูปที่ตั้งใจเลือกให้เมนูนี้ ส่วนข้อ 2-4 เป็นการ "เดา" ชื่อไฟล์ในเครื่อง
  if (food.image && String(food.image).trim()) {
    const url = String(food.image).trim();
    // ฉบับย่อก่อน — ถ้าย่อไม่ได้ (เช่นรันในเครื่อง ไม่มีตัวย่อของ Vercel) ค่อยใช้ไฟล์ต้นฉบับ
    const small = optimizedUrl(url, width);
    if (small) list.push(small);
    list.push(...driveResizedUrls(url, width));
    list.push(url);
  }
  const local = [];
  if (fileName) {
    // 2. Check folder-based real photos (WebP/PNG/JPG)
    local.push(`/images/${folder}/${fileName}.webp`);
    local.push(`/images/${folder}/${fileName}.png`);
    local.push(`/images/${folder}/${fileName}.jpg`);
    // 3. Check root-based real photos (WebP/PNG/JPG)
    local.push(`/images/${fileName}.webp`);
    local.push(`/images/${fileName}.png`);
    local.push(`/images/${fileName}.jpg`);
  }
  // 4. Check ID-based real photos (WebP/PNG/JPG)
  local.push(`/images/item_${id}.webp`);
  local.push(`/images/item_${id}.png`);
  local.push(`/images/item_${id}.jpg`);
  // 5. SVG vector fallback
  if (fileName) {
    local.push(`/images/${folder}/${fileName}.svg`);
    local.push(`/images/${fileName}.svg`);
  }
  local.push(`/images/item_${id}.svg`);
  list.push(...local.filter(hasLocal));
  return [...new Set(list)];
};
