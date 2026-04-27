import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';

const ManagePromotions = () => {
  const { lang } = useOutletContext();
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchPromos();
  }, []);

  const fetchPromos = async () => {
    const cached = localStorage.getItem('gas_all_data');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.promotions) setPromos(data.promotions);
        setLoading(false);
      } catch(e) {}
    } else {
      setLoading(true);
    }

    try {
      const resp = await fetch(GAS_URL + '?action=getAllData');
      const data = await resp.json();
      if (data && data.promotions) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        setPromos(data.promotions);
      }
    } catch(e) {
      console.error('Failed to fetch promos:', e);
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
          action: 'savePromotions',
          promotions: newArray
        })
      });
      setPromos(newArray);
      setIsModalOpen(false);

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.promotions = newArray;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(e) { console.error(e); }
      }
    } catch(e) {
      alert('Failed to save to database');
    }
  };

  const handleDelete = async (id) => {
    if (id === 'none') {
       alert("The 'none' promotion is structurally required and cannot be deleted.");
       return;
    }
    if (window.confirm('Are you sure you want to delete this promotion?')) {
      const updated = promos.filter(item => item.id !== id);
      try {
        await fetch(GAS_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'deletePromotion',
            id: id
          })
        });
        setPromos(updated);

        const cached = localStorage.getItem('gas_all_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            parsed.promotions = updated;
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
      id: Date.now().toString(),
      name: '',
      nameEn: '',
      price: 0,
      origPrice: ''
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    let updated;
    if (promos.find(i => i.id === editingItem.id)) {
      updated = promos.map(i => i.id === editingItem.id ? editingItem : i);
    } else {
      updated = [...promos, editingItem];
    }
    
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'upsertPromotion',
          item: editingItem
        })
      });
      setPromos(updated);
      setIsModalOpen(false);

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.promotions = updated;
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

  const filteredPromos = promos.filter(item => {
    const searchLow = searchTerm.toLowerCase();
    const nameLow = (item.name || '').toLowerCase();
    const nameEnLow = (item.nameEn || '').toLowerCase();
    const idLow = (item.id || '').toLowerCase();
    return nameLow.includes(searchLow) || nameEnLow.includes(searchLow) || idLow.includes(searchLow);
  });

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>{lang === 'th' ? 'จัดการโปรโมชัน' : 'Manage Promotions'}</h1>
          <p>{lang === 'th' ? 'เพิ่มดีลพิเศษสำหรับตัวเลือกออเดอร์' : 'Add special deals for the configuration wizard.'}</p>
        </div>
        <button className="admin-btn" onClick={handleAddNew}>
          <Plus size={20} /> {lang === 'th' ? 'เพิ่มโปรโมชัน' : 'Add Deal'}
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
        {loading ? <p>{lang === 'th' ? 'กำลังโหลดข้อมูล...' : 'Loading promotions from database...'}</p> : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{lang === 'th' ? 'รหัสอ้างอิง (Slug)' : 'Id (Slug)'}</th>
                  <th>{lang === 'th' ? 'ชื่อโปรโมชัน (TH/EN)' : 'Promo Name (TH/EN)'}</th>
                  <th>{lang === 'th' ? 'ส่วนเพิ่มราคา (+฿)' : 'Sale Price (+฿)'}</th>
                  <th>{lang === 'th' ? 'ราคาดั้งเดิม (ขีดทับ)' : 'Original Price (Strike)'}</th>
                  <th>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPromos.length > 0 ? filteredPromos.map(item => (
                  <tr key={item.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{item.id}</td>
                    <td>
                      <strong>{item.name}</strong><br/>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)'}}>{item.nameEn}</span>
                    </td>
                    <td style={{ color: 'var(--accent)', fontWeight: 'bold' }}>+฿{item.price}</td>
                    <td style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>
                      {item.origPrice ? `฿${item.origPrice}` : '-'}
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
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                      {lang === 'th' ? 'ไม่พบโปรโมชันในฐานข้อมูล' : 'No promotions found in database.'}
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
              <h2>{editingItem.name ? (lang === 'th' ? 'แก้ไขโปรโมชัน' : 'Edit Promo') : (lang === 'th' ? 'เพิ่มโปรโมชันใหม่' : 'Add New Promo')}</h2>
              <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div className="admin-form-group">
                <label>{lang === 'th' ? 'รหัสอ้างอิง (e.g. "soda" หรือ "none")' : 'Id (Unique slug e.g. "soda" or "none")'}</label>
                <input required disabled={editingItem.id === 'none'} value={editingItem.id} onChange={e => setEditingItem({...editingItem, id: e.target.value})} />
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

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'ราคาเพิ่ม (฿)' : 'Add-on Price (฿)'}</label>
                  <input type="number" value={editingItem.price} onChange={e => setEditingItem({...editingItem, price: e.target.value})} />
                </div>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'ราคาดั้งเดิม (ไม่บังคับ)' : 'Original Value (Optional)'}</label>
                  <input type="number" value={editingItem.origPrice} onChange={e => setEditingItem({...editingItem, origPrice: e.target.value})} />
                </div>
              </div>

              <button type="submit" className="admin-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                <Save size={20} /> {lang === 'th' ? 'บันทึกข้อมูล' : 'Save Promo'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagePromotions;
