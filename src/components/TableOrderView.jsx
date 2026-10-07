import React, { useMemo, useState } from 'react';
import { ShoppingBag, Plus, CreditCard, Trash2, ChevronLeft, RefreshCw, Split, AlertTriangle, LayoutGrid, CheckCircle2 } from 'lucide-react';
import { readTablesConfig, saleTypesForTable } from '../utils/salePricing';

const calcCharges = (subtotal, settings = {}) => {
  const scRate = settings?.serviceCharge?.enabled ? (settings.serviceCharge.rate || 0) : 0;
  const vatRate = settings?.vat?.enabled ? (settings.vat.rate || 0) : 0;
  const sc = Math.round(subtotal * scRate) / 100;
  const vatBase = subtotal + sc;
  const vat = Math.round(vatBase * vatRate) / 100;
  return { sc, vat, grand: subtotal + sc + vat };
};

const TableOrderView = ({
  tableNumber,
  tableOrders,
  lang = 'th',
  onAddMore,
  onCheckout,
  onDeleteItem,
  onBack,
  onSelectTable,
  onRefresh,
  isRefreshing,
  onMoveMerge,
  currentUser,
  settings = {},
  customerType = '',
  setCustomerType,
  customerName = '',
  setCustomerName,
  onCloseTable
}) => {
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState(''); // 'move' | 'merge' | 'split'
  const [targetTable, setTargetTable] = useState('');
  const [confirmStage, setConfirmStage] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState([]);
  
  // ประเภทการขายที่โต๊ะนี้ใช้ได้ — ล็อกตาม priceTier ที่ตั้งไว้หลังบ้าน เหมือนหน้าขาย
  const saleTypeOptions = useMemo(
    () => saleTypesForTable(tableNumber, readTablesConfig()),
    [tableNumber]
  );
  const saleTypeLocked = !!tableNumber && saleTypeOptions.length === 1;

  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [currentCount, setCurrentCount] = useState(() => localStorage.getItem('customer_count_' + tableNumber) || '');
  const [editCustomerCount, setEditCustomerCount] = useState(1);

  // Group items for display
  const rowsOfTable = (tableOrders || []).filter(o => String(o.TableNumber) === String(tableNumber));
  // รายการที่ยังต้องเก็บเงิน (พนักงานรับออเดอร์ให้)
  const pendingItems = rowsOfTable.filter(o => o.Status !== 'paid');
  // รายการที่ลูกค้าสแกน QR สั่งเองและโอนเงินมาแล้ว — โชว์ให้พนักงานเห็นว่าโต๊ะนี้สั่งอะไรไว้
  // แต่ห้ามเอาไปรวมยอดที่ต้องเก็บ ไม่งั้นลูกค้าโดนเก็บเงินซ้ำ
  const paidItems = rowsOfTable.filter(o => o.Status === 'paid');

  const sumRows = (rows) => rows.reduce((sum, item) => sum + (Number(item.ItemPrice) || 0) * (Number(item.Quantity) || 1), 0);
  const totalAmount = sumRows(pendingItems);
  const paidTotal = sumRows(paidItems);

  const { sc, vat, grand } = calcCharges(totalAmount, settings);

  const toggleSelect = (idx) => {
    setSelectedIdx(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]);
  };
  const allSelected = pendingItems.length > 0 && selectedIdx.length === pendingItems.length;
  const toggleSelectAll = () => {
    setSelectedIdx(allSelected ? [] : pendingItems.map((_, i) => i));
  };

  const openAction = (type) => {
    setActionType(type);
    setTargetTable('');
    setConfirmStage(false);
    setShowActionModal(true);
  };
  const closeAction = () => {
    setShowActionModal(false);
    setConfirmStage(false);
  };

  const actingItems = selectedIdx.length > 0 ? selectedIdx.map(i => pendingItems[i]).filter(Boolean) : pendingItems;
  const actingIsAll = selectedIdx.length === 0 || selectedIdx.length === pendingItems.length;

  const actionLabel = (type) => {
    if (type === 'move') return lang === 'th' ? 'ย้ายโต๊ะ' : 'Move';
    if (type === 'merge') return lang === 'th' ? 'รวมโต๊ะ' : 'Merge';
    return lang === 'th' ? 'แยกโต๊ะ' : 'Split';
  };

  const runTableAction = () => {
    if (!targetTable || targetTable === String(tableNumber)) return;
    onMoveMerge(tableNumber, targetTable, actionType === 'merge', actingItems, actingIsAll);
    closeAction();
    setSelectedIdx([]);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-dark, #fcfbf7)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Header Bar */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '0.9rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxShadow: '0 4px 15px rgba(0,0,0,0.15)'
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '10px',
            color: '#ffffff',
            padding: '0.5rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            transition: 'background 0.2s'
          }}
          title={lang === 'th' ? 'กลับไปหน้าสั่งอาหาร' : 'Back to Food Menu'}
        >
          <ChevronLeft size={22} />
        </button>
        {onSelectTable && (
          <button
            onClick={onSelectTable}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '10px',
              color: '#ffffff',
              padding: '0.45rem 0.75rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontWeight: '700',
              fontSize: '0.85rem'
            }}
            title={lang === 'th' ? 'กลับไปหน้าเลือกโต๊ะ' : 'Back to Table Selection'}
          >
            <LayoutGrid size={16} color="#facc15" />
            <span>{lang === 'th' ? 'เลือกโต๊ะ' : 'Tables'}</span>
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {lang === 'th' ? 'สรุปบิล' : 'Bill Summary'}
              {currentCount && (
                <span 
                  onClick={() => {
                    setEditCustomerCount(parseInt(currentCount, 10) || 1);
                    setShowEditCustomerModal(true);
                  }}
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    color: '#fef08a',
                    background: 'rgba(245,158,11,0.25)',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    border: '1px solid rgba(245,158,11,0.5)'
                  }}
                >
                  ({currentCount} {lang === 'th' ? 'ท่าน' : 'pax'})
                </span>
              )}
            </h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => openAction('move')}
                disabled={rowsOfTable.length === 0}
                style={{
                  background: 'rgba(56,189,248,0.2)',
                  border: '1px solid rgba(56,189,248,0.4)',
                  borderRadius: '6px',
                  color: '#38bdf8',
                  padding: '3px 10px',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  cursor: rowsOfTable.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: rowsOfTable.length === 0 ? 0.4 : 1
                }}
              >
                {lang === 'th' ? 'ย้ายโต๊ะ' : 'Move'}
              </button>
              <button
                onClick={() => openAction('merge')}
                disabled={rowsOfTable.length === 0}
                style={{
                  background: 'rgba(52,211,153,0.2)',
                  border: '1px solid rgba(52,211,153,0.4)',
                  borderRadius: '6px',
                  color: '#34d399',
                  padding: '3px 10px',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  cursor: rowsOfTable.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: rowsOfTable.length === 0 ? 0.4 : 1
                }}
              >
                {lang === 'th' ? 'รวมโต๊ะ' : 'Merge'}
              </button>
              <button
                onClick={() => openAction('split')}
                disabled={rowsOfTable.length === 0}
                style={{
                  background: 'rgba(192,132,252,0.2)',
                  border: '1px solid rgba(192,132,252,0.4)',
                  borderRadius: '6px',
                  color: '#c084fc',
                  padding: '3px 10px',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  cursor: rowsOfTable.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: rowsOfTable.length === 0 ? 0.4 : 1,
                  display: 'flex', alignItems: 'center', gap: '3px'
                }}
              >
                <Split size={13} /> {lang === 'th' ? 'แยกโต๊ะ' : 'Split'}
              </button>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', marginTop: '2px' }}>
            {lang === 'th'
              ? `${rowsOfTable.length} รายการ${paidItems.length > 0 ? ` (จ่ายแล้ว ${paidItems.length})` : ''}`
              : `${rowsOfTable.length} items${paidItems.length > 0 ? ` (${paidItems.length} paid)` : ''}`}
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '10px',
            color: '#ffffff',
            padding: '0.5rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            opacity: isRefreshing ? 0.5 : 1,
            transition: 'all 0.2s'
          }}
        >
          <RefreshCw size={18} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Customer type + name section */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        padding: '0.85rem 1.25rem',
        background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0'
      }}>
        <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap' }}>
          👤 {lang === 'th' ? 'ประเภทลูกค้า' : 'Customer'}
        </span>
        <select
          value={customerType}
          disabled={saleTypeLocked}
          onChange={(e) => setCustomerType && setCustomerType(e.target.value)}
          title={saleTypeLocked
            ? (lang === 'th'
              ? 'ประเภทการขายถูกกำหนดจากโต๊ะที่เลือก แก้ได้ที่หลังบ้าน > จัดการโต๊ะ'
              : 'Sale type comes from the selected table — change it in Admin > Tables')
            : undefined}
          style={{
            padding: '0.5rem 0.75rem', borderRadius: '8px',
            background: saleTypeLocked ? '#f1f5f9' : '#ffffff', color: '#0f172a',
            border: '2px solid #cbd5e1', fontSize: '0.9rem',
            fontWeight: 700, cursor: saleTypeLocked ? 'default' : 'pointer', maxWidth: '240px',
            opacity: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}
        >
          {saleTypeOptions.map(o => (
            <option key={o.value} value={o.value} style={{ color: '#000000', fontWeight: 'bold' }}>
              {lang === 'th' ? o.th : o.en}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName && setCustomerName(e.target.value)}
          placeholder={lang === 'th' ? 'ชื่อลูกค้า (ถ้ามี)' : 'Customer name (optional)'}
          style={{
            padding: '0.5rem 0.75rem', borderRadius: '8px',
            background: '#ffffff', color: '#0f172a',
            border: '2px solid #cbd5e1', fontSize: '0.9rem',
            fontWeight: 600, width: '200px', flexShrink: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}
        />
      </div>

      {/* Order Items List */}
      <div style={{ flex: 1, padding: '1rem 1.25rem', overflowY: 'auto', paddingBottom: '200px' }}>
        {rowsOfTable.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: '4rem',
            color: '#64748b',
            textAlign: 'center'
          }}>
            <ShoppingBag size={64} style={{ opacity: 0.25, marginBottom: '1rem', color: '#475569' }} />
            <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#334155', marginBottom: '0.3rem' }}>
              {lang === 'th' ? 'ยังไม่มีรายการอาหาร' : 'No orders yet'}
            </p>
            <p style={{ fontSize: '0.88rem', color: '#64748b' }}>
              {lang === 'th' ? 'กดปุ่มสั่งเพิ่มด้านล่างเพื่อสั่งอาหาร' : 'Tap the add button below to order'}
            </p>
          </div>
        ) : pendingItems.length === 0 ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.4rem 0.25rem', cursor: 'pointer',
              color: '#334155', fontSize: '0.9rem', fontWeight: 700
            }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#ea580c' }}
              />
              {lang === 'th' ? 'เลือกทั้งหมด' : 'Select all'}
              {selectedIdx.length > 0 && (
                <span style={{ color: '#ea580c', fontWeight: 800 }}>
                  ({selectedIdx.length} {lang === 'th' ? 'รายการ' : 'selected'})
                </span>
              )}
            </label>
            {pendingItems.map((item, idx) => {
              const subtotal = (Number(item.ItemPrice) || 0) * (Number(item.Quantity) || 1);
              const isSelected = selectedIdx.includes(idx);
              return (
                <div key={idx} style={{
                  background: '#ffffff',
                  border: `2px solid ${isSelected ? '#ea580c' : '#e2e8f0'}`,
                  borderRadius: '14px',
                  padding: '1rem 1.1rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  boxShadow: isSelected ? '0 4px 12px rgba(234,88,12,0.15)' : '0 2px 6px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease'
                }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(idx)}
                    style={{ width: '18px', height: '18px', marginTop: '0.35rem', cursor: 'pointer', flexShrink: 0, accentColor: '#ea580c' }}
                  />
                  <div style={{
                    background: '#fff7ed',
                    border: '1px solid #ffedd5',
                    borderRadius: '8px',
                    padding: '0.35rem 0.65rem',
                    fontWeight: '800',
                    color: '#c2410c',
                    fontSize: '0.95rem',
                    flexShrink: 0,
                    minWidth: '36px',
                    textAlign: 'center'
                  }}>
                    {Number(item.Quantity) || 1}x
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '1rem', lineHeight: '1.3' }}>
                      {lang === 'th' ? (item.ItemName || '') : (item.ItemNameEn || item.ItemName || '')}
                    </div>
                    {item.Options && (
                      <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '0.25rem', fontWeight: 500 }}>
                        {item.Options}
                      </div>
                    )}
                    {item.Timestamp && !isNaN(new Date(item.Timestamp)) && (
                      <div style={{
                        fontSize: '0.8rem',
                        color: '#64748b',
                        marginTop: '0.25rem',
                        fontWeight: 500
                      }}>
                        🕒 {new Date(item.Timestamp).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '1.05rem' }}>
                      ฿{subtotal.toLocaleString()}
                    </span>
                    <button
                      onClick={() => onDeleteItem(item)}
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '7px',
                        color: '#ef4444',
                        padding: '0.3rem 0.5rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'background 0.2s'
                      }}
                      title={lang === 'th' ? 'ลบรายการ' : 'Delete item'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* รายการที่ลูกค้าสั่งเองจาก QR และชำระมาแล้ว — อ่านอย่างเดียว ไม่ต้องเก็บเงินซ้ำ */}
        {paidItems.length > 0 && (
          <div style={{ marginTop: pendingItems.length > 0 ? '1.25rem' : 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '0.5rem', color: '#4338ca', fontWeight: 800, fontSize: '0.92rem'
            }}>
              <span>💳 {lang === 'th' ? 'ลูกค้าสั่งเอง & ชำระแล้ว' : 'Self-ordered & paid'}</span>
              <span>฿{paidTotal.toLocaleString()}</span>
            </div>
            {paidItems.map((item, idx) => (
              <div key={'paid-' + idx} style={{
                background: '#eef2ff',
                border: '2px solid #c7d2fe',
                borderRadius: '14px',
                padding: '0.85rem 1rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem'
              }}>
                <div style={{
                  background: '#ffffff', border: '1px solid #c7d2fe', borderRadius: '8px',
                  padding: '0.35rem 0.65rem', fontWeight: 800, color: '#4338ca',
                  fontSize: '0.95rem', flexShrink: 0, minWidth: '36px', textAlign: 'center'
                }}>
                  {Number(item.Quantity) || 1}x
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#1e1b4b', fontSize: '1rem', lineHeight: 1.3 }}>
                    {lang === 'th' ? (item.ItemName || '') : (item.ItemNameEn || item.ItemName || '')}
                  </div>
                  {item.Options && (
                    <div style={{ fontSize: '0.85rem', color: '#4338ca', marginTop: '0.25rem', fontWeight: 500 }}>
                      {item.Options}
                    </div>
                  )}
                  {item.Timestamp && !isNaN(new Date(item.Timestamp)) && (
                    <div style={{ fontSize: '0.8rem', color: '#6366f1', marginTop: '0.25rem', fontWeight: 500 }}>
                      🕒 {new Date(item.Timestamp).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </div>
                  )}
                </div>
                <span style={{ fontWeight: 800, color: '#4338ca', fontSize: '1.05rem' }}>
                  ฿{((Number(item.ItemPrice) || 0) * (Number(item.Quantity) || 1)).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
        padding: '1rem 1.25rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        zIndex: 10
      }}>
        {pendingItems.length > 0 && (() => {
          const hasCharges = sc > 0 || vat > 0;
          return (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              marginBottom: '0.1rem'
            }}>
              {hasCharges ? (
                <div style={{ fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontWeight: 600 }}>
                    <span>{lang === 'th' ? 'ยอดอาหาร' : 'Subtotal'}</span>
                    <span>฿{totalAmount.toLocaleString()}</span>
                  </div>
                  {sc > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d97706', fontWeight: 600 }}>
                      <span>{lang === 'th' ? `เซอร์วิชชาร์จ ${settings.serviceCharge.rate}%` : `Service Charge ${settings.serviceCharge.rate}%`}</span>
                      <span>+฿{sc.toLocaleString()}</span>
                    </div>
                  )}
                  {vat > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563eb', fontWeight: 600 }}>
                      <span>{lang === 'th' ? `VAT ${settings.vat.rate}%` : `VAT ${settings.vat.rate}%`}</span>
                      <span>+฿{vat.toLocaleString()}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '1.1rem', borderTop: '1px solid #cbd5e1', paddingTop: '0.45rem', marginTop: '0.1rem' }}>
                    <span style={{ color: '#0f172a' }}>{lang === 'th' ? 'ยอดรวม' : 'Total'}</span>
                    <span style={{ color: '#ea580c', fontSize: '1.4rem' }}>฿{grand.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#0f172a', fontWeight: '700', fontSize: '1rem' }}>
                    {lang === 'th' ? 'ยอดรวม' : 'Total'}
                  </span>
                  <span style={{ color: '#ea580c', fontWeight: '800', fontSize: '1.5rem' }}>
                    ฿{totalAmount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        {pendingItems.length === 0 && paidItems.length > 0 && (
          <div style={{
            background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '12px',
            padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', color: '#3730a3', fontWeight: 700, fontSize: '0.92rem'
          }}>
            <span>💳 {lang === 'th' ? 'ลูกค้าชำระเองครบแล้ว' : 'Fully paid by the customer'}</span>
            <span style={{ fontWeight: 800 }}>฿{paidTotal.toLocaleString()}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onAddMore}
            style={{
              flex: 1,
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '14px',
              color: '#0f172a',
              padding: '0.9rem',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s'
            }}
          >
            <Plus size={18} color="#0f172a" />
            {lang === 'th' ? 'สั่งเพิ่ม' : 'Add More'}
          </button>
          {pendingItems.length === 0 && paidItems.length > 0 && onCloseTable && (
            <button
              onClick={() => {
                if (window.confirm(lang === 'th'
                  ? 'ลูกค้าชำระเงินครบแล้ว ต้องการปิดโต๊ะและล้างรายการหรือไม่?'
                  : 'The customer has paid in full. Close this table and clear its items?')) {
                  onCloseTable(tableNumber);
                }
              }}
              style={{
                flex: 2,
                background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
                border: 'none', borderRadius: '14px', color: '#ffffff',
                padding: '0.9rem', cursor: 'pointer', fontWeight: 800, fontSize: '1.05rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                boxShadow: '0 4px 15px rgba(67,56,202,0.35)'
              }}
            >
              <CheckCircle2 size={20} />
              {lang === 'th' ? 'ปิดโต๊ะ (ชำระครบแล้ว)' : 'Close table (paid)'}
            </button>
          )}
          {pendingItems.length > 0 && (
            <button
              onClick={() => {
                if (currentUser?.canCheckout !== false || currentUser?.isAdmin) {
                  onCheckout(pendingItems, totalAmount);
                } else {
                  alert(lang === 'th' ? 'ไม่มีสิทธิ์ในการชำระเงิน' : 'No checkout permission');
                }
              }}
              style={{
                flex: 2,
                background: (currentUser?.canCheckout !== false || currentUser?.isAdmin) ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : '#e2e8f0',
                border: 'none',
                borderRadius: '14px',
                color: (currentUser?.canCheckout !== false || currentUser?.isAdmin) ? '#ffffff' : '#94a3b8',
                padding: '0.9rem',
                cursor: (currentUser?.canCheckout !== false || currentUser?.isAdmin) ? 'pointer' : 'not-allowed',
                fontWeight: '800',
                fontSize: '1.05rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: (currentUser?.canCheckout !== false || currentUser?.isAdmin) ? '0 4px 15px rgba(217, 119, 6, 0.35)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <CreditCard size={20} />
              {lang === 'th' ? `ชำระเงิน ฿${grand.toLocaleString()}` : `Pay ฿${grand.toLocaleString()}`}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Action Modal (Move / Merge / Split) */}
      {showActionModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '360px',
            padding: '1.5rem',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#0f172a', textAlign: 'center', fontWeight: '700' }}>
              {actionLabel(actionType)}
            </h3>

            <div style={{
              marginBottom: '1rem', padding: '0.6rem 0.8rem', borderRadius: '10px',
              background: '#f8fafc', border: '1px solid #e2e8f0',
              fontSize: '0.85rem', color: '#475569', textAlign: 'center', fontWeight: '600'
            }}>
              {actingIsAll
                ? (lang === 'th' ? `ดำเนินการกับ "ทั้งโต๊ะ" (${actingItems.length} รายการ)` : `Acting on the whole table (${actingItems.length} items)`)
                : (lang === 'th' ? `ดำเนินการกับ ${actingItems.length} รายการที่เลือก` : `Acting on ${actingItems.length} selected items`)}
            </div>

            {!confirmStage ? (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: '#334155', fontSize: '0.9rem', fontWeight: '600' }}>
                    {actionType === 'move'
                      ? (lang === 'th' ? 'ย้ายไปโต๊ะเบอร์ (โต๊ะว่าง):' : 'Move to table (empty):')
                      : actionType === 'merge'
                        ? (lang === 'th' ? 'รวมกับโต๊ะเบอร์ (โต๊ะที่มีลูกค้า):' : 'Merge into table (occupied):')
                        : (lang === 'th' ? 'แยกรายการไปโต๊ะเบอร์:' : 'Split items to table:')}
                  </label>
                  <input
                    type="text"
                    value={targetTable}
                    onChange={(e) => setTargetTable(e.target.value)}
                    placeholder={lang === 'th' ? 'ระบุเบอร์โต๊ะเป้าหมาย' : 'Enter target table'}
                    style={{
                      width: '100%',
                      background: '#ffffff',
                      border: '2px solid #cbd5e1',
                      borderRadius: '10px',
                      color: '#0f172a',
                      padding: '0.8rem',
                      fontSize: '1rem',
                      fontWeight: '700',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={closeAction}
                    style={{
                      flex: 1, background: '#f1f5f9', border: '1px solid #cbd5e1',
                      borderRadius: '10px', color: '#0f172a', padding: '0.8rem',
                      fontWeight: '700', cursor: 'pointer'
                    }}
                  >
                    {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => { if (targetTable && targetTable !== String(tableNumber)) setConfirmStage(true); }}
                    disabled={!targetTable || targetTable === String(tableNumber)}
                    style={{
                      flex: 1,
                      background: actionType === 'move' ? '#2563eb' : actionType === 'merge' ? '#059669' : '#7c3aed',
                      border: 'none', borderRadius: '10px', color: '#ffffff', padding: '0.8rem',
                      fontWeight: '700', cursor: 'pointer',
                      opacity: (!targetTable || targetTable === String(tableNumber)) ? 0.5 : 1
                    }}
                  >
                    {lang === 'th' ? 'ถัดไป' : 'Next'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: '0.75rem', marginBottom: '1.5rem', textAlign: 'center'
                }}>
                  <AlertTriangle size={40} color="#ea580c" />
                  <p style={{ margin: 0, color: '#0f172a', fontSize: '1rem', fontWeight: 700 }}>
                    {lang === 'th' ? 'ยืนยันอีกครั้ง' : 'Please confirm again'}
                  </p>
                  <p style={{ margin: 0, color: '#475569', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    {lang === 'th'
                      ? `${actionLabel(actionType)} ${actingIsAll ? 'ทั้งโต๊ะ' : `${actingItems.length} รายการ`} จากโต๊ะ ${tableNumber} ไปโต๊ะ ${targetTable} ?`
                      : `${actionLabel(actionType)} ${actingIsAll ? 'the whole table' : `${actingItems.length} items`} from table ${tableNumber} to table ${targetTable}?`}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() => setConfirmStage(false)}
                    style={{
                      flex: 1, background: '#f1f5f9', border: '1px solid #cbd5e1',
                      borderRadius: '10px', color: '#0f172a', padding: '0.8rem',
                      fontWeight: '700', cursor: 'pointer'
                    }}
                  >
                    {lang === 'th' ? 'ย้อนกลับ' : 'Back'}
                  </button>
                  <button
                    onClick={runTableAction}
                    style={{
                      flex: 1,
                      background: actionType === 'move' ? '#2563eb' : actionType === 'merge' ? '#059669' : '#7c3aed',
                      border: 'none', borderRadius: '10px', color: '#ffffff', padding: '0.8rem',
                      fontWeight: '700', cursor: 'pointer'
                    }}
                  >
                    {lang === 'th' ? 'ยืนยัน' : 'Confirm'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit Customer Count Modal */}
      {showEditCustomerModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '320px',
            padding: '1.5rem',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#0f172a', textAlign: 'center', fontWeight: '700' }}>
              {lang === 'th' ? 'แก้ไขจำนวนลูกค้า' : 'Edit Customer Count'}
            </h3>
            
            <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <button
                  onClick={() => setEditCustomerCount(Math.max(1, editCustomerCount - 1))}
                  style={{
                    width: '44px', height: '44px',
                    borderRadius: '50%',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    color: '#0f172a',
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  -
                </button>
                <span style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ea580c', minWidth: '40px' }}>
                  {editCustomerCount}
                </span>
                <button
                  onClick={() => setEditCustomerCount(editCustomerCount + 1)}
                  style={{
                    width: '44px', height: '44px',
                    borderRadius: '50%',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    color: '#0f172a',
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowEditCustomerModal(false)}
                style={{
                  flex: 1,
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  color: '#0f172a',
                  padding: '0.8rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                onClick={() => {
                  localStorage.setItem('customer_count_' + tableNumber, editCustomerCount);
                  setCurrentCount(String(editCustomerCount));
                  setShowEditCustomerModal(false);
                }}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#ffffff',
                  padding: '0.8rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                {lang === 'th' ? 'บันทึก' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableOrderView;
