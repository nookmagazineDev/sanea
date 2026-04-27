import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, GripVertical } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';

const ManageCategories = () => {
  const { lang } = useOutletContext();
  const [categories, setCategories] = useState([]);
  const [menuList, setMenuList] = useState([]);
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
      const resp = await fetch(GAS_URL + '?action=getAllData');
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
      await fetch(GAS_URL, {
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
        await fetch(GAS_URL, {
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

  const handleDragOver = (e, index) => {
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

  const handleAddNew = () => {
    setEditingItem({
      slug: `cat_${Date.now()}`,
      name: '',
      nameEn: '',
      icon: '📌',
      isActive: true,
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
      await fetch(GAS_URL, {
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

  const handleItemToggle = (field, id) => {
    setEditingItem(prev => {
      const current = prev[field] || [];
      if (current.includes(id)) {
        return { ...prev, [field]: current.filter(i => i !== id) };
      } else {
        return { ...prev, [field]: [...current, id] };
      }
    });
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
              <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'Slug (รหัสภาษาอังกฤษ เช่น "drinks")' : 'Slug (Machine readable ID, e.g. "drinks")'}</label>
                  <input required value={editingItem.slug} onChange={e => setEditingItem({...editingItem, slug: e.target.value})} />
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

              <div className="admin-form-group" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                <label>{lang === 'th' ? 'ตั้งค่าหน้าจอสั่งอาหาร (Order Wizard Steps)' : 'Order Wizard Steps'}</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  
                  {[1, 2, 3, 4, 5, 6].map(num => {
                    const hasPopup = editingItem[`hasPopup${num}`];
                    const categoryProp = `popup${num}Category`;
                    const itemsProp = `popup${num}Items`;
                    const itemsMaxProp = `popup${num}ItemsMax`;
                    const minProp = `popup${num}Min`;
                    const maxProp = `popup${num}Max`;
                    const freeProp = `popup${num}Free`;

                    return (
                      <div key={num} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                          <input type="checkbox" checked={hasPopup === true} onChange={e => setEditingItem({...editingItem, [`hasPopup${num}`]: e.target.checked})} style={{ width: 'auto', marginBottom: 0 }} />
                          <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{lang === 'th' ? `แสดง Popup ${num}` : `Show Popup ${num}`}</span>
                        </label>
                        {hasPopup === true && (
                          <div style={{ marginLeft: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '8px' }}>
                            <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                              <label>{lang === 'th' ? 'ดึงเมนูจากหมวดหมู่:' : 'Pull items from category:'}</label>
                              <select 
                                value={editingItem[categoryProp] || ''} 
                                onChange={e => setEditingItem({...editingItem, [categoryProp]: e.target.value, [itemsProp]: []})}
                                style={{ padding: '0.5rem', width: '100%', borderRadius: '4px', background: 'var(--bg-card)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                              >
                                <option value="">{lang === 'th' ? '-- เลือกหมวดหมู่ --' : '-- Select Category --'}</option>
                                {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                              </select>
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                              <label>{lang === 'th' ? 'บังคับเลือกอย่างน้อยกี่รายการ (0 = ไม่บังคับ):' : 'Min Required (0 = Optional):'}</label>
                              <input type="number" min="0" value={editingItem[minProp] || 0} onChange={e => setEditingItem({...editingItem, [minProp]: parseInt(e.target.value) || 0})} style={{ width: '120px', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }} />
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                              <label>{lang === 'th' ? 'จำกัดจำนวนสูงสุด (0 = ไม่จำกัด):' : 'Max Allowed (0 = Unlimited):'}</label>
                              <input type="number" min="0" value={editingItem[maxProp] || 0} onChange={e => setEditingItem({...editingItem, [maxProp]: parseInt(e.target.value) || 0})} style={{ width: '120px', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }} />
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                                <input type="checkbox" checked={editingItem[freeProp] === true} onChange={e => setEditingItem({...editingItem, [freeProp]: e.target.checked})} style={{ width: 'auto', marginBottom: 0 }} />
                                <span style={{ fontSize: '0.85rem' }}>{lang === 'th' ? 'ฟรี (ไม่บวกราคาเพิ่มในบิล)' : 'Free (Does not add cost)'}</span>
                              </label>
                            </div>
                            {editingItem[categoryProp] && menuList.filter(m => m.category === editingItem[categoryProp]).length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {lang === 'th' ? 'เลือกรายการที่จะแสดง: (หากไม่ติ๊กเลย จะแสดงทุกเมนูในหมวด)' : 'Select items to show (tick none meaning all shows):'}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                  {menuList.filter(m => m.category === editingItem[categoryProp]).map(item => (
                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                      <input type="checkbox" checked={(editingItem[itemsProp] || []).includes(item.id)} onChange={() => handleItemToggle(itemsProp, item.id)} style={{ width: 'auto', margin: 0 }} />
                                      <span style={{ flex: 1 }}>{item.name}</span>
                                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{lang === 'th' ? 'max/รายการ:' : 'max/item:'}</span>
                                      <input
                                        type="number" min="0"
                                        value={(editingItem[itemsMaxProp] || {})[item.id] || 0}
                                        onChange={e => setEditingItem({...editingItem, [itemsMaxProp]: {...(editingItem[itemsMaxProp] || {}), [item.id]: parseInt(e.target.value) || 0}})}
                                        style={{ width: '50px', padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem' }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                    <input type="checkbox" checked={editingItem.hasDining !== false} onChange={e => setEditingItem({...editingItem, hasDining: e.target.checked})} style={{ width: 'auto', marginBottom: 0 }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{lang === 'th' ? 'แสดง ทานร้าน/ห่อกลับ' : 'Show Dining Options'}</span>
                  </label>
                </div>
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
