import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Edit2, Trash2, QrCode, CheckCircle, RefreshCw, Printer, Download, Sparkles, LayoutGrid, X } from 'lucide-react';
import QRCode from 'qrcode';
import { API_URL } from '../../utils/api';
import './Admin.css';

export const DEFAULT_TABLES = [
  ...Array.from({ length: 16 }, (_, i) => ({ id: `dine_${i + 1}`, name: `${i + 1}`, zone: 'DineIn', priceTier: 'normal', seats: 4, active: true })),
  { id: 'th_1', name: 'Takehome 1', zone: 'Takehome', priceTier: 'takehome', seats: 0, active: true },
  { id: 'th_2', name: 'Takehome 2', zone: 'Takehome', priceTier: 'takehome', seats: 0, active: true },
  { id: 'th_3', name: 'Takehome 3', zone: 'Takehome', priceTier: 'takehome', seats: 0, active: true },
  { id: 'deli_1', name: 'LineMan', zone: 'Delivery', priceTier: 'deli', seats: 0, active: true },
  { id: 'deli_2', name: 'Grab', zone: 'Delivery', priceTier: 'deli', seats: 0, active: true },
  { id: 'deli_3', name: 'Shopee', zone: 'Delivery', priceTier: 'deli', seats: 0, active: true }
];

// ผังโต๊ะของสาขาที่เก็บไว้บนเซิร์ฟเวอร์ (ก้อน cache ที่หน้าร้านดึงมาแล้ว)
const serverTablesFor = (branchId) => {
  try {
    const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
    const list = d.branchTables && d.branchTables[branchId];
    return Array.isArray(list) && list.length > 0 ? list : null;
  } catch { return null; }
};

