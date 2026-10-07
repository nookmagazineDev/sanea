import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, GripVertical } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { API_URL, nextItemId } from '../../utils/api';
import { VISIBILITY_OPTIONS } from '../../utils/categoryVisibility';

const ManageCategories = () => {
  const { lang } = useOutletContext();
  const [categories, setCategories] = useState([]);
  const [, setMenuList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    // Clear stale cache first so fresh data always wins
    localStorage.removeItem('gas_all_data');
    setLoading(true);

    try {
      const resp = await fetch(API_URL + '?action=getAllData');
      const data = await resp.json();
      if (data) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setMenuList(Array.isArray(data.menu) ? data.menu : []);
      }
    } catch(e) {
      console.error('Failed to fetch categories:', e);
    }
    setLoading(false);
  };

  const handleSave = async (newArray) => {
    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'saveCategories',
          categories: newArray
        })
      });
      setCategories(newArray);
      setIsModalOpen(false);

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.categories = newArray;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(e) { console.error(e); }
      }
    } catch(e) {
      alert('Failed to save to database');
    }
  };

  const handleDelete = async (slug) => {
    if (window.confirm('Are you sure you want to delete this category? (It will just vanish from tabs but menus assigned to it will still exist).')) {
      const updated = categories.filter(item => item.slug !== slug);
      
      try {
        await fetch(API_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'deleteCategory',
            slug: slug
          })
        });
        
        setCategories(updated);
        
        const cached = localStorage.getItem('gas_all_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            parsed.categories = updated;
            localStorage.setItem('gas_all_data', JSON.stringify(parsed));
            window.dispatchEvent(new Event('appDataChanged'));
          } catch(e) { console.error(e); }
        }
      } catch(e) {
        alert('Failed to delete category');
      }
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { if (e.target) e.target.style.opacity = '0.5'; }, 0);
  };

  const handleDragEnd = (e) => {
    if (e.target) e.target.style.opacity = '1';
    setDraggedIdx(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetIdx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const updated = [...categories];
    const draggedItem = updated.splice(draggedIdx, 1)[0];
    updated.splice(targetIdx, 0, draggedItem);
    handleSave(updated);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = async () => {
    // หมวดหมู่ใช้ชุดเลขเดียวกับเมนู รหัสจึงไม่มีทางซ้ำกันข้ามสองตาราง
    const id = await nextItemId(categories.map(c => c.slug));
    setEditingItem({
      slug: id,
      name: '',
      nameEn: '',
      icon: '📌',
      isActive: true,
      visibility: 'all',
      hasPopup1: false, popup1Category: '', popup1Items: [], popup1ItemsMax: {}, popup1Min: 0, popup1Max: 0, popup1Free: false,
      hasPopup2: false, popup2Category: '', popup2Items: [], popup2ItemsMax: {}, popup2Min: 0, popup2Max: 0, popup2Free: false,
      hasPopup3: false, popup3Category: '', popup3Items: [], popup3ItemsMax: {}, popup3Min: 0, popup3Max: 0, popup3Free: false,
      hasPopup4: false, popup4Category: '', popup4Items: [], popup4ItemsMax: {}, popup4Min: 0, popup4Max: 0, popup4Free: false,
      hasPopup5: false, popup5Category: '', popup5Items: [], popup5ItemsMax: {}, popup5Min: 0, popup5Max: 0, popup5Free: false,
      hasPopup6: false, popup6Category: '', popup6Items: [], popup6ItemsMax: {}, popup6Min: 0, popup6Max: 0, popup6Free: false,
      hasDining: true
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    let updated;
    if (categories.find(i => i.slug === editingItem.slug)) {
      updated = categories.map(i => i.slug === editingItem.slug ? editingItem : i);
    } else {
      updated = [...categories, editingItem];
    }
    
    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'upsertCategory',
          item: editingItem
        })
      });
      
      setCategories(updated);
      setIsModalOpen(false);
      
      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.categories = updated;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(err) { console.error(err); }
      }
    } catch(err) {
      alert('Failed to save to database');
    }
  };

  const handleAutoTranslate = async () => {
    if (!editingItem.name) return;
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=en&dt=t&q=${encodeURIComponent(editingItem.name)}`;
      const res = await fetch(url);
      const data = await res.json();
      const translatedText = data[0].map(item => item[0]).join('');
      setEditingItem(prev => ({...prev, nameEn: translatedText}));
    } catch(e) {
      console.error('Translation failed', e);
      alert('Translation failed. Please try again or enter manually.');
    }
  };

  const filteredCategories = categories.filter(item => {
    const searchLow = searchTerm.toLowerCase();
    const nameLow = (item.name || '').toLowerCase();
    const nameEnLow = (item.nameEn || '').toLowerCase();
    const slugLow = (item.slug || '').toLowerCase();
    return nameLow.includes(searchLow) || nameEnLow.includes(searchLow) || slugLow.includes(searchLow);
  });

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>{lang === 'th' ? 'จัดการหมวดหมู่' : 'Manage Categories'}</h1>
          <p>{lang === 'th' ? 'สร้างและแก้ไขแท็บหมวดหมู่ที่ลูกค้าเห็น' : 'Create and edit the navigation tabs your customers see.'}</p>
        </div>
        <button className="admin-btn" onClick={handleAddNew}>
          <Plus size={20} /> {lang === 'th' ? 'เพิ่มหมวดหมู่' : 'Add Category'}
        </button>
      </div>

      <div className="admin-card">
        <div style={{ marginBottom: '1rem', display: 'flex' }}>
          <input 
            type="text" 
            placeholder={lang === 'th' ? 'ค้นหาจากชื่อ หรือ Slug...' : 'Search by name or slug...'} 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-search-input"
            style={{ width: '100%', maxWidth: '400px' }}
          />
        </div>
        {loading ? <p>{lang === 'th' ? 'กำลังโหลดข้อมูล...' : 'Loading categories from database...'}</p> : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{lang === 'th' ? 'ไอคอน' : 'Icon'}</th>
                  <th>{lang === 'th' ? 'ชื่อหมวดหมู่ (TH/EN)' : 'Category Name (TH/EN)'}</th>
                  <th>{lang === 'th' ? 'รหัสอ้างอิง (Slug)' : 'Internal Slug'}</th>
                  <th>{lang === 'th' ? 'สถานะ' : 'Status'}</th>
                  <th>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.length > 0 ? filteredCategories.map((item, index) => (
                  <tr 
                    key={item.slug}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    style={{ 
                      cursor: draggedIdx !== null ? 'grabbing' : 'grab',
                      background: draggedIdx === index ? 'rgba(255,255,255,0.05)' : ''
                    }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '2rem' }}>
                        <GripVertical size={20} color="gray" />
                        {item.icon}
                      </div>
                    </td>
                    <td>
                      <strong>{item.name}</strong><br/>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)'}}>{item.nameEn}</span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{item.slug}</td>
                    <td>
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.85rem',
                        background: item.isActive !== false ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: item.isActive !== false ? '#22c55e' : '#ef4444'
                      }}>
                        {item.isActive !== false ? (lang === 'th' ? 'เปิดแสดง' : 'Active') : (lang === 'th' ? 'ซ่อน' : 'Hidden')}
                      </span>
                      {item.isActive !== false && item.visibility && item.visibility !== 'all' && (
                        <div style={{ marginTop: 4, fontSize: '0.78rem', fontWeight: 600, color: item.visibility === 'staff' ? '#2563eb' : '#c2410c' }}>
                          {item.visibility === 'staff' ? (lang === 'th' ? '👤 เฉพาะพนักงาน' : 'Staff only') : (lang === 'th' ? '📱 เฉพาะลูกค้า' : 'Customers only')}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="admin-btn secondary" style={{ marginRight: '0.5rem', padding: '0.4rem' }} onClick={() => handleEdit(item)}>
                        <Edit2 size={16} />
                      </button>
                      <button className="admin-btn danger" style={{ padding: '0.4rem' }} onClick={() => handleDelete(item.slug)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                      {lang === 'th' ? 'ไม่พบข้อมูลแนะนำให้ตั้งค่าเริ่มต้นโดยการบันทึก' : 'No categories found. Adding standard fallback ones via save is recommended.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && editingItem && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2>{editingItem.name ? (lang === 'th' ? 'แก้ไขหมวดหมู่' : 'Edit Category') : (lang === 'th' ? 'เพิ่มหมวดหมู่ใหม่' : 'Add New Category')}</h2>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  {/* รหัสหมวดหมู่ระบบออกให้เอง แก้เองไม่ได้ — เมนู ส่วนลด และป๊อปอัพอ้างถึงรหัสนี้อยู่
                      ถ้าแก้มือ ของที่ผูกไว้จะหลุดทันที */}
                  <label>{lang === 'th' ? 'รหัสหมวดหมู่ (ระบบออกให้)' : 'Category ID (auto-generated)'}</label>
                  <input value={editingItem.slug} readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>
                <div className="admin-form-group" style={{ flex: 0.5 }}>
                  <label>{lang === 'th' ? 'ไอคอน (อีโมจิ)' : 'Icon (Emoji)'}</label>
                  <input value={editingItem.icon} onChange={e => setEditingItem({...editingItem, icon: e.target.value})} />
                </div>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'ชื่อ (ภาษาไทย)' : 'Name (Thai)'}</label>
                <input required value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
              </div>
              <div className="admin-form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  {lang === 'th' ? 'ชื่อ (ภาษาอังกฤษ)' : 'Name (English)'}
                  <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: '0.85rem' }} onClick={handleAutoTranslate}>✨ {lang === 'th' ? 'แปลอัตโนมัติ' : 'Auto Translate'}</span>
                </label>
                <input value={editingItem.nameEn} onChange={e => setEditingItem({...editingItem, nameEn: e.target.value})} />
              </div>

              <div className="admin-form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input 
                  type="checkbox" 
                  id="cat-active" 
                  checked={editingItem.isActive !== false} 
                  onChange={e => setEditingItem({...editingItem, isActive: e.target.checked})} 
                  style={{ width: 'auto', marginBottom: 0 }} 
                />
                <label htmlFor="cat-active" style={{ marginBottom: 0, cursor: 'pointer' }}>
                  {lang === 'th' ? 'เปิดใช้งาน (แสดงบนหน้าร้าน)' : 'Active (Show on storefront)'}
                </label>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'แสดงให้ใครเห็น' : 'Visible to'}</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {VISIBILITY_OPTIONS.map(opt => {
                    const on = (editingItem.visibility || 'all') === opt.value;
                    return (
                      <button type="button" key={opt.value} onClick={() => setEditingItem({ ...editingItem, visibility: opt.value })}
                        style={{ padding: '0.45rem 0.85rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: on ? 700 : 500,
                          border: `1.5px solid ${on ? 'var(--accent)' : 'rgba(0,0,0,0.15)'}`, background: on ? 'rgba(234,179,8,0.15)' : '#fff', color: 'var(--text-main)' }}>
                        {lang === 'th' ? opt.label : opt.labelEn}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {lang === 'th'
                    ? 'เฉพาะพนักงาน = ไม่ขึ้นในหน้าลูกค้าสั่งเอง/QR · เฉพาะลูกค้า = ไม่ขึ้นในหน้าขายของพนักงาน · เมนูในหมวดยังใช้เป็นตัวเลือกในป๊อปอัพได้ตามเดิม'
                    : 'Staff only = hidden on the self-order/QR page · Customers only = hidden on the staff POS · items still work as popup options.'}
                </div>
              </div>

              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: '8px', padding: '0.85rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                ℹ️ {lang === 'th'
                  ? 'การตั้งค่าตัวเลือกตอนสั่ง (Popup) ย้ายไปอยู่ที่หน้า "จัดการเมนู" แล้ว — ตั้งค่าได้รายเมนูในส่วน "ตัวเลือกตอนสั่ง (Popup)"'
                  : 'Order option (popup) settings have moved to the "Manage Menu" page — configure them per item under "Order Options (Popups)".'}
              </div>

              <button type="submit" className="admin-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                <Save size={20} /> {lang === 'th' ? 'บันทึกข้อมูล' : 'Save Category'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageCategories;
