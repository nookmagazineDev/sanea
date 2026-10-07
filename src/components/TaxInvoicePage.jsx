import React, { useState, useEffect, useCallback } from 'react';
import { X, FileText, RefreshCw, Search, Trash2, Save } from 'lucide-react';
import { API_URL } from '../utils/api';
import TaxInvoiceModal from './admin/TaxInvoiceModal';

// ── หน้าใบกำกับภาษี (เปิดจากหน้าขาย > เพิ่มเติม) ──
// แท็บ: บิลที่ขายแล้ว (ออกใบ) / ใบกำกับที่ออกแล้ว (พิมพ์ซ้ำ/ยกเลิก) / ลูกค้า (แก้ไข/ลบ)
// ใช้ข้อมูลและหน้าต่างออกใบชุดเดียวกับหลังบ้าน > รายงาน > รายงานยอดขาย

const ymd = (d) => {
  const t = new Date(d.getTime() + 7 * 3600 * 1000); // วันที่ตามเวลาไทย
  return t.toISOString().slice(0, 10);
};
const todayStr = () => ymd(new Date());
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

const fmt = (n) => (Number(n) || 0).toLocaleString('th-TH');
const timeOf = (ts) => {
  try {
    return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  } catch { return String(ts || ''); }
};
const isHQ = (b) => !b || b === 'สำนักงานใหญ่' || /^0+$/.test(String(b));

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 900, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2vh 1rem', overflowY: 'auto' };
const panel = { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 960, padding: '1.1rem 1.25rem', color: '#0f172a', fontFamily: 'inherit', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' };
const chip = (on) => ({ padding: '0.4rem 0.85rem', borderRadius: 999, border: `1px solid ${on ? '#eab308' : '#cbd5e1'}`, background: on ? '#fef9c3' : '#fff', fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', color: '#0f172a' });
const tabBtn = (on) => ({ padding: '0.55rem 0.9rem', border: 'none', borderBottom: `3px solid ${on ? '#16a34a' : 'transparent'}`, background: 'none', fontWeight: on ? 700 : 500, color: on ? '#0f172a' : '#64748b', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.92rem' });
const th = { textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', padding: '0.5rem', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '0.55rem 0.5rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem', verticalAlign: 'middle' };
const input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', fontSize: '0.85rem' };

const PayBadge = ({ method }) => {
  const m = String(method || '').toLowerCase();
  if (!m || m === '—') return <span style={{ color: '#94a3b8' }}>—</span>;
  const [c, bg] = m.includes('สด') ? ['#16a34a', '#dcfce7'] : (m.includes('โอน') || m.includes('qr')) ? ['#0284c7', '#e0f2fe'] : m.includes('บัตร') ? ['#ea580c', '#ffedd5'] : ['#475569', '#f1f5f9'];
  return <span style={{ padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, color: c, background: bg, whiteSpace: 'nowrap' }}>{method}</span>;
};

export default function TaxInvoicePage({ onClose, isAdmin = false, userName = '', branchId = '' }) {
  const [tab, setTab] = useState('bills');
  const [range, setRange] = useState({ key: 'today', from: todayStr(), to: todayStr() });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bills, setBills] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [modalOrder, setModalOrder] = useState(null);
  const [editing, setEditing] = useState(null); // ลูกค้าที่กำลังแก้
  const [msg, setMsg] = useState('');

  const getJson = async (qs) => {
    const res = await fetch(`${API_URL}?${qs}`);
    return res.json();
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [report, inv, cust] = await Promise.all([
        getJson(`action=getReportData&from=${range.from}&to=${range.to}`),
        getJson('action=getTaxInvoices').catch(() => null),
        getJson('action=getTaxCustomers').catch(() => null)
      ]);
      if (!report || !report.success) throw new Error('โหลดรายการบิลไม่สำเร็จ');
      // บิลที่ชำระแล้ว: สถานะ completed หรือมีรายการชำระเงิน (บิลลูกค้าสั่งเอง/QR จ่ายแล้วแต่ครัวยังทำอยู่)
      const payMap = {};
      (report.payments || []).forEach(p => { payMap[p.orderNumber] = p; });
      const map = {};
      (report.orders || []).forEach(r => {
        const no = r.OrderNumber;
        if (!no || String(r.Status || '').toLowerCase() === 'cancelled') return;
        if (branchId && r.BranchId && String(r.BranchId) !== String(branchId)) return;
        const paid = String(r.Status || '').toLowerCase() === 'completed' || !!payMap[no];
        if (!paid) return;
        if (!map[no]) {
          map[no] = { orderNumber: no, customerName: r.CustomerName, total: Number(r.TotalAmount) || 0, timestamp: r.Timestamp, paymentMethod: payMap[no]?.paymentMethod || '—' };
        }
      });
      setBills(Object.values(map).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      setInvoices(inv && inv.success && Array.isArray(inv.invoices) ? inv.invoices : []);
      setCustomers(cust && cust.success && Array.isArray(cust.customers) ? cust.customers : []);
    } catch (e) {
      setError(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
    setLoading(false);
  }, [range.from, range.to, branchId]);

  useEffect(() => { load(); }, [load]);

  // ใบกำกับของแต่ละบิล: ใบที่ยังใช้อยู่ก่อน
  const invoiceByOrder = {};
  invoices.forEach(inv => {
    const cur = invoiceByOrder[inv.orderNumber];
    if (!cur || (cur.cancelled && !inv.cancelled)) invoiceByOrder[inv.orderNumber] = inv;
  });
  const updateInvoice = (inv) => {
    setInvoices(prev => [inv, ...prev.filter(x => x.invoiceNo !== inv.invoiceNo)]);
    // ออกใบใหม่ = ลูกค้าถูกบันทึก/อัปเดตที่เซิร์ฟเวอร์แล้ว → โหลดรายชื่อใหม่
    getJson('action=getTaxCustomers').then(j => { if (j && j.success) setCustomers(j.customers || []); }).catch(() => {});
  };

  const q = search.trim().toLowerCase();
  const has = (...vals) => !q || vals.some(v => String(v || '').toLowerCase().includes(q));

  const shownBills = bills.filter(b => {
    const inv = invoiceByOrder[b.orderNumber];
    return has(b.orderNumber, b.customerName, inv && !inv.cancelled ? inv.buyer.name : '', inv && !inv.cancelled ? inv.invoiceNo : '');
  });
  const inRange = (iso) => { const d = String(iso || '').slice(0, 10); return d >= range.from && d <= range.to; };
  const shownInvoices = invoices.filter(inv => inRange(inv.issuedAt) && (!branchId || !inv.branchId || String(inv.branchId) === String(branchId))
    && has(inv.invoiceNo, inv.orderNumber, inv.buyer.name, inv.buyer.taxId));
  const shownCustomers = customers.filter(c => has(c.name, c.taxId, c.address, c.phone));

  const post = async (body) => {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!json || json.success !== true) throw new Error((json && json.error) || 'ไม่สำเร็จ');
    return json;
  };

  const saveCustomer = async () => {
    setMsg('');
    try {
      await post({ action: 'saveTaxCustomer', customer: editing });
      setCustomers(prev => prev.map(c => (c.taxId === editing.taxId && c.branch === editing.branch ? { ...c, ...editing } : c)));
      setEditing(null);
      setMsg('✅ บันทึกข้อมูลลูกค้าแล้ว');
    } catch (e) { setMsg(`❌ ${e.message}`); }
  };
  const deleteCustomer = async (c) => {
    if (!window.confirm(`ลบลูกค้า "${c.name}" ออกจากรายชื่อ?\n(ใบกำกับที่เคยออกไปแล้วไม่หาย)`)) return;
    setMsg('');
    try {
      await post({ action: 'deleteTaxCustomer', taxId: c.taxId, branch: c.branch });
      setCustomers(prev => prev.filter(x => !(x.taxId === c.taxId && x.branch === c.branch)));
    } catch (e) { setMsg(`❌ ${e.message}`); }
  };

  const setPreset = (key) => {
    if (key === 'today') setRange({ key, from: todayStr(), to: todayStr() });
    if (key === 'yesterday') setRange({ key, from: daysAgo(1), to: daysAgo(1) });
    if (key === '7d') setRange({ key, from: daysAgo(6), to: todayStr() });
  };

  const invoiceButton = (bill) => {
    const inv = invoiceByOrder[bill.orderNumber];
    const active = inv && !inv.cancelled;
    return (
      <button onClick={() => setModalOrder(bill)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.35rem 0.7rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap',
          border: `1px solid ${active ? '#86efac' : '#cbd5e1'}`, background: active ? '#dcfce7' : '#fff', color: active ? '#15803d' : '#0f172a' }}>
        {active ? <>✓ {inv.invoiceNo}</> : <><FileText size={14} /> ออกใบกำกับภาษี</>}
      </button>
    );
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🧾 ใบกำกับภาษี</h2>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button onClick={load} disabled={loading} title="โหลดใหม่" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
              <RefreshCw size={18} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={24} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.9rem 0 0.6rem' }}>
          <button style={chip(range.key === 'today')} onClick={() => setPreset('today')}>วันนี้</button>
          <button style={chip(range.key === 'yesterday')} onClick={() => setPreset('yesterday')}>เมื่อวาน</button>
          <button style={chip(range.key === '7d')} onClick={() => setPreset('7d')}>7 วัน</button>
          <input type="date" value={range.from} max={todayStr()}
            onChange={e => e.target.value && setRange({ key: 'pick', from: e.target.value, to: e.target.value })}
            style={{ ...chip(range.key === 'pick'), padding: '0.32rem 0.6rem' }} />
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเลขบิล / โต๊ะ / ชื่อลูกค้า / เลขผู้เสียภาษี"
              style={{ ...input, paddingLeft: 32, padding: '0.5rem 0.7rem 0.5rem 32px' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e2e8f0', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <button style={tabBtn(tab === 'bills')} onClick={() => setTab('bills')}>บิลที่ขายแล้ว ({shownBills.length})</button>
          <button style={tabBtn(tab === 'invoices')} onClick={() => setTab('invoices')}>ใบกำกับที่ออกแล้ว ({shownInvoices.length})</button>
          <button style={tabBtn(tab === 'customers')} onClick={() => setTab('customers')}>ลูกค้า ({shownCustomers.length})</button>
        </div>

        {error && <div style={{ color: '#dc2626', fontWeight: 600, margin: '0.5rem 0' }}>{error}</div>}
        {msg && <div style={{ color: msg.startsWith('❌') ? '#dc2626' : '#15803d', fontWeight: 600, margin: '0.5rem 0' }}>{msg}</div>}
        {loading && <div style={{ color: '#64748b', padding: '1rem 0' }}>กำลังโหลด...</div>}

        {!loading && tab === 'bills' && (
          shownBills.length === 0 ? <Empty text="ไม่มีบิลในช่วงวันที่เลือก" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>เวลา</th><th style={th}>เลขบิล</th><th style={th}>โต๊ะ</th><th style={th}>ยอดรวม</th><th style={th}>ชำระ</th><th style={th}>ใบกำกับภาษี</th></tr></thead>
                <tbody>
                  {shownBills.map(b => (
                    <tr key={b.orderNumber}>
                      <td style={{ ...td, color: '#64748b', whiteSpace: 'nowrap' }}>{timeOf(b.timestamp)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{b.orderNumber}</td>
                      <td style={td}>{b.customerName || '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>฿{fmt(b.total)}</td>
                      <td style={td}><PayBadge method={b.paymentMethod} /></td>
                      <td style={td}>{invoiceButton(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && tab === 'invoices' && (
          shownInvoices.length === 0 ? <Empty text="ยังไม่มีใบกำกับภาษีในช่วงวันที่เลือก" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>วันที่ออก</th><th style={th}>เลขที่</th><th style={th}>บิล</th><th style={th}>ลูกค้า</th><th style={th}>ยอดรวม</th><th style={th}></th></tr></thead>
                <tbody>
                  {shownInvoices.map(inv => (
                    <tr key={inv.invoiceNo} style={{ opacity: inv.cancelled ? 0.55 : 1 }}>
                      <td style={{ ...td, color: '#64748b', whiteSpace: 'nowrap' }}>{timeOf(inv.issuedAt)}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {inv.invoiceNo}
                        {inv.cancelled && <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 700 }}>ยกเลิกแล้ว</div>}
                      </td>
                      <td style={td}>{inv.orderNumber}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{inv.buyer.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{inv.buyer.taxId}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>฿{fmt(inv.total)}</td>
                      <td style={td}>
                        <button onClick={() => setModalOrder({ orderNumber: inv.orderNumber, total: inv.total, customerName: '' })}
                          style={{ padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 700 }}>
                          {inv.cancelled ? 'ดู / ออกใหม่' : 'พิมพ์ / จัดการ'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && tab === 'customers' && (
          shownCustomers.length === 0 ? <Empty text="ยังไม่มีลูกค้า — ลูกค้าจะถูกบันทึกเองเมื่อออกใบกำกับภาษีครั้งแรก" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>ลูกค้า</th><th style={th}>เลขผู้เสียภาษี</th><th style={th}>ที่อยู่</th><th style={th}>ใช้</th><th style={th}></th></tr></thead>
                <tbody>
                  {shownCustomers.map(c => {
                    const isEditing = editing && editing.taxId === c.taxId && editing.branch === c.branch;
                    if (isEditing) {
                      return (
                        <tr key={`${c.taxId}-${c.branch}`} style={{ background: '#f8fafc' }}>
                          <td style={td}>
                            <input style={input} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                            <input style={{ ...input, marginTop: 4 }} value={editing.phone} placeholder="เบอร์โทร" onChange={e => setEditing({ ...editing, phone: e.target.value })} />
                          </td>
                          <td style={td}>{c.taxId}<div style={{ fontSize: '0.75rem', color: '#64748b' }}>{isHQ(c.branch) ? 'สำนักงานใหญ่' : `สาขา ${c.branch}`}</div></td>
                          <td style={td}><textarea style={{ ...input, minHeight: 56 }} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} /></td>
                          <td style={td}>{c.useCount}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            <button onClick={saveCustomer} style={{ padding: '0.35rem 0.6rem', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, marginRight: 4 }}><Save size={14} /></button>
                            <button onClick={() => setEditing(null)} style={{ padding: '0.35rem 0.6rem', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}><X size={14} /></button>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`${c.taxId}-${c.branch}`}>
                        <td style={td}><div style={{ fontWeight: 700 }}>{c.name}</div>{c.phone && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>☎ {c.phone}</div>}</td>
                        <td style={td}>{c.taxId}<div style={{ fontSize: '0.75rem', color: '#64748b' }}>{isHQ(c.branch) ? 'สำนักงานใหญ่' : `สาขา ${c.branch}`}</div></td>
                        <td style={{ ...td, fontSize: '0.8rem', color: '#475569', maxWidth: 320 }}>{c.address}</td>
                        <td style={td}>{c.useCount} ครั้ง</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setMsg(''); setEditing({ taxId: c.taxId, branch: c.branch, name: c.name, address: c.address, phone: c.phone || '' }); }}
                            style={{ padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 700, marginRight: 4 }}>แก้ไข</button>
                          {isAdmin && (
                            <button onClick={() => deleteCustomer(c)} title="ลบ" style={{ padding: '0.35rem 0.5rem', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', cursor: 'pointer' }}><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {modalOrder && (
        <div onClick={e => e.stopPropagation()}>
          <TaxInvoiceModal
            order={modalOrder}
            invoice={invoiceByOrder[modalOrder.orderNumber] || null}
            canCancel={isAdmin}
            userName={userName}
            onChanged={updateInvoice}
            onClose={() => setModalOrder(null)}
          />
        </div>
      )}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2.5rem 1rem' }}>{text}</div>;
}
