import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';

const ManageMenu = () => {
  const { lang } = useOutletContext();
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchMenu();
  }, []);

  const fetchMenu = async () => {
    // Clear stale cache first so fresh data always wins
    localStorage.removeItem('gas_all_data');
    setLoading(true);

    try {
      const resp = await fetch(GAS_URL + '?action=getAllData');
      const data = await resp.json();
      if (data) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        setMenuItems(Array.isArray(data.menu) ? data.menu : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      }
    } catch(e) {
      console.error('Failed to fetch menu:', e);
    }
    setLoading(false);
  };

  const handleSaveMenu = async (newMenuArray) => {
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'saveMenu',
          items: newMenuArray
        })
      });
      setMenuItems(newMenuArray);
      setIsModalOpen(false);

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.menu = newMenuArray;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(e) { console.error(e); }
      }
    } catch(e) {
      alert('Failed to save to database');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this menu item?')) {
      const updated = menuItems.filter(item => item.id !== id);
      try {
        await fetch(GAS_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'deleteMenu',
            id: id
          })
        });
        setMenuItems(updated);

        const cached = localStorage.getItem('gas_all_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            parsed.menu = updated;
            localStorage.setItem('gas_all_data', JSON.stringify(parsed));
            window.dispatchEvent(new Event('appDataChanged'));
          } catch(err) { console.error(err); }
        }
      } catch(e) {
        alert('Failed to delete from database');
      }
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem({
      id: Date.now(),
      category: 'food',
      name: '',
      nameEn: '',
      description: '',
      descriptionEn: '',
      price: 0,
      image: '',
      isActive: true,
      bundledItems: []
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    let updated;
    if (menuItems.find(i => i.id === editingItem.id)) {
      updated = menuItems.map(i => i.id === editingItem.id ? editingItem : i);
    } else {
      updated = [...menuItems, editingItem];
    }
    
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'upsertMenu',
          item: editingItem
        })
      });
      setMenuItems(updated);
      setIsModalOpen(false);

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.menu = updated;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(err) { console.error(err); }
      }
    } catch(err) {
      alert('Failed to save to database');
    }
  };

  const handleAutoTranslate = async (field) => {
    const textToTranslate = field === 'name' ? editingItem.name : editingItem.description;
    if (!textToTranslate) return;
    
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=en&dt=t&q=${encodeURIComponent(textToTranslate)}`;
      const res = await fetch(url);
      const data = await res.json();
      const translatedText = data[0].map(item => item[0]).join('');
      
      if (field === 'name') {
        setEditingItem(prev => ({...prev, nameEn: translatedText}));
      } else {
        setEditingItem(prev => ({...prev, descriptionEn: translatedText}));
      }
    } catch(e) {
      console.error('Translation failed', e);
      alert('Translation failed. Please try again or enter manually.');
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('image', file);
    const IMGBB_API_KEY = 'c46b3eebbda2ef57c71cb885cb305fe5';
    
    try {
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      
      if (data.success) {
        setEditingItem(prev => ({...prev, image: data.data.display_url}));
      } else {
        alert('Upload failed: ' + (data.error?.message || 'Unknown error'));
      }
    } catch(err) {
      console.error('ImgBB upload error:', err);
      alert('Upload failed. Check your internet connection.');
    }
    setUploading(false);
  };

  const filteredMenu = menuItems.filter(item => {
    const searchLow = searchTerm.toLowerCase();
    const nameLow = (item.name || '').toLowerCase();
    const nameEnLow = (item.nameEn || '').toLowerCase();
    return nameLow.includes(searchLow) || nameEnLow.includes(searchLow);
  });

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>{lang === 'th' ? 'จัดการเมนู' : 'Manage Menu'}</h1>
          <p>{lang === 'th' ? 'เพิ่ม แก้ไข หรือลบรายการอาหารและเครื่องดื่ม' : 'Add, edit, or remove food and drinks.'}</p>
        </div>
        <button className="admin-btn" onClick={handleAddNew}>
          <Plus size={20} /> {lang === 'th' ? 'เพิ่มเมนูใหม่' : 'Add New Menu'}
        </button>
      </div>

      <div className="admin-card">
        <div style={{ marginBottom: '1rem', display: 'flex' }}>
          <input 
            type="text" 
            placeholder={lang === 'th' ? 'ค้นหาเมนู (TH/EN)...' : 'Search menu...'} 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-search-input"
            style={{ width: '100%', maxWidth: '400px' }}
          />
        </div>
        {loading ? <p>{lang === 'th' ? 'กำลังโหลดข้อมูลเมนู...' : 'Loading menu from database...'}</p> : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{lang === 'th' ? 'รูปภาพ' : 'Image'}</th>
                  <th>{lang === 'th' ? 'ชื่อ (TH/EN)' : 'Name (TH/EN)'}</th>
                  <th>{lang === 'th' ? 'หมวดหมู่' : 'Category'}</th>
                  <th>{lang === 'th' ? 'ราคา' : 'Price'}</th>
                  <th>{lang === 'th' ? 'สถานะ' : 'Status'}</th>
                  <th>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMenu.length > 0 ? filteredMenu.map(item => (
                  <tr key={item.id}>
                    <td>
                      <img src={item.image} alt="food" style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '8px' }} />
                    </td>
                    <td>
                      <strong>{item.name}</strong><br/>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)'}}>{item.nameEn}</span>
                    </td>
                    <td>
                       <span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                         {item.category || 'food'}
                       </span>
                    </td>
                    <td style={{ color: 'var(--accent)', fontWeight: 'bold' }}>฿{item.price}</td>
                    <td>
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.85rem',
                        background: item.isActive !== false ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: item.isActive !== false ? '#22c55e' : '#ef4444'
                      }}>
                        {item.isActive !== false ? (lang === 'th' ? 'เปิด' : 'Active') : (lang === 'th' ? 'ซ่อน' : 'Hidden')}
                      </span>
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
                )) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      {lang === 'th' ? 'ไม่มีรายการเมนู ลองเริ่มต้นเพิ่มสิ่งแรกดูสิ!' : 'No menu items found. Get started by adding a new product!'}
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
              <h2>{editingItem.name ? (lang === 'th' ? 'แก้ไขเมนู' : 'Edit Menu') : (lang === 'th' ? 'เพิ่มเมนูใหม่' : 'Add New Menu')}</h2>
              <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'ชื่อ (ภาษาไทย)' : 'Name (Thai)'}</label>
                  <input required value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
                </div>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {lang === 'th' ? 'ชื่อ (ภาษาอังกฤษ)' : 'Name (English)'}
                    <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleAutoTranslate('name')}>✨ {lang === 'th' ? 'แปลอัตโนมัติ' : 'Auto Translate'}</span>
                  </label>
                  <input value={editingItem.nameEn} onChange={e => setEditingItem({...editingItem, nameEn: e.target.value})} />
                </div>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'รายละเอียด (ภาษาไทย)' : 'Description (Thai)'}</label>
                <textarea rows="2" value={editingItem.description} onChange={e => setEditingItem({...editingItem, description: e.target.value})} />
              </div>
              
              <div className="admin-form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                   {lang === 'th' ? 'รายละเอียด (ภาษาอังกฤษ)' : 'Description (English)'}
                   <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleAutoTranslate('description')}>✨ {lang === 'th' ? 'แปลอัตโนมัติ' : 'Auto Translate'}</span>
                </label>
                <textarea rows="2" value={editingItem.descriptionEn} onChange={e => setEditingItem({...editingItem, descriptionEn: e.target.value})} />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'ราคา (฿)' : 'Price (฿)'}</label>
                  <input type="number" value={editingItem.price} onChange={e => setEditingItem({...editingItem, price: e.target.value})} />
                </div>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'หมวดหมู่' : 'Category'}</label>
                  <select value={editingItem.category} onChange={e => setEditingItem({...editingItem, category: e.target.value})}>
                    {categories.length > 0 ? (
                      categories.map(c => <option key={c.slug} value={c.slug}>{lang === 'th' ? c.name : c.nameEn}</option>)
                    ) : (
                      <>
                        <option value="food">{lang === 'th' ? 'อาหาร' : 'Food'}</option>
                        <option value="drink">{lang === 'th' ? 'เครื่องดื่ม' : 'Drink'}</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'รูปภาพ (อัปโหลดจากคอมฯ หรือวาง URL)' : 'Image (Upload from PC or enter Cloud URL)'}</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ flex: 1, padding: '0.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                  {uploading && <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{lang === 'th' ? 'กำลังอัปโหลด...' : 'Uploading...'}</span>}
                </div>
                <input value={editingItem.image} onChange={e => setEditingItem({...editingItem, image: e.target.value})} placeholder={lang === 'th' ? 'หรือวางลิงก์รูปภาพที่นี่' : 'Or paste image URL here'} />
                {editingItem.image && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <img src={editingItem.image} alt="Preview" style={{ height: '80px', borderRadius: '8px', objectFit: 'cover' }} />
                  </div>
                )}
              </div>

              <div className="admin-form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input 
                  type="checkbox" 
                  id="menu-active" 
                  checked={editingItem.isActive !== false} 
                  onChange={e => setEditingItem({...editingItem, isActive: e.target.checked})} 
                  style={{ width: 'auto', marginBottom: 0 }} 
                />
                <label htmlFor="menu-active" style={{ marginBottom: 0, cursor: 'pointer' }}>
                  {lang === 'th' ? 'เปิดใช้งาน (แสดงบนหน้าร้าน)' : 'Active (Show on storefront)'}
                </label>
              </div>

              {/* Bundled Items */}
              <div className="admin-form-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <label style={{ marginBottom: '0.5rem', display: 'block' }}>
                  {lang === 'th' ? 'เมนูที่เพิ่มอัตโนมัติเมื่อสั่ง (Bundled Items):' : 'Auto-add items when ordered (Bundled Items):'}
                </label>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {lang === 'th' ? 'ระบุจำนวนที่ต้องการให้เพิ่มเข้าตะกร้าอัตโนมัติทุกครั้งที่สั่งเมนูนี้' : 'Specify the quantity to automatically add to cart every time this menu is ordered'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {menuItems.filter(m => String(m.id) !== String(editingItem.id) && m.isActive !== false).map(m => {
                    const count = (editingItem.bundledItems || []).filter(bId => String(bId) === String(m.id)).length;
                    const updateCount = (newCount) => {
                      let parsed = parseInt(newCount) || 0;
                      if (parsed < 0) parsed = 0;
                      const others = (editingItem.bundledItems || []).map(String).filter(bId => bId !== String(m.id));
                      for(let i=0; i<parsed; i++) others.push(String(m.id));
                      setEditingItem({ ...editingItem, bundledItems: others });
                    };
                    
                    return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                      <input
                        type="number"
                        min="0"
                        value={count === 0 ? '' : count}
                        placeholder="0"
                        onChange={e => updateCount(e.target.value)}
                        style={{ width: '60px', padding: '0.2rem', margin: 0, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', textAlign: 'center' }}
                      />
                      <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => updateCount(count === 0 ? 1 : 0)}>
                        <span style={{ fontWeight: count > 0 ? 'bold' : 'normal', color: count > 0 ? 'var(--accent)' : 'inherit' }}>{m.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>(฿{m.price})</span>
                      </span>
                    </div>
                  )})}
                </div>
              </div>

              <button type="submit" className="admin-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                <Save size={20} /> {lang === 'th' ? 'บันทึกเมนู' : 'Save Menu Item'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMenu;
