import React from 'react';
import { Building2, LogOut } from 'lucide-react';
import './LoginScreen.css';

// หน้าเลือกสาขาหลังล็อกอิน — สำหรับพนักงานที่ตั้งสาขาไว้เป็น "ทุกสาขา"
const BranchPicker = ({ user, branches = [], onPick, onLogout, lang = 'th' }) => {
  const active = branches.filter(b => b.isActive !== false);
  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">{lang === 'th' ? 'เลือกสาขา' : 'Select branch'}</h1>
        <p className="login-subtitle">
          {lang === 'th' ? `${user?.username || ''} — วันนี้ทำงานที่สาขาไหน` : `${user?.username || ''} — which branch today?`}
        </p>
        {active.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            {lang === 'th' ? 'กำลังโหลดรายการสาขา...' : 'Loading branches...'}
          </p>
        ) : (
          <div className="user-grid">
            {active.map(b => (
              <button key={b.id} className="user-select-btn" onClick={() => onPick(String(b.id))}>
                <div className="user-avatar"><Building2 size={28} /></div>
                <span>{b.name || b.id}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onLogout}
          style={{ marginTop: '1.25rem', width: '100%', padding: '0.7rem', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          <LogOut size={16} /> {lang === 'th' ? 'ออกจากระบบ' : 'Log out'}
        </button>
      </div>
    </div>
  );
};

export default BranchPicker;
