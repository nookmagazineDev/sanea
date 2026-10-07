import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChefHat, Clock, PlusCircle, CheckCircle, XCircle, Printer } from 'lucide-react';
import { printKitchenOrder } from '../utils/printerRouting';

// เปิด/ปิดการพิมพ์อัตโนมัติ เก็บแยกรายเครื่อง — ให้เปิดไว้เครื่องเดียวพอ
// ถ้าเปิดหลายเครื่องพร้อมกัน ออเดอร์เดียวจะถูกพิมพ์ซ้ำหลายใบ
const AUTO_PRINT_KEY = 'auto_print_kitchen';
// เลขออเดอร์ที่พิมพ์ไปแล้ว กันพิมพ์ซ้ำตอนดึงข้อมูลรอบถัดไปหรือรีเฟรชหน้า
const PRINTED_KEY = 'auto_printed_orders';
const PRINTED_MAX = 200;

const loadPrinted = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch (e) {
    return new Set();
  }
};

const OrderTimer = ({ timestamp }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const orderTime = new Date(timestamp).getTime();
    
    const calculateElapsed = () => {
      setElapsed(Math.floor((Date.now() - orderTime) / 1000));
    };
    
    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  const mins = Math.floor(elapsed / 60);
  const timeString = mins > 0 ? `รอมาแล้ว ${mins} นาที` : 'เพิ่งสั่ง...';
  const isLate = mins >= 10;

  return (
    <div className="order-timer" style={{ color: isLate ? 'var(--spice-4)' : 'var(--spice-2)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.35rem', background: isLate ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: `1px solid ${isLate ? 'rgba(239, 68, 68, 0.3)' : 'rgba(234, 179, 8, 0.3)'}` }}>
      <Clock size={16} /> <span>{timeString}</span>
    </div>
  );
};

