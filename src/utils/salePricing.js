// ประเภทการขาย (customerType) และชุดราคาที่ผูกกับโต๊ะ
// ใช้ร่วมกันระหว่างหน้าขายกับหน้าสรุปบิล จะได้ไม่ตีความคนละแบบ

// ค่าที่ส่งออกคือ customerType ซึ่งเป็นตัวกำหนดชุดราคาของทุกเมนู
// '' = ราคาปกติ, 'Takehome' = ราคาห่อกลับบ้าน, 'Deli' = ราคาเดลิเวอรี่
export const SALE_TYPES = [
  { value: '',         th: '🍽️ ทานที่ร้าน',  en: '🍽️ Dine-in' },
  { value: 'Takehome', th: '🛍️ ห่อกลับบ้าน', en: '🛍️ Takeaway' },
  { value: 'Deli',     th: '🛵 เดลิเวอรี่',   en: '🛵 Delivery' }
];

export const sameTable = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// โต๊ะที่ตั้งค่าไว้หลังบ้าน (หน้าจัดการโต๊ะเขียนลง localStorage ตัวนี้)
export const readTablesConfig = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('pos_tables_config') || '[]');
    if (Array.isArray(saved) && saved.length > 0) return saved.filter(x => x.active !== false);
  } catch { /* ยังไม่ได้ตั้งค่า → ให้ผู้เรียกใช้ค่าเริ่มต้นของตัวเอง */ }
  return [];
};

// ชุดราคาที่ควรใช้เมื่อเลือกโต๊ะนั้น ๆ — โต๊ะแต่ละตัวตั้ง priceTier ไว้ตัวเดียว
// ยังไม่ได้ตั้งค่าโต๊ะไว้ ให้เดาจากชื่อโต๊ะแทน (Takehome 1 / LineMan / Grab ฯลฯ)
export const priceTypeForTable = (name, configuredTables = []) => {
  const cfg = configuredTables.find(x => sameTable(x.name, name));
  if (cfg) {
    if (cfg.priceTier === 'takehome') return 'Takehome';
    if (cfg.priceTier === 'deli') return 'Deli';
    return '';
  }
  const s = String(name).toLowerCase();
  if (s.startsWith('takehome') || s.includes('กลับบ้าน')) return 'Takehome';
  if (['lineman', 'grab', 'shopee', 'deli', 'delivery'].some(d => s.includes(d))) return 'Deli';
  return '';
};

// ประเภทการขายที่โต๊ะนี้เลือกได้ — ล็อกไว้ตาม priceTier ของโต๊ะ
// ยังไม่ได้เลือกโต๊ะ = โชว์ครบทุกแบบ ไว้ให้เห็นว่าร้านขายช่องทางไหนบ้าง
export const saleTypesForTable = (name, configuredTables = []) => {
  if (!name) return SALE_TYPES;
  const tier = priceTypeForTable(name, configuredTables);
  const only = SALE_TYPES.filter(o => o.value === tier);
  return only.length > 0 ? only : SALE_TYPES;
};

// ── ชื่อราคาที่เป็น "ช่องทางขาย" ไม่ใช่ขนาด/ตัวเลือกของเมนู ──
// เมนูที่มีแต่ราคาช่องทางพวกนี้ = ยังไม่ได้ตั้งราคาขายหน้าร้าน
export const TAKEHOME_ALIASES = ['takehome', 'take home', 'takeaway', 'ห่อกลับบ้าน', 'กลับบ้าน', 'ห่อกลับ'];
export const DELI_ALIASES = ['deli', 'delivery', 'เดลิเวอรี่', 'lineman', 'grab', 'shopee'];

export const normName = (v) => String(v || '').trim().toLowerCase();
export const isChannelPriceName = (name) =>
  TAKEHOME_ALIASES.includes(normName(name)) || DELI_ALIASES.includes(normName(name));

// ราคาที่เมนูตั้งไว้สำหรับประเภทการขายที่เลือกอยู่ — ไม่ได้ตั้งไว้คืน null
// '' (ขายปกติ/ทานที่ร้าน) = ต้องมีราคาที่ไม่ใช่ราคาช่องทางอย่างน้อยหนึ่งอัน
// เมนูที่ตั้งไว้แต่ราคา Takehome/Deli จึงถือว่ายังขายหน้าร้านไม่ได้
export const priceForSaleType = (priceOptions = [], saleType = '') => {
  if (!saleType) {
    return priceOptions.find(o => normName(o.name) === 'ปกติ')
      || priceOptions.find(o => !isChannelPriceName(o.name))
      || null;
  }
  const target = normName(saleType);
  return priceOptions.find(o => {
    const name = normName(o.name);
    if (name === target) return true;
    if (target === 'takehome' && TAKEHOME_ALIASES.includes(name)) return true;
    if (target === 'deli' && DELI_ALIASES.includes(name)) return true;
    return false;
  }) || null;
};
