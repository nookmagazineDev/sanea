import React, { useState, useEffect, useCallback } from 'react';
import { Package, AlertTriangle, RefreshCw, Plus, X, Save, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { API_URL } from '../../utils/api';

const STATUS_CONFIG = {
  OUT: { label: '🔴 หมดแล้ว!',   bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',   text: '#ef4444' },
  LOW: { label: '🟡 ใกล้หมด',    bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.4)',   text: '#d84518' },
  OK:  { label: '🟢 ปกติ',        bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.3)',   text: '#22c55e' },
};

const DEFAULT_STOCK_IN = { ingId: '', qty: '', pricePerUnit: '', note: '' };

// ดูรวมทุกสาขา (อ่านอย่างเดียว — รับของเข้าต้องเลือกสาขา)
const ALL = '__all__';

// branchId = สาขาที่เครื่องนี้ทำงานอยู่ / canPickBranch = แอดมินเลือกดูสาขาอื่นหรือรวมทุกสาขาได้
const ManageStock = ({ branchId: homeBranch = '', branches = [], canPickBranch = false }) => {
  const { canSeeCost = true } = useOutletContext();
  const activeBranches = branches.filter(b => b.isActive !== false);
  const [viewBranch, setViewBranch] = useState(homeBranch);
  useEffect(() => { if (!viewBranch && homeBranch) setViewBranch(homeBranch); }, [homeBranch, viewBranch]);
  const viewingAll = viewBranch === ALL;
  const branchLabel = viewingAll
    ? 'รวมทุกสาขา'
    : ((activeBranches.find(b => String(b.id) === String(viewBranch)) || {}).name || viewBranch);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showStockIn, setShowStockIn] = useState(false);
  const [stockInForm, setStockInForm] = useState([DEFAULT_STOCK_IN]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [sortCol, setSortCol] = useState('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ALL');

  const fetchStock = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = viewingAll || !viewBranch ? '' : `&branch=${encodeURIComponent(viewBranch)}`;
      const res = await fetch(`${API_URL}?action=getStock${qs}`);
      const data = await res.json();
      if (data.success) {
        setStock(data.stock || []);
        setLastUpdated(new Date());
      } else {
        setError(data.error || 'โหลดข้อมูลไม่สำเร็จ');
      }
    } catch (e) {
      setError('ติดต่อ GAS ไม่ได้ — กรุณาตรวจสอบการเชื่อมต่อ หรือเพิ่ม action=getStock ในไฟล์ GAS');
    }
    setLoading(false);
  }, [viewBranch, viewingAll]);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  const alertItems = stock.filter(s => s.status !== 'OK');

  const sorted = [...stock]
    .filter(s => filterStatus === 'ALL' || s.status === filterStatus)
    .sort((a, b) => {
      const order = { OUT: 0, LOW: 1, OK: 2 };
      if (sortCol === 'status') return sortAsc ? order[a.status] - order[b.status] : order[b.status] - order[a.status];
      if (sortCol === 'current') return sortAsc ? a.current - b.current : b.current - a.current;
      if (sortCol === 'name') return sortAsc ? a.name.localeCompare(b.name, 'th') : b.name.localeCompare(a.name, 'th');
      return 0;
    });

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const SortIcon = ({ col }) => sortCol === col
    ? (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
    : <ChevronDown size={14} style={{ opacity: 0.3 }} />;

  const addStockInRow = () => setStockInForm(prev => [...prev, { ...DEFAULT_STOCK_IN }]);
  const removeStockInRow = (i) => setStockInForm(prev => prev.filter((_, idx) => idx !== i));
  const updateStockInRow = (i, field, val) => {
    setStockInForm(prev => prev.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
    setSaveMsg('');
  };

  const handleStockInSave = async () => {
    const valid = stockInForm.filter(r => r.ingId && Number(r.qty) > 0);
    if (valid.length === 0) { setSaveMsg('กรุณาระบุรหัสวัตถุดิบและจำนวนอย่างน้อย 1 รายการ'); return; }
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'stockIn',
          branchId: viewBranch,
          items: valid.map(r => ({
            ingId: r.ingId,
            qty: Number(r.qty),
            pricePerUnit: r.pricePerUnit ? Number(r.pricePerUnit) : undefined,
            note: r.note,
            staff: 'admin'
          }))
        })
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      setSaveMsg(`✅ บันทึกรับวัตถุดิบเข้าสาขา ${branchLabel} สำเร็จ`);
      setStockInForm([DEFAULT_STOCK_IN]);
      setTimeout(() => { setShowStockIn(false); setSaveMsg(''); fetchStock(); }, 1800);
    } catch (e) {
      setSaveMsg(`❌ บันทึกไม่สำเร็จ: ${e.message || e}`);
    }
    setSaving(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={26} color="var(--accent-hover)" /> สต็อกวัตถุดิบ
          </h1>
          <p style={{ margin: 0 }}>
            ติดตามวัตถุดิบคงเหลือ — ตัดอัตโนมัติเมื่อมีออเดอร์ · <b>{branchLabel || '—'}</b>
            {lastUpdated && <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginLeft: '0.75rem' }}>
              อัปเดต {lastUpdated.toLocaleTimeString('th-TH')}
            </span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canPickBranch && activeBranches.length > 1 && (
            <select value={viewBranch} onChange={e => setViewBranch(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontFamily: 'inherit', fontWeight: 700, background: '#fff' }}>
              {activeBranches.map(b => <option key={b.id} value={b.id}>🏠 {b.name || b.id}</option>)}
              <option value={ALL}>🌐 รวมทุกสาขา</option>
            </select>
          )}
          <a
            href="https://docs.google.com/spreadsheets/"
            target="_blank" rel="noopener noreferrer"
            className="admin-btn secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', padding: '0.55rem 1rem' }}
          >
            <ExternalLink size={15} /> เปิด Google Sheet
          </a>
          <button className="admin-btn secondary" onClick={fetchStock} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem' }}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> รีเฟรช
          </button>
          <button className="admin-btn" onClick={() => setShowStockIn(true)} disabled={viewingAll}
            title={viewingAll ? 'เลือกสาขาก่อน — รับของเข้าต้องระบุว่าเข้าสาขาไหน' : ''}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: viewingAll ? 0.5 : 1 }}>
            <Plus size={18} /> รับวัตถุดิบเข้า
          </button>
        </div>
      </div>

      {/* Alert Banner */}
      {alertItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {alertItems.map(item => {
            const cfg = STATUS_CONFIG[item.status];
            return (
              <div key={item.id} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: '12px', padding: '1rem 1.25rem' }}>
                <div style={{ fontWeight: '700', color: cfg.text, fontSize: '0.82rem', marginBottom: '0.25rem' }}>{cfg.label}</div>
                <div style={{ color: 'var(--text-main)', fontWeight: '600' }}>{item.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  คงเหลือ <strong style={{ color: cfg.text }}>{item.current.toLocaleString()}</strong> {item.unit}
                  {item.minimum > 0 && ` (ขั้นต่ำ ${item.minimum.toLocaleString()})`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem', color: '#ef4444', fontSize: '0.9rem' }}>
          <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { key: 'ALL', label: `ทั้งหมด (${stock.length})` },
          { key: 'OUT', label: `🔴 หมด (${stock.filter(s => s.status === 'OUT').length})` },
          { key: 'LOW', label: `🟡 ใกล้หมด (${stock.filter(s => s.status === 'LOW').length})` },
          { key: 'OK',  label: `🟢 ปกติ (${stock.filter(s => s.status === 'OK').length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilterStatus(tab.key)} style={{
            padding: '0.4rem 0.9rem', borderRadius: '20px', fontSize: '0.83rem', cursor: 'pointer',
            border: filterStatus === tab.key ? '1.5px solid var(--accent)' : '1px solid rgba(0,0,0,0.08)',
            background: filterStatus === tab.key ? 'rgba(234,179,8,0.18)' : 'rgba(0,0,0,0.02)',
            color: filterStatus === tab.key ? 'var(--text-main)' : 'var(--text-muted)',
            fontWeight: filterStatus === tab.key ? '700' : '400',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Stock Table */}
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <RefreshCw size={32} style={{ opacity: 0.4, marginBottom: '1rem', animation: 'spin 1s linear infinite' }} />
            <p>กำลังโหลดข้อมูลสต็อก...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <Package size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
            <p>ไม่พบข้อมูลวัตถุดิบ — กรุณารัน setupBOM() ใน Google Apps Script ก่อน</p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '110px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '120px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('name')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>ชื่อวัตถุดิบ <SortIcon col="name" /></span>
                  </th>
                  <th>หน่วย</th>
                  <th style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => handleSort('current')}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.3rem' }}>คงเหลือ <SortIcon col="current" /></span>
                  </th>
                  <th style={{ textAlign: 'right' }}>ขั้นต่ำ</th>
                  {canSeeCost && <th style={{ textAlign: 'right' }}>ราคา/หน่วย</th>}
                  {canSeeCost && <th style={{ textAlign: 'right' }}>มูลค่าสต็อก</th>}
                  <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('status')}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>สถานะ <SortIcon col="status" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const stockValue = item.current * item.price;
                  return (
                    <tr key={item.id} style={{ borderLeft: `3px solid ${item.status !== 'OK' ? cfg.border : 'transparent'}` }}>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{item.id}</td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.nameEn && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.nameEn}</div>}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{item.unit}</td>
                      <td style={{ textAlign: 'right', fontWeight: '700', color: item.status === 'OUT' ? '#ef4444' : item.status === 'LOW' ? '#d84518' : 'var(--text-main)' }}>
                        {item.current.toLocaleString('th-TH', { maximumFractionDigits: 1 })}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                        {item.minimum > 0 ? item.minimum.toLocaleString() : '—'}
                      </td>
                      {canSeeCost && (
                        <td style={{ textAlign: 'right', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                          {item.price > 0 ? `฿${item.price.toFixed(2)}` : '—'}
                        </td>
                      )}
                      {canSeeCost && (
                        <td style={{ textAlign: 'right', fontSize: '0.88rem', color: stockValue > 0 ? '#60a5fa' : 'var(--text-muted)' }}>
                          {stockValue > 0 ? `฿${stockValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '—'}
                        </td>
                      )}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '0.25rem 0.6rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: '600', background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* สรุปมูลค่าสต็อก */}
      {stock.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {[
            { label: 'วัตถุดิบทั้งหมด', val: `${stock.length} รายการ`, color: 'var(--text-main)' },
            { label: 'ใกล้หมด/หมดแล้ว', val: `${alertItems.length} รายการ`, color: alertItems.length > 0 ? '#ef4444' : '#22c55e' },
            ...(canSeeCost ? [{ label: 'มูลค่าสต็อครวม', val: `฿${stock.reduce((s, i) => s + i.current * i.price, 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, color: '#60a5fa' }] : []),
          ].map(card => (
            <div key={card.label} style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '10px', padding: '0.75rem 1.25rem', minWidth: '160px' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{card.label}</div>
              <div style={{ fontWeight: '800', fontSize: '1.1rem', color: card.color }}>{card.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: รับวัตถุดิบ */}
      {showStockIn && (
        <div className="admin-modal-overlay" onClick={() => setShowStockIn(false)}>
          <div className="admin-modal" style={{ maxWidth: '720px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Plus size={20} /> รับวัตถุดิบเข้าสต็อก
              </h2>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowStockIn(false)}>
                <X size={24} />
              </button>
            </div>

            {/* แถวหัว */}
            <div style={{ display: 'grid', gridTemplateColumns: canSeeCost ? '2fr 90px 120px 1fr 36px' : '2fr 90px 1fr 36px', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
              <span>วัตถุดิบ</span>
              <span>จำนวน (หน่วยซื้อ)</span>
              {canSeeCost && <span>ราคา/หน่วยซื้อ ฿</span>}
              <span>หมายเหตุ</span>
              <span></span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '320px', overflowY: 'auto', marginBottom: '1.25rem' }}>
              {stockInForm.map((row, i) => {
                const sel = stock.find(s => String(s.id) === String(row.ingId));
                const factor = sel ? (Number(sel.unitsPerPurchase) || 1) : 1;
                const qtyP = Number(row.qty) || 0;
                const priceP = row.pricePerUnit !== '' ? Number(row.pricePerUnit) : null;
                const usageQty = qtyP * factor;
                const usageCost = priceP != null && factor > 0 ? priceP / factor : null;
                const showPreview = sel && qtyP > 0;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: canSeeCost ? '2fr 90px 120px 1fr 36px' : '2fr 90px 1fr 36px', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={row.ingId}
                        onChange={e => updateStockInRow(i, 'ingId', e.target.value)}
                        style={{ fontSize: '0.88rem', width: '100%' }}
                      >
                        <option value="">— เลือกวัตถุดิบ —</option>
                        {stock.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.id} — {s.name}{s.purchaseUnit ? ` (ซื้อเป็น ${s.purchaseUnit})` : (s.unit ? ` (${s.unit})` : '')}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number" min="0" step="any" placeholder="0"
                        value={row.qty}
                        onChange={e => updateStockInRow(i, 'qty', e.target.value)}
                        style={{ textAlign: 'right' }}
                      />
                      {canSeeCost && (
                        <input
                          type="number" min="0" step="0.01" placeholder="ใช้ค่าเดิม"
                          value={row.pricePerUnit}
                          onChange={e => updateStockInRow(i, 'pricePerUnit', e.target.value)}
                          style={{ textAlign: 'right' }}
                        />
                      )}
                      <input
                        placeholder="หมายเหตุ"
                        value={row.note}
                        onChange={e => updateStockInRow(i, 'note', e.target.value)}
                      />
                      <button onClick={() => removeStockInRow(i)} disabled={stockInForm.length === 1}
                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', padding: '0.4rem', opacity: stockInForm.length === 1 ? 0.3 : 1 }}>
                        <X size={14} />
                      </button>
                    </div>
                    {showPreview && (
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', paddingLeft: '0.25rem' }}>
                        ➜ เข้าสต็อก <strong style={{ color: '#22c55e' }}>{usageQty.toLocaleString()} {sel.unit}</strong>
                        {canSeeCost && usageCost != null && <> · ต้นทุน <strong style={{ color: '#60a5fa' }}>฿{usageCost.toLocaleString(undefined, { maximumFractionDigits: 4 })}/{sel.unit}</strong></>}
                        {sel.purchaseUnit && <span style={{ opacity: 0.7 }}> (1 {sel.purchaseUnit} = {factor.toLocaleString()} {sel.unit})</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button onClick={addStockInRow} style={{ background: 'rgba(0,0,0,0.02)', border: '1px dashed rgba(0,0,0,0.15)', color: 'var(--text-main)', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', width: '100%', marginBottom: '1.25rem', fontSize: '0.88rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
              <Plus size={15} /> เพิ่มรายการ
            </button>

            {saveMsg && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: saveMsg.startsWith('✅') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: saveMsg.startsWith('✅') ? '#22c55e' : '#ef4444', fontSize: '0.9rem' }}>
                {saveMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setShowStockIn(false)} style={{ flex: 1, padding: '0.85rem', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', color: 'var(--text-main)', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                ยกเลิก
              </button>
              <button onClick={handleStockInSave} disabled={saving} style={{ flex: 2, padding: '0.85rem', background: saving ? 'rgba(0,0,0,0.05)' : 'var(--accent)', color: saving ? 'var(--text-muted)' : 'black', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Save size={18} /> {saving ? 'กำลังบันทึก...' : 'บันทึกรับวัตถุดิบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default ManageStock;