const KitchenMonitor = ({ orders, onUpdateOrderStatus, onNewOrder, allMenu = [] }) => {
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem(AUTO_PRINT_KEY) === '1');
  const [autoPrintStatus, setAutoPrintStatus] = useState(null); // { ok, msg }
  const printedRef = useRef(loadPrinted());
  const baselineDone = useRef(false);

  const markPrinted = useCallback((list) => {
    list.forEach(o => printedRef.current.add(String(o.orderNumber)));
    const keep = Array.from(printedRef.current).slice(-PRINTED_MAX);
    printedRef.current = new Set(keep);
    localStorage.setItem(PRINTED_KEY, JSON.stringify(keep));
  }, []);

  const toggleAutoPrint = () => {
    setAutoPrint(prev => {
      const next = !prev;
      localStorage.setItem(AUTO_PRINT_KEY, next ? '1' : '0');
      if (!next) baselineDone.current = false;
      return next;
    });
    setAutoPrintStatus(null);
  };

  useEffect(() => {
    if (!autoPrint) return;

    // ตอนเพิ่งเปิดหน้าจอ (หรือเพิ่งเปิดสวิตช์) ให้ถือว่าออเดอร์ที่ค้างอยู่พิมพ์ไปแล้ว
    // กันพ่นใบย้อนหลังทีเดียวเป็นสิบใบ
    if (!baselineDone.current) {
      baselineDone.current = true;
      markPrinted(orders);
      return;
    }

    const fresh = orders.filter(o => !printedRef.current.has(String(o.orderNumber)));
    if (fresh.length === 0) return;

    // ทำเครื่องหมายก่อนพิมพ์ กันยิงซ้ำถ้าข้อมูลรอบใหม่เข้ามาระหว่างที่ยังพิมพ์ไม่เสร็จ
    markPrinted(fresh);

    (async () => {
      for (const order of fresh) {
        const result = await printKitchenOrder(order, allMenu);
        setAutoPrintStatus(result.success
          ? { ok: true, msg: `พิมพ์ออเดอร์ #${order.orderNumber} แล้ว (${result.printed} ใบ)` }
          : { ok: false, msg: `ออเดอร์ #${order.orderNumber} พิมพ์ไม่สำเร็จ — ${result.error} (กดปุ่มพิมพ์ที่ใบออเดอร์เพื่อลองใหม่)` });
        if (!result.success) console.error('Auto print failed:', result.error);
      }
    })();
  }, [orders, autoPrint, allMenu, markPrinted]);

  const handleCompleteClick = (orderId, orderNumber) => {
    const numString = orderNumber ? orderNumber.toString().replace('#', '').replace(/^0+/, '') : '';
    
    // พยายามเล่นไฟล์เสียงที่เตรียมไว้โดยตรง
    let audioUrl = '/audio/completed.mp3';
    const num = parseInt(numString);
    if (!isNaN(num) && num >= 1 && num <= 100) {
      audioUrl = `/audio/completed_${num}.mp3`;
    }
    
    const audio = new Audio(audioUrl);
    
    audio.play().catch(e => {
      console.warn("Cannot play local audio, trying general fallback", e);
      if (audioUrl !== '/audio/completed.mp3') {
        const fallbackAudio = new Audio('/audio/completed.mp3');
        fallbackAudio.play().catch(console.error);
      }
    });

    onUpdateOrderStatus(orderId, 'completed');
  };

  const handlePrintClick = async (order) => {
    const result = await printKitchenOrder(order, allMenu);
    if (result.success) {
      markPrinted([order]);
    } else {
      alert('ปริ้นไม่สำเร็จ: ' + result.error);
    }
  };

  const calculateAggregate = () => {
    const counts = {};
    const orderedKeys = [];
    let totalMainDishes = 0;

    orders.forEach(order => {
      order.items.forEach(item => {
        let itemName = item.isFlattened ? item.name : item.food.name;
        let qty = item.isFlattened ? 1 : (item.quantity || 1);
        
        if (item.isFlattened) {
          const match = itemName.match(/\(x(\d+)\)$/);
          if (match) {
            qty = parseInt(match[1], 10);
            itemName = itemName.replace(/\s*\(x\d+\)$/, '').trim();
          }
        }
        
        if (!counts[itemName]) {
          counts[itemName] = 0;
          orderedKeys.push(itemName);
        }
        counts[itemName] += qty;
        totalMainDishes += qty;

        if (item.isFlattened && item.subItems) {
           item.subItems.forEach(sub => {
              let subName = sub.replace('↳', '').trim();
              if (subName.startsWith('ความเผ็ด:')) return;
              
              let subQty = 1;
              const subMatch = subName.match(/\(x(\d+)\)$/);
              if (subMatch) {
                subQty = parseInt(subMatch[1], 10);
                subName = subName.replace(/\s*\(x\d+\)$/, '').trim();
              }
              if (!counts[subName]) {
                counts[subName] = 0;
                orderedKeys.push(subName);
              }
              counts[subName] += subQty;
           });
        } else if (!item.isFlattened) {
          const itemQty = item.quantity || 1;
          const popups = [...(item.allPopups || []), ...(item.addOns || [])];
          popups.forEach(p => {
             const subName = p.name;
             if (!counts[subName]) {
               counts[subName] = 0;
               orderedKeys.push(subName);
             }
             counts[subName] += itemQty;
          });
          if (item.promo && item.promo.id !== 'none') {
             const subName = item.promo.name;
             if (!counts[subName]) {
               counts[subName] = 0;
               orderedKeys.push(subName);
             }
             counts[subName] += itemQty;
          }
        }
      });
    });
    return { counts, orderedKeys, totalMainDishes };
  };

  const { counts: aggregateCounts, orderedKeys, totalMainDishes } = calculateAggregate();
  const sortedItems = orderedKeys.map(key => [key, aggregateCounts[key]]);

  return (
    <div className="kitchen-monitor">
      <div className="kitchen-header">
        <h2><ChefHat size={32} /> ระบบหลังบ้าน (Kitchen Monitor)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={toggleAutoPrint}
            title={autoPrint
              ? 'ออเดอร์ใหม่จะถูกพิมพ์เข้าครัวอัตโนมัติจากเครื่องนี้'
              : 'เปิดเพื่อให้ออเดอร์ใหม่พิมพ์เข้าครัวเองโดยไม่ต้องกด'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: autoPrint ? '#16a34a' : 'rgba(255,255,255,0.1)',
              color: 'white',
              border: `1px solid ${autoPrint ? '#16a34a' : 'rgba(255,255,255,0.2)'}`,
              padding: '0.6rem 1.1rem', borderRadius: '10px', fontWeight: 700, cursor: 'pointer'
            }}
          >
            <Printer size={18} />
            พิมพ์อัตโนมัติ: {autoPrint ? 'เปิด' : 'ปิด'}
          </button>
          <button className="new-order-btn" onClick={onNewOrder}>
            <PlusCircle size={20} />
            สั่งอาหาร (New Order)
          </button>
        </div>
      </div>

      {autoPrint && autoPrintStatus && (
        <div style={{
          background: autoPrintStatus.ok ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)',
          border: `1px solid ${autoPrintStatus.ok ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)'}`,
          color: autoPrintStatus.ok ? '#4ade80' : '#fca5a5',
          padding: '0.75rem 1rem', borderRadius: '10px', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600
        }}>
          {autoPrintStatus.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
          <span>{autoPrintStatus.msg}</span>
        </div>
      )}

      {orders.length > 0 && (
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '16px', marginBottom: '2rem', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: '1.25rem' }}>สรุปยอดค้างทำทั้งหมด (รอมอนิเตอร์)</h3>
            <span style={{ background: 'rgba(249,115,22,0.2)', color: 'var(--accent)', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.9rem', fontWeight: 'bold' }}>
              รวม {totalMainDishes} จานหลัก
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {sortedItems.map(([name, qty]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: '500' }}>{name}</span>
                <span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontWeight: 'bold', minWidth: '36px', textAlign: 'center' }}>{qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="orders-grid">
        {orders.length === 0 ? (
          <div className="no-orders">
            <Clock size={48} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
            <p>ยังไม่มีออเดอร์ในขณะนี้</p>
          </div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="kitchen-order-card">
              <div className="order-header">
                <h3>ออเดอร์ {order.orderNumber}</h3>
                <span className={`status-badge ${order.status}`}>{order.status}</span>
              </div>
              
              <div className="customer-info" style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                <strong>ลูกค้า:</strong> {order.customerDetails?.name || 'ไม่ระบุ'}
              </div>

              <div className="order-items">
                {order.items.map((item, index) => (
                  <div key={index} className="kitchen-order-item">
                    {item.isFlattened ? (
                      <>
                        <div className="item-main">
                          <span className="item-name">{item.name}</span>
                        </div>
                        {item.subItems && item.subItems.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '0.5rem', marginTop: '0.2rem' }}>
                            {item.subItems.map((sub, i) => (
                               <div key={i} className="item-addons">{sub.replace(/\[.*?\]\s*/g, '')}</div>
                            ))}
                          </div>
                        )}
                        {item.dining && item.dining !== 'ไม่ระบุ' && (
                          <div className="item-dining" style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                            {item.dining}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="item-main">
                          <span className="item-name">
                            {item.quantity && item.quantity > 1 ? <strong style={{color: 'var(--accent)'}}>x{item.quantity} </strong> : ''}
                            {item.food.name}
                          </span>
                          <span className="item-spice">({item.spice?.name || 'ไม่ระบุ'})</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '0.5rem', marginTop: '0.2rem' }}>
                          {item.popup1 && (
                            <div className="item-addons">
                              ↳ {item.popup1.name} {item.quantity > 1 ? `(x${item.quantity})` : ''}
                            </div>
                          )}
                          {item.addOns && item.addOns.length > 0 && item.addOns.map((a, i) => (
                            <div key={`a-${i}`} className="item-addons">
                              ↳ {a.name} {item.quantity > 1 ? `(x${item.quantity})` : ''}
                            </div>
                          ))}
                          {item.promo && item.promo.id !== 'none' && (
                            <div className="item-promo" style={{ color: 'var(--spice-2)' }}>
                              ↳ {item.promo.name} {item.quantity > 1 ? `(x${item.quantity})` : ''}
                            </div>
                          )}
                        </div>
                        {item.dining && (
                          <div className="item-dining" style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                            {item.dining.name}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="order-footer">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span className="order-time">
                    เวลาสั่ง: {new Date(order.timestamp).toLocaleTimeString('th-TH')}
                  </span>
                  <OrderTimer timestamp={order.timestamp} />
                </div>
                <span className="order-total" style={{ alignSelf: 'flex-end' }}>
                  ยอดรวม: ฿{order.total}
                </span>
              </div>
              
              <div className="order-actions" style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.25rem' }}>
                <button className="action-btn secondary" onClick={() => handlePrintClick(order)} style={{ background: 'rgba(255,255,255,0.1)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Printer size={18} /> พิมพ์บิล
                </button>
                <button className="action-btn success" onClick={() => handleCompleteClick(order.id, order.orderNumber)} style={{ flex: 1 }}>
                  <CheckCircle size={18} /> สำเร็จแล้ว
                </button>
                <button className="action-btn cancel" onClick={() => onUpdateOrderStatus(order.id, 'cancelled')}>
                  <XCircle size={18} /> ยกเลิก
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default KitchenMonitor;
