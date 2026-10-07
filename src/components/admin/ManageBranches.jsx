import React, { useState, useEffect } from 'react';
import { Plus, Save, X, Building2, Trash2, Users, AlertTriangle } from 'lucide-react';
import { API_URL } from '../../utils/api';

const inp = {
  width: '100%', padding: '0.65rem 0.85rem',
  background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 10, color: 'var(--text-main)', fontSize: '0.95rem', fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
};
const lbl = { display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 5 };

const EMPTY_BRANCH = { id: '', name: '', billPrefix: '', phone: '', address: '', taxId: '', receiptFooter: '', posId: '', isActive: true };

// รหัสสาขาใช้ผูกกับผู้ใช้/บิล/ของเสีย — ให้เป็นตัวอักษร ตัวเลข ขีด หรือขีดล่าง ไม่มีช่องว่าง
const cleanCode = (v) => String(v || '').trim().replace(/\s+/g, '').replace(/[^0-9A-Za-zก-๙_-]/g, '');
// ตัวนำหน้าเลขบิล ใช้กฎเดียวกับหน้าขาย (ตัวพิมพ์ใหญ่ ตัวเลข ตัวไทย)
const cleanPrefix = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Zก-๙]/g, '');
// '*' = พนักงานทุกสาขา ไม่นับเป็นสาขาใดสาขาหนึ่ง
const branchOfUser = (u) => { const b = String(u?.branch || '').trim(); return b === '*' ? '' : b; };

