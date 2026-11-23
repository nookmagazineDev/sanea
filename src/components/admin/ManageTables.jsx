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

// ลิงก์หน้าสั่งอาหารของโต๊ะ — ใช้ที่อยู่ของหน้าที่เปิดอยู่ (เปิดหลังบ้านจากที่อยู่ไหน QR ก็ชี้ที่อยู่นั้น)
// ?b= = สาขาของโต๊ะนี้ ออเดอร์ที่ลูกค้าสั่งเองจะเข้าโต๊ะของสาขานี้ (QR เก่าที่ไม่มี b ยังใช้ได้ — ลงสาขาหลัก)
const kioskLinkFor = (table, branchId) =>
  `${window.location.protocol}//${window.location.host}/kiosk?table=${encodeURIComponent(table.name)}${branchId ? `&b=${encodeURIComponent(branchId)}` : ''}`;
const tableLabel = (name) => (isNaN(name) ? String(name) : `โต๊ะ ${name}`);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// โต๊ะเดลิเวอรี่ (LineMan/Grab ฯลฯ) ไม่มีลูกค้านั่ง ไม่ต้องมี QR
const qrTablesOf = (tables) => tables.filter(t => t.active !== false && t.zone !== 'Delivery');

// พิมพ์สติกเกอร์ QR (โต๊ะเดียวหรือหลายโต๊ะ) ในหน้าต่างใหม่ — กระดาษ A4 แผ่นละ 6 ดวง มีเส้นประให้ตัด
// เปิดหน้าต่างก่อน (ต้องอยู่ในจังหวะกดปุ่ม ไม่งั้นเบราว์เซอร์บล็อก) แล้วค่อยใส่ QR ที่สร้างเสร็จ
async function printQrStickers(list, branchId, branchName = '') {
  const win = window.open('', '_blank');
  if (!win) { window.alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปของเว็บนี้แล้วกดใหม่'); return; }
  win.document.write('<meta charset="utf-8"><p style="font-family:sans-serif">กำลังสร้าง QR...</p>');
  const items = await Promise.all(list.map(async (t) => ({
    t, qr: await QRCode.toDataURL(kioskLinkFor(t, branchId), { width: 600, margin: 2, errorCorrectionLevel: 'H' })
  })));
  const host = window.location.host;
  const cards = items.map(({ t, qr }) => `
    <div class="card"><div class="in">
      <div class="shop">เสน่ห์</div>
      <div class="table">${esc(tableLabel(t.name))}</div>
      <img class="qr" src="${qr}" alt="">
      <div class="cap">📱 สแกน QR เพื่อสั่งอาหาร &amp; ชำระเงินได้ด้วยตนเอง</div>
      <div class="host">${esc(host)}${branchName ? ' · ' + esc(branchName) : ''}</div>
    </div></div>`).join('');
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR โต๊ะ ${esc(branchName)}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; color: #141414; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; }
  .card { height: 93mm; border: 1px dashed #7a7a7a; padding: 3mm; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
  .in { height: 100%; border: 2px solid #141414; border-radius: 5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6mm; text-align: center; padding: 2.5mm 2mm; overflow: hidden; }
  .logo { height: 9mm; max-width: 40mm; object-fit: contain; }
  .shop { font-weight: 900; font-size: 12pt; line-height: 1.15; }
  .table { font-weight: 900; font-size: 19pt; line-height: 1.1; color: #c8102e; }
  .qr { width: 46mm; height: 46mm; }
  .cap { font-size: 8.5pt; line-height: 1.2; font-weight: 700; color: #454545; }
  .host { font-size: 7pt; line-height: 1.2; color: #7a7a7a; }
  .tip { font-size: 10pt; color: #454545; padding: 4mm 0; }
  @media print { .tip { display: none; } }
</style></head><body>
<div class="tip">${items.length} ดวง · กระดาษ A4 แผ่นละ 6 ดวง · ตัดตามเส้นประ · QR ชี้ไปที่ <b>${esc(host)}</b></div>
<div class="grid">${cards}</div>
<script>
  // รอรูปโลโก้/QR โหลดครบก่อนพิมพ์ ไม่งั้นรูปหายในกระดาษ
  const imgs = Array.from(document.images);
  Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 200));
</script></body></html>`);
  win.document.close();
}

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
    const kioskLink = kioskLinkFor(table, branchId);

    QRCode.toDataURL(kioskLink, { width: 300, margin: 2, errorCorrectionLevel: 'H' })
      .then(url => setQrUrl(url))
      .catch(err => console.error('Failed to generate QR Code:', err));
  };

  const getPriceTierLabel = (tier) => {
    switch (tier) {
      case 'takehome': return { name: '🛍️ TAKEHOME', color: '#141414', bg: '#efefef' };
      case 'deli': return { name: '🛵 DELI / เดลิเวอรี่', color: '#16a34a', bg: '#dcfce7' };
      case 'vip': return { name: '⭐ ราคาพิเศษ VIP', color: '#c8102e', bg: '#f1f1f1' };
      default: return { name: '🪑 ราคาปกติ (ทานที่ร้าน)', color: '#c8102e', bg: '#fbe0e4' };
    }
  };

  const getZoneBadge = (zone) => {
    switch (zone) {
      case 'Takehome': return { label: 'กลับบ้าน (Takehome)', color: '#141414' };
      case 'Delivery': return { label: 'เดลิเวอรี่ (Delivery)', color: '#16a34a' };
      case 'VIP': return { label: 'โซน VIP', color: '#c8102e' };
      default: return { label: 'ทานที่ร้าน (Dine-in)', color: '#c8102e' };
    }
  };

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutGrid color="#c8102e" size={28} />
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

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={() => printQrStickers(qrTablesOf(tables), branchId, branchName)}
            disabled={qrTablesOf(tables).length === 0}
            className="admin-btn secondary"
            style={{ padding: '0.65rem 1.2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '10px' }}
            title={lang === 'th' ? 'ทุกโต๊ะที่เปิดใช้งาน ยกเว้นโต๊ะเดลิเวอรี่ · A4 แผ่นละ 6 ดวง' : 'All active tables except delivery · 6 per A4 page'}
          >
            <Printer size={18} />
            {lang === 'th' ? `พิมพ์ QR ทุกโต๊ะ (${qrTablesOf(tables).length})` : `Print all QR (${qrTablesOf(tables).length})`}
          </button>
          <button
            onClick={handleOpenAddModal}
            className="admin-btn primary"
            style={{ padding: '0.65rem 1.2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '10px' }}
          >
            <Plus size={18} />
            {lang === 'th' ? '+ เพิ่มโต๊ะใหม่' : '+ Add New Table'}
          </button>
        </div>
      </div>
      {/vercel\.app$/i.test(window.location.hostname) && (
        <div style={{ background: '#fdf2f4', border: '1px solid #f07a8a', color: '#7a0a1c', borderRadius: 12, padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.88rem', fontWeight: 600 }}>
          {lang === 'th'
            ? `⚠️ ตอนนี้เปิดหลังบ้านจากที่อยู่เดิม (${window.location.host}) — QR ที่พิมพ์จะชี้ไปที่ Vercel · ถ้าจะพิมพ์ QR ชุดใหม่ ให้เปิดหลังบ้านจากที่อยู่ใหม่ของร้านก่อน`
            : `⚠️ You are on the old address (${window.location.host}) — printed QR codes will point to Vercel. Open the admin from the new address to print new QR codes.`}
        </div>
      )}

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
                border: `2px solid ${table.active ? '#d0d0d0' : '#f1f1f1'}`,
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
              <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid #e4e4e4', paddingTop: '0.75rem' }}>
                <button
                  onClick={() => handleGenerateQR(table)}
                  style={{
                    flex: 1, background: '#141414', color: '#ffffff',
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
                    background: '#f1f1f1', color: '#141414', border: '1px solid #d0d0d0',
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
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#141414' }}>
                  {lang === 'th' ? 'ชื่อโต๊ะ / หมายเลขโต๊ะ *' : 'Table Name / Number *'}
                </label>
                <input
                  type="text"
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น 1, 2, VIP 1, Takehome 1' : 'e.g. 1, 2, VIP 1'}
                  required
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1.5px solid #d0d0d0', fontSize: '0.95rem', fontWeight: '700' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#141414' }}>
                  {lang === 'th' ? 'โซน / ประเภทโต๊ะ' : 'Table Zone'}
                </label>
                <select
                  value={tableZone}
                  onChange={e => setTableZone(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1.5px solid #d0d0d0', fontSize: '0.95rem', fontWeight: '700', background: 'white' }}
                >
                  <option value="DineIn">🪑 ทานที่ร้าน (Dine-in)</option>
                  <option value="Takehome">🛍️ สั่งกลับบ้าน (Takehome)</option>
                  <option value="Delivery">🛵 เดลิเวอรี่ (Delivery)</option>
                  <option value="VIP">⭐ โซนพิเศษ (VIP)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.88rem', marginBottom: '0.35rem', color: '#141414' }}>
                  {lang === 'th' ? 'ราคาขายที่แสดงประจำโต๊ะนี้ (Display Price Tier) *' : 'Assigned Price Tier *'}
                </label>
                <select
                  value={priceTier}
                  onChange={e => setPriceTier(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '2px solid #c8102e', fontSize: '0.95rem', fontWeight: '800', background: '#fdf2f4', color: '#a50d25' }}
                >
                  <option value="normal">🪑 ราคาขายปกติ (Normal Price)</option>
                  <option value="takehome">🛍️ ราคา TAKEHOME</option>
                  <option value="deli">🛵 ราคา DELI / Delivery</option>
                  <option value="vip">⭐ ราคาพิเศษ / VIP Discount</option>
                </select>
                <span style={{ fontSize: '0.78rem', color: '#5a5a5a', marginTop: '0.25rem', display: 'block' }}>
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
              <span style={{ fontSize: '0.9rem', fontWeight: '800', color: '#c8102e' }}>QR Self-Ordering Sticker</span>
              <button onClick={() => setQrModalTable(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <div id="table-qr-sticker" style={{ background: '#ffffff', border: '2px solid #141414', borderRadius: '20px', padding: '1.25rem', boxShadow: '0 8px 25px rgba(0,0,0,0.08)' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '900', margin: '0 0 0.15rem 0', color: '#141414' }}>เสน่ห์</h3>
              <div style={{ fontSize: '1.25rem', fontWeight: '900', color: '#c8102e', margin: '0.25rem 0 0.75rem 0' }}>
                {lang === 'th' ? `โต๊ะ ${qrModalTable.name}` : `Table ${qrModalTable.name}`}
              </div>

              {qrUrl ? (
                <img src={qrUrl} alt="Table QR" style={{ width: '200px', height: '200px', margin: '0 auto', display: 'block' }} />
              ) : (
                <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>กำลังสร้าง QR...</div>
              )}

              <p style={{ fontSize: '0.8rem', color: '#454545', fontWeight: '700', marginTop: '0.75rem', marginBottom: 0 }}>
                📱 สแกน QR เพื่อสั่งอาหาร & ชำระเงินง่ายๆ ได้ด้วยตนเอง
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => printQrStickers([qrModalTable], branchId, branchName)}
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
