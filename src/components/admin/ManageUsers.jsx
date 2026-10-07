import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Users, Eye, EyeOff, ShieldCheck, ShieldOff, CheckCircle } from 'lucide-react';
import { API_URL } from '../../utils/api';
import { ALL_BRANCHES, branchLabel } from '../../utils/branches';

const AVATAR_COLORS = ['#7c3aed','#ea580c','#0891b2','#16a34a','#dc2626','#d97706','#7c3aed','#db2777'];

const avatarColor = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const inp = {
  width: '100%', padding: '0.65rem 0.85rem',
  background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 10, color: 'var(--text-main)', fontSize: '0.95rem', fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
};

const EMPTY_USER = { id: '', username: '', pin: '', branch: '', canCheckout: true, isAdmin: false, isCashier: false };

const isTrue = (v) => v === true || v === 'TRUE';
const userRole = (u) => isTrue(u.isAdmin) ? 'admin' : (isTrue(u.isCashier) ? 'cashier' : 'staff');
const ROLE_OPTIONS = [
  { key: 'admin',   label: '👑 แอดมิน',     color: '#f97316', bg: 'rgba(249,115,22,0.18)', bd: 'rgba(249,115,22,0.6)' },
  { key: 'cashier', label: '💳 แคชเชียร์',   color: '#38bdf8', bg: 'rgba(56,189,248,0.18)', bd: 'rgba(56,189,248,0.6)' },
  { key: 'staff',   label: 'พนักงานทั่วไป', color: '#475569', bg: 'rgba(100,116,139,0.16)', bd: 'rgba(100,116,139,0.55)' },
];

// ช่องสาขา: ถ้าตั้งสาขาไว้ในหน้าตั้งค่าสาขาแล้ว ให้เลือกจากรายการ (กันพิมพ์รหัสผิดแล้วบิลไม่เข้าสาขา)
// ยังไม่มีสาขาในระบบ → พิมพ์เองได้แบบเดิม
function BranchField({ branches, value, onChange, autoFocus }) {
  if (branches.length === 0) {
    return <input style={inp} value={value || ''} onChange={e => onChange(e.target.value)} placeholder="เช่น xum, xcm" autoFocus={autoFocus} />;
  }
  const current = String(value || '').trim();
  const known = branches.some(b => String(b.id) === current);
  return (
    <select style={inp} value={current} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}>
      <option value="">— เลือกสาขา —</option>
      <option value={ALL_BRANCHES}>🌐 ทุกสาขา (เลือกสาขาตอนล็อกอิน)</option>
      {current && !known && current !== ALL_BRANCHES && <option value={current}>{current} (ไม่มีในรายการสาขา)</option>}
      {branches.filter(b => b.isActive !== false || String(b.id) === current).map(b => (
        <option key={b.id} value={b.id}>{b.name && b.name !== b.id ? `${b.name} (${b.id})` : b.id}</option>
      ))}
    </select>
  );
}

