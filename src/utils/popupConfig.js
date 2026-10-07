// Helpers for per-menu-item popup (Order Wizard) configuration.
// Popup config used to live on each category; it now lives on each menu item
// (stored as a single JSON column `popupConfig` in the Menu sheet).

// Per-popup field suffixes (1..6) plus the shared hasDining flag.
export const POPUP_NUMS = [1, 2, 3, 4, 5, 6];

const popupFieldKeys = () => {
  const keys = ['hasDining', 'hasNotes', 'popupConfigured'];
  POPUP_NUMS.forEach(n => {
    keys.push(
      `hasPopup${n}`, `popup${n}Category`, `popup${n}Items`, `popup${n}ItemsMax`,
      `popup${n}Min`, `popup${n}Max`, `popup${n}Free`, `popup${n}AllowRepeat`,
      `popup${n}Separate`
    );
  });
  return keys;
};

// Default flattened popup fields for a brand-new menu item.
export const emptyPopupFields = () => {
  const obj = { hasDining: true, hasNotes: true, popupConfigured: false };
  POPUP_NUMS.forEach(n => {
    obj[`hasPopup${n}`] = false;
    obj[`popup${n}Category`] = '';
    obj[`popup${n}Items`] = [];
    obj[`popup${n}ItemsMax`] = {};
    obj[`popup${n}Min`] = 0;
    obj[`popup${n}Max`] = 0;
    obj[`popup${n}Free`] = false;
    obj[`popup${n}AllowRepeat`] = true; // เลือกซ้ำได้เป็นค่าเริ่มต้น
    // แยกเป็นรายการของตัวเองในบิล/ใบครัว แทนที่จะเป็นตัวเลือกใต้เมนูหลัก
    // ค่าเริ่มต้น = แยก เพราะป๊อปอัพดึง "เมนูจริง" มาให้เลือก ครัวควรเห็นเป็นคนละรายการ
    // (รายการฟรีจะเป็น ฿0 รายการที่คิดเงินจะติดราคาของตัวเองไปด้วย)
    // ป๊อปอัพที่เป็นตัวเลือกล้วน ๆ (เผ็ดน้อย/ไข่ดาว) ค่อยไปติ๊กออกทีละอันในหน้าจัดการเมนู
    obj[`popup${n}Separate`] = true;
  });
  return obj;
};

// Merge a stored popupConfig object back onto the flat item (for the wizard/forms).
export const flattenPopupConfig = (item) => {
  if (!item) return item;
  const cfg = item.popupConfig && typeof item.popupConfig === 'object' ? item.popupConfig : {};
  return { ...item, ...cfg };
};

// Collect the flat popup fields off an item into a compact popupConfig object,
// marking it as explicitly configured so the storefront uses item-level config.
export const extractPopupConfig = (item) => {
  const cfg = { popupConfigured: true };
  popupFieldKeys().forEach(k => {
    if (k === 'popupConfigured') return;
    if (item[k] !== undefined) cfg[k] = item[k];
  });
  return cfg;
};

// True when an item has been explicitly given its own popup configuration.
export const hasItemPopupConfig = (food) => !!(food && food.popupConfigured);

// Build the list of selectable price options for a menu item.
// Falls back to the single legacy `price` field when no named prices exist.
export const getPriceOptions = (food) => {
  if (food && Array.isArray(food.prices) && food.prices.length > 0) {
    const opts = food.prices
      .filter(p => p && p.price !== '' && p.price != null)
      .map(p => ({ name: p.name || '', price: Number(p.price) || 0 }));
    if (opts.length > 0) return opts;
  }
  return [{ name: '', price: Number(food && food.price) || 0 }];
};

// Decide which object holds the active popup config for a given food.
// Falls back to the food's category config when the item is not configured,
// so existing category-based setups keep working until items are reconfigured.
export const resolvePopupSource = (food, categories = []) => {
  if (hasItemPopupConfig(food)) return food;
  return categories.find(c => c.slug === food.category) || {};
};

