import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Percent, Tag } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { API_URL } from '../../utils/api';

const ManageDiscounts = () => {
  const { lang } = useOutletContext();
  const [discounts, setDiscounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pos_discounts') || '[]');
      setDiscounts(Array.isArray(saved) ? saved : []);
    } catch {}

    try {
      const cached = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
      if (Array.isArray(cached.categories)) setCategories(cached.categories);
    } catch {}
  }, []);

  const persistDiscounts = (newList) => {
    setDiscounts(newList);
    localStorage.setItem('pos_discounts', JSON.stringify(newList));
    window.dispatchEvent(new Event('pos_discounts_changed'));
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'saveDiscounts', discounts: newList })
    }).catch(console.error);
  };

  const handleAddNew = () => {
    setEditingItem({ id: Date.now().toString(), name: '', type: 'baht', value: '', categories: [] });
    setIsModalOpen(true);
  };

  const handleEdit = (item) => {
    setEditingItem({ ...item, categories: item.categories || [] });
    setIsModalOpen(true);
  };

  const handleDelete = (id) => {
    if (window.confirm(lang === 'th' ? 'ยืนยันลบส่วนลดนี้?' : 'Delete this discount?')) {
      persistDiscounts(discounts.filter(d => d.id !== id));
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const item = { ...editingItem, value: Number(editingItem.value) };
    if (discounts.find(d => d.id === item.id)) {
      persistDiscounts(discounts.map(d => d.id === item.id ? item : d));
    } else {
      persistDiscounts([...discounts, item]);
    }
    setIsModalOpen(false);
  };

  const toggleCategory = (slug) => {
    const cats = editingItem.categories || [];
    setEditingItem({
      ...editingItem,
      categories: cats.includes(slug) ? cats.filter(c => c !== slug) : [...cats, slug]
    });
  };

  const getCategoryLabel = (slug) => {
    const cat = categories.find(c => c.slug === slug);
    if (!cat) return slug;
    return `${cat.icon ? cat.icon + ' ' : ''}${lang === 'th' ? cat.name : (cat.nameEn || cat.name)}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>{lang === 'th' ? 'ส่วนลด' : 'Discounts'}</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {lang === 'th'
              ? 'สร้างส่วนลดเป็นบาทหรือเปอร์เซ็น และกำหนดหมวดหมู่ที่ใช้ได้'
              : 'Create fixed-baht or percentage discounts, assign applicable categories.'}
          </p>
        </div>
        <button className="admin-btn" onClick={handleAddNew}>
          <Plus size={20} /> {lang === 'th' ? 'เพิ่มส่วนลด' : 'Add Discount'}
        </button>
      </div>

      {/* Table */}
      <div className="admin-card">
        {discounts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
            <Percent size={52} style={{ opacity: 0.18, marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
            <p style={{ fontSize: '1rem' }}>
              {lang === 'th' ? 'ยังไม่มีส่วนลด กดปุ่ม "เพิ่มส่วนลด" เพื่อเริ่มต้น' : 'No discounts yet. Click "Add Discount" to get started.'}
            </p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{lang === 'th' ? 'ชื่อส่วนลด' : 'Discount Name'}</th>
                  <th>{lang === 'th' ? 'ประเภท' : 'Type'}</th>
                  <th>{lang === 'th' ? 'จำนวน' : 'Amount'}</th>
                  <th>{lang === 'th' ? 'หมวดหมู่ที่ใช้ได้' : 'Applicable Categories'}</th>
                  <th>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map(item => (
                  <tr key={item.id}>
                    <td>
                      <strong style={{ color: 'var(--text-main)' }}>{item.name}</strong>
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 12px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: '600',
                        background: item.type === 'baht' ? 'rgba(34,197,94,0.12)' : 'rgba(96,165,250,0.12)',
                        color: item.type === 'baht' ? '#16a34a' : '#2563eb',
                        border: `1px solid ${item.type === 'baht' ? 'rgba(34,197,94,0.3)' : 'rgba(96,165,250,0.3)'}`
                      }}>
                        {item.type === 'baht' ? (lang === 'th' ? '฿ บาท' : '฿ Baht') : (lang === 'th' ? '% เปอร์เซ็น' : '% Percent')}
                      </span>
                    </td>
                    <td style={{ fontWeight: '700', color: '#ef4444', fontSize: '1rem' }}>
                      {item.type === 'baht' ? `-฿${Number(item.value).toLocaleString()}` : `-${item.value}%`}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {item.categories && item.categories.length > 0
                        ? item.categories.map(s => getCategoryLabel(s)).join('  •  ')
                        : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{lang === 'th' ? 'ทุกหมวด' : 'All Categories'}</span>
                      }
                    </td>
                    <td>
                      <button className="admin-btn secondary" style={{ marginRight: '0.5rem', padding: '0.4rem' }} onClick={() => handleEdit(item)}>
                        <Edit2 size={16} />
                      </button>
                      <button className="admin-btn danger" style={{ padding: '0.4rem' }} onClick={() => handleDelete(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && editingItem && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>
                {discounts.find(d => d.id === editingItem.id)
                  ? (lang === 'th' ? 'แก้ไขส่วนลด' : 'Edit Discount')
                  : (lang === 'th' ? 'เพิ่มส่วนลดใหม่' : 'Add New Discount')}
              </h2>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit}>
              {/* ชื่อส่วนลด */}
              <div className="admin-form-group">
                <label>{lang === 'th' ? 'ชื่อส่วนลด' : 'Discount Name'}</label>
                <input
                  required
                  value={editingItem.name}
                  onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder={lang === 'th' ? 'เช่น ส่วนลดสมาชิก, ลด Happy Hour' : 'e.g. Member Discount, Happy Hour'}
                />
              </div>

              {/* ประเภท */}
              <div className="admin-form-group">
                <label>{lang === 'th' ? 'ประเภทส่วนลด' : 'Discount Type'}</label>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {[
                    { value: 'baht', labelTh: '฿ บาท (ลดคงที่)', labelEn: '฿ Fixed Baht', color: '#22c55e' },
                    { value: 'percent', labelTh: '% เปอร์เซ็น', labelEn: '% Percentage', color: '#60a5fa' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, type: opt.value })}
                      style={{
                        flex: 1, padding: '0.75rem', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
                        border: `2px solid ${editingItem.type === opt.value ? opt.color : 'rgba(255,255,255,0.15)'}`,
                        background: editingItem.type === opt.value ? `${opt.color}20` : 'rgba(255,255,255,0.04)',
                        color: editingItem.type === opt.value ? opt.color : 'var(--text-muted)',
                        fontWeight: '700', fontSize: '0.95rem', transition: 'all 0.15s'
                      }}
                    >
                      {lang === 'th' ? opt.labelTh : opt.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* จำนวน */}
              <div className="admin-form-group">
                <label>
                  {editingItem.type === 'baht'
                    ? (lang === 'th' ? 'จำนวนเงินที่ลด (฿)' : 'Discount Amount (฿)')
                    : (lang === 'th' ? 'เปอร์เซ็นต์ที่ลด (%)' : 'Discount Percentage (%)')}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  max={editingItem.type === 'percent' ? 100 : undefined}
                  step={editingItem.type === 'percent' ? '0.1' : '1'}
                  value={editingItem.value}
                  onChange={e => setEditingItem({ ...editingItem, value: e.target.value })}
                  placeholder={editingItem.type === 'baht' ? '50' : '10'}
                />
              </div>

              {/* หมวดหมู่ */}
              <div className="admin-form-group">
                <label>{lang === 'th' ? 'หมวดหมู่ที่ใช้ส่วนลดได้' : 'Applicable Categories'}</label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 0.65rem 0' }}>
                  {lang === 'th'
                    ? 'ถ้าไม่เลือกหมวดใด = ใช้ได้กับทุกหมวด'
                    : 'If none selected = applies to all categories'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {categories.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      {lang === 'th' ? 'ยังไม่พบหมวดหมู่ (กด refresh แล้วลองใหม่)' : 'No categories found (try refreshing data)'}
                    </p>
                  ) : (
                    categories.filter(c => c.isActive !== false).map(cat => {
                      const selected = (editingItem.categories || []).includes(cat.slug);
                      return (
                        <button
                          key={cat.slug}
                          type="button"
                          onClick={() => toggleCategory(cat.slug)}
                          style={{
                            padding: '0.45rem 1rem', borderRadius: '20px', cursor: 'pointer', fontFamily: 'inherit',
                            border: `1.5px solid ${selected ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
                            background: selected ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)',
                            color: selected ? 'var(--accent)' : 'var(--text-muted)',
                            fontWeight: selected ? '700' : '400', fontSize: '0.88rem', transition: 'all 0.15s'
                          }}
                        >
                          {cat.icon && `${cat.icon} `}
                          {lang === 'th' ? cat.name : (cat.nameEn || cat.name)}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Preview */}
              {editingItem.name && editingItem.value > 0 && (
                <div style={{
                  background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: '10px', padding: '0.85rem 1rem', marginBottom: '0.5rem'
                }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
                    {lang === 'th' ? 'ตัวอย่าง: ' : 'Preview: '}
                    <strong style={{ color: 'var(--accent)' }}>{editingItem.name}</strong>
                    {' — '}
                    {editingItem.type === 'baht'
                      ? <span style={{ color: '#f87171' }}>ลด ฿{Number(editingItem.value).toLocaleString()}</span>
                      : <span style={{ color: '#f87171' }}>ลด {editingItem.value}%</span>}
                    {editingItem.categories && editingItem.categories.length > 0
                      ? <span> ({editingItem.categories.map(s => getCategoryLabel(s)).join(', ')})</span>
                      : <span style={{ color: 'rgba(255,255,255,0.4)' }}> ({lang === 'th' ? 'ทุกหมวด' : 'All Categories'})</span>}
                  </p>
                </div>
              )}

              <button type="submit" className="admin-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                <Save size={20} /> {lang === 'th' ? 'บันทึกส่วนลด' : 'Save Discount'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageDiscounts;