export default function ManageUsers() {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState('');
  const [editId,    setEditId]    = useState(null);   // id being edited inline
  const [showModal, setShowModal] = useState(false);  // add-user modal
  const [form,      setForm]      = useState(EMPTY_USER);
  const [showPin,   setShowPin]   = useState({});     // { [id]: bool }
  const [dirty,     setDirty]     = useState(false);
  const [branches,  setBranches]  = useState([]);
  const [loadError, setLoadError] = useState('');

  // รายชื่อพร้อมรหัสดึงจากเซิร์ฟเวอร์ (getUsers — เฉพาะแอดมินสำนักงานใหญ่)
  // รายชื่อที่หน้าร้านเก็บไว้ไม่มีรหัสแล้ว ห้ามเอามาบันทึกทับ ไม่งั้นรหัสทุกคนหาย
  useEffect(() => {
    (async () => {
      let cached = {};
      try { cached = JSON.parse(localStorage.getItem('gas_all_data') || '{}') || {}; } catch {}
      if (Array.isArray(cached.branches)) setBranches(cached.branches);
      try {
        const res = await fetch(`${API_URL}?action=getUsers`);
        const json = await res.json();
        if (json && json.success === true && Array.isArray(json.users)) {
          setUsers(json.users);
        } else if (json && json.error === 'Unknown GET action') {
          // API รุ่นเก่ายังส่งรหัสมากับรายชื่อ ใช้ของในเครื่องได้
          if (Array.isArray(cached.users)) setUsers(cached.users);
        } else {
          setLoadError((json && json.error) || 'โหลดรายชื่อพนักงานไม่สำเร็จ');
        }
      } catch (e) {
        setLoadError(`โหลดรายชื่อพนักงานไม่สำเร็จ: ${e.message || e}`);
      }
      setLoading(false);
    })();
  }, []);

  const markDirty = () => setDirty(true);

  const handleChange = (id, field, value) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, [field]: value } : u));
    markDirty();
  };

  const setUserRole = (id, role) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, isAdmin: role === 'admin', isCashier: role === 'cashier' } : u));
    markDirty();
  };

  const handleDelete = (id) => {
    if (!window.confirm('ยืนยันการลบพนักงาน?')) return;
    setUsers(prev => prev.filter(u => u.id !== id));
    markDirty();
  };

  const handleAddUser = () => {
    setForm({ ...EMPTY_USER, id: Date.now().toString() });
    setShowModal(true);
  };

  const handleModalSave = () => {
    if (!form.username.trim()) return;
    if (!form.branch.trim()) { alert('กรุณากรอกชื่อสาขา'); return; }
    if (!form.pin) { alert('กรุณากรอกรหัสผ่าน'); return; }
    setUsers(prev => [...prev, { ...form }]);
    setShowModal(false);
    markDirty();
  };

  const handleSave = async () => {
    // กันพลาด: คนที่มีรหัสอยู่แล้วแต่รายการนี้ไม่มีรหัสมาด้วย = โหลดมาไม่ครบ บันทึกไปรหัสจะหาย
    if (users.some(u => u.hasPin === true && (u.pin === undefined || u.pin === ''))) {
      setSaveMsg('❌ รายชื่อโหลดมาไม่ครบ (ไม่มีรหัส) — รีเฟรชหน้าแล้วลองใหม่');
      return;
    }
    setSaving(true); setSaveMsg('');
    try {
      const clean = users.map(({ isNew, hasPin, ...u }) => u);
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveUsers', users: clean }),
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      // หน้าร้านเก็บรายชื่อไว้ใช้โชว์ปุ่มล็อกอิน — ไม่เก็บรหัสไว้ในเครื่อง
      const publicList = clean.map(({ pin, ...u }) => ({ ...u, hasPin: String(pin ?? '') !== '' }));
      const raw = localStorage.getItem('gas_all_data');
      if (raw) { const d = JSON.parse(raw); d.users = publicList; localStorage.setItem('gas_all_data', JSON.stringify(d)); }
      localStorage.setItem('cached_users', JSON.stringify(publicList));
      setEditId(null); setSaveMsg('✅ บันทึกสำเร็จ'); setDirty(false);
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg(`❌ บันทึกไม่สำเร็จ: ${e.message || e}`);
    }
    setSaving(false);
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>กำลังโหลด...</div>
  );

  return (
    <div style={{ color: 'var(--text-main)', fontFamily: 'inherit' }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={26} color="var(--accent-hover)" /> จัดการพนักงาน
          </h1>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {users.length} คน &nbsp;•&nbsp; เพิ่ม ลบ และกำหนดสิทธิ์
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {saveMsg && (
            <span style={{ fontSize: '0.88rem', color: saveMsg.startsWith('✅') ? '#22c55e' : '#ef4444', background: saveMsg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '0.45rem 0.85rem' }}>
              {saveMsg}
            </span>
          )}
          <button onClick={handleAddUser} style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 10, color: 'var(--text-main)', cursor: 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} /> เพิ่มพนักงาน
          </button>
          <button onClick={handleSave} disabled={saving || !dirty} style={{ background: dirty ? '#16a34a' : 'rgba(0,0,0,0.05)', border: `1px solid ${dirty ? 'rgba(34,197,94,0.5)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, color: dirty ? 'white' : 'var(--text-muted)', cursor: saving || !dirty ? 'not-allowed' : 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}>
            <Save size={18} /> {saving ? 'กำลังบันทึก...' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      {loadError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.88rem' }}>
          ⚠️ {loadError}
        </div>
      )}

      {/* User cards grid */}
      {users.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Users size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <p style={{ margin: 0 }}>ยังไม่มีพนักงาน — กด <strong style={{ color: 'var(--accent-hover)' }}>เพิ่มพนักงาน</strong> เพื่อเริ่ม</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {users.map(user => {
            const isEditing = editId === user.id;
            const color     = avatarColor(user.username);
            const initial   = (user.username || '?')[0].toUpperCase();
            return (
              <div key={user.id} style={{ background: 'var(--bg-card)', border: `1px solid ${isEditing ? 'var(--accent)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 16, padding: '1.25rem', transition: 'border-color 0.2s' }}>
                {isEditing ? (
                  /* ── Edit mode ── */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent-hover)', fontSize: '0.85rem' }}>✏️ แก้ไขข้อมูล</span>
                      <button onClick={() => setEditId(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>ชื่อสาขา (Branch)</label>
                      <BranchField branches={branches} value={user.branch} onChange={v => handleChange(user.id, 'branch', v)} />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>ชื่อผู้ใช้</label>
                      <input style={inp} value={user.username} onChange={e => handleChange(user.id, 'username', e.target.value)} placeholder="ชื่อผู้ใช้" />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>รหัสผ่าน</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showPin[user.id] ? 'text' : 'password'}
                          style={{ ...inp, paddingRight: '2.5rem', letterSpacing: showPin[user.id] ? '0.1rem' : '0.3rem' }}
                          value={user.pin}
                          onChange={e => handleChange(user.id, 'pin', e.target.value)}
                          placeholder="รหัสผ่าน"
                        />
                        <button onClick={() => setShowPin(p => ({ ...p, [user.id]: !p[user.id] }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                          {showPin[user.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>สิทธิ์ชำระเงิน</label>
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        {[true, false].map(val => (
                          <button key={String(val)} onClick={() => handleChange(user.id, 'canCheckout', val)} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.85rem', background: user.canCheckout === val ? (val ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') : 'rgba(0,0,0,0.02)', borderColor: user.canCheckout === val ? (val ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(0,0,0,0.1)', color: user.canCheckout === val ? (val ? '#22c55e' : '#ef4444') : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                            {val ? <><ShieldCheck size={15} /> อนุญาต</> : <><ShieldOff size={15} /> ไม่อนุญาต</>}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>ระดับสิทธิ์ (เข้าหลังบ้าน)</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {ROLE_OPTIONS.map(r => {
                          const active = userRole(user) === r.key;
                          return (
                            <button key={r.key} onClick={() => setUserRole(user.id, r.key)} style={{ flex: 1, padding: '0.55rem 0.3rem', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.78rem', background: active ? r.bg : 'rgba(0,0,0,0.02)', borderColor: active ? r.bd : 'rgba(0,0,0,0.1)', color: active ? r.color : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button onClick={() => setEditId(null)} style={{ marginTop: 4, padding: '0.65rem', background: 'var(--accent)', border: 'none', borderRadius: 10, color: 'black', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <CheckCircle size={16} /> เสร็จสิ้น
                    </button>
                  </div>
                ) : (
                  /* ── View mode ── */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* Avatar */}
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', fontWeight: 800, color: 'white', flexShrink: 0, boxShadow: `0 0 0 3px ${color}33` }}>
                      {initial}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {user.username || <span style={{ color: 'var(--text-muted)' }}>ไม่มีชื่อ</span>}
                        {(user.branch || user.id) && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 6, padding: '0.1rem 0.45rem' }}>🏠 {branchLabel(user.branch || user.id, branches)}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {/* PIN mask */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {showPin[user.id]
                            ? <><Eye size={12} /> {user.pin}</>
                            : [0,1,2,3].map(i => <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(0,0,0,0.25)', display: 'inline-block' }} />)
                          }
                        </span>
                        <button onClick={() => setShowPin(p => ({ ...p, [user.id]: !p[user.id] }))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                          {showPin[user.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        {/* Role badge */}
                        <span style={{ padding: '0.15rem 0.55rem', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: user.canCheckout !== false ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: user.canCheckout !== false ? '#22c55e' : '#ef4444', border: `1px solid ${user.canCheckout !== false ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, display: 'flex', alignItems: 'center', gap: 3 }}>
                          {user.canCheckout !== false ? <><ShieldCheck size={10} /> ชำระเงินได้</> : <><ShieldOff size={10} /> ไม่มีสิทธิ์ชำระ</>}
                        </span>
                        {userRole(user) === 'admin' && (
                          <span style={{ padding: '0.15rem 0.55rem', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            👑 แอดมิน
                          </span>
                        )}
                        {userRole(user) === 'cashier' && (
                          <span style={{ padding: '0.15rem 0.55rem', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            💳 แคชเชียร์
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                      <button onClick={() => setEditId(user.id)} title="แก้ไข" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleDelete(user.id)} title="ลบ" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add User Modal ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 10px 30px rgba(0,0,0,0.06)', borderRadius: 18, padding: '1.75rem', width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-hover)' }}>
                <Plus size={20} /> เพิ่มพนักงานใหม่
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
            </div>

            {/* Preview avatar */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: avatarColor(form.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 800, color: 'white', boxShadow: `0 0 0 4px ${avatarColor(form.username)}33` }}>
                {(form.username || '?')[0].toUpperCase()}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>ชื่อสาขา (Branch) *</label>
                <BranchField branches={branches} value={form.branch} onChange={v => setForm(f => ({ ...f, branch: v }))} autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>ชื่อผู้ใช้ *</label>
                <input style={inp} placeholder="ชื่อผู้ใช้" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 }}>รหัสผ่าน *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPin.__new__ ? 'text' : 'password'}
                    style={{ ...inp, paddingRight: '2.5rem', letterSpacing: '0.15rem' }}
                    placeholder="รหัสผ่าน"
                    value={form.pin}
                    onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                  />
                  <button onClick={() => setShowPin(p => ({ ...p, __new__: !p.__new__ }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                    {showPin.__new__ ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>สิทธิ์ชำระเงิน</label>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  {[true, false].map(val => (
                    <button key={String(val)} onClick={() => setForm(f => ({ ...f, canCheckout: val }))} style={{ flex: 1, padding: '0.6rem', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.85rem', background: form.canCheckout === val ? (val ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') : 'rgba(0,0,0,0.02)', borderColor: form.canCheckout === val ? (val ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(0,0,0,0.1)', color: form.canCheckout === val ? (val ? '#22c55e' : '#ef4444') : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                      {val ? <><ShieldCheck size={15} /> อนุญาต</> : <><ShieldOff size={15} /> ไม่อนุญาต</>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>ระดับสิทธิ์ (เข้าหลังบ้าน)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {ROLE_OPTIONS.map(r => {
                    const active = userRole(form) === r.key;
                    return (
                      <button key={r.key} onClick={() => setForm(f => ({ ...f, isAdmin: r.key === 'admin', isCashier: r.key === 'cashier' }))} style={{ flex: 1, padding: '0.6rem 0.3rem', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.78rem', background: active ? r.bg : 'rgba(0,0,0,0.02)', borderColor: active ? r.bd : 'rgba(0,0,0,0.1)', color: active ? r.color : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '0.8rem', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', color: 'var(--text-main)', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>ยกเลิก</button>
              <button onClick={handleModalSave} disabled={!form.username.trim() || !form.branch.trim() || !form.pin} style={{ flex: 2, padding: '0.8rem', background: form.username.trim() && form.branch.trim() && form.pin ? 'var(--accent)' : 'rgba(0,0,0,0.05)', border: 'none', color: form.username.trim() && form.branch.trim() && form.pin ? 'black' : 'var(--text-muted)', borderRadius: 10, cursor: form.username.trim() && form.branch.trim() && form.pin ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Plus size={18} /> เพิ่มพนักงาน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