// True when a menu item carries its own popup steps — used to open a nested
// popup when the item is picked inside another item's popup.
export const hasOwnPopupSteps = (item) => {
  if (!item) return false;
  const cfg = flattenPopupConfig(item);
  if (!hasItemPopupConfig(cfg)) return false;
  return POPUP_NUMS.some(n => cfg[`hasPopup${n}`] === true);
};

// หมวดที่ปิดคำถาม "ทานที่ร้าน / ห่อกลับบ้าน" ไว้ (hasDining === false) เช่นหมวดเครื่องดื่ม
// ป้ายกำกับการรับประทานของรายการนั้นใช้ "ชื่อหมวด" แทน
//
// เดิมโค้ดเช็กตรง ๆ ว่า category === 'drink' ซึ่งผูกกับรหัสหมวดที่ตั้งชื่อไว้แบบนั้นพอดี
// พอเปลี่ยนรหัสหมวดเป็น HL##### การเช็กแบบนั้นใช้ไม่ได้อีก จึงย้ายมาอ่านจากค่าที่ตั้งไว้ในหมวดแทน
export const categoryDining = (food, categories = []) => {
  const cat = categories.find(c => c.slug === (food && food.category));
  if (cat && cat.name) return { id: cat.slug, name: cat.name, nameEn: cat.nameEn || cat.name };
  return { id: 'dine_in', name: 'ทานที่ร้าน', nameEn: 'Dine-in' };
};

// ── หมายเหตุถึงครัว (ขั้นตอนท้าย ๆ ของป๊อปอัพ) ──

// รายการตั้งต้นสำหรับร้านที่ยังไม่เคยเข้าไปตั้งค่า — ตั้งค่าครั้งแรกเมื่อไหร่ค่านี้จะถูกแทนที่ทั้งชุด
export const DEFAULT_NOTE_OPTIONS = [
  { id: 'note_no_spicy',      name: 'ไม่เผ็ด',         nameEn: 'Not spicy' },
  { id: 'note_less_spicy',    name: 'เผ็ดน้อย',        nameEn: 'Less spicy' },
  { id: 'note_extra_spicy',   name: 'เผ็ดมาก',         nameEn: 'Extra spicy' },
  { id: 'note_no_coriander',  name: 'ไม่ใส่ผักชี',      nameEn: 'No coriander' },
  { id: 'note_sauce_side',    name: 'แยกน้ำจิ้ม',       nameEn: 'Sauce on the side' },
  { id: 'note_no_cutlery',    name: 'ไม่ใส่ช้อนส้อม',   nameEn: 'No cutlery' }
];

// ความยาวสูงสุดของหมายเหตุที่พิมพ์เอง — ยาวกว่านี้ใบครัว 80 มม. ตัดคำจนอ่านไม่ออก
export const NOTE_MAX_LENGTH = 120;

// อ่านค่าหมายเหตุจาก settings ของร้าน
//   kiosk = true  → หน้าลูกค้าสแกน QR สั่งเอง (ค่าเริ่มต้นคือพิมพ์เองไม่ได้)
//   kiosk = false → หน้าขายที่พนักงานกดให้ (ค่าเริ่มต้นคือพิมพ์เองได้)
export const resolveNoteConfig = (settings, { kiosk = false } = {}) => {
  const raw = settings && typeof settings.orderNotes === 'object' ? settings.orderNotes : null;
  const options = (raw && Array.isArray(raw.options) ? raw.options : DEFAULT_NOTE_OPTIONS)
    .filter(o => o && String(o.name || '').trim())
    .map(o => ({ id: String(o.id || o.name), name: String(o.name).trim(), nameEn: String(o.nameEn || o.name).trim() }));
  const flag = kiosk ? 'allowCustomKiosk' : 'allowCustomPos';
  const allowCustom = raw && raw[flag] !== undefined ? !!raw[flag] : !kiosk;
  return { options, allowCustom };
};

// เมนูนี้ถามหมายเหตุไหม — ไม่เคยตั้งค่า = ถาม (เมนูเดิมทั้งหมดจึงได้ใช้ทันทีโดยไม่ต้องไล่เปิดทีละอัน)
export const itemAsksNotes = (cfg) => !!cfg && cfg.hasNotes !== false;
