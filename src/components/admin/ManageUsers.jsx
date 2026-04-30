import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Edit2, Trash2, Save, X, User } from 'lucide-react';
import './Admin.css';

const ManageUsers = () => {
  const { lang } = useOutletContext();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    const rawData = localStorage.getItem('gas_all_data');
    if (rawData) {
      try {
        const data = JSON.parse(rawData);
        if (data.users) {
          setUsers(data.users);
        }
      } catch (e) {
        console.error('Error parsing local data', e);
      }
    }
    setLoading(false);
  }, []);

  const handleAddUser = () => {
    const newUser = {
      id: Date.now().toString(),
      username: '',
      pin: '',
      canCheckout: true,
      isNew: true
    };
    setUsers([newUser, ...users]);
    setEditingId(newUser.id);
  };

  const handleChange = (id, field, value) => {
    setUsers(users.map(u => u.id === id ? { ...u, [field]: value } : u));
  };

  const handleDelete = (id) => {
    if (window.confirm(lang === 'th' ? 'ยืนยันการลบพนักงาน?' : 'Confirm delete user?')) {
      setUsers(users.filter(u => u.id !== id));
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';
      const cleanUsers = users.map(u => {
        const { isNew, ...rest } = u;
        return rest;
      });
      
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveUsers',
          users: cleanUsers
        })
      });
      
      // Update local storage so we don't have to fetch immediately
      const rawData = localStorage.getItem('gas_all_data');
      if (rawData) {
        const data = JSON.parse(rawData);
        data.users = cleanUsers;
        localStorage.setItem('gas_all_data', JSON.stringify(data));
      }
      
      setEditingId(null);
      alert(lang === 'th' ? 'บันทึกข้อมูลสำเร็จ' : 'Saved successfully');
    } catch (error) {
      console.error('Error saving users:', error);
      alert(lang === 'th' ? 'เกิดข้อผิดพลาดในการบันทึก' : 'Error saving');
    }
    setIsSaving(false);
  };

  if (loading) {
    return <div className="admin-loading">{lang === 'th' ? 'กำลังโหลด...' : 'Loading...'}</div>;
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">{lang === 'th' ? 'จัดการพนักงาน' : 'Manage Users'}</h1>
          <p className="admin-subtitle">
            {lang === 'th' ? 'เพิ่ม ลด และกำหนดสิทธิ์พนักงาน' : 'Add, remove, and manage user permissions'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            className="admin-btn-primary" 
            onClick={handleAddUser}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Plus size={20} /> {lang === 'th' ? 'เพิ่มพนักงาน' : 'Add User'}
          </button>
          <button 
            className="admin-btn-primary" 
            onClick={handleSave}
            disabled={isSaving}
            style={{ 
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: 'var(--success)', opacity: isSaving ? 0.7 : 1
            }}
          >
            <Save size={20} /> {isSaving ? (lang === 'th' ? 'กำลังบันทึก...' : 'Saving...') : (lang === 'th' ? 'บันทึกทั้งหมด' : 'Save All')}
          </button>
        </div>
      </div>

      <div className="admin-card">
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{lang === 'th' ? 'ชื่อพนักงาน' : 'Username'}</th>
                <th>{lang === 'th' ? 'รหัส PIN (4 หลัก)' : 'PIN (4 digits)'}</th>
                <th>{lang === 'th' ? 'สิทธิ์การชำระเงิน' : 'Checkout Access'}</th>
                <th style={{ textAlign: 'right' }}>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    {lang === 'th' ? 'ไม่มีข้อมูลพนักงาน' : 'No users found'}
                  </td>
                </tr>
              ) : users.map(user => {
                const isEditing = editingId === user.id || user.isNew;
                return (
                  <tr key={user.id}>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={user.username}
                          onChange={(e) => handleChange(user.id, 'username', e.target.value)}
                          placeholder={lang === 'th' ? 'ชื่อพนักงาน' : 'Username'}
                          className="admin-input"
                          style={{ width: '100%', maxWidth: '200px' }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <User size={18} color="var(--accent)" />
                          {user.username}
                        </div>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="password"
                          maxLength="4"
                          value={user.pin}
                          onChange={(e) => handleChange(user.id, 'pin', e.target.value.replace(/\D/g, ''))}
                          placeholder="0000"
                          className="admin-input"
                          style={{ width: '100px', textAlign: 'center', letterSpacing: '4px' }}
                        />
                      ) : (
                        <span style={{ letterSpacing: '2px', color: 'var(--text-muted)' }}>••••</span>
                      )}
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isEditing ? 'pointer' : 'default' }}>
                        <input
                          type="checkbox"
                          checked={user.canCheckout !== false}
                          onChange={(e) => isEditing && handleChange(user.id, 'canCheckout', e.target.checked)}
                          disabled={!isEditing}
                          style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
                        />
                        <span style={{ color: user.canCheckout !== false ? 'var(--success)' : 'var(--text-muted)' }}>
                          {user.canCheckout !== false 
                            ? (lang === 'th' ? 'อนุญาต' : 'Allowed') 
                            : (lang === 'th' ? 'ไม่อนุญาต' : 'Denied')}
                        </span>
                      </label>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        {isEditing ? (
                          <button 
                            className="admin-btn-icon" 
                            onClick={() => setEditingId(null)}
                            style={{ color: 'var(--success)', background: 'rgba(16,185,129,0.1)' }}
                          >
                            <Save size={18} />
                          </button>
                        ) : (
                          <button 
                            className="admin-btn-icon" 
                            onClick={() => setEditingId(user.id)}
                            style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}
                          >
                            <Edit2 size={18} />
                          </button>
                        )}
                        <button 
                          className="admin-btn-icon" 
                          onClick={() => handleDelete(user.id)}
                          style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ManageUsers;
