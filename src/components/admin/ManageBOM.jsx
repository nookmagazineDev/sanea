import React, { useState, useEffect } from 'react';
import {
  FlaskConical, Save, Plus, Trash2, Search,
  Package, RefreshCw, Upload, ChevronRight, Edit2, X
} from 'lucide-react';
import { API_URL } from '../../utils/api';

// ─── Helper: derive current BOM rows for selectedMenuId from bomConfig ───────
const getBomRows = (bomConfig, menuId) =>
  menuId ? (bomConfig[String(menuId)] || []) : [];

const ManageBOM = () => {

  // ─── Tabs ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('bom'); // 'bom' | 'ingredients'

  // ─── Data ────────────────────────────────────────────────────────────────
  const [menuItems, setMenuItems]     = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [bomConfig, setBomConfig]     = useState({}); // { [menuId]: [{ingId,ingName,qty,unit,costPerUnit}] }

  // ─── BOM tab state ───────────────────────────────────────────────────────
  const [selectedMenuId, setSelectedMenuId] = useState(null);
  const [searchTerm, setSearchTerm]         = useState('');
  const [saved, setSaved]                   = useState(false);
  const [syncStatus, setSyncStatus]         = useState(null); // null | 'syncing' | 'ok' | 'error'

  // ─── Ingredients tab state ───────────────────────────────────────────────
  const [ingSearch, setIngSearch]     = useState('');
  const [editingIng, setEditingIng]   = useState(null);
  const [ingLoading, setIngLoading]   = useState(false);

  const [loading, setLoading] = useState(true);

  // ─── Init ────────────────────────────────────────────────────────────────
  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    // Menu
    try {
      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        const data = JSON.parse(cached);
        if (Array.isArray(data.menu)) setMenuItems(data.menu);
      }
    } catch(e) {}
    // BOM config
    try {
      const stored = localStorage.getItem('bom_config');
      if (stored) setBomConfig(JSON.parse(stored));
    } catch(e) {}
    // Ingredients
    await fetchIngredients(false);
    setLoading(false);
  };

  const fetchIngredients = async (forceRefresh = false) => {
    const stored = localStorage.getItem('bom_ingredients');
    if (stored && !forceRefresh) {
      try { setIngredients(JSON.parse(stored)); return; } catch(e) {}
    }
    setIngLoading(true);
    try {
      const resp = await fetch(API_URL + '?action=getIngredients');
      const data = await resp.json();
      if (data.success && Array.isArray(data.ingredients)) {
        setIngredients(data.ingredients);
        localStorage.setItem('bom_ingredients', JSON.stringify(data.ingredients));
      }
    } catch(e) { /* GAS may not have this action yet */ }
    setIngLoading(false);
  };

  // ─── Derived ─────────────────────────────────────────────────────────────
  const selectedMenu = menuItems.find(m => String(m.id) === String(selectedMenuId));
  const currentBom   = getBomRows(bomConfig, selectedMenuId);

  const totalCost  = currentBom.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.costPerUnit) || 0), 0);
  const menuPrice  = selectedMenu ? (parseFloat(selectedMenu.price) || 0) : 0;
  const grossProfit = menuPrice - totalCost;
  const margin      = menuPrice > 0 ? (grossProfit / menuPrice) * 100 : 0;

  const bomMenuCount = Object.keys(bomConfig).filter(k => (bomConfig[k] || []).length > 0).length;

  const filteredMenu = menuItems.filter(m => {
    const s = searchTerm.toLowerCase();
    return (m.name || '').toLowerCase().includes(s) || (m.nameEn || '').toLowerCase().includes(s);
  });

  const filteredIngredients = ingredients.filter(i => {
    const s = ingSearch.toLowerCase();
    return (i.name || '').toLowerCase().includes(s) || (i.id || '').toLowerCase().includes(s);
  });

  // ─── BOM CRUD ────────────────────────────────────────────────────────────
  const updateBomState = (menuId, rows) => {
    setBomConfig(prev => ({ ...prev, [String(menuId)]: rows }));
    setSaved(false);
  };

  const updateBomRow = (index, field, value) => {
    const rows = [...currentBom];
    rows[index] = { ...rows[index], [field]: value };
    // Auto-fill from ingredient master when ingId changes
    if (field === 'ingId' && value) {
      const ing = ingredients.find(i => i.id === value);
      if (ing) {
        rows[index].ingName    = ing.name;
        rows[index].unit       = rows[index].unit || ing.unit || '';
        rows[index].costPerUnit = rows[index].costPerUnit !== undefined && rows[index].costPerUnit !== ''
          ? rows[index].costPerUnit
          : (ing.costPerUnit ?? ing.pricePerUnit ?? 0);
      }
    }
    updateBomState(selectedMenuId, rows);
  };

  const addBomRow = () => {
    updateBomState(selectedMenuId, [...currentBom, { ingId: '', ingName: '', qty: '', unit: '', costPerUnit: '' }]);
  };

  const removeBomRow = (index) => {
    updateBomState(selectedMenuId, currentBom.filter((_, i) => i !== index));
  };

  const saveBomForMenu = () => {
    const newConfig = { ...bomConfig, [String(selectedMenuId)]: currentBom };
    localStorage.setItem('bom_config', JSON.stringify(newConfig));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // ─── Sync all BOM to GAS ─────────────────────────────────────────────────
  const syncToGAS = async () => {
    setSyncStatus('syncing');
    const rows = [];
    menuItems.forEach(m => {
      (bomConfig[String(m.id)] || []).forEach(row => {
        if (row.ingId || row.ingName) {
          rows.push({
            menuId:       String(m.id),
            menuName:     m.name || '',
            menuNameEn:   m.nameEn || '',
            ingId:        row.ingId || '',
            ingName:      row.ingName || '',
            qty:          parseFloat(row.qty) || 0,
            unit:         row.unit || '',
            costPerUnit:  parseFloat(row.costPerUnit) || 0,
          });
        }
      });
    });
    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveBOM', rows })
      });
      setSyncStatus('ok');
    } catch(e) {
      setSyncStatus('error');
    }
    setTimeout(() => setSyncStatus(null), 3500);
  };

  // ─── Ingredient CRUD ─────────────────────────────────────────────────────
  const saveIngredient = (ing) => {
    const normalized = { ...ing, id: ing.id || `ING-${Date.now()}` };
    const newList = ingredients.find(i => i.id === normalized.id)
      ? ingredients.map(i => i.id === normalized.id ? normalized : i)
      : [...ingredients, normalized];
    setIngredients(newList);
    localStorage.setItem('bom_ingredients', JSON.stringify(newList));
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'upsertIngredient', ingredient: normalized })
    }).catch(console.error);
    setEditingIng(null);
  };

  const deleteIngredient = (id) => {
    if (!window.confirm('ลบวัตถุดิบนี้ออกจากรายการ?')) return;
    const newList = ingredients.filter(i => i.id !== id);
    setIngredients(newList);
    localStorage.setItem('bom_ingredients', JSON.stringify(newList));
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'deleteIngredient', id })
    }).catch(console.error);
  };

  // ─── UI helpers ──────────────────────────────────────────────────────────
  const marginColor = margin >= 60 ? '#22c55e' : margin >= 35 ? '#d84518' : '#ef4444';

  const TAB_BTN = (tab, label, badge) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '0.5rem 1.25rem', borderRadius: '8px', border: '1px solid', cursor: 'pointer',
        fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.15s',
        background: activeTab === tab ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
        borderColor: activeTab === tab ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
        color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem'
      }}
    >
      {label}
      {badge !== undefined && (
        <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 4, padding: '0 5px', fontSize: '0.73rem' }}>
          {badge}
        </span>
      )}
    </button>
  );

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div>
      {/* ─── Page header ─────────────────────────────────────────────────── */}
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>
            <FlaskConical size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            จัดการ BOM (สูตรวัตถุดิบ)
          </h1>
          <p>กำหนดส่วนผสมและปริมาณวัตถุดิบต่อจาน — ใช้คำนวณต้นทุนและตัดสต็อกอัตโนมัติ</p>
        </div>
        <button
          className="admin-btn secondary"
          onClick={syncToGAS}
          disabled={syncStatus === 'syncing'}
          style={{ fontSize: '0.85rem', padding: '0.6rem 1.2rem', minWidth: 160 }}
        >
          {syncStatus === 'syncing'
            ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> กำลัง Sync...</>
            : syncStatus === 'ok'
              ? <><Upload size={14} /> Sync แล้ว ✓</>
              : syncStatus === 'error'
                ? <><X size={14} /> Sync ไม่ได้</>
                : <><Upload size={14} /> Sync ไปยัง GAS</>
          }
        </button>
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {TAB_BTN('bom',
          <><FlaskConical size={15} /> BOM เมนู</>,
          `${bomMenuCount}/${menuItems.length}`
        )}
        {TAB_BTN('ingredients',
          <><Package size={15} /> วัตถุดิบ</>,
          ingredients.length
        )}
      </div>

      {/* ══════════════════════ TAB: BOM ══════════════════════════════════ */}
      {activeTab === 'bom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.25rem', alignItems: 'start' }}>

          {/* ── Left: Menu list ─────────────────────────────────────────── */}
          <div className="admin-card" style={{ padding: '1rem', maxHeight: '78vh', overflowY: 'auto' }}>
            <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                placeholder="ค้นหาเมนู..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', paddingLeft: '2rem', fontSize: '0.88rem', boxSizing: 'border-box' }}
              />
            </div>

            {loading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>กำลังโหลด...</p>
            ) : filteredMenu.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>ไม่พบเมนู</p>
            ) : (
              filteredMenu.map(m => {
                const bom = bomConfig[String(m.id)];
                const hasBom = bom && bom.length > 0;
                const isSelected = String(selectedMenuId) === String(m.id);
                return (
                  <div
                    key={m.id}
                    onClick={() => { setSelectedMenuId(String(m.id)); setSaved(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.6rem 0.75rem', borderRadius: '10px', cursor: 'pointer', marginBottom: '0.3rem',
                      background: isSelected ? 'rgba(185,28,28,0.2)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isSelected ? 'rgba(185,28,28,0.5)' : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    {m.image ? (
                      <img src={m.image} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} alt="" />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>🍽️</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>฿{m.price}</div>
                    </div>
                    {hasBom ? (
                      <span style={{ fontSize: '0.68rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '0.15rem 0.45rem', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {bom.length} ชนิด
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>ยังไม่ตั้ง</span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* ── Right: BOM Editor ───────────────────────────────────────── */}
          {selectedMenu ? (
            <div className="admin-card">
              {/* Menu header + save btn */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center' }}>
                  {selectedMenu.image ? (
                    <img src={selectedMenu.image} style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover' }} alt="" />
                  ) : (
                    <div style={{ width: 52, height: 52, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.7rem' }}>🍽️</div>
                  )}
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{selectedMenu.name}</h2>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {selectedMenu.nameEn} · ราคาขาย ฿{selectedMenu.price}
                    </div>
                  </div>
                </div>
                <button
                  className="admin-btn"
                  onClick={saveBomForMenu}
                  style={{ background: saved ? '#22c55e' : undefined, transition: 'background 0.3s' }}
                >
                  <Save size={16} /> {saved ? 'บันทึกแล้ว ✓' : 'บันทึก BOM'}
                </button>
              </div>

              {/* Cost summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[
                  { label: 'ต้นทุนวัตถุดิบ/จาน', value: `฿${totalCost.toFixed(2)}`, color: '#ef4444' },
                  { label: 'กำไรขั้นต้น/จาน',    value: `฿${grossProfit.toFixed(2)}`, color: grossProfit >= 0 ? '#22c55e' : '#ef4444' },
                  { label: 'Gross Margin',        value: `${margin.toFixed(1)}%`,       color: marginColor },
                ].map(card => (
                  <div key={card.label} style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 10, padding: '0.85rem', textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '1.55rem', fontWeight: 700, color: card.color }}>{card.value}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{card.label}</div>
                  </div>
                ))}
              </div>

              {/* Ingredient table */}
              {currentBom.length > 0 ? (
                <div style={{ overflowX: 'auto', marginBottom: '0.85rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        {[['วัตถุดิบ', 'left'], ['ปริมาณ', 'center'], ['หน่วย', 'center'], ['ราคา/หน่วย', 'center'], ['ต้นทุน', 'center'], ['', 'center']].map(([h, align]) => (
                          <th key={h} style={{ textAlign: align, padding: '0.45rem 0.5rem', fontSize: '0.77rem', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentBom.map((row, idx) => {
                        const rowCost = (parseFloat(row.qty) || 0) * (parseFloat(row.costPerUnit) || 0);
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
                            {/* Ingredient selector */}
                            <td style={{ padding: '0.4rem 0.5rem', minWidth: 200 }}>
                              {ingredients.length > 0 ? (
                                <select
                                  value={row.ingId || ''}
                                  onChange={e => updateBomRow(idx, 'ingId', e.target.value)}
                                  style={{ width: '100%', fontSize: '0.84rem' }}
                                >
                                  <option value="">— เลือกวัตถุดิบ —</option>
                                  {ingredients.map(ing => (
                                    <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={row.ingName || ''}
                                  onChange={e => updateBomRow(idx, 'ingName', e.target.value)}
                                  placeholder="ชื่อวัตถุดิบ"
                                  style={{ width: '100%', fontSize: '0.84rem' }}
                                />
                              )}
                              {row.ingId && ingredients.length > 0 && !ingredients.find(i => i.id === row.ingId) && (
                                <div style={{ fontSize: '0.72rem', color: '#d84518', marginTop: '0.15rem' }}>⚠ ไม่พบในคลังวัตถุดิบ</div>
                              )}
                            </td>
                            {/* Quantity */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="number" min="0" step="any"
                                value={row.qty ?? ''}
                                onChange={e => updateBomRow(idx, 'qty', e.target.value)}
                                placeholder="0"
                                style={{ width: 72, textAlign: 'center', fontSize: '0.84rem' }}
                              />
                            </td>
                            {/* Unit */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                value={row.unit || ''}
                                onChange={e => updateBomRow(idx, 'unit', e.target.value)}
                                placeholder="หน่วย"
                                style={{ width: 65, textAlign: 'center', fontSize: '0.84rem' }}
                              />
                            </td>
                            {/* Cost per unit */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="number" min="0" step="any"
                                value={row.costPerUnit ?? ''}
                                onChange={e => updateBomRow(idx, 'costPerUnit', e.target.value)}
                                placeholder="0.00"
                                style={{ width: 72, textAlign: 'center', fontSize: '0.84rem' }}
                              />
                            </td>
                            {/* Row cost */}
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>
                              ฿{rowCost.toFixed(2)}
                            </td>
                            {/* Delete */}
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              <button onClick={() => removeBomRow(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid rgba(255,255,255,0.12)' }}>
                        <td colSpan={4} style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)' }}>รวมต้นทุนต่อจาน</td>
                        <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 700, color: '#ef4444' }}>฿{totalCost.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, marginBottom: '1rem' }}>
                  <FlaskConical size={42} style={{ opacity: 0.25, marginBottom: '0.75rem' }} />
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>ยังไม่มีส่วนผสม — กด "เพิ่มวัตถุดิบ" เพื่อเริ่มต้น</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.1rem' }}>
                <button className="admin-btn secondary" onClick={addBomRow}>
                  <Plus size={16} /> เพิ่มวัตถุดิบ
                </button>
                <button
                  className="admin-btn"
                  onClick={saveBomForMenu}
                  style={{ background: saved ? '#22c55e' : undefined, transition: 'background 0.3s' }}
                >
                  <Save size={16} /> {saved ? 'บันทึกแล้ว ✓' : 'บันทึก BOM'}
                </button>
              </div>

              <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', padding: '0.8rem 1rem', borderRadius: 10, color: '#d84518', fontSize: '0.8rem', lineHeight: 1.6 }}>
                💡 <strong>วิธีใช้:</strong> บันทึก BOM ทุกเมนูที่ต้องการ แล้วกด <strong>"Sync ไปยัง GAS"</strong> เพื่อส่งข้อมูลไปชีท BOM
                — ระบบจะตัดสต็อกอัตโนมัติเมื่อมีออเดอร์ผ่าน GAS action <code>deductStock</code>
              </div>
            </div>
          ) : (
            <div className="admin-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, color: 'var(--text-muted)' }}>
              <FlaskConical size={54} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p style={{ margin: 0, fontSize: '0.95rem' }}>เลือกเมนูจากทางซ้ายเพื่อตั้งค่าสูตรวัตถุดิบ (BOM)</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ TAB: INGREDIENTS ════════════════════════ */}
      {activeTab === 'ingredients' && (
        <div className="admin-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  placeholder="ค้นหาวัตถุดิบ..."
                  value={ingSearch}
                  onChange={e => setIngSearch(e.target.value)}
                  style={{ paddingLeft: '2rem', width: 230, fontSize: '0.88rem' }}
                />
              </div>
              <button
                className="admin-btn secondary"
                onClick={() => fetchIngredients(true)}
                disabled={ingLoading}
                style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
              >
                <RefreshCw size={14} style={{ animation: ingLoading ? 'spin 1s linear infinite' : 'none' }} />
                {ingLoading ? ' กำลังโหลด...' : ' ดึงจาก GAS'}
              </button>
            </div>
            <button
              className="admin-btn"
              onClick={() => setEditingIng({ id: `ING-${Date.now()}`, name: '', nameEn: '', unit: '', purchaseUnit: '', unitsPerPurchase: 1, minStock: 0, costPerUnit: 0, category: '' })}
            >
              <Plus size={16} /> เพิ่มวัตถุดิบ
            </button>
          </div>

          {ingredients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <Package size={48} style={{ opacity: 0.25, marginBottom: '1rem' }} />
              <p>ยังไม่มีรายการวัตถุดิบ</p>
              <p style={{ fontSize: '0.85rem' }}>กด <strong>ดึงจาก GAS</strong> เพื่อโหลดจากชีท "วัตถุดิบ" หรือเพิ่มด้วยตนเอง</p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ชื่อวัตถุดิบ</th>
                    <th style={{ textAlign: 'center' }}>หน่วยใช้</th>
                    <th style={{ textAlign: 'center' }}>หน่วยซื้อ (แปลง)</th>
                    <th style={{ textAlign: 'center' }}>สต็อกขั้นต่ำ</th>
                    <th style={{ textAlign: 'center' }}>ต้นทุน/หน่วยใช้</th>
                    <th>หมวดหมู่</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIngredients.map(ing => (
                    <tr key={ing.id}>
                      <td>
                        <code style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', padding: '0.15rem 0.45rem', borderRadius: 4 }}>
                          {ing.id}
                        </code>
                      </td>
                      <td>
                        <strong>{ing.name}</strong>
                        {ing.nameEn && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.5rem' }}>{ing.nameEn}</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>{ing.unit}</td>
                      <td style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {ing.purchaseUnit
                          ? <>{ing.purchaseUnit} <span style={{ opacity: 0.6 }}>(×{Number(ing.unitsPerPurchase) || 1})</span></>
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>{ing.minStock}</td>
                      <td style={{ textAlign: 'center', color: 'var(--accent)', fontWeight: 700 }}>
                        ฿{parseFloat(ing.costPerUnit ?? ing.pricePerUnit ?? 0).toFixed(2)}
                      </td>
                      <td>
                        <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.2rem 0.55rem', borderRadius: 5, fontSize: '0.78rem' }}>
                          {ing.category || '—'}
                        </span>
                      </td>
                      <td>
                        <button className="admin-btn secondary" style={{ padding: '0.3rem 0.55rem', marginRight: '0.4rem', fontSize: '0.8rem' }} onClick={() => setEditingIng({ ...ing })}>
                          <Edit2 size={13} />
                        </button>
                        <button className="admin-btn danger" style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem' }} onClick={() => deleteIngredient(ing.id)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Ingredient Edit Modal ──────────────────────────────────────── */}
      {editingIng && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0 }}>
                {ingredients.find(i => i.id === editingIng.id) ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}
              </h2>
              <button onClick={() => setEditingIng(null)} style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>รหัสวัตถุดิบ</label>
                <input value={editingIng.id || ''} onChange={e => setEditingIng({ ...editingIng, id: e.target.value })} placeholder="ING-001" />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>หมวดหมู่</label>
                <input value={editingIng.category || ''} onChange={e => setEditingIng({ ...editingIng, category: e.target.value })} placeholder="เนื้อสัตว์, ผัก..." />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>ชื่อ (ไทย) *</label>
                <input required value={editingIng.name || ''} onChange={e => setEditingIng({ ...editingIng, name: e.target.value })} placeholder="หมูสามชั้น" />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>ชื่อ (EN)</label>
                <input value={editingIng.nameEn || ''} onChange={e => setEditingIng({ ...editingIng, nameEn: e.target.value })} placeholder="Pork Belly" />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>หน่วยใช้ (สำหรับ BOM)</label>
                <input value={editingIng.unit || ''} onChange={e => setEditingIng({ ...editingIng, unit: e.target.value })} placeholder="กรัม, มล, ลูก..." />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>สต็อกขั้นต่ำ (หน่วยใช้)</label>
                <input type="number" value={editingIng.minStock ?? ''} onChange={e => setEditingIng({ ...editingIng, minStock: e.target.value })} placeholder="500" />
              </div>

              {/* ── หน่วยซื้อ + อัตราแปลง ── */}
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>หน่วยซื้อ (ตอนลงซื้อของ)</label>
                <input value={editingIng.purchaseUnit || ''} onChange={e => setEditingIng({ ...editingIng, purchaseUnit: e.target.value })} placeholder="กก., ขวด, แพ็ค..." />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.82rem' }}>1 หน่วยซื้อ = กี่หน่วยใช้</label>
                <input type="number" step="any" min="0" value={editingIng.unitsPerPurchase ?? ''} onChange={e => setEditingIng({ ...editingIng, unitsPerPurchase: e.target.value })} placeholder="เช่น 1 กก. = 1000 กรัม" />
              </div>

              <div className="admin-form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.82rem' }}>ต้นทุน/หน่วยใช้ (฿) — อัปเดตอัตโนมัติเมื่อลงซื้อของ</label>
                <input type="number" step="any" value={editingIng.costPerUnit ?? ''} onChange={e => setEditingIng({ ...editingIng, costPerUnit: e.target.value })} placeholder="0.08" />
              </div>

              {(() => {
                const upp = Number(editingIng.unitsPerPurchase) || 0;
                const cpu = Number(editingIng.costPerUnit) || 0;
                if (upp > 0 && editingIng.purchaseUnit) {
                  return (
                    <div style={{ gridColumn: 'span 2', fontSize: '0.78rem', color: 'var(--text-muted)', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
                      💡 1 {editingIng.purchaseUnit} = {upp.toLocaleString()} {editingIng.unit || 'หน่วยใช้'}
                      {cpu > 0 && <> · ต้นทุนต่อ 1 {editingIng.purchaseUnit} ≈ <strong style={{ color: '#60a5fa' }}>฿{(cpu * upp).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></>}
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <button
              className="admin-btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem' }}
              onClick={() => saveIngredient(editingIng)}
            >
              <Save size={16} /> บันทึกวัตถุดิบ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageBOM;
