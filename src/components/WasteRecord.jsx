import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Trash2, RefreshCw, X, Save, ChevronLeft, Clock, Building2, ChefHat, ClipboardList } from 'lucide-react';
import { API_URL } from '../utils/api';

const WASTE_UNITS = ['จาน', 'แก้ว', 'ขวด', 'ชิ้น', 'ถ้วย', 'ที่', 'กรัม', 'กิโลกรัม', 'มล.', 'ลิตร', 'ถุง', 'แพ็ค', 'ฟอง', 'หม้อ', 'รายการ'];

// หน้าเดียวใช้ 3 แบบ: บันทึกการทิ้ง (waste) / การเตรียม (prep) / การนับสต็อก (count) — เลือกได้ทั้งเมนูและวัตถุดิบ
const MODES = {
  waste: { color: '#dc2626', soft: 'rgba(239,68,68,', text: '#fca5a5', title: 'บันทึกการทิ้ง (Waste)', titleEn: 'Waste Record', verb: 'ทิ้ง', action: 'saveWasteRecord', newBtn: 'ทิ้งใหม่', notePh: 'เช่น หมดอายุ, ทำตก, ลูกค้าคืน' },
  prep:  { color: '#0891b2', soft: 'rgba(8,145,178,', text: '#67e8f9', title: 'บันทึกการเตรียม (Prep)', titleEn: 'Prep Record', verb: 'เตรียม', action: 'savePrepRecord', newBtn: 'เตรียมใหม่', notePh: 'เช่น เตรียมรอบเช้า, ต้มน้ำซุป, หั่นไก่' },
  count: { color: '#d97706', soft: 'rgba(217,119,6,', text: '#fcd34d', title: 'บันทึกการนับสต็อก (Stock count)', titleEn: 'Stock Count', verb: 'นับ', action: 'saveStockCount', newBtn: 'นับใหม่', notePh: 'เช่น นับปิดร้าน, นับตู้เย็น 2' }
};

