// คิดส่วนลดร้าน (หลังบ้าน > โปรโมชั่น/ส่วนลด) ให้ตรงกันทุกหน้า: หน้าขาย และหน้าคิดเงิน
// ส่วนลดที่เลือกหมวดไว้ (discount.categories) ลดเฉพาะยอดของเมนูในหมวดนั้น — ไม่เลือกหมวด = ทั้งบิล
// lines: [{ name, amount }] (amount = ยอดของบรรทัด รวมตัวเลือกแล้ว) · menu: เมนูทั้งหมด (หาหมวดจากชื่อเมนู)

const norm = (s) => String(s || '').trim();

export function menuCategoryLookup(menu = []) {
  const map = new Map();
  (Array.isArray(menu) ? menu : []).forEach(m => {
    if (!m || !m.name) return;
    const cats = new Set([m.category, ...(Array.isArray(m.categories) ? m.categories : [])].filter(Boolean).map(String));
    const key = norm(m.name);
    // ชื่อซ้ำกันหลายเมนู = รวมหมวดของทุกตัว
    map.set(key, new Set([...(map.get(key) || []), ...cats]));
  });
  return (name) => map.get(norm(name)) || new Set();
}

// ยอดที่ส่วนลดนี้ใช้ได้
export function discountBase(discount, lines = [], categoriesOf) {
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const cats = discount && Array.isArray(discount.categories) ? discount.categories.filter(Boolean).map(String) : [];
  if (!cats.length || !categoriesOf) return total;
  return lines.reduce((s, l) => {
    const own = categoriesOf(l.name);
    return cats.some(c => own.has(c)) ? s + (Number(l.amount) || 0) : s;
  }, 0);
}

export function discountAmount(discount, lines = [], categoriesOf) {
  if (!discount) return 0;
  const base = discountBase(discount, lines, categoriesOf);
  if (discount.type === 'percent') return Math.round(base * (Number(discount.value) || 0)) / 100;
  if (discount.type === 'baht') return Math.min(Number(discount.value) || 0, base);
  return 0;
}