export default function ManageBranches() {
  const [branches, setBranches] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [savedIds, setSavedIds] = useState(new Set()); // รหัสที่บันทึกแล้ว — ห้ามแก้ ไม่งั้นข้อมูลเก่าหลุดสาขา
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');
  const [dirty,    setDirty]    = useState(false);
  const [showAdd,  setShowAdd]  = useState(false);
  const [form,     setForm]     = useState(EMPTY_BRANCH);

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
      const list = Array.isArray(d.branches) ? d.branches : [];
      setBranches(list);
      setSavedIds(new Set(list.map(b => String(b.id))));
      if (Array.isArray(d.users)) setUsers(d.users);
    } catch {}
  }, []);

  const userCount = (id) => users.filter(u => branchOfUser(u) === String(id)).length;
  // รหัสสาขาที่ผู้ใช้ใช้อยู่แต่ยังไม่มีในรายการ — มักเป็นรหัสที่พิมพ์ผิด หรือยังไม่ได้รัน sql:init
  const orphanCodes = [...new Set(users.map(branchOfUser).filter(Boolean))]
    .filter(code => !branches.some(b => String(b.id) === code));

  const update = (id, field, value) => {
    setBranches(prev => prev.map(b => (String(b.id) === String(id) ? { ...b, [field]: value } : b)));
    setDirty(true);
  };

  const openAdd = (code = '') => {
    setForm({ ...EMPTY_BRANCH, id: code, name: code, billPrefix: cleanPrefix(code) });
    setShowAdd(true);
  };

  const addBranch = () => {
    const id = cleanCode(form.id);
    if (!id) { alert('กรุณากรอกรหัสสาขา'); return; }
    if (branches.some(b => String(b.id).toLowerCase() === id.toLowerCase())) { alert(`รหัสสาขา "${id}" มีอยู่แล้ว`); return; }
    setBranches(prev => [...prev, { ...form, id, name: form.name.trim() || id, billPrefix: cleanPrefix(form.billPrefix || id) }]);
    setShowAdd(false);
    setDirty(true);
  };

  // สาขาหลัก = สาขาแรกที่เปิดใช้งานในรายการ — ข้อมูลเก่า เครื่องที่ยังไม่ผูกสาขา และ QR โต๊ะแบบเก่าจะลงที่นี่
  const mainId = (branches.find(b => b.isActive !== false) || {}).id;
  const makeMain = (id) => {
    setBranches(prev => {
      const target = prev.find(b => String(b.id) === String(id));
      return target ? [target, ...prev.filter(b => String(b.id) !== String(id))] : prev;
    });
    setDirty(true);
  };

  const removeBranch = (b) => {
    const n = userCount(b.id);
    if (n > 0) { alert(`ลบไม่ได้ — ยังมีพนักงาน ${n} คนอยู่ในสาขานี้ ย้ายพนักงานออกก่อน หรือกด "ปิดใช้งาน" แทน`); return; }
    const msg = savedIds.has(String(b.id))
      ? `ลบสาขา "${b.name || b.id}"?\nบิลเก่าของสาขานี้ยังอยู่ในรายงาน แต่จะไม่มีข้อมูลสาขาให้แสดง — ถ้าแค่เลิกใช้ แนะนำให้ "ปิดใช้งาน" แทน`
      : `ลบสาขา "${b.name || b.id}"?`;
    if (!window.confirm(msg)) return;
    setBranches(prev => prev.filter(x => String(x.id) !== String(b.id)));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true); setSaveMsg('');
    const clean = branches.map(b => ({ ...b, billPrefix: cleanPrefix(b.billPrefix || b.id) }));
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveBranches', branches: clean }),
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      try {
        const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
        d.branches = clean;
        localStorage.setItem('gas_all_data', JSON.stringify(d));
      } catch {}
      setBranches(clean);
      setSavedIds(new Set(clean.map(b => String(b.id))));
      setDirty(false);
      setSaveMsg('✅ บันทึกสำเร็จ');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      const reason = String(e.message || e);
      setSaveMsg(/Unknown action/i.test(reason)
        ? '❌ API ที่เครื่อง SQL ยังเป็นรุ่นเก่า — อัปเดตโค้ดในเครื่องนั้นแล้วรีสตาร์ต API ก่อน'
        : /Invalid object name|Branches/i.test(reason)
          ? '❌ ยังไม่มีตารางสาขาในฐานข้อมูล — ต้องรัน npm run sql:init ที่เครื่อง SQL ก่อน'
          : `❌ บันทึกไม่สำเร็จ: ${reason}`);
    }
    setSaving(false);
  };

  return (
    <div style={{ color: 'var(--text-main)', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={26} color="var(--accent-hover)" /> ตั้งค่าสาขา
          </h1>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {branches.length} สาขา &nbsp;•&nbsp; ชื่อ เลขบิล และข้อมูลหัวใบเสร็จของแต่ละสาขา
          </p>
          <p style={{ margin: '0.2rem 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            ⭐ สาขาหลัก = ที่ลงของเครื่องที่ยังไม่ได้ผูกสาขา และลิงก์ QR โต๊ะแบบเก่า
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {saveMsg && (
            <span style={{ fontSize: '0.88rem', color: saveMsg.startsWith('✅') ? '#22c55e' : '#ef4444', background: saveMsg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '0.45rem 0.85rem' }}>
              {saveMsg}
            </span>
          )}
          <button onClick={() => openAdd()} style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 10, color: 'var(--text-main)', cursor: 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} /> เพิ่มสาขา
          </button>
          <button onClick={handleSave} disabled={saving || !dirty} style={{ background: dirty ? '#16a34a' : 'rgba(0,0,0,0.05)', border: `1px solid ${dirty ? 'rgba(34,197,94,0.5)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, color: dirty ? 'white' : 'var(--text-muted)', cursor: saving || !dirty ? 'not-allowed' : 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Save size={18} /> {saving ? 'กำลังบันทึก...' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      {orphanCodes.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '1.25rem', color: '#92400e', fontSize: '0.88rem' }}>
          <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AlertTriangle size={16} /> มีพนักงานที่ผูกกับรหัสสาขาที่ยังไม่มีในรายการ
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {orphanCodes.map(code => (
              <button key={code} onClick={() => openAdd(code)} style={{ background: '#fff', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.3rem 0.7rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, color: '#92400e' }}>
                + สร้างสาขา "{code}" ({userCount(code)} คน)
              </button>
            ))}
          </div>
        </div>
      )}

      {branches.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Building2 size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <p style={{ margin: 0 }}>ยังไม่มีสาขา — กด <strong style={{ color: 'var(--accent-hover)' }}>เพิ่มสาขา</strong> เพื่อเริ่ม</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {branches.map(b => {
            const locked = savedIds.has(String(b.id));
            const active = b.isActive !== false;
            return (
              <div key={b.id} style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: '1.25rem', opacity: active ? 1 : 0.65, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.id}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      รหัส <code>{b.id}</code> · <Users size={12} /> {userCount(b.id)} คน
                    </div>
                    {String(b.id) === String(mainId) ? (
                      <div style={{ marginTop: 6, fontSize: '0.72rem', fontWeight: 800, color: '#b45309', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 6, padding: '0.15rem 0.5rem', display: 'inline-block' }}>
                        ⭐ สาขาหลัก
                      </div>
                    ) : active && (
                      <button onClick={() => makeMain(b.id)} style={{ marginTop: 6, fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', background: 'transparent', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: 6, padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                        ตั้งเป็นสาขาหลัก
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button onClick={() => update(b.id, 'isActive', !active)} style={{ padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.75rem', background: active ? 'rgba(34,197,94,0.12)' : 'rgba(0,0,0,0.04)', borderColor: active ? 'rgba(34,197,94,0.35)' : 'rgba(0,0,0,0.15)', color: active ? '#16a34a' : 'var(--text-muted)' }}>
                      {active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                    </button>
                    <button onClick={() => removeBranch(b)} title="ลบ" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div>
                    <label style={lbl}>ชื่อสาขา</label>
                    <input style={inp} value={b.name || ''} onChange={e => update(b.id, 'name', e.target.value)} placeholder="เช่น สาขาอุดม" />
                  </div>
                  <div>
                    <label style={lbl}>ตัวนำหน้าเลขบิล</label>
                    <input style={inp} value={b.billPrefix || ''} onChange={e => update(b.id, 'billPrefix', cleanPrefix(e.target.value))} placeholder={cleanPrefix(b.id)} />
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-0.4rem' }}>
                  บิลถัดไปจะเป็น <code>{cleanPrefix(b.billPrefix || b.id) || 'POS'}-#001</code> (เลขนับต่อจากของเดิม)
                </div>
                <div>
                  <label style={lbl}>เบอร์โทร</label>
                  <input style={inp} value={b.phone || ''} onChange={e => update(b.id, 'phone', e.target.value)} placeholder="0xx-xxx-xxxx" />
                </div>
                <div>
                  <label style={lbl}>ที่อยู่ (หัวใบเสร็จ)</label>
                  <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={b.address || ''} onChange={e => update(b.id, 'address', e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div>
                    <label style={lbl}>เลขประจำตัวผู้เสียภาษี</label>
                    <input style={inp} value={b.taxId || ''} onChange={e => update(b.id, 'taxId', e.target.value)} />
                  </div>
                  <div>
                    <label style={lbl}>ข้อความท้ายใบเสร็จ</label>
                    <input style={inp} value={b.receiptFooter || ''} onChange={e => update(b.id, 'receiptFooter', e.target.value)} placeholder="ขอบคุณที่ใช้บริการ" />
                  </div>
                </div>
                <div>
                  <label style={lbl}>เลขรหัสประจำเครื่อง POS (POS ID ที่สรรพากรออกให้)</label>
                  <input style={inp} value={b.posId || ''} onChange={e => update(b.id, 'posId', e.target.value.trim())} placeholder="เช่น E0123456789012" />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-0.4rem' }}>
                  ใส่เลขผู้เสียภาษีแล้ว ใบเสร็จจะพิมพ์เป็น "ใบกำกับภาษีอย่างย่อ / TAX INV (ABB)" พร้อม POS ID และยอดแยก VAT
                </div>
                {String(b.taxId || '').trim() && !String(b.posId || '').trim() && (
                  <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '-0.4rem' }}>
                    ⚠️ ยังไม่ได้ใส่ POS ID — ใบกำกับภาษีอย่างย่อตามแบบสรรพากรต้องมีเลขรหัสประจำเครื่อง
                  </div>
                )}
                {!locked && (
                  <div style={{ fontSize: '0.75rem', color: '#b45309' }}>สาขาใหม่ — ยังไม่ได้บันทึก กด "บันทึกทั้งหมด"</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={() => setShowAdd(false)}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 10px 30px rgba(0,0,0,0.06)', borderRadius: 18, padding: '1.75rem', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-hover)' }}>
                <Plus size={20} /> เพิ่มสาขาใหม่
              </h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={lbl}>รหัสสาขา * (เปลี่ยนภายหลังไม่ได้)</label>
                <input style={inp} value={form.id} autoFocus placeholder="เช่น xum"
                  onChange={e => { const id = cleanCode(e.target.value); setForm(f => ({ ...f, id, billPrefix: f.billPrefix && f.billPrefix !== cleanPrefix(f.id) ? f.billPrefix : cleanPrefix(id) })); }} />
              </div>
              <div>
                <label style={lbl}>ชื่อสาขา</label>
                <input style={inp} value={form.name} placeholder="เช่น สาขาอุดม" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>ตัวนำหน้าเลขบิล</label>
                <input style={inp} value={form.billPrefix} placeholder={cleanPrefix(form.id) || 'XUM'} onChange={e => setForm(f => ({ ...f, billPrefix: cleanPrefix(e.target.value) }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: '0.8rem', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', color: 'var(--text-main)', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>ยกเลิก</button>
              <button onClick={addBranch} disabled={!cleanCode(form.id)} style={{ flex: 2, padding: '0.8rem', background: cleanCode(form.id) ? 'var(--accent)' : 'rgba(0,0,0,0.05)', border: 'none', color: cleanCode(form.id) ? 'black' : 'var(--text-muted)', borderRadius: 10, cursor: cleanCode(form.id) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Plus size={18} /> เพิ่มสาขา
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