// เวลาประเทศไทย (ISO + offset) — เก็บเวลาที่ลงให้ตรงเขตเวลาไทย
const getThaiTimeISO = () => {
  const d = new Date();
  const opt = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const parts = new Intl.DateTimeFormat('en-GB', opt).formatToParts(d);
  const p = {};
  parts.forEach(part => p[part.type] = part.value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+07:00`;
};

// ตรวจว่าเป็น "หมวดโปรโมชั่น" หรือไม่ (จะถูกตัดออกจากตัวเลือกไอเทม)
const isPromoCategory = (c) => {
  const n = String(c.name || '').toLowerCase();
  const ne = String(c.nameEn || '').toLowerCase();
  const s = String(c.slug || '').toLowerCase();
  return n.includes('โปรโม') || ne.includes('promotion') || ne.includes('promo') || s.includes('promo');
};

const WasteRecord = ({ currentUser, lang = 'th', branch: loginBranch = '', onBack, menu = [], categories = [], mode = 'waste' }) => {
  const M = MODES[mode] || MODES.waste;
  const Icon = mode === 'prep' ? ChefHat : mode === 'count' ? ClipboardList : Trash2;
  // วัตถุดิบ (ระบบสต็อก) — โหลดตอนเปิดหน้าต่างบันทึกครั้งแรก
  const [ingredients, setIngredients] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // สาขา = ใช้สาขาของผู้ใช้ที่ล็อกอิน ถ้ามี ไม่งั้น fallback เป็นค่าล่าสุดที่จำไว้ของเครื่องนี้
  const [branch, setBranch] = useState(() => loginBranch || localStorage.getItem('waste_branch') || '');
  const [form, setForm] = useState({ itemType: 'menu', itemName: '', category: '', qty: '', unit: 'จาน', note: '' });

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}?action=getWasteRecords${mode !== 'waste' ? `&kind=${mode}` : ''}`);
      const data = await res.json();
      if (data.success) setRecords(data.records || []);
    } catch (e) {}
    setLoading(false);
  }, [mode]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ตัวเลือกไอเทม จัดกลุ่มตามหมวด — ทุกหมวด "ยกเว้นหมวดโปรโมชั่น"
  const itemGroups = useMemo(() => {
    const promoSlugs = new Set(categories.filter(isPromoCategory).map(c => c.slug));
    const inPromo = (m) => {
      const primary = m.category || '';
      const extra = Array.isArray(m.categories) ? m.categories : [];
      return promoSlugs.has(primary) || extra.some(s => promoSlugs.has(s));
    };
    const visibleCats = categories.filter(c => !isPromoCategory(c));
    const seen = new Set();
    const groups = [];
    visibleCats.forEach(cat => {
      const items = (menu || [])
        .filter(m => !inPromo(m))
        .filter(m => {
          const primary = m.category || '';
          const extra = Array.isArray(m.categories) ? m.categories : [];
          return primary === cat.slug || extra.includes(cat.slug);
        })
        .map(m => String(m.name || '').trim())
        .filter(Boolean);
      const unique = [...new Set(items)].filter(n => {
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      }).sort((a, b) => a.localeCompare(b, 'th'));
      if (unique.length > 0) {
        groups.push({ catName: (lang === 'th' ? cat.name : cat.nameEn) || cat.name || cat.slug, slug: cat.slug, items: unique });
      }
    });
    return groups;
  }, [menu, categories, lang]);

  // วัตถุดิบจัดกลุ่มตามหมวดของวัตถุดิบ
  const ingredientGroups = useMemo(() => {
    const map = new Map();
    (ingredients || []).forEach(ing => {
      const cat = ing.category || (lang === 'th' ? 'วัตถุดิบ' : 'Ingredients');
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(ing);
    });
    return [...map.entries()].map(([catName, items]) => ({ catName, slug: `ing-${catName}`, items }));
  }, [ingredients, lang]);

  const loadIngredients = async () => {
    if (ingredients !== null) return;
    try {
      const res = await fetch(`${API_URL}?action=getIngredientNames`);
      const data = await res.json();
      setIngredients(data && data.success && Array.isArray(data.ingredients) ? data.ingredients : []);
    } catch { setIngredients([]); }
  };

  // หาชื่อหมวดของไอเทมที่เลือก เพื่อเก็บลงคอลัมน์ category
  const findCategoryName = (itemName, itemType = form.itemType) => {
    if (itemType === 'ingredient') {
      const ing = (ingredients || []).find(i => i.name === itemName);
      return ing ? (ing.category || 'วัตถุดิบ') : 'วัตถุดิบ';
    }
    for (const g of itemGroups) {
      if (g.items.includes(itemName)) return g.catName;
    }
    return '';
  };

  const openModal = () => {
    setForm({ itemType: 'menu', itemName: '', category: '', qty: '', unit: 'จาน', note: '' });
    setSaveMsg('');
    setModal(true);
    loadIngredients();
  };

  const handleSave = async () => {
    if (!branch.trim()) { setSaveMsg('กรุณากรอกชื่อสาขา'); return; }
    if (!form.itemName.trim() || !form.qty) { setSaveMsg('กรุณาเลือกไอเทมและกรอกจำนวน'); return; }

    const timestamp = getThaiTimeISO();
    const category = findCategoryName(form.itemName);
    localStorage.setItem('waste_branch', branch.trim());

    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:   M.action,
          itemType: form.itemType,
          timestamp,
          branch:   branch.trim(),
          itemName: form.itemName.trim(),
          category,
          qty:      Number(form.qty),
          unit:     form.unit || 'จาน',
          note:     form.note.trim(),
          staff:    currentUser?.username || 'ไม่ระบุ',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) {
        setSaveMsg(json && /Unknown action/i.test(json.error || '')
          ? '❌ API ยังเป็นรุ่นเก่า — รัน update-api.bat ที่เครื่อง SQL ก่อน'
          : `❌ บันทึกไม่สำเร็จ${json && json.error ? `: ${json.error}` : ''}`);
        setSaving(false);
        return;
      }
      setRecords(prev => [...prev, {
        itemType: form.itemType,
        timestamp, branch: branch.trim(), itemName: form.itemName.trim(), category,
        qty: Number(form.qty), unit: form.unit || 'จาน', note: form.note.trim(),
        staff: currentUser?.username || 'ไม่ระบุ',
      }]);
      setSaveMsg('✅ บันทึกสำเร็จ');
      setTimeout(() => { setModal(false); setSaveMsg(''); }, 1000);
    } catch (e) {
      setSaveMsg('❌ บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อ');
    }
    setSaving(false);
  };

  const fmtDate = (ts) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  };

  const history = [...records].reverse();
  const totalQty = records.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const cardStyle  = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.25rem' };
  const inputStyle = { width: '100%', padding: '0.7rem 0.9rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: 'white', fontSize: '0.95rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', marginBottom: '0.4rem' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0f0f0f)', color: 'white', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9rem', padding: 0 }}>
          <ChevronLeft size={20} /> {lang === 'th' ? 'กลับ' : 'Back'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
          <Icon size={24} color={M.color} />
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
            {lang === 'th' ? M.title : M.titleEn}
          </h1>
        </div>
        <button onClick={fetchRecords} disabled={loading} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'white', cursor: 'pointer', padding: '0.5rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {lang === 'th' ? 'รีเฟรช' : 'Refresh'}
        </button>
        <button onClick={openModal} style={{ background: M.color, border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', padding: '0.55rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.9rem' }}>
          <Icon size={17} /> {lang === 'th' ? M.newBtn : 'New'}
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
        {/* Branch selector (จดจำต่อเครื่อง) */}
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <Building2 size={18} color={M.color} />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', fontWeight: 600 }}>{lang === 'th' ? 'สาขา' : 'Branch'}</span>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 160, maxWidth: 320 }}
            placeholder={lang === 'th' ? 'ชื่อสาขาของเครื่องนี้' : 'Branch name for this device'}
            value={branch}
            onChange={e => setBranch(e.target.value)}
            onBlur={() => { if (branch.trim()) localStorage.setItem('waste_branch', branch.trim()); }}
          />
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>
            {lang === 'th' ? `รวม${M.verb}ทั้งหมด` : 'Total'}: <strong style={{ color: M.color }}>{totalQty}</strong>
          </span>
        </div>

        {/* History */}
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: '0.9rem' }}>
            <Clock size={15} /> {lang === 'th' ? `ประวัติการ${M.verb}` : 'History'} ({records.length})
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.4)' }}>
              <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
              <p>กำลังโหลด...</p>
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.4)' }}>
              <Icon size={44} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
              <p style={{ margin: 0 }}>{lang === 'th' ? `ยังไม่มีรายการ${M.verb}` : 'No records yet'}</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {['วันเวลา', 'สาขา', 'รายการ', 'ประเภท', 'หมวด', 'จำนวน', 'หมายเหตุ', 'พนักงาน'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.07)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '0.7rem 1rem', color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{fmtDate(r.timestamp)}</td>
                      <td style={{ padding: '0.7rem 1rem', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.15rem 0.55rem', borderRadius: 20, fontSize: '0.76rem', fontWeight: 700, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
                          <Building2 size={11} /> {r.branch || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '0.7rem 1rem', fontWeight: 600, color: M.text }}>{r.itemName}</td>
                      <td style={{ padding: '0.7rem 1rem', fontSize: '0.78rem', whiteSpace: 'nowrap', color: r.itemType === 'ingredient' ? '#fbbf24' : 'rgba(255,255,255,0.6)' }}>{r.itemType === 'ingredient' ? '🥬 วัตถุดิบ' : '🍽️ เมนู'}</td>
                      <td style={{ padding: '0.7rem 1rem', color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>{r.category || '—'}</td>
                      <td style={{ padding: '0.7rem 1rem', fontWeight: 700, textAlign: 'center', color: M.color, whiteSpace: 'nowrap' }}>{r.qty} {r.unit || ''}</td>
                      <td style={{ padding: '0.7rem 1rem', color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem' }}>{r.note || '—'}</td>
                      <td style={{ padding: '0.7rem 1rem', color: '#22c55e', fontWeight: 600, fontSize: '0.82rem' }}>{r.staff || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal: บันทึกการทิ้ง */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={() => setModal(false)}>
          <div style={{ background: '#1a1a2e', border: `1px solid ${M.soft}0.3)`, borderRadius: 18, padding: '1.75rem', width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
                <Icon size={20} color={M.color} /> {lang === 'th' ? `บันทึกการ${M.verb}` : 'New record'}
              </h2>
              <button onClick={() => setModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}><X size={22} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>{lang === 'th' ? 'สาขา *' : 'Branch *'}</label>
                <input style={inputStyle} placeholder={lang === 'th' ? 'ชื่อสาขา' : 'Branch'} value={branch} onChange={e => setBranch(e.target.value)} />
              </div>

              <div>
                <label style={labelStyle}>{lang === 'th' ? `เลือกรายการที่${M.verb} *` : 'Select item *'}</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {[['menu', '🍽️ เมนู'], ['ingredient', '🥬 วัตถุดิบ']].map(([key, label]) => {
                    const on = form.itemType === key;
                    return (
                      <button key={key} type="button" onClick={() => setForm(f => ({ ...f, itemType: key, itemName: '', category: '', unit: key === 'menu' ? 'จาน' : f.unit }))}
                        style={{ flex: 1, padding: '0.55rem', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.9rem',
                          border: `1.5px solid ${on ? M.color : 'rgba(255,255,255,0.15)'}`, background: on ? `${M.soft}0.18)` : 'transparent', color: 'white' }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {form.itemType === 'menu' ? (
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={form.itemName}
                    onChange={e => setForm(f => ({ ...f, itemName: e.target.value, category: findCategoryName(e.target.value, 'menu') }))}
                  >
                    <option value="" style={{ color: '#000' }}>{lang === 'th' ? '— เลือกเมนู —' : '— Select menu —'}</option>
                    {itemGroups.map(g => (
                      <optgroup key={g.slug} label={g.catName} style={{ color: '#000' }}>
                        {g.items.map(name => <option key={g.slug + name} value={name} style={{ color: '#000' }}>{name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={form.itemName}
                    onChange={e => {
                      const ing = (ingredients || []).find(i => i.name === e.target.value);
                      setForm(f => ({ ...f, itemName: e.target.value, category: findCategoryName(e.target.value, 'ingredient'), unit: (ing && ing.unit) || f.unit }));
                    }}
                  >
                    <option value="" style={{ color: '#000' }}>{ingredients === null ? 'กำลังโหลดวัตถุดิบ...' : (lang === 'th' ? '— เลือกวัตถุดิบ —' : '— Select ingredient —')}</option>
                    {ingredientGroups.map(g => (
                      <optgroup key={g.slug} label={g.catName} style={{ color: '#000' }}>
                        {g.items.map(ing => <option key={ing.id} value={ing.name} style={{ color: '#000' }}>{ing.name}{ing.unit ? ` (${ing.unit})` : ''}</option>)}
                      </optgroup>
                    ))}
                  </select>
                )}
                {form.itemType === 'menu' && itemGroups.length === 0 && (
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.74rem', margin: '0.35rem 0 0' }}>
                    {lang === 'th' ? 'ยังไม่มีเมนูให้เลือก' : 'No menu items available'}
                  </p>
                )}
                {form.itemType === 'ingredient' && ingredients !== null && ingredients.length === 0 && (
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.74rem', margin: '0.35rem 0 0' }}>
                    {lang === 'th' ? 'ยังไม่มีวัตถุดิบ — เพิ่มได้ที่ หลังบ้าน > สต็อก (หรือ API ยังไม่ได้อัปเดต)' : 'No ingredients yet'}
                  </p>
                )}
              </div>

              <div>
                <label style={labelStyle}>{lang === 'th' ? (mode === 'count' ? 'จำนวนที่นับได้ (คงเหลือ) *' : `จำนวนที่${M.verb} *`) : 'Quantity *'}</label>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <input type="number" min="0" step="any" style={{ ...inputStyle, flex: 1 }} placeholder="0" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
                  <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} style={{ ...inputStyle, width: 110, flexShrink: 0, cursor: 'pointer' }}>
                    {WASTE_UNITS.map(u => <option key={u} value={u} style={{ color: '#000' }}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>{lang === 'th' ? 'หมายเหตุ / สาเหตุ' : 'Note / Reason'}</label>
                <input style={inputStyle} placeholder={lang === 'th' ? M.notePh : 'Note'} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>

              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.45)' }}>
                {lang === 'th' ? 'พนักงาน' : 'Staff'}: <strong style={{ color: '#22c55e' }}>{currentUser?.username || 'ไม่ระบุ'}</strong>
                <span style={{ marginLeft: 12 }}>⏰ {fmtDate(getThaiTimeISO())}</span>
              </div>
            </div>

            {saveMsg && (
              <div style={{ marginTop: '0.85rem', padding: '0.65rem 0.9rem', borderRadius: 8, background: saveMsg.startsWith('✅') ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: saveMsg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: '0.88rem' }}>
                {saveMsg}
              </div>
            )}

            <button onClick={handleSave} disabled={saving} style={{ width: '100%', marginTop: '1.25rem', padding: '0.85rem', border: 'none', borderRadius: 12, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '1rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: saving ? '#444' : M.color, color: 'white' }}>
              <Save size={18} /> {saving ? (lang === 'th' ? 'กำลังบันทึก...' : 'Saving...') : (lang === 'th' ? `บันทึกการ${M.verb}` : 'Save')}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default WasteRecord;
