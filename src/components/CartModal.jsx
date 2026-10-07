import React from 'react';
import { X, Trash2, ShoppingBag, Plus, Minus } from 'lucide-react';

const CartModal = ({ cart, onClose, onRemove, onUpdateQuantity, onUpdateNote, onCheckout, lang = 'th', settings = {} }) => {
  const calculateSubtotal = () => {
    return cart.reduce((total, item) => {
      let itemTotal = Number(item.food.price);
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(p => { itemTotal += Number(p.price || 0); });
      }
      return total + (itemTotal * (item.quantity || 1));
    }, 0);
  };

  const calcCharges = (subtotal) => {
    const scRate = settings?.serviceCharge?.enabled ? (settings.serviceCharge.rate || 0) : 0;
    const vatRate = settings?.vat?.enabled ? (settings.vat.rate || 0) : 0;
    const sc = Math.round(subtotal * scRate) / 100;
    const vatBase = subtotal + sc;
    const vat = Math.round(vatBase * vatRate) / 100;
    return { sc, vat, grand: subtotal + sc + vat };
  };

  const getSubtotal = (item) => {
    let itemTotal = Number(item.food.price);
    if (item.allPopups && item.allPopups.length > 0) {
      item.allPopups.forEach(p => { itemTotal += Number(p.price || 0); });
    }
    return itemTotal * (item.quantity || 1);
  };

  return (
    <div className="cart-overlay" onClick={onClose}>
      <div className="cart-panel" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', color: '#0f172a', borderLeft: '1px solid #cbd5e1' }}>
        <div className="cart-header" style={{ borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
            <ShoppingBag color="#ea580c" /> {lang === 'th' ? 'ตะกร้าสินค้า' : 'Shopping Cart'}
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={24} color="#0f172a" />
          </button>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div className="empty-cart" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem', color: '#64748b' }}>
              <p style={{ fontWeight: '600' }}>{lang === 'th' ? 'ยังไม่มีสินค้าในตะกร้า' : 'Your cart is empty'}</p>
              <button
                onClick={() => {
                  onClose();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}
              >
                <ShoppingBag size={20} /> {lang === 'th' ? 'ดำเนินการสั่งอาหาร' : 'Start Ordering'}
              </button>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.cartId} className="cart-item" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.25rem' }}>
                <div className="cart-item-info">
                  <h4 style={{ color: '#0f172a', fontWeight: '800', margin: '0 0 0.35rem 0' }}>
                    {lang === 'th' ? item.food.name : (item.food.nameEn || item.food.name)}
                    {item.food.priceName && (
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #ffedd5', padding: '0.1rem 0.45rem', borderRadius: '6px', verticalAlign: 'middle' }}>
                        {item.food.priceName}
                      </span>
                    )}
                  </h4>

                  <div className="cart-item-details" style={{ color: '#475569', fontSize: '0.85rem' }}>
                    {item.customerName && (
                      <div className="cart-item-customer">
                        <strong style={{ color: '#0f172a' }}>{lang === 'th' ? 'ลูกค้า:' : 'Customer:'}</strong> {item.customerName}
                      </div>
                    )}
                    {item.allPopups && item.allPopups.length > 0 && (
                      <div className="cart-item-addons">
                        <strong style={{ color: '#0f172a' }}>{lang === 'th' ? 'ตัวเลือก:' : 'Options:'}</strong> {(() => {
                          const grouped = [];
                          item.allPopups.forEach(a => {
                            const label = lang === 'th' ? a.name : (a.nameEn || a.name);
                            const found = grouped.find(g => g.label === label);
                            if (found) found.count += 1;
                            else grouped.push({ label, count: 1 });
                          });
                          return grouped.map(g => g.count > 1 ? `${g.label} ×${g.count}` : g.label).join(', ');
                        })()}
                      </div>
                    )}

                    {/* รายการที่แยกออกมาจากป๊อปอัพของอีกจาน */}
                    {item.fromPopupOf && (
                      <div className="cart-item-from-popup" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                        {lang === 'th' ? `พ่วงกับ ${item.fromPopupOf}` : `with ${item.fromPopupOf}`}
                      </div>
                    )}

                    <div className="cart-item-dining">
                      <strong style={{ color: '#0f172a' }}>{lang === 'th' ? 'การรับประทาน:' : 'Dining:'}</strong> {lang === 'th' ? item.dining.name : (item.dining.nameEn || item.dining.name)}
                    </div>
                  </div>

                  <div className="cart-item-price" style={{ color: '#ea580c', fontWeight: '800', fontSize: '1.15rem', marginTop: '0.5rem' }}>฿{getSubtotal(item).toLocaleString()}</div>

                  <input
                    type="text"
                    value={item.note || ''}
                    onChange={(e) => onUpdateNote && onUpdateNote(item.cartId, e.target.value)}
                    placeholder={lang === 'th' ? '📝 หมายเหตุ เช่น ไม่ใส่ผัก, เผ็ดน้อย' : '📝 Note e.g. no veggies'}
                    style={{
                      marginTop: '0.5rem',
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '0.5rem 0.65rem',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      color: '#0f172a',
                      fontSize: '0.85rem',
                      fontFamily: 'inherit',
                      fontWeight: '600',
                      outline: 'none'
                    }}
                  />
                </div>

                <div className="cart-item-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="qty-controls" style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.25rem' }}>
                    <button className="qty-btn" onClick={() => onUpdateQuantity(item.cartId, -1)} disabled={(item.quantity || 1) <= 1} style={{ background: 'none', border: 'none', color: '#0f172a', cursor: ((item.quantity || 1) <= 1) ? 'not-allowed' : 'pointer', opacity: ((item.quantity || 1) <= 1) ? 0.3 : 1, padding: '0.25rem' }}><Minus size={16}/></button>
                    <span className="qty-val" style={{ width: '24px', textAlign: 'center', fontWeight: '800', color: '#0f172a' }}>{item.quantity || 1}</span>
                    <button className="qty-btn" onClick={() => onUpdateQuantity(item.cartId, 1)} style={{ background: 'none', border: 'none', color: '#0f172a', cursor: 'pointer', padding: '0.25rem' }}><Plus size={16}/></button>
                  </div>
                  <button
                    className="remove-btn"
                    onClick={() => {
                      if (window.confirm(lang === 'th' ? 'คุณต้องการลบรายการนี้ใช่หรือไม่?' : 'Remove this item from cart?')) {
                        onRemove(item.cartId);
                      }
                    }}
                    style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', padding: '0.5rem', borderRadius: '50%', cursor: 'pointer' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="cart-footer" style={{ borderTop: '1px solid #e2e8f0', background: '#f8fafc', padding: '1.5rem 2rem' }}>
            {(() => {
              const subtotal = calculateSubtotal();
              const { sc, vat, grand } = calcCharges(subtotal);
              const hasCharges = sc > 0 || vat > 0;
              return (
                <div style={{ marginBottom: '0.85rem' }}>
                  {hasCharges ? (
                    <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontWeight: '600' }}>
                        <span>{lang === 'th' ? 'ยอดอาหาร' : 'Subtotal'}</span>
                        <span style={{ color: '#0f172a', fontWeight: '700' }}>฿{subtotal.toLocaleString()}</span>
                      </div>
                      {sc > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d97706', fontWeight: '600' }}>
                          <span>{lang === 'th' ? `เซอร์วิชชาร์จ ${settings.serviceCharge.rate}%` : `Service Charge ${settings.serviceCharge.rate}%`}</span>
                          <span style={{ fontWeight: '700' }}>+฿{sc.toLocaleString()}</span>
                        </div>
                      )}
                      {vat > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563eb', fontWeight: '600' }}>
                          <span>{lang === 'th' ? `VAT ${settings.vat.rate}%` : `VAT ${settings.vat.rate}%`}</span>
                          <span style={{ fontWeight: '700' }}>+฿{vat.toLocaleString()}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '1.15rem', borderTop: '1px solid #cbd5e1', paddingTop: '0.45rem', marginTop: '0.1rem' }}>
                        <span style={{ color: '#0f172a' }}>{lang === 'th' ? 'รวมทั้งสิ้น' : 'Grand Total'}</span>
                        <span style={{ color: '#ea580c', fontWeight: '900', fontSize: '1.25rem' }}>฿{grand.toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="cart-total" style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.25rem', fontWeight: 800 }}>
                      <span style={{ color: '#0f172a' }}>{lang === 'th' ? 'ยอดรวม:' : 'Total:'}</span>
                      <span style={{ color: '#ea580c', fontSize: '1.35rem', fontWeight: 900 }}>฿{subtotal.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <button
                onClick={() => { onClose(); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100); }}
                style={{ flex: 1, padding: '0.85rem', borderRadius: '10px', border: '2px solid #ea580c', background: '#ffffff', color: '#ea580c', fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.25rem', fontFamily: 'inherit' }}
              >
                <Plus size={18} /> {lang === 'th' ? 'สั่งเพิ่ม' : 'Order More'}
              </button>
              <button className="confirm-btn" onClick={onCheckout} style={{ flex: 1.5, margin: 0, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#ffffff', fontWeight: '800', borderRadius: '10px', padding: '0.85rem' }}>
                {lang === 'th' ? '✅ ส่งรายการอาหาร' : 'Send Order'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartModal;
