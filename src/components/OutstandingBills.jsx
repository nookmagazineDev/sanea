import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, RefreshCw, ReceiptText, ChevronDown, ChevronUp, Phone, User, Clock } from 'lucide-react';
import { API_URL } from '../utils/api';

const parseItems = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
  return [];
};

const OutstandingBills = ({ lang = 'th', onBack }) => {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let local = [];
    try { local = JSON.parse(localStorage.getItem('outstanding_bills') || '[]'); } catch {}
    let remote = [];
    try {
      const res = await fetch(`${API_URL}?action=getOutstandingBills`);
      const data = await res.json();
      if (data.success) remote = data.bills || [];
    } catch (e) {}
    // รวม local + remote, ไม่ซ้ำ id (ให้ remote เป็นหลักถ้ามี)
    const byId = {};
    [...local, ...remote].forEach(b => { if (b && b.id) byId[b.id] = { ...byId[b.id], ...b }; });
    const merged = Object.values(byId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    setBills(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (ts) => {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ts; }
  };

  const grandTotal = bills.reduce((s, b) => s + (Number(b.total) || 0), 0);
  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0f0f0f)', color: 'white', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9rem', padding: 0 }}>
          <ChevronLeft size={20} /> {lang === 'th' ? 'กลับ' : 'Back'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
          <ReceiptText size={24} color="#f1592a" />
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>{lang === 'th' ? 'รายการบิลค้าง' : 'Outstanding Bills'}</h1>
        </div>
        <button onClick={load} disabled={loading} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'white', cursor: 'pointer', padding: '0.5rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {lang === 'th' ? 'รีเฟรช' : 'Refresh'}
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 860, margin: '0 auto' }}>
        {/* Summary */}
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{lang === 'th' ? `บิลค้างทั้งหมด ${bills.length} บิล` : `${bills.length} bills`}</span>
          <span style={{ color: '#f1592a', fontWeight: 900, fontSize: '1.6rem' }}>฿{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.4)' }}>
            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
            <p>{lang === 'th' ? 'กำลังโหลด...' : 'Loading...'}</p>
          </div>
        ) : bills.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', padding: '3rem' }}>
            <ReceiptText size={52} style={{ opacity: 0.2, marginBottom: '1rem' }} />
            <p style={{ color: 'rgba(255,255,255,0.4)', margin: 0 }}>{lang === 'th' ? 'ไม่มีบิลค้าง' : 'No outstanding bills'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {bills.map((b, i) => {
              const items = parseItems(b.items);
              const open = expanded === (b.id || i);
              return (
                <div key={b.id || i} style={card}>
                  <button
                    onClick={() => setExpanded(open ? null : (b.id || i))}
                    style={{ width: '100%', background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '1rem 1.1rem', textAlign: 'left', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '1rem' }}
                  >
                    <div style={{ background: 'rgba(180,83,9,0.18)', border: '1px solid rgba(180,83,9,0.4)', borderRadius: 10, padding: '0.5rem 0.85rem', textAlign: 'center', minWidth: 64 }}>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)' }}>{lang === 'th' ? 'โต๊ะ' : 'Table'}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#f1592a', lineHeight: 1 }}>{b.tableNo}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                        <User size={13} color="rgba(255,255,255,0.5)" /> {b.customerName || (lang === 'th' ? 'ไม่ระบุชื่อ' : 'No name')}
                      </div>
                      {b.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', marginTop: 2 }}>
                          <Phone size={12} /> {b.phone}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', marginTop: 2 }}>
                        <Clock size={12} /> {fmtDate(b.createdAt)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#f1592a', fontWeight: 800, fontSize: '1.1rem' }}>฿{(Number(b.total) || 0).toLocaleString()}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                        {lang === 'th' ? 'ดูรายการ' : 'Details'} {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '0.85rem 1.1rem' }}>
                      {items.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>{lang === 'th' ? 'ไม่มีรายละเอียด' : 'No details'}</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {items.map((it, idx) => {
                            const qty = Number(it.Quantity) || 1;
                            const price = Number(it.ItemPrice) || 0;
                            return (
                              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.88rem' }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ color: 'var(--accent, #f97316)', fontWeight: 700, marginRight: 6 }}>{qty}×</span>
                                  {lang === 'th' ? (it.ItemName || '') : (it.ItemNameEn || it.ItemName || '')}
                                  {it.Options && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', paddingLeft: '1.4rem' }}>{it.Options}</div>}
                                </div>
                                <span style={{ color: 'white', fontWeight: 600, whiteSpace: 'nowrap' }}>฿{(price * qty).toLocaleString()}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default OutstandingBills;