// branchId = สาขาที่กำลังจัดผังโต๊ะ (สาขาของผู้ใช้ที่ล็อกอิน หรือสาขาหลัก)
const ManageTables = ({ branchId = '', branches = [] }) => {
  const { lang } = useOutletContext();
  const [syncMsg, setSyncMsg] = useState('');
  const branchName = (() => {
    const b = branches.find(x => String(x.id) === String(branchId));
    return b ? (b.name || b.id) : branchId;
  })();
  const [tables, setTables] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  
  // Modal form states
  const [tableName, setTableName] = useState('');
  const [tableZone, setTableZone] = useState('DineIn');
  const [priceTier, setPriceTier] = useState('normal');
  const [seats, setSeats] = useState(4);

  // QR Code preview modal state
  const [qrModalTable, setQrModalTable] = useState(null);
  const [qrUrl, setQrUrl] = useState('');

  // บันทึกผังโต๊ะขึ้นเซิร์ฟเวอร์ — ทุกเครื่องของสาขาเดียวกันจะได้ผังเดียวกัน
  const pushTables = async (list) => {
    if (!branchId) return;
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveBranchTables', branchId, tables: list })
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      try {
        const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
        d.branchTables = { ...(d.branchTables || {}), [branchId]: list };
        localStorage.setItem('gas_all_data', JSON.stringify(d));
      } catch {}
      setSyncMsg('');
    } catch (e) {
      setSyncMsg(`⚠️ บันทึกผังโต๊ะขึ้นระบบไม่สำเร็จ (${e.message || e}) — เครื่องอื่นจะยังเห็นผังเดิม`);
    }
  };

  useEffect(() => {
    const fromServer = serverTablesFor(branchId);
    if (fromServer) {
      setTables(fromServer);
      localStorage.setItem('pos_tables_config', JSON.stringify(fromServer));
      return;
    }
    let local = null;
    try { local = JSON.parse(localStorage.getItem('pos_tables_config') || 'null'); } catch { local = null; }
    const initial = Array.isArray(local) && local.length > 0 ? local : DEFAULT_TABLES;
    setTables(initial);
    localStorage.setItem('pos_tables_config', JSON.stringify(initial));
    // สาขานี้ยังไม่เคยมีผังบนระบบ → ส่งผังที่ใช้อยู่ในเครื่องนี้ขึ้นไปเป็นผังตั้งต้น
    pushTables(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const saveTablesToStorage = (updatedTables) => {
    setTables(updatedTables);
    localStorage.setItem('pos_tables_config', JSON.stringify(updatedTables));
    pushTables(updatedTables);
  };

  const handleOpenAddModal = () => {
    setEditingTable(null);
    setTableName('');
    setTableZone('DineIn');
    setPriceTier('normal');
    setSeats(4);
    setShowModal(true);
  };

  const handleOpenEditModal = (table) => {
    setEditingTable(table);
    setTableName(table.name);
    setTableZone(table.zone || 'DineIn');
    setPriceTier(table.priceTier || 'normal');
    setSeats(table.seats || 4);
    setShowModal(true);
  };

  const handleSaveTable = (e) => {
    e.preventDefault();
    if (!tableName.trim()) return;

    if (editingTable) {
      const updated = tables.map(t => t.id === editingTable.id ? {
        ...t,
        name: tableName.trim(),
        zone: tableZone,
        priceTier,
        seats: Number(seats) || 0
      } : t);
      saveTablesToStorage(updated);
    } else {
      const newTable = {
        id: 'tb_' + Date.now(),
        name: tableName.trim(),
        zone: tableZone,
        priceTier,
        seats: Number(seats) || 0,
        active: true
      };
      saveTablesToStorage([...tables, newTable]);
    }

    setShowModal(false);
  };

  const handleDeleteTable = (id, name) => {
    if (window.confirm(lang === 'th' ? `ลบโต๊ะ "${name}" หรือไม่?` : `Delete table "${name}"?`)) {
      saveTablesToStorage(tables.filter(t => t.id !== id));
    }
  };

  const handleToggleActive = (id) => {
    saveTablesToStorage(tables.map(t => t.id === id ? { ...t, active: !t.active } : t));
  };

  const handleGenerateQR = (table) => {
    setQrModalTable(table);
    const host = window.location.host;
    const protocol = window.location.protocol;
    // ?b= = สาขาของโต๊ะนี้ ออเดอร์ที่ลูกค้าสั่งเองจะเข้าโต๊ะของสาขานี้ (QR เก่าที่ไม่มี b ยังใช้ได้ — ลงสาขาหลัก)
    const branchQs = branchId ? `&b=${encodeURIComponent(branchId)}` : '';
    const kioskLink = `${protocol}//${host}/kiosk?table=${encodeURIComponent(table.name)}${branchQs}`;

    QRCode.toDataURL(kioskLink, { width: 300, margin: 2, errorCorrectionLevel: 'H' })
      .then(url => setQrUrl(url))
      .catch(err => console.error('Failed to generate QR Code:', err));
  };

  const getPriceTierLabel = (tier) => {
    switch (tier) {
      case 'takehome': return { name: '🛍️ TAKEHOME', color: '#0284c7', bg: '#e0f2fe' };
      case 'deli': return { name: '🛵 DELI / เดลิเวอรี่', color: '#16a34a', bg: '#dcfce7' };
      case 'vip': return { name: '⭐ ราคาพิเศษ VIP', color: '#7c3aed', bg: '#f3e8ff' };
      default: return { name: '🪑 ราคาปกติ (ทานที่ร้าน)', color: '#ea580c', bg: '#ffedd5' };
    }
  };

  const getZoneBadge = (zone) => {
    switch (zone) {
      case 'Takehome': return { label: 'กลับบ้าน (Takehome)', color: '#0284c7' };
      case 'Delivery': return { label: 'เดลิเวอรี่ (Delivery)', color: '#16a34a' };
      case 'VIP': return { label: 'โซน VIP', color: '#7c3aed' };
      default: return { label: 'ทานที่ร้าน (Dine-in)', color: '#ea580c' };
    }
  };

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutGrid color="#ea580c" size={28} />
            {lang === 'th' ? 'จัดการโต๊ะ & ราคาที่แสดง' : 'Manage Tables & Price Tiers'}
          </h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {lang === 'th' ? 'เพิ่ม/แก้ไขหมายเลขโต๊ะ กำหนดประเภทราคาขายประจำโต๊ะ และสร้าง QR Code สำหรับสั่งอาหารด้วยตนเอง' : 'Configure table numbers, default display price tiers, and generate self-ordering QR stickers.'}
          </p>
          {branchId && (
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
              🏠 {lang === 'th' ? `ผังโต๊ะของสาขา: ${branchName}` : `Branch: ${branchName}`}
            </p>
          )}
          {syncMsg && (
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.82rem', color: '#b91c1c' }}>{syncMsg}</p>
          )}
        </div>

        <button
          onClick={handleOpenAddModal}
          className="admin-btn primary"
          style={{ padding: '0.65rem 1.2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '10px' }}
        >
          <Plus size={18} />
          {lang === 'th' ? '+ เพิ่มโต๊ะใหม่' : '+ Add New Table'}
        </button>
      </div>

      {/* Grid of Tables */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
        {tables.map(table => {
          const tierInfo = getPriceTierLabel(table.priceTier);
          const zoneInfo = getZoneBadge(table.zone);

          return (
            <div
              key={table.id}
              style={{
                background: 'var(--bg-card)',
                border: `2px solid ${table.active ? '#cbd5e1' : '#f1f5f9'}`,
                borderRadius: '16px', padding: '1.25rem',
                opacity: table.active ? 1 : 0.6,
                boxShadow: '0 4px 15px rgba(0,0,0,0.03)',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                position: 'relative'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: zoneInfo.color, textTransform: 'uppercase' }}>
                      {zoneInfo.label}
                    </span>
                    <h3 style={{ fontSize: '1.35rem', fontWeight: '900', margin: '0.15rem 0 0 0', color: 'var(--text-main)' }}>
                      {isNaN(table.name) ? table.name : `${lang === 'th' ? 'โต๊ะ' : 'Table'} ${table.name}`}
                    </h3>
                  </div>

                  <button
                    onClick={() => handleToggleActive(table.id)}
                    style={{
                      background: table.active ? '#dcfce7' : '#fee2e2',
                      color: table.active ? '#15803d' : '#b91c1c',
                      border: 'none', borderRadius: '20px', padding: '0.25rem 0.65rem',
                      fontWeight: '800', fontSize: '0.75rem', cursor: 'pointer'
                    }}
                  >
                    {table.active ? (lang === 'th' ? 'เปิดใช้งาน' : 'Active') : (lang === 'th' ? 'ปิดใช้งาน' : 'Disabled')}
                  </button>
                </div>

                {/* Price Tier Badge */}
                <div style={{
                  background: tierInfo.bg, color: tierInfo.color,
                  padding: '0.5rem 0.75rem', borderRadius: '10px',
                  fontWeight: '800', fontSize: '0.85rem', marginBottom: '1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                  <span>{lang === 'th' ? 'ราคาที่แสดง:' : 'Display Price:'}</span>
                  <span>{tierInfo.name}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                <button
                  onClick={() => handleGenerateQR(table)}
                  style={{
                    flex: 1, background: '#0f172a', color: '#ffffff',
                    border: 'none', borderRadius: '8px', padding: '0.45rem',
                    fontWeight: '700', fontSize: '0.82rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                  }}
                  title={lang === 'th' ? 'สร้าง QR สั่งเองสำหรับโต๊ะนี้' : 'Generate Self-Order QR'}
                >
                  <QrCode size={14} />
                  <span>QR โต๊ะ</span>
                </button>

                <button
                  onClick={() => handleOpenEditModal(table)}
                  style={{
                    background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1',
                    borderRadius: '8px', padding: '0.45rem 0.65rem', cursor: 'pointer'
                  }}
                  title={lang === 'th' ? 'แก้ไข' : 'Edit'}
                >
                  <Edit2 size={14} />
                </button>

                <button
                  onClick={() => handleDeleteTable(table.id, table.name)}
                  style={{
                    background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                    borderRadius: '8px', padding: '0.45rem 0.65rem', cursor: 'pointer'
                  }}
                  title={lang === 'th' ? 'ลบ' : 'Delete'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Add/Edit Modal ─── */}
      {showModal && (
        <div className="admin-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="admin-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', borderRadius: '20px' }}>
            <div className="admin-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>
                {editingTable ? (lang === 'th' ? '✏️ แก้ไขข้อมูลโต๊ะ' : 'Edit Table') : (lang === 'th' ? '➕ เพิ่มโต๊ะใหม่' : 'Add New Table')}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveTable} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#0f172a' }}>
                  {lang === 'th' ? 'ชื่อโต๊ะ / หมายเลขโต๊ะ *' : 'Table Name / Number *'}
                </label>
                <input
                  type="text"
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น 1, 2, VIP 1, Takehome 1' : 'e.g. 1, 2, VIP 1'}
                  required
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1.5px solid #cbd5e1', fontSize: '0.95rem', fontWeight: '700' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#0f172a' }}>
                  {lang === 'th' ? 'โซน / ประเภทโต๊ะ' : 'Table Zone'}
                </label>
                <select
                  value={tableZone}
                  onChange={e => setTableZone(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1.5px solid #cbd5e1', fontSize: '0.95rem', fontWeight: '700', background: 'white' }}
                >
                  <option value="DineIn">🪑 ทานที่ร้าน (Dine-in)</option>
                  <option value="Takehome">🛍️ สั่งกลับบ้าน (Takehome)</option>
                  <option value="Delivery">🛵 เดลิเวอรี่ (Delivery)</option>
                  <option value="VIP">⭐ โซนพิเศษ (VIP)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#0f172a' }}>
                  {lang === 'th' ? 'ราคาขายที่แสดงประจำโต๊ะนี้ (Display Price Tier) *' : 'Assigned Price Tier *'}
                </label>
                <select
                  value={priceTier}
                  onChange={e => setPriceTier(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '2px solid #ea580c', fontSize: '0.95rem', fontWeight: '800', background: '#fff7ed', color: '#c2410c' }}
                >
                  <option value="normal">🪑 ราคาขายปกติ (Normal Price)</option>
                  <option value="takehome">🛍️ ราคา TAKEHOME</option>
                  <option value="deli">🛵 ราคา DELI / Delivery</option>
                  <option value="vip">⭐ ราคาพิเศษ / VIP Discount</option>
                </select>
                <span style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                  {lang === 'th' ? 'เมนูอาหารของโต๊ะนี้จะแสดงราคาตามประเภทราคาที่เลือกไว้โดยอัตโนมัติ' : 'Menu items for this table will automatically display the selected price tier.'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowModal(false)} className="admin-btn secondary" style={{ flex: 1 }}>
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button type="submit" className="admin-btn primary" style={{ flex: 1, fontWeight: '800' }}>
                  {lang === 'th' ? 'บันทึก' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── QR Code Sticker Modal ─── */}
      {qrModalTable && (
        <div className="admin-modal-overlay" onClick={() => setQrModalTable(null)}>
          <div className="admin-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px', borderRadius: '24px', textAlign: 'center', padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: '800', color: '#ea580c' }}>QR Self-Ordering Sticker</span>
              <button onClick={() => setQrModalTable(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <div id="table-qr-sticker" style={{ background: '#ffffff', border: '2px solid #0f172a', borderRadius: '20px', padding: '1.25rem', boxShadow: '0 8px 25px rgba(0,0,0,0.08)' }}>
              <img src="/logo.png" alt="Logo" style={{ width: '48px', height: '48px', borderRadius: '12px', marginBottom: '0.5rem' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: '900', margin: '0 0 0.15rem 0', color: '#0f172a' }}>เสน่ห์</h3>
              <div style={{ fontSize: '1.25rem', fontWeight: '900', color: '#ea580c', margin: '0.25rem 0 0.75rem 0' }}>
                {lang === 'th' ? `โต๊ะ ${qrModalTable.name}` : `Table ${qrModalTable.name}`}
              </div>

              {qrUrl ? (
                <img src={qrUrl} alt="Table QR" style={{ width: '200px', height: '200px', margin: '0 auto', display: 'block' }} />
              ) : (
                <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>กำลังสร้าง QR...</div>
              )}

              <p style={{ fontSize: '0.8rem', color: '#475569', fontWeight: '700', marginTop: '0.75rem', marginBottom: 0 }}>
                📱 สแกน QR เพื่อสั่งอาหาร & ชำระเงินง่ายๆ ได้ด้วยตนเอง
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => window.print()}
                className="admin-btn primary"
                style={{ flex: 1, fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <Printer size={16} /> {lang === 'th' ? 'พิมพ์สติกเกอร์' : 'Print Sticker'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageTables;
