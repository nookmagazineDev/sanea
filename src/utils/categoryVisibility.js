// ── หมวดหมู่แสดงให้ใครเห็น (ตั้งที่หลังบ้าน > หมวดหมู่) ──
// visibility: '' / 'all' = ทั้งพนักงานและลูกค้า · 'staff' = เฉพาะหน้าพนักงาน · 'customer' = เฉพาะหน้าลูกค้าสั่งเอง
// ซ่อนแค่ "การแสดงในรายการ" — เมนูในหมวดที่ซ่อนยังใช้เป็นตัวเลือกในป๊อปอัพได้ตามเดิม

export const VISIBILITY_OPTIONS = [
  { value: 'all', label: 'ทั้งพนักงานและลูกค้า', labelEn: 'Staff & customers' },
  { value: 'staff', label: 'เฉพาะพนักงาน', labelEn: 'Staff only' },
  { value: 'customer', label: 'เฉพาะลูกค้า (หน้าสั่งเอง)', labelEn: 'Customers only' }
];

// audience: 'staff' | 'customer'
export const categoryVisibleFor = (cat, audience) => {
  const v = (cat && cat.visibility) || 'all';
  return v === 'all' || v === audience;
};

// เมนูแสดงให้กลุ่มนี้เห็นไหม — หมวดหลักหรือหมวดเสริมตัวใดตัวหนึ่งเห็นได้ก็พอ
// หมวดที่ไม่รู้จัก (ถูกลบไปแล้ว) ยังแสดง เหมือนเดิมที่ตกไปอยู่ "เมนูอื่น ๆ"
export const menuVisibleFor = (item, categories, audience) => {
  const slugs = [item.category || '', ...(Array.isArray(item.categories) ? item.categories : [])].filter(Boolean);
  const known = slugs.map(s => categories.find(c => c.slug === s)).filter(Boolean);
  if (known.length === 0) return true;
  return known.some(c => categoryVisibleFor(c, audience));
};
