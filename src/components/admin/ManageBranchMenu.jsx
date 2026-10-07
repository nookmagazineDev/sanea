import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Store, Save, Search, RotateCcw } from 'lucide-react';
import { API_URL } from '../../utils/api';
import { getPriceOptions } from '../../utils/popupConfig';

// ── เมนูรายสาขา ──
// เมนูกลางแก้ที่หน้า "จัดการเมนู" ตามเดิม หน้านี้ปรับเฉพาะที่สาขาหนึ่งต่างจากเมนูกลาง:
// ไม่ขายเมนูนี้ / ราคาต่างจากเมนูกลาง / ให้ใบออกปริ้นเตอร์ตัวไหนของสาขานี้
// ช่องที่เว้นว่าง = ใช้ตามเมนูกลาง

const inp = {
  padding: '0.45rem 0.6rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 8, color: 'var(--text-main)', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
};

const EMPTY = { isAvailable: true, priceMap: {}, printerId: '' };
const isChanged = (o) => !!o && (o.isAvailable === false || Object.keys(o.priceMap || {}).length > 0 || !!o.printerId);

export default function ManageBranchMenu({ branchId: initialBranch = '', branches = [] }) {
  const activeBranches = branches.filter(b => b.isActive !== false);
  const [branchId, setBranchId] = useState(initialBranch || (activeBranches[0] && String(activeBranches[0].id)) || '');
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [overrides, setOverrides] = useState({}); // { [menuId]: { isAvailable, priceMap, printerId } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (!branchId && initialBranch) setBranchId(initialBranch);
  }, [initialBranch, branchId]);

  // เมนูกลาง + ปริ้นเตอร์ทุกสาขา (getStatic ไม่ระบุสาขา = ยังไม่ปรับ)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}?action=getStatic`);
        const data = await res.json();
        setMenu(Array.isArray(data.menu) ? data.menu : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setPrinters(Array.isArray(data.printers) ? data.printers : []);
      } catch (e) {
        setError(`โหลดเมนูไม่สำเร็จ: ${e.message || e}`);
      }
    })();
  }, []);

  const loadOverrides = useCallback(async (id) => {
    if (!id) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_URL}?action=getMenuBranch&branch=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!data || data.success !== true) {
        throw new Error(data && data.error === 'Unknown GET action'
          ? 'API ที่เครื่อง SQL ยังเป็นรุ่นเก่า — รัน update-api.bat ก่อน'
          : (data && data.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      }
      const map = {};
      (data.rows || []).forEach(r => {
        map[String(r.menuId)] = {
          isAvailable: r.isAvailable !== false,
          priceMap: r.priceMap && typeof r.priceMap === 'object' ? r.priceMap : {},
          printerId: r.printerId || ''
        };
      });
      setOverrides(map);
      setDirty(false);
    } catch (e) {
      setError(String(e.message || e));
      setOverrides({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadOverrides(branchId); }, [branchId, loadOverrides]);

  const branchPrinters = printers.filter(p => !p.branchId || String(p.branchId) === String(branchId));

  const setOverride = (menuId, patch) => {
    setOverrides(prev => {
      const cur = prev[menuId] || EMPTY;
      return { ...prev, [menuId]: { ...cur, ...patch } };
    });
    setDirty(true);
  };

  const setPrice = (menuId, name, value) => {
    setOverrides(prev => {
      const cur = prev[menuId] || EMPTY;
      const priceMap = { ...(cur.priceMap || {}) };
      if (value === '') delete priceMap[name];
      else priceMap[name] = value;
      return { ...prev, [menuId]: { ...cur, priceMap } };
    });
    setDirty(true);
  };

  const resetItem = (menuId) => {
    setOverrides(prev => { const next = { ...prev }; delete next[menuId]; return next; });
    setDirty(true);
  };

  const changeBranch = (id) => {
    if (dirty && !window.confirm('ยังไม่ได้บันทึกการแก้ไขของสาขานี้ — เปลี่ยนสาขาแล้วการแก้ไขจะหาย?')) return;
    setBranchId(id);
  };

  const handleSave = async () => {
    setSaving(true); setSaveMsg('');
    const rows = Object.entries(overrides)
      .filter(([, o]) => isChanged(o))
      .map(([menuId, o]) => ({ menuId, isAvailable: o.isAvailable !== false, priceMap: o.priceMap || {}, printerId: o.printerId || '' }));
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveMenuBranch', branchId, rows })
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) {
        throw new Error(json && /Unknown action/i.test(json.error || '')
          ? 'API ที่เครื่อง SQL ยังเป็นรุ่นเก่า — รัน update-api.bat ก่อน'
          : (json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      }
      setDirty(false);
      setSaveMsg(`✅ บันทึกแล้ว — ปรับ ${json.saved} เมนู หน้าร้านสาขานี้เห็นภายใน 1 นาที`);
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (e) {
      setSaveMsg(`❌ บันทึกไม่สำเร็จ: ${e.message || e}`);
    }
    setSaving(false);
  };

  // จัดกลุ่มตามหมวด เรียงตามลำดับหมวดในหน้าหมวดหมู่
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = menu.filter(m => {
      if (q && !String(m.name || '').toLowerCase().includes(q) && !String(m.nameEn || '').toLowerCase().includes(q)) return false;
      if (onlyChanged && !isChanged(overrides[String(m.id)])) return false;
      return true;
    });
    const order = categories.map(c => c.slug);
    const byCat = new Map();
    list.forEach(m => {
      const key = m.category || '';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(m);
    });
    return Array.from(byCat.entries())
      .sort((a, b) => {
        const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      .map(([slug, items]) => ({ slug, name: (categories.find(c => c.slug === slug) || {}).name || slug || 'ไม่มีหมวด', items }));
  }, [menu, categories, search, onlyChanged, overrides]);

  const changedCount = Object.values(overrides).filter(isChanged).length;
  const branchName = (branches.find(b => String(b.id) === String(branchId)) || {}).name || branchId;

  return (
    <div style={{ color: 'var(--text-main)', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Store size={26} color="var(--accent-hover)" /> เมนูรายสาขา
          </h1>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            ปรับเฉพาะที่สาขานี้ต่างจากเมนูกลาง — ช่องที่เว้นว่างใช้ตามเมนูกลาง (แก้เมนูกลางที่หน้า "จัดการเมนู")
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {saveMsg && (
            <span style={{ fontSize: '0.85rem', color: saveMsg.startsWith('✅') ? '#16a34a' : '#dc2626', background: saveMsg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '0.45rem 0.85rem' }}>
              {saveMsg}
            </span>
          )}
          <button onClick={handleSave} disabled={saving || !dirty || !branchId} style={{ background: dirty ? '#16a34a' : 'rgba(0,0,0,0.05)', border: `1px solid ${dirty ? 'rgba(34,197,94,0.5)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, color: dirty ? 'white' : 'var(--text-muted)', cursor: saving || !dirty ? 'not-allowed' : 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Save size={18} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <select value={branchId} onChange={e => changeBranch(e.target.value)} style={{ ...inp, fontWeight: 700, minWidth: 180 }}>
          {activeBranches.length === 0 && <option value="">— ยังไม่มีสาขา —</option>}
          {activeBranches.map(b => <option key={b.id} value={b.id}>🏠 {b.name || b.id}</option>)}
        </select>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเมนู" style={{ ...inp, width: '100%', paddingLeft: 30 }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} />
          เฉพาะที่ปรับไว้ ({changedCount})
        </label>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.88rem' }}>⚠️ {error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>กำลังโหลด...</div>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>ไม่พบเมนู</div>
      ) : groups.map(group => (
        <div key={group.slug} style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--text-muted)' }}>{group.name}</h3>
          <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
            {group.items.map((m, idx) => {
              const id = String(m.id);
              const o = overrides[id] || EMPTY;
              const selling = o.isAvailable !== false;
              const globallyOff = m.isActive === false;
              const options = getPriceOptions(m);
              return (
                <div key={id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem 1rem', padding: '0.75rem 1rem', borderTop: idx ? '1px solid rgba(0,0,0,0.06)' : 'none', background: isChanged(o) ? 'rgba(234,179,8,0.06)' : 'transparent', opacity: globallyOff ? 0.55 : 1 }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    {globallyOff && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>ปิดขายในเมนูกลาง (ทุกสาขา)</div>}
                  </div>

                  <button
                    onClick={() => setOverride(id, { isAvailable: !selling })}
                    disabled={globallyOff}
                    style={{ padding: '0.35rem 0.75rem', borderRadius: 8, border: '1px solid', cursor: globallyOff ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.78rem', minWidth: 92, background: selling ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)', borderColor: selling ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)', color: selling ? '#16a34a' : '#dc2626' }}
                  >
                    {selling ? 'ขายที่สาขานี้' : 'ไม่ขาย'}
                  </button>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {options.map(opt => {
                      const key = String(opt.name || '');
                      const val = o.priceMap && o.priceMap[key] !== undefined ? o.priceMap[key] : '';
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {key || 'ราคา'}
                          <input
                            type="number" min="0" step="1" inputMode="decimal"
                            value={val}
                            placeholder={String(opt.price)}
                            onChange={e => setPrice(id, key, e.target.value)}
                            style={{ ...inp, width: 78, textAlign: 'right', fontWeight: val !== '' ? 800 : 400, borderColor: val !== '' ? 'rgba(234,179,8,0.7)' : 'rgba(0,0,0,0.15)' }}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <select value={o.printerId || ''} onChange={e => setOverride(id, { printerId: e.target.value })} style={{ ...inp, minWidth: 150 }} title="ใบของเมนูนี้ออกที่ปริ้นเตอร์ไหนของสาขานี้">
                    <option value="">🖨️ ตามเมนูกลาง</option>
                    {branchPrinters.map(p => <option key={p.id} value={p.id}>🖨️ {p.name || p.ip || p.id}</option>)}
                  </select>

                  {isChanged(o) && (
                    <button onClick={() => resetItem(id)} title="ใช้ตามเมนูกลาง" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}>
                      <RotateCcw size={14} /> คืนค่า
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {branchId && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          กำลังแก้: <b>{branchName}</b> — ปริ้นเตอร์ "ตามเมนูกลาง" = ใช้ปริ้นเตอร์ของสาขานี้ที่ชื่อเดียวกับที่ตั้งไว้ในเมนูกลาง ไม่เจอก็ออกที่ปริ้นเตอร์ครัว
        </p>
      )}
    </div>
  );
}
