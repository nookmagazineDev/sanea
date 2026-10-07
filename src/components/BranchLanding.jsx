import React, { useState, useEffect } from 'react';
import { Building2, Store, Smartphone, ArrowLeft } from 'lucide-react';
import './LoginScreen.css';

// ── หน้าแรกของเว็บ ──
// 1) เลือกสาขา (มีสาขาเดียว = ข้ามให้เลย)  2) เลือกโหมด: หน้าพนักงาน / หน้าลูกค้าสั่งเอง
// หน้าลูกค้า → เข้าหน้าสั่งอาหารแบบเดียวกับสแกน QR เลย (ลูกค้าเลือกทานที่ร้าน/ห่อกลับ และโต๊ะเอง)
// เครื่องจำสาขาที่เลือกไว้ (device_branch) — ครั้งหน้ากดต่อได้ทันที

const card = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem',
  padding: '1.4rem 1rem', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.1)',
  background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-main)'
};
const backBtn = {
  marginTop: '1.25rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 6
};

export default function BranchLanding({ branches = [], deviceBranch = '', loaded = false, onStaff, onCustomer, lang = 'th' }) {
  const active = branches.filter(b => b.isActive !== false);
  const single = active.length === 1;
  const known = active.some(b => String(b.id) === String(deviceBranch));
  const [branchId, setBranchId] = useState(known ? deviceBranch : '');
  const [step, setStep] = useState('branch'); // branch → mode

  // มีสาขาเดียว → เลือกให้เลย / เพิ่งโหลดรายการสาขาเสร็จ → ใช้สาขาที่เครื่องจำไว้เป็นค่าเริ่ม
  useEffect(() => {
    if (single && !branchId) { setBranchId(String(active[0].id)); setStep('mode'); }
    else if (!branchId && known) setBranchId(deviceBranch);
  }, [single, known, branchId, deviceBranch, active]);

  const branch = active.find(b => String(b.id) === String(branchId));
  const branchName = branch ? (branch.name || branch.id) : '';
  const t = (th, en) => (lang === 'th' ? th : en);

  if (!loaded && active.length === 0) {
    return (
      <div className="login-container"><div className="login-box">
        <h1 className="login-title">SA-NAE POS</h1>
        <p className="login-subtitle">{t('กำลังโหลดรายการสาขา...', 'Loading branches...')}</p>
      </div></div>
    );
  }

  // ยังไม่มีสาขาในระบบ (ติดตั้งใหม่) หรือโหลดไม่ได้ → เข้าหน้าพนักงานได้เลย ไม่ให้ติดอยู่หน้านี้
  if (active.length === 0) {
    return (
      <div className="login-container"><div className="login-box">
        <h1 className="login-title">SA-NAE POS</h1>
        <p className="login-subtitle">{t('ยังไม่มีสาขาในระบบ — ตั้งค่าที่หลังบ้าน > สาขา', 'No branches yet')}</p>
        <button style={{ ...card, width: '100%' }} onClick={() => onStaff('')}>
          <Store size={32} color="var(--accent-hover)" /><b>{t('เข้าหน้าพนักงาน', 'Staff')}</b>
        </button>
      </div></div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box" style={{ maxWidth: 560 }}>
        {step === 'branch' && (
          <>
            <h1 className="login-title">{t('เลือกสาขา', 'Select branch')}</h1>
            <p className="login-subtitle">{t('เครื่องนี้อยู่สาขาไหน', 'Which branch is this device at?')}</p>
            <div className="user-grid">
              {active.map(b => (
                <button key={b.id} className="user-select-btn"
                  style={String(b.id) === String(branchId) ? { borderColor: 'var(--accent)', background: 'rgba(234,179,8,0.08)' } : undefined}
                  onClick={() => { setBranchId(String(b.id)); setStep('mode'); }}>
                  <div className="user-avatar"><Building2 size={28} /></div>
                  <span>{b.name || b.id}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'mode' && (
          <>
            <h1 className="login-title">{branchName}</h1>
            <p className="login-subtitle">{t('เลือกการใช้งานของเครื่องนี้', 'Choose how this device is used')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <button style={card} onClick={() => onStaff(branchId)}>
                <Store size={40} color="var(--accent-hover)" />
                <b style={{ fontSize: '1.1rem' }}>{t('หน้าพนักงาน', 'Staff')}</b>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('ขายหน้าร้าน เปิดโต๊ะ เช็กบิล หลังบ้าน', 'POS, tables, back office')}</span>
              </button>
              <button style={card} onClick={() => onCustomer(branchId)}>
                <Smartphone size={40} color="#16a34a" />
                <b style={{ fontSize: '1.1rem' }}>{t('หน้าลูกค้า', 'Customer')}</b>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('ลูกค้าสั่งอาหารและจ่ายเอง', 'Self-order & pay')}</span>
              </button>
            </div>
            {!single && (
              <button style={backBtn} onClick={() => setStep('branch')}>
                <ArrowLeft size={16} /> {t('เปลี่ยนสาขา', 'Change branch')}
              </button>
            )}
          </>
        )}

      </div>
    </div>
  );
}
