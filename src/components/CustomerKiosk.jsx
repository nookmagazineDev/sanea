import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ShoppingBag, CheckCircle, Smartphone, Globe, Plus, Minus, X, ChevronRight, QrCode, Sparkles, Utensils, Menu, Download, ZoomIn } from 'lucide-react';
import QRCode from 'qrcode';
import { generatePromptPayPayload, generateDynamicQRFromRaw } from '../utils/promptpay';
import OrderWizardModal from './OrderWizardModal';
import { categoryVisibleFor, menuVisibleFor } from '../utils/categoryVisibility';
import { resolveNoteConfig, getPriceOptions } from '../utils/popupConfig';
import { priceForSaleType } from '../utils/salePricing';

const TAKEAWAY_DINING = { id: 'takeaway', name: 'ห่อกลับบ้าน', nameEn: 'Takeaway' };
const DINE_IN_DINING = { id: 'dine_in', name: 'ทานที่ร้าน', nameEn: 'Dine-in' };
// ทานที่ร้านโดยไม่ได้สแกน QR โต๊ะ (เข้าจากหน้าแรกของเว็บ) → ไม่ถามโต๊ะ ลงชื่อนี้แทน
const DINE_IN_LABEL = 'ทานที่ร้าน';

// รูปเมนูขยาย: ใช้สองนิ้วซูม/ลากดู, แตะสองครั้งที่รูปเพื่อซูมเข้า-ออก
// ตอนซูมอยู่ แตะพื้นที่ว่างจะคืนขนาดเดิม (ยังไม่ปิด) — ตอนไม่ซูม แตะพื้นที่ว่างจะปิดรูป
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const ZoomableImage = ({ src, alt, onBackdropTap, hint }) => {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  // ระหว่างนิ้วแตะจอ ปิด transition ให้รูปตามนิ้วทันที
  const [touching, setTouching] = useState(false);
  const viewRef = useRef(view);
  const areaRef = useRef(null);
  const imgRef = useRef(null);
  const gesture = useRef(null);
  const lastTap = useRef(0);

  const apply = (scale, x, y) => {
    const img = imgRef.current;
    let next;
    if (scale <= 1.01 || !img) {
      next = { scale: 1, x: 0, y: 0 };
    } else {
      // ไม่ให้ลากรูปหลุดออกนอกกรอบ
      const maxX = (img.offsetWidth * (scale - 1)) / 2;
      const maxY = (img.offsetHeight * (scale - 1)) / 2;
      next = { scale, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
    }
    viewRef.current = next;
    setView(next);
  };

  // ตำแหน่งนิ้ว เทียบกับจุดกึ่งกลางของรูป (ก่อนซูม)
  const fromCenter = (clientX, clientY) => {
    const r = areaRef.current.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  const startPinch = (touches) => {
    const [a, b] = [touches[0], touches[1]];
    const mid = fromCenter((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    const { scale, x, y } = viewRef.current;
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
      scale,
      // จุดบนรูปที่อยู่ใต้กึ่งกลางสองนิ้ว — ให้คงอยู่ใต้นิ้วตลอดการซูม
      px: (mid.x - x) / scale,
      py: (mid.y - y) / scale
    };
  };

  const startPan = (t) => {
    const { x, y } = viewRef.current;
    gesture.current = { type: 'pan', sx: t.clientX, sy: t.clientY, x, y, moved: false };
  };

  const onTouchStart = (e) => {
    setTouching(true);
    if (e.touches.length >= 2) startPinch(e.touches);
    else if (e.touches.length === 1) startPan(e.touches[0]);
  };

  const onTouchMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch' && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = Math.max(1, Math.min(MAX_ZOOM, g.scale * (dist / g.dist)));
      const mid = fromCenter((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      apply(scale, mid.x - scale * g.px, mid.y - scale * g.py);
    } else if (g.type === 'pan' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - g.sx;
      const dy = t.clientY - g.sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
      if (viewRef.current.scale > 1) apply(viewRef.current.scale, g.x + dx, g.y + dy);
    }
  };

  const onTouchEnd = (e) => {
    const g = gesture.current;
    if (e.touches.length === 1) { startPan(e.touches[0]); gesture.current.moved = true; return; }
    if (e.touches.length >= 2) { startPinch(e.touches); return; }
    gesture.current = null;
    setTouching(false);
    // แตะสองครั้งที่รูป = ซูมเข้าตรงจุดที่แตะ / ซูมออก
    if (g && g.type === 'pan' && !g.moved && e.target === imgRef.current) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        if (viewRef.current.scale > 1) apply(1, 0, 0);
        else {
          const p = fromCenter(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
          apply(DOUBLE_TAP_ZOOM, p.x * (1 - DOUBLE_TAP_ZOOM), p.y * (1 - DOUBLE_TAP_ZOOM));
        }
      } else {
        lastTap.current = now;
      }
    }
  };

  const zoomed = view.scale > 1;

  return (
    <div
      ref={areaRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { gesture.current = null; setTouching(false); }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === imgRef.current) return;
        if (viewRef.current.scale > 1) apply(1, 0, 0);
        else onBackdropTap();
      }}
      style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'calc(60px + env(safe-area-inset-top)) 12px 12px',
        overflow: 'hidden', position: 'relative', touchAction: 'none'
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        draggable={false}
        onError={(e) => { e.target.src = '/images/menu/default.png'; }}
        style={{
          maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
          borderRadius: zoomed ? 0 : '16px', userSelect: 'none', WebkitUserSelect: 'none',
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: touching ? 'none' : 'transform 0.2s ease',
          willChange: 'transform'
        }}
      />
      {!zoomed && (
        <div style={{
          position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,0.7)', color: '#e2e8f0', fontSize: '0.75rem', fontWeight: '600',
          padding: '0.3rem 0.75rem', borderRadius: '20px', whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>
          {hint}
        </div>
      )}
    </div>
  );
};

// tables = ผังโต๊ะของสาขานี้ (ใช้ตอนเข้าหน้าลูกค้าจากหน้าแรกของเว็บ ที่ไม่มีเลขโต๊ะติดมากับลิงก์)
const CustomerKiosk = ({ liveMenu: rawMenu = [], categories = [], settings = {}, onRequestPayment, onCheckPayment, lang: initialLang = 'th', tables = [] }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // QR โต๊ะมีเลขโต๊ะในลิงก์ (ส่งไปหลังบ้านให้พนักงานรู้โต๊ะ แต่ไม่แสดงให้ลูกค้าเห็น)
  const tableParam = searchParams.get('table') || searchParams.get('t') || '';
  const [tableNo, setTableNo] = useState(tableParam);

  // ทานที่ร้าน / ห่อกลับบ้าน — เลือกที่จอแรก ราคาทุกเมนูแสดงตามนี้
  const [orderType, setOrderType] = useState('');
  // ห่อกลับบ้านโดยไม่มีเลขโต๊ะ → ลงโต๊ะโซน Takehome ตัวแรกของร้าน (ไม่มีก็ใช้ชื่อ Takehome)
  const takeawayTable = (() => {
    const t = (Array.isArray(tables) ? tables : []).find(tb => tb.active !== false && tb.zone === 'Takehome');
    return t ? String(t.name) : 'Takehome';
  })();

  const chooseOrderType = (type) => {
    setOrderType(type);
    if (!tableParam) setTableNo(type === 'takeaway' ? takeawayTable : DINE_IN_LABEL);
  };

  // เมนูพร้อมราคาตามที่เลือก: ห่อกลับบ้าน = ราคา Takehome
  // เมนูที่ไม่ได้ตั้งราคา Takehome → ไม่แสดงในรายการตอนห่อกลับบ้าน (noTakehomePrice)
  //   แต่ยังอยู่ในชุดนี้ด้วยราคาปกติ ให้ป๊อปอัพ/ของแถมที่อ้างถึงยังหาเจอ
  // เมนูที่มีแต่ราคาช่องทางอื่น (เช่นเฉพาะ Delivery) ไม่แสดง เหมือนหน้าขาย
  const liveMenu = useMemo(() => {
    if (!orderType) return rawMenu;
    const out = [];
    rawMenu.forEach(food => {
      const opts = getPriceOptions(food);
      const takehome = orderType === 'takeaway' ? priceForSaleType(opts, 'Takehome') : null;
      const chosen = takehome || priceForSaleType(opts, '');
      if (!chosen) return;
      out.push({ ...food, price: Number(chosen.price) || 0, ...(takehome ? { priceName: takehome.name } : {}),
        ...(orderType === 'takeaway' && !takehome ? { noTakehomePrice: true } : {}) });
    });
    return out;
  }, [rawMenu, orderType]);

  const changeOrderType = () => {
    if (cart.length > 0 && !window.confirm(lang === 'th'
      ? 'เปลี่ยนเป็นทานที่ร้าน/ห่อกลับบ้าน ราคาจะเปลี่ยน — ล้างรายการในตะกร้าแล้วเลือกใหม่?'
      : 'Changing will clear your cart. Continue?')) return;
    setCart([]);
    setOrderType('');
    if (!tableParam) setTableNo('');
  };

  const [lang, setLang] = useState(initialLang);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.slug || 'food');
  const [cart, setCart] = useState([]);
  const [selectedFood, setSelectedFood] = useState(null);
  // เมนูที่กำลังเปิดดูรูปขยายเต็มจอ (แตะที่รูปในการ์ด)
  const [previewFood, setPreviewFood] = useState(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [orderNumber, setOrderNumber] = useState('');   // เลขบิลที่ระบบออกให้ ใช้อ้างอิงกับพนักงาน
  // รหัสอ้างอิงการชำระครั้งนี้ — ส่งค่าเดิมทุกครั้งที่กดส่งซ้ำ ระบบหลังบ้านจะได้ไม่ออกบิลซ้อน
  const paySessionRef = React.useRef('');

  // ── ลูกค้ากด "ฉันโอนเงินแล้ว" → รอพนักงานหน้าขายยืนยันยอด ──
  // payStage: '' (ยังไม่แจ้ง) / 'waiting' (รอตรวจสอบ) / 'rejected' (ร้านยังไม่พบยอด) / 'approved' (สำเร็จ)
  // paySnap = รายการ/ยอดที่แจ้งโอนไป (เก็บใน sessionStorage — ปิดแท็บ/รีเฟรชแล้วกลับมารอต่อได้)
  const [payStage, setPayStage] = useState('');
  const [paySnap, setPaySnap] = useState(null);
  const [payError, setPayError] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  // ข้อความใต้ปุ่มบันทึกรูป QR ('saved' | 'error' | '')
  const [qrSaveState, setQrSaveState] = useState('');

  // แผงเลือกหมวดหมู่ (เปิดจากปุ่ม 3 ขีด)
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);


  // PromptPay QR configurations
  const promptPayId = settings?.promptPayId || '004000001641684';
  const qrType = settings?.qrType || 'kshop_dynamic';
  const kshopRawPayload = settings?.kshopRawPayload || '00020101021130810016A00000067701011201150107536000315080214KB0000016416840320KPS004KB00000164168431690016A00000067701011301030040214KB0000016416840420KPS004KB00000164168453037645802TH6304A14E';
  const staticQrUrl = settings?.staticQrUrl || '/kshop_qr.png';

  // Calculate cart subtotal
  const cartSubtotal = cart.reduce((sum, item) => {
    let price = Number(item.food.price) || 0;
    if (item.allPopups) item.allPopups.forEach(p => price += Number(p.price || 0));
    return sum + (price * item.quantity);
  }, 0);

  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => { setQrSaveState(''); }, [isCheckoutOpen, cartSubtotal]);

  // Generate QR Code when checkout opens
  useEffect(() => {
    if (!isCheckoutOpen || cartSubtotal <= 0) { setQrDataUrl(''); return; }
    let cancelled = false;
    let payload = '';

    if (qrType === 'kshop_dynamic') {
      payload = generateDynamicQRFromRaw(kshopRawPayload, cartSubtotal);
    } else {
      payload = generatePromptPayPayload(promptPayId, cartSubtotal);
    }

    if (payload) {
      QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(url => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(''); });
    } else {
      setQrDataUrl('');
    }
    return () => { cancelled = true; };
  }, [isCheckoutOpen, cartSubtotal, qrType, kshopRawPayload, promptPayId]);

  // เมนูที่เพิ่มอัตโนมัติเมื่อสั่ง (Bundled Items) = เมนูจริงที่แถมไปกับจานนี้
  // ลงตะกร้าเป็นรายการของตัวเองราคา ฿0 เหมือนฝั่งพนักงานสั่ง ครัวจะได้เห็นเป็นคนละรายการ
  const bundledRowsFor = (food, dining) => {
    const ids = Array.isArray(food.bundledItems) ? food.bundledItems : [];
    const rows = [];
    ids.forEach((bundledId, idx) => {
      const bundledFood = rawMenu.find(m => String(m.id) === String(bundledId));
      if (!bundledFood) return;
      rows.push({
        cartId: Date.now() + Math.random() + idx,
        food: { ...bundledFood, price: 0, priceName: '', isBundled: true },
        quantity: 1,
        allPopups: [],
        dining,
        fromPopupOf: food.name
      });
    });
    return rows;
  };

  // รายการที่เหมือนกันเป๊ะ (เมนูเดียวกัน ไม่มีตัวเลือก มาจากจานเดียวกัน) ให้บวกจำนวนแทนเพิ่มบรรทัดซ้ำ
  const mergeRow = (list, row) => {
    const plain = (r) => !r.allPopups || r.allPopups.length === 0;
    const idx = list.findIndex(c =>
      String(c.food.id) === String(row.food.id) &&
      (c.fromPopupOf || '') === (row.fromPopupOf || '') &&
      // หมายเหตุคนละแบบ = คนละบรรทัด ครัวจะได้ไม่ทำรวมกันเป็นจานเดียว
      (c.note || '') === (row.note || '') &&
      plain(c) && plain(row)
    );
    if (idx >= 0) return list.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + row.quantity } : c));
    return [...list, row];
  };

  const handleAddToCartDirect = (food) => {
    const dining = orderType === 'takeaway' ? TAKEAWAY_DINING : DINE_IN_DINING;
    const rows = [
      { cartId: Date.now() + Math.random(), food, quantity: 1, allPopups: [], dining },
      ...bundledRowsFor(food, dining)
    ];
    setCart(rows.reduce(mergeRow, cart));
  };

  const handleFoodClick = (food) => {
    // Check if food has popups/options configured
    if (food.hasPopup1 || food.hasPopup2 || food.hasPopup3 || food.hasPopup4 || food.hasPopup5 || food.hasPopup6 || (food.priceOptions && food.priceOptions.length > 1)) {
      setSelectedFood(food);
    } else {
      handleAddToCartDirect(food);
    }
  };

  // รูปขยาย: ดันประวัติไว้ 1 ขั้น ให้ปุ่มย้อนกลับของมือถือปิดรูปแทนการออกจากหน้า
  // (คง state เดิมของ router ไว้ เพื่อไม่ให้ router มองว่าเปลี่ยนหน้า)
  const isPreviewOpen = !!previewFood;
  useEffect(() => {
    if (!isPreviewOpen) return;
    window.history.pushState({ ...(window.history.state || {}), kioskImgPreview: true }, '');
    const onPop = () => setPreviewFood(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isPreviewOpen]);

  const closePreview = () => {
    if (window.history.state?.kioskImgPreview) window.history.back();
    else setPreviewFood(null);
  };

  const foodImageSrc = (food) => food.image || `/images/menu/${food.id}.png`;

  // หมายเหตุฝั่งลูกค้าสั่งเอง — สวิตช์พิมพ์เองแยกจากหน้าขาย (ค่าเริ่มต้นคือเลือกได้เฉพาะปุ่ม)
  const kioskNoteConfig = useMemo(() => resolveNoteConfig(settings, { kiosk: true }), [settings]);

  const handleConfirmWizardOrder = (rawFood, orderDetails) => {
    const chosenPrice = orderDetails?.selectedPrice;
    const baseFood = chosenPrice ? { ...rawFood, price: Number(chosenPrice.price) || 0, priceName: chosenPrice.name } : rawFood;
    const dining = orderType === 'takeaway' ? TAKEAWAY_DINING : (orderDetails.dining || DINE_IN_DINING);

    const rows = [{
      cartId: Date.now() + Math.random(),
      food: baseFood,
      quantity: 1,
      allPopups: orderDetails.allPopups || [],
      note: orderDetails.note || '',
      dining
    }];

    // ป๊อปอัพที่ตั้งให้ "แยกเป็นรายการต่างหาก" — ลงตะกร้าเป็นรายการของตัวเอง
    // จะได้ขึ้นคนละบรรทัดในบิล/ใบครัว เหมือนฝั่งพนักงานสั่ง
    (orderDetails.separateItems || []).forEach((row, idx) => {
      rows.push({
        cartId: Date.now() + Math.random() + idx + 1,
        food: row.food,
        quantity: 1,
        allPopups: row.options || [],
        dining,
        fromPopupOf: baseFood.name
      });
    });

    setCart([...rows, ...bundledRowsFor(baseFood, dining)].reduce(mergeRow, cart));
    setSelectedFood(null);
  };

  const handleUpdateQty = (cartId, delta) => {
    setCart(cart.map(item => {
      if (item.cartId === cartId) {
        const n = item.quantity + delta;
        return n > 0 ? { ...item, quantity: n } : null;
      }
      return item;
    }).filter(Boolean));
  };

  // ── บันทึกรูป QR ลงเครื่อง ──
  // ลูกค้าถือมือถือเครื่องเดียว จะสแกน QR บนจอตัวเองไม่ได้ ต้องเซฟรูปไว้ก่อน
  // แล้วเข้าแอปธนาคาร → "สแกนจากรูปภาพ/แกลเลอรี" ถึงจะโอนได้
  // มือถือส่วนใหญ่ใช้ Web Share (มีเมนู "บันทึกรูปภาพ" ให้เลย) ส่วนเครื่องที่ไม่มีค่อยตกไปใช้ลิงก์ดาวน์โหลด
  const handleSaveQr = async () => {
    const src = qrType === 'static' ? staticQrUrl : qrDataUrl;
    if (!src) return;
    setQrSaveState('');
    const fileName = `promptpay-table${tableNo}-${Math.round(cartSubtotal)}baht.png`;

    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], fileName, { type: blob.type || 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          setQrSaveState('saved');
          return;
        } catch (err) {
          // ผู้ใช้กดยกเลิกแผงแชร์เอง = ไม่ใช่ข้อผิดพลาด ไม่ต้องขึ้นอะไร
          if (err && err.name === 'AbortError') return;
          // แชร์ไม่ได้ด้วยเหตุอื่น ค่อยลองดาวน์โหลดต่อข้างล่าง
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setQrSaveState('saved');
    } catch (err) {
      console.error('save qr error:', err);
      setQrSaveState('error');
    }
  };

  const PAY_KEY = 'kiosk_pending_payment';
  const savePending = (snap) => { try { if (snap) sessionStorage.setItem(PAY_KEY, JSON.stringify(snap)); else sessionStorage.removeItem(PAY_KEY); } catch { /* ไม่มีที่เก็บ */ } };

  // เปิดหน้าใหม่/รีเฟรชระหว่างรอพนักงานยืนยัน → กลับมาที่หน้ารอเดิม
  useEffect(() => {
    try {
      const snap = JSON.parse(sessionStorage.getItem(PAY_KEY) || 'null');
      if (snap && snap.id) {
        paySessionRef.current = snap.id;
        setPaySnap(snap);
        if (snap.orderType) setOrderType(snap.orderType);
        setPayStage('waiting');
        setIsCheckoutOpen(true);
      }
    } catch { /* ข้อมูลเสีย ข้าม */ }
  }, []);

  // ลูกค้ากด "ฉันโอนเงินแล้ว" (หรือแจ้งอีกครั้งหลังร้านยังไม่พบยอด)
  const handleTransferDone = async () => {
    if (cart.length === 0 || payBusy) return;
    if (!paySessionRef.current) paySessionRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snap = {
      id: paySessionRef.current,
      total: cartSubtotal,
      orderType,
      tableNo,
      items: cart.map(item => {
        const unit = (Number(item.food.price) || 0) + (item.allPopups || []).reduce((sum, p) => sum + (Number(p.price) || 0), 0);
        return {
          name: lang === 'th' ? item.food.name : (item.food.nameEn || item.food.name),
          options: (item.allPopups || []).map(p => p.name).join(', '),
          qty: item.quantity,
          amount: unit * item.quantity
        };
      })
    };
    setPayBusy(true); setPayError('');
    const dining = orderType === 'takeaway' ? 'ห่อกลับบ้าน' : 'ทานที่ร้าน';
    const res = onRequestPayment
      ? await onRequestPayment(tableNo, cart, cartSubtotal, snap.id, dining)
      : { success: false, error: 'ระบบยังไม่พร้อม' };
    setPayBusy(false);
    if (!res || !res.success) {
      setPayError(lang === 'th'
        ? `แจ้งร้านไม่สำเร็จ${res && /Unknown action/i.test(res.error || '') ? ' (ระบบร้านยังไม่อัปเดต)' : ''} — กดอีกครั้ง หรือแจ้งพนักงาน`
        : 'Could not notify the shop — please try again or call our staff.');
      return;
    }
    setPaySnap(snap);
    savePending(snap);
    if (res.status === 'approved') {
      setOrderNumber(res.orderNumber || '');
      setPayStage('approved');
      savePending(null);
      setCart([]);
    } else {
      setPayStage('waiting');
    }
  };

  // ระหว่างรอ — ถามสถานะทุก 3 วินาที (เก็บฟังก์ชันไว้ใน ref: หน้าหลัก render ใหม่บ่อย ไม่ให้ตัวจับเวลาเริ่มใหม่ทุกครั้ง)
  const checkPaymentRef = React.useRef(onCheckPayment);
  checkPaymentRef.current = onCheckPayment;
  useEffect(() => {
    if (payStage !== 'waiting' || !paySessionRef.current) return;
    let alive = true;
    const tick = async () => {
      if (!checkPaymentRef.current) return;
      const st = await checkPaymentRef.current(paySessionRef.current);
      if (!alive || !st) return;
      if (st.status === 'approved') {
        setOrderNumber(st.orderNumber || '');
        setPayStage('approved');
        savePending(null);
        setCart([]);
      } else if (st.status === 'rejected') {
        setPayStage('rejected');
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [payStage]);

  // ชำระสำเร็จ → กลับไปหน้าเมนู พร้อมรับออเดอร์ใหม่ (รหัสรายการใหม่)
  const finishPayment = () => {
    setIsCheckoutOpen(false);
    setPayStage('');
    setPaySnap(null);
    setPayError('');
    setOrderNumber('');
    paySessionRef.current = '';
    savePending(null);
  };


  // ── หน้าแรกโชว์ครบทุกเมนู แยกเป็นบล็อกตามหมวด ──
  // เดิมกรองให้เห็นทีละหมวด ลูกค้าไม่รู้ว่ามีอะไรอีกบ้างถ้าไม่กดเปลี่ยนหมวด
  // ตอนนี้ไล่ดูรวดเดียวได้ ส่วนปุ่มหมวดหมู่เปลี่ยนหน้าที่เป็น "เลื่อนไปยังหมวดนั้น"
  // หมวดที่ตั้งเป็น "เฉพาะพนักงาน" ไม่แสดงที่นี่ (ป๊อปอัพยังใช้เมนูครบชุดตามเดิม)
  const menuSections = useMemo(() => {
    const shownMenu = liveMenu.filter(item => !item.noTakehomePrice && menuVisibleFor(item, categories, 'customer'));
    const sections = categories.filter(cat => categoryVisibleFor(cat, 'customer')).map(cat => ({
      slug: cat.slug,
      name: lang === 'th' ? cat.name : (cat.nameEn || cat.name),
      icon: cat.icon || '🍲',
      items: shownMenu.filter(item => {
        const primary = item.category || 'food';
        const extra = Array.isArray(item.categories) ? item.categories : [];
        return primary === cat.slug || extra.includes(cat.slug);
      })
    })).filter(section => section.items.length > 0);

    // เมนูที่หมวดของมันถูกลบ/เปลี่ยนชื่อไปแล้ว ต้องยังเห็นอยู่ ไม่ใช่หายไปเงียบ ๆ
    const shown = new Set(sections.flatMap(section => section.items.map(item => String(item.id))));
    const rest = shownMenu.filter(item => !shown.has(String(item.id)));
    if (rest.length > 0) {
      sections.push({ slug: '__other__', name: lang === 'th' ? 'เมนูอื่น ๆ' : 'Others', icon: '🍽️', items: rest });
    }
    return sections;
  }, [categories, liveMenu, lang]);

  const totalMenuCount = menuSections.reduce((sum, section) => sum + section.items.length, 0);

  // หมวดที่กำลังดูอยู่ — อ่านจาก menuSections เพราะมี "เมนูอื่น ๆ" ที่ไม่มีใน categories ด้วย
  const activeCat = menuSections.find(section => section.slug === activeCategory) || menuSections[0];

  // หัวจอ + แถบหมวดหมู่เป็น sticky ทับเนื้อหาอยู่ ต้องรู้ความสูงจริงเพื่อ
  //   ก) วางแถบหมวดหมู่ให้พอดีใต้หัวจอ  ข) เลื่อนไปหมวดแล้วหัวข้อไม่โดนบัง
  const headerRef = React.useRef(null);
  const catBarRef = React.useRef(null);
  const sectionRefs = React.useRef({});
  const [headerH, setHeaderH] = useState(0);
  const [catBarH, setCatBarH] = useState(0);

  useEffect(() => {
    const measure = () => {
      setHeaderH(headerRef.current ? headerRef.current.offsetHeight : 0);
      setCatBarH(catBarRef.current ? catBarRef.current.offsetHeight : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [lang, menuSections.length]);

  // หมวดที่เลือกอยู่หายไปจากเมนู (ร้านลบ/ปิดขาย) ให้กลับไปหมวดแรกที่ยังมีของ
  useEffect(() => {
    if (menuSections.length > 0 && !menuSections.some(section => section.slug === activeCategory)) {
      setActiveCategory(menuSections[0].slug);
    }
  }, [menuSections, activeCategory]);

  const scrollOffset = headerH + catBarH + 8;

  const scrollToCategory = (slug) => {
    setActiveCategory(slug);
    setShowCategoryMenu(false);
    // รอให้แผงหมวดหมู่ปิดก่อน ค่อยเลื่อน ไม่งั้นตำแหน่งเพี้ยนตอนคืนสกอร์ล
    requestAnimationFrame(() => {
      const el = sectionRefs.current[slug];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // เลื่อนอ่านไปถึงหมวดไหน ให้ปุ่มด้านบนโชว์ชื่อหมวดนั้น ลูกค้าจะได้รู้ว่าอยู่ตรงไหนของเมนู
  useEffect(() => {
    const els = menuSections.map(section => sectionRefs.current[section.slug]).filter(Boolean);
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const slug = visible[0] && visible[0].target.dataset.slug;
      if (slug) setActiveCategory(slug);
    }, { rootMargin: `-${scrollOffset + 4}px 0px -65% 0px`, threshold: 0 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [menuSections, scrollOffset]);

  // การ์ดเมนูหนึ่งใบ — ใช้ร่วมกันทุกหมวด
  const renderFoodCard = (food) => {
    const inCartItems = cart.filter(c => c.food.id === food.id);
    const inCartQty = inCartItems.reduce((sum, c) => sum + c.quantity, 0);
    const price = Number(food.price) || 0;

    return (
      <div
        key={food.id}
        /* ตั้งใจไม่ให้กดที่การ์ด/รูปแล้วสั่ง — ลูกค้ามักแตะรูปเพื่อดูให้ชัด
           ถ้าแตะแล้วเพิ่มของทันทีจะได้ของที่ไม่ได้ตั้งใจสั่ง ต้องกดปุ่ม "+ สั่ง" เท่านั้น */
        style={{
          background: '#ffffff', borderRadius: '18px',
          border: '1px solid #e2e8f0', overflow: 'hidden',
          boxShadow: '0 6px 20px rgba(0,0,0,0.04)',
          transition: 'transform 0.15s',
          display: 'flex', flexDirection: 'column', height: '100%',
          position: 'relative'
        }}
      >
        {/* Image Container with high visual impact */}
        {/* แตะรูป = เปิดดูรูปขยาย (ไม่เพิ่มลงตะกร้า) */}
        <div
          onClick={() => setPreviewFood(food)}
          style={{ width: '100%', aspectRatio: '1 / 1', position: 'relative', background: '#f1f5f9', cursor: 'zoom-in' }}
        >
          <img
            src={foodImageSrc(food)}
            alt={food.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { e.target.src = '/images/menu/default.png'; }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          
          <div style={{
            position: 'absolute', top: '8px', left: '8px',
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'rgba(15,23,42,0.55)', color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
          }}>
            <ZoomIn size={15} />
          </div>

          {/* Badge & Price tag overlay */}
          <div style={{
            position: 'absolute', bottom: '8px', right: '8px',
            background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(8px)',
            color: '#ffffff', padding: '0.28rem 0.6rem', borderRadius: '20px',
            fontWeight: '900', fontSize: '0.92rem', border: '1.5px solid rgba(255,255,255,0.2)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}>
            <span style={{ color: '#ea580c', fontSize: '0.75rem', marginRight: '2px' }}>฿</span>
            {price.toLocaleString()}
          </div>

          {inCartQty > 0 && (
            <div style={{
              position: 'absolute', top: '8px', right: '8px',
              background: '#ea580c', color: 'white', fontWeight: '900',
              fontSize: '0.8rem', borderRadius: '50%', width: '26px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(234,88,12,0.4)', border: '2px solid white'
            }}>
              {inCartQty}
            </div>
          )}
        </div>

        {/* Content info */}
        <div style={{ padding: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <div>
            {/* ตัดชื่อที่ 2 บรรทัด เพื่อให้การ์ดในแถวเดียวกันสูงเท่ากัน */}
            <h4 style={{
              fontSize: '0.95rem', fontWeight: '800', margin: 0, color: '#0f172a', lineHeight: 1.3,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
            }}>
              {lang === 'th' ? food.name : (food.nameEn || food.name)}
            </h4>
            {food.description && (
              <p style={{
                fontSize: '0.74rem', color: '#64748b', margin: '0.2rem 0 0 0', fontWeight: '500', lineHeight: 1.35,
                display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden'
              }}>
                {food.description}
              </p>
            )}
          </div>

          <button
            onClick={() => handleFoodClick(food)}
            style={{
              marginTop: 'auto',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: '#ffffff', border: 'none', borderRadius: '11px',
              padding: '0.6rem 0.5rem', fontWeight: '800', fontSize: '0.88rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              boxShadow: '0 4px 12px rgba(217,119,6,0.3)', width: '100%', fontFamily: 'inherit'
            }}
          >
            <Plus size={16} /> {lang === 'th' ? 'สั่ง' : 'Add'}
          </button>
        </div>
      </div>
    );
  };


  // ── จอแรก: ทานที่ร้าน / ห่อกลับบ้าน ──
  if (!orderType) {
    const bigBtn = (active) => ({
      display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', textAlign: 'left',
      padding: '1.25rem', borderRadius: 18, border: `2px solid ${active ? '#ea580c' : '#e2e8f0'}`,
      background: '#ffffff', cursor: 'pointer', fontFamily: 'inherit', color: '#0f172a',
      boxShadow: '0 6px 20px rgba(0,0,0,0.05)'
    });
    return (
      <div style={{ minHeight: '100dvh', background: '#f8fafc', width: '100%', maxWidth: 480, margin: '0 auto', padding: '1.5rem 1rem', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#0f172a' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <img src="/logo.png" alt="Logo" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{lang === 'th' ? 'เสน่ห์' : 'SA-NAE'}</div>
            </div>
          </div>
          <button onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 20, padding: '0.35rem 0.6rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Globe size={13} /> {lang === 'th' ? 'TH' : 'EN'}
          </button>
        </div>

        <>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, margin: '0 0 0.3rem' }}>{lang === 'th' ? 'ทานที่ร้าน หรือ ห่อกลับบ้าน?' : 'Dine in or take away?'}</h2>
          <p style={{ color: '#64748b', margin: '0 0 1.25rem' }}>{lang === 'th' ? 'ราคาในเมนูจะแสดงตามที่เลือก' : 'Menu prices follow your choice'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <button style={bigBtn(false)} onClick={() => chooseOrderType('dine_in')}>
              <span style={{ fontSize: '2.4rem' }}>🍽️</span>
              <b style={{ fontSize: '1.25rem' }}>{lang === 'th' ? 'ทานที่ร้าน' : 'Dine in'}</b>
            </button>
            <button style={bigBtn(false)} onClick={() => chooseOrderType('takeaway')}>
              <span style={{ fontSize: '2.4rem' }}>🛍️</span>
              <b style={{ fontSize: '1.25rem' }}>{lang === 'th' ? 'ห่อกลับบ้าน' : 'Take away'}</b>
            </button>
          </div>
        </>
      </div>
    );
  }

  return (
    <div style={{
      // 100dvh = ความสูงจอ "จริง" ตอนนั้น — 100vh บนมือถือจะนับรวมแถบที่อยู่เว็บที่ยุบ ๆ ยืด ๆ
      minHeight: '100dvh',
      background: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#0f172a',
      // กล่องนี้เป็นลูกของ .app-container ซึ่งเป็น flex column — พอใส่ margin auto
      // ตัวมันจะเลิก stretch แล้วกว้างตามเนื้อหา (ไปชน max-width 480) ทำให้จอ 320-430px
      // เลื่อนซ้ายขวาได้ ต้องกำหนด width 100% + min-width 0 บังคับให้กว้างเท่าจอเสมอ
      width: '100%',
      minWidth: 0,
      maxWidth: '480px',
      margin: '0 auto',
      boxShadow: '0 0 30px rgba(0,0,0,0.1)',
      position: 'relative',
      // เผื่อที่ให้แถบตะกร้าลอย + แถบ home ของ iPhone
      paddingBottom: 'calc(110px + env(safe-area-inset-bottom))',
      WebkitTapHighlightColor: 'transparent',
      overflowX: 'hidden'
    }}>

      {/* ─── Kiosk Header (Vertical Top Sticky) ─── */}
      <header ref={headerRef} style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        // ระยะห่างและขนาดตัวอักษรยืดตามความกว้างจอ (clamp) — จอ 320px จะไม่แน่นจนชื่อร้านตกบรรทัด
        padding: 'clamp(0.6rem, 3vw, 0.85rem) clamp(0.75rem, 4vw, 1.25rem)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.5rem',
        boxShadow: '0 4px 15px rgba(0,0,0,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(0.4rem, 2vw, 0.75rem)', minWidth: 0, flex: 1 }}>
          <img src="/logo.png" alt="Logo" style={{ width: 'clamp(32px, 10vw, 42px)', height: 'clamp(32px, 10vw, 42px)', borderRadius: '12px', objectFit: 'cover', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 'clamp(0.92rem, 4.2vw, 1.15rem)', fontWeight: '800', margin: 0, color: '#0f172a', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {lang === 'th' ? 'เสน่ห์' : 'SA-NAE'}
            </h1>
            <span style={{ fontSize: 'clamp(0.66rem, 2.8vw, 0.78rem)', color: '#ea580c', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <Utensils size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {lang === 'th' ? 'ระบบสั่งอาหารด้วยตนเอง' : 'Self-Ordering Kiosk'}
              </span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          <div style={{
            background: '#fff7ed', border: '1.5px solid #ffedd5',
            color: '#c2410c', fontWeight: '800', fontSize: 'clamp(0.72rem, 3vw, 0.85rem)',
            padding: '0.35rem 0.6rem', borderRadius: '20px', whiteSpace: 'nowrap'
          }}>
            {orderType === 'takeaway'
              ? `🛍️ ${lang === 'th' ? 'ห่อกลับบ้าน' : 'Take away'}`
              : `🍽️ ${lang === 'th' ? 'ทานที่ร้าน' : 'Dine in'}`}
          </div>
          <button onClick={changeOrderType} title={lang === 'th' ? 'เปลี่ยนทานที่ร้าน/ห่อกลับบ้าน' : 'Change'}
            style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '20px', padding: '0.35rem 0.55rem', color: '#0f172a', fontWeight: '700', fontSize: 'clamp(0.66rem, 2.8vw, 0.76rem)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>
            {orderType === 'takeaway' ? (lang === 'th' ? 'ราคา Takehome' : 'Takehome') : (lang === 'th' ? 'ราคาปกติ' : 'Regular')} ⇄
          </button>
          <button
            onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            style={{
              background: '#f1f5f9', border: '1px solid #cbd5e1',
              borderRadius: '20px', padding: '0.35rem 0.55rem',
              color: '#0f172a', fontWeight: '700', fontSize: 'clamp(0.7rem, 3vw, 0.8rem)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
              whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            <Globe size={13} /> {lang === 'th' ? 'TH' : 'EN'}
          </button>
        </div>
      </header>

      {/* ─── Hero Banner ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        color: '#ffffff', padding: '1.25rem',
        margin: '0.75rem 1rem', borderRadius: '16px',
        boxShadow: '0 8px 20px rgba(15,23,42,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div>
          <span style={{ background: '#ea580c', color: '#ffffff', fontSize: '0.7rem', fontWeight: '800', padding: '2px 8px', borderRadius: '10px', textTransform: 'uppercase' }}>
            {lang === 'th' ? 'สั่งง่าย จ่ายไว' : 'Fast Ordering'}
          </span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '900', margin: '0.35rem 0 0.2rem 0', color: '#ffffff' }}>
            {lang === 'th' ? 'เลือกเมนูอร่อยได้เลย!' : 'Choose Your Dish!'}
          </h2>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
            {lang === 'th' ? 'สแกน QR ชำระเงินง่ายๆ ออเดอร์ตรงเข้าครัวทันที' : 'Scan QR to pay, orders sent directly to kitchen'}
          </p>
        </div>
        <Sparkles size={36} color="#f59e0b" style={{ flexShrink: 0, opacity: 0.9 }} />
      </div>

      {/* ─── แถบหมวดหมู่ (3 ขีด) — กดแล้วเลื่อนไปยังหมวดนั้นในหน้าเดียวกัน ─── */}
      <div
        ref={catBarRef}
        style={{
          position: 'sticky', top: headerH, zIndex: 95,
          background: '#f8fafc', padding: '0.5rem 1rem 0.6rem'
        }}
      >
        <button
          onClick={() => setShowCategoryMenu(true)}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.75rem 0.9rem', borderRadius: '14px',
            border: '2px solid #e2e8f0', background: '#ffffff',
            color: '#0f172a', fontWeight: '800', fontSize: '0.95rem',
            fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            boxShadow: '0 4px 12px rgba(15,23,42,0.05)'
          }}
        >
          <Menu size={20} color="#ea580c" />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeCat ? `${activeCat.icon} ${activeCat.name}` : (lang === 'th' ? 'เลือกหมวดหมู่' : 'Choose a category')}
          </span>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '700', flexShrink: 0 }}>
            {lang === 'th' ? 'ข้ามไปหมวด' : 'Jump to'}
          </span>
          <ChevronRight size={18} color="#94a3b8" style={{ transform: 'rotate(90deg)', flexShrink: 0 }} />
        </button>
      </div>

      {/* ─── เมนูทั้งหมด แยกเป็นบล็อกตามหมวด ไล่ดูรวดเดียวได้ ─── */}
      <main style={{ padding: '0 1rem' }}>
        {menuSections.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontWeight: '700', padding: '2.5rem 1rem' }}>
            {lang === 'th' ? 'ยังไม่มีเมนูให้สั่งตอนนี้' : 'No menu items available right now.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '700', marginBottom: '0.75rem' }}>
              {lang === 'th'
                ? `ทั้งหมด ${totalMenuCount} รายการ · ${menuSections.length} หมวด — เลื่อนดูได้ทั้งหน้า`
                : `${totalMenuCount} items in ${menuSections.length} categories — scroll to browse`}
            </div>

            {menuSections.map(section => (
              <section
                key={section.slug}
                data-slug={section.slug}
                ref={el => { sectionRefs.current[section.slug] = el; }}
                style={{ scrollMarginTop: `${scrollOffset}px`, marginBottom: '1.5rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
                    <span style={{ flexShrink: 0 }}>{section.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.name}</span>
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '700', flexShrink: 0 }}>
                    {section.items.length} {lang === 'th' ? 'รายการ' : 'items'}
                  </span>
                </div>

                {/* การ์ดเมนูแบบตาราง 2 คอลัมน์ รูปเป็นสี่เหลี่ยมจัตุรัส — เห็นเมนูได้มากขึ้นต่อหนึ่งหน้าจอ */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', alignItems: 'start' }}>
                  {section.items.map(renderFoodCard)}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {/* ─── Sticky Bottom Floating Cart Bar ─── */}
      {cart.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 'calc(15px + env(safe-area-inset-bottom))',
          left: '50%', transform: 'translateX(-50%)',
          width: 'calc(100% - 2rem)', maxWidth: '440px', zIndex: 90
        }}>
          <button
            onClick={() => setIsCheckoutOpen(true)}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              color: '#ffffff', border: '1.5px solid #334155', borderRadius: '20px',
              padding: '0.95rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: '0 12px 30px rgba(15,23,42,0.4)', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                background: '#ea580c', color: 'white', borderRadius: '50%',
                width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: '900', fontSize: '0.95rem'
              }}>
                {totalItemsCount}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: '600' }}>
                  {lang === 'th' ? 'ตะกร้าของคุณ' : 'Your Cart'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: '900', color: '#ffffff' }}>
                  ฿{cartSubtotal.toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: '#ffffff', fontWeight: '800', fontSize: '0.95rem',
              padding: '0.6rem 1.1rem', borderRadius: '14px',
              display: 'flex', alignItems: 'center', gap: '4px'
            }}>
              <span>{lang === 'th' ? 'ดูรายการ & ชำระเงิน' : 'Checkout'}</span>
              <ChevronRight size={18} />
            </div>
          </button>
        </div>
      )}

      {/* ─── รูปเมนูขยายเต็มจอ ─── */}
      {previewFood && (
        <div
          onClick={closePreview}
          style={{
            position: 'fixed', inset: 0, zIndex: 950,
            background: 'rgba(2,6,23,0.92)',
            display: 'flex', flexDirection: 'column'
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); closePreview(); }}
            aria-label={lang === 'th' ? 'ปิด' : 'Close'}
            style={{
              position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', right: '12px', zIndex: 1,
              width: '42px', height: '42px', borderRadius: '50%', border: 'none',
              background: 'rgba(255,255,255,0.15)', color: '#ffffff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <X size={22} />
          </button>

          <ZoomableImage
            key={previewFood.id}
            src={foodImageSrc(previewFood)}
            alt={previewFood.name}
            onBackdropTap={closePreview}
            hint={lang === 'th' ? 'ใช้สองนิ้วซูม หรือแตะสองครั้ง' : 'Pinch or double-tap to zoom'}
          />

          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#ffffff', width: '100%', maxWidth: '480px', margin: '0 auto',
              borderTopLeftRadius: '22px', borderTopRightRadius: '22px',
              padding: '1rem', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
              display: 'flex', flexDirection: 'column', gap: '0.5rem'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '900', color: '#0f172a', lineHeight: 1.3 }}>
              {lang === 'th' ? previewFood.name : (previewFood.nameEn || previewFood.name)}
            </h3>
            {previewFood.description && (
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', lineHeight: 1.45, maxHeight: '20dvh', overflowY: 'auto' }}>
                {previewFood.description}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '0.25rem' }}>
              <div style={{ fontSize: '1.35rem', fontWeight: '900', color: '#ea580c' }}>
                ฿{(Number(previewFood.price) || 0).toLocaleString()}
              </div>
              <button
                onClick={() => { const food = previewFood; closePreview(); handleFoodClick(food); }}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#ffffff', border: 'none', borderRadius: '11px',
                  padding: '0.75rem 1.4rem', fontWeight: '800', fontSize: '1rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                  boxShadow: '0 4px 12px rgba(217,119,6,0.3)', fontFamily: 'inherit'
                }}
              >
                <Plus size={18} /> {lang === 'th' ? 'สั่ง' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Order Wizard Option Modal ─── */}
      {selectedFood && (
        <OrderWizardModal
          food={selectedFood}
          lang={lang}
          liveMenu={liveMenu}
          categories={categories}
          basePrice={Number(selectedFood.price) || 0}
          askDining={false}
          hasPriceForCustomerType={(m) => !m.noTakehomePrice}
          noteOptions={kioskNoteConfig.options}
          allowCustomNote={kioskNoteConfig.allowCustom}
          onClose={() => setSelectedFood(null)}
          onConfirm={handleConfirmWizardOrder}
        />
      )}

      {/* ─── แผงเลือกหมวดหมู่ (เปิดจากปุ่ม 3 ขีด) ─── */}
      {showCategoryMenu && (
        <div
          onClick={() => setShowCategoryMenu(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 900,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#ffffff', width: '100%', maxWidth: '480px',
              borderTopLeftRadius: '22px', borderTopRightRadius: '22px',
              padding: '1rem',
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
              maxHeight: '80dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '900', color: '#0f172a' }}>
                {lang === 'th' ? 'หมวดหมู่' : 'Categories'}
              </h3>
              <button
                onClick={() => setShowCategoryMenu(false)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={18} color="#0f172a" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {menuSections.map(cat => {
                const isActive = cat.slug === activeCategory;
                // หมวดที่ไม่มีเมนูไม่ต้องโชว์ (menuSections กรองออกให้แล้ว) กดแล้วต้องเจอของเสมอ
                const count = cat.items.length;
                return (
                  <button
                    key={cat.slug}
                    onClick={() => scrollToCategory(cat.slug)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.85rem 0.9rem', borderRadius: '13px',
                      border: `2px solid ${isActive ? '#ea580c' : '#e2e8f0'}`,
                      background: isActive ? '#fff7ed' : '#ffffff',
                      color: '#0f172a', fontWeight: '800', fontSize: '0.95rem',
                      fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%'
                    }}
                  >
                    <span style={{ flexShrink: 0, fontSize: '1.15rem' }}>{cat.icon}</span>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {cat.name}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#94a3b8', flexShrink: 0 }}>
                      {count}
                    </span>
                    {isActive && <CheckCircle size={17} color="#ea580c" style={{ flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Self-Checkout & PromptPay QR Modal ─── */}
      {isCheckoutOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
          zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }} onClick={() => { if (payStage !== 'waiting' && payStage !== 'approved') setIsCheckoutOpen(false); }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#ffffff', width: '100%', maxWidth: '480px',
              borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
              padding: '1.25rem',
              paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
              maxHeight: '90dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.2)', color: '#0f172a'
            }}
          >
            {payStage === 'approved' ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                <CheckCircle size={64} color="#16a34a" style={{ margin: '0 auto 0.75rem' }} />
                <h3 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#16a34a', marginBottom: '0.4rem' }}>
                  {lang === 'th' ? 'ชำระเงินสำเร็จ!' : 'Payment confirmed!'}
                </h3>
                <p style={{ color: '#475569', fontSize: '0.95rem', fontWeight: '600', marginBottom: '1.25rem' }}>
                  {lang === 'th' ? 'ร้านได้รับเงินแล้ว กำลังเตรียมอาหารให้ครับ' : 'We received your payment and are preparing your food.'}
                </p>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '1rem', color: '#166534', fontWeight: '700', textAlign: 'left', lineHeight: 1.8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{lang === 'th' ? 'ประเภท' : 'Type'}</span><span>{(paySnap?.orderType || orderType) === 'takeaway' ? (lang === 'th' ? '🛍️ ห่อกลับบ้าน' : '🛍️ Take away') : (lang === 'th' ? '🍽️ ทานที่ร้าน' : '🍽️ Dine in')}</span></div>
                  {orderNumber && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{lang === 'th' ? 'เลขที่บิล' : 'Bill no.'}</span><strong>{orderNumber}</strong></div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{lang === 'th' ? 'ยอดชำระ' : 'Paid'}</span><strong>฿{Number(paySnap?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', fontWeight: '600', opacity: 0.85 }}>
                    {lang === 'th' ? 'ชำระเรียบร้อยแล้ว ไม่ต้องจ่ายซ้ำที่เคาน์เตอร์' : 'Already paid — no need to pay again at the counter.'}
                  </div>
                </div>
                <button onClick={finishPayment}
                  style={{ width: '100%', marginTop: '1.25rem', background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', color: '#fff', border: 'none', borderRadius: '14px', padding: '1rem', fontWeight: '900', fontSize: '1.05rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  🍽️ {lang === 'th' ? 'สั่งอาหารเพิ่ม' : 'Order more'}
                </button>
              </div>
            ) : payStage === 'waiting' ? (
              <div style={{ textAlign: 'center', padding: '1.25rem 0.25rem' }}>
                <div style={{ width: 64, height: 64, margin: '0.5rem auto 0.75rem', borderRadius: '50%', border: '7px solid #fde68a', borderTopColor: '#f59e0b', animation: 'kioskspin 1s linear infinite' }} />
                <style>{'@keyframes kioskspin { to { transform: rotate(360deg); } }'}</style>
                <h3 style={{ fontSize: '1.3rem', fontWeight: '900', color: '#b45309', margin: '0 0 0.35rem' }}>
                  {lang === 'th' ? 'กำลังตรวจสอบการโอน...' : 'Checking your transfer...'}
                </h3>
                <p style={{ color: '#64748b', fontSize: '0.88rem', fontWeight: '600', margin: '0 0 1rem', lineHeight: 1.5 }}>
                  {lang === 'th' ? 'พนักงานกำลังเช็กยอดเงินเข้า กรุณาอย่าปิดหน้านี้' : 'Our staff are confirming the payment. Please keep this page open.'}
                </p>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem 0.9rem', textAlign: 'left' }}>
                  {(paySnap?.items || []).map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.88rem', padding: '0.15rem 0' }}>
                      <span>{it.qty}× {it.name}{it.options ? <span style={{ color: '#64748b' }}> ({it.options})</span> : null}</span>
                      <b>฿{Number(it.amount || 0).toLocaleString()}</b>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', marginTop: '0.4rem', paddingTop: '0.45rem', fontWeight: '900' }}>
                    <span>{lang === 'th' ? 'ยอดโอน' : 'Amount'}</span>
                    <span style={{ color: '#ea580c' }}>฿{Number(paySnap?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '1rem' }}>
                  {lang === 'th' ? 'รอนานเกิน 5 นาที กรุณาแจ้งพนักงาน' : 'Waiting more than 5 minutes? Please call our staff.'}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShoppingBag color="#ea580c" size={22} />
                    {lang === 'th' ? 'สรุปรายการ & ชำระเงิน' : 'Checkout & Self-Payment'}
                  </h3>
                  <button onClick={() => setIsCheckoutOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <X size={24} color="#0f172a" />
                  </button>
                </div>

                {/* Cart items list preview */}
                <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {cart.map(item => (
                    <div key={item.cartId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div>
                        <div style={{ fontWeight: '800', fontSize: '0.92rem', color: '#0f172a' }}>
                          {lang === 'th' ? item.food.name : (item.food.nameEn || item.food.name)}
                        </div>
                        {item.allPopups && item.allPopups.length > 0 && (
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {item.allPopups.map(p => p.name).join(', ')}
                          </div>
                        )}
                        {/* รายการที่แยกออกมาจากป๊อปอัพของอีกจาน */}
                        {item.fromPopupOf && (
                          <div style={{ fontSize: '0.72rem', color: '#1d4ed8', fontWeight: 700 }}>
                            {lang === 'th' ? `พ่วงกับ ${item.fromPopupOf}` : `with ${item.fromPopupOf}`}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '1px' }}>
                          <button onClick={() => handleUpdateQty(item.cartId, -1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#0f172a' }}><Minus size={14} /></button>
                          <span style={{ fontWeight: '800', fontSize: '0.85rem', padding: '0 4px', color: '#0f172a' }}>{item.quantity}</span>
                          <button onClick={() => handleUpdateQty(item.cartId, 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#0f172a' }}><Plus size={14} /></button>
                        </div>
                        <span style={{ fontWeight: '800', color: '#ea580c', fontSize: '0.95rem' }}>
                          ฿{((Number(item.food.price) + item.allPopups.reduce((s, p) => s + (Number(p.price) || 0), 0)) * item.quantity).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* PromptPay QR Code container */}
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '16px', padding: '1rem', textAlign: 'center', marginBottom: '1.25rem', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
                  <div style={{ color: '#003d6a', fontWeight: '900', fontSize: '1rem', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>
                    THAI QR PAYMENT
                  </div>
                  <div style={{ background: '#003d6a', color: 'white', fontWeight: '800', fontSize: '0.8rem', borderRadius: '6px', padding: '0.25rem', marginBottom: '0.75rem' }}>
                    PromptPay (พร้อมเพย์)
                  </div>

                  {qrType === 'static' ? (
                    <img src={staticQrUrl} alt="Static QR" style={{ width: '220px', height: '220px', margin: '0 auto', display: 'block' }} />
                  ) : qrDataUrl ? (
                    <img src={qrDataUrl} alt="Dynamic PromptPay QR" style={{ width: '220px', height: '220px', margin: '0 auto', display: 'block' }} />
                  ) : (
                    <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                      {lang === 'th' ? 'กำลังสร้าง QR Code...' : 'Generating QR Code...'}
                    </div>
                  )}

                  <div style={{ marginTop: '0.5rem', color: '#0f172a' }}>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{lang === 'th' ? 'ยอดชำระทั้งสิ้น' : 'Total Amount'}</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '900', color: '#ea580c' }}>
                      ฿{cartSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* บันทึกรูป QR ไว้เปิดในแอปธนาคาร (สแกนจอตัวเองด้วยเครื่องเดียวกันไม่ได้) */}
                  {(qrType === 'static' ? staticQrUrl : qrDataUrl) && (
                    <>
                      <button
                        onClick={handleSaveQr}
                        style={{
                          width: '100%', marginTop: '0.85rem',
                          background: '#ffffff', color: '#003d6a',
                          border: '1.5px solid #003d6a', borderRadius: '12px',
                          padding: '0.75rem', fontWeight: '900', fontSize: '0.95rem',
                          cursor: 'pointer', fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem'
                        }}
                      >
                        <Download size={18} />
                        {lang === 'th' ? 'บันทึกรูป QR' : 'Save QR image'}
                      </button>

                      <div style={{
                        marginTop: '0.4rem', fontSize: '0.74rem', lineHeight: 1.45, fontWeight: '600',
                        color: qrSaveState === 'error' ? '#b91c1c' : qrSaveState === 'saved' ? '#166534' : '#64748b'
                      }}>
                        {qrSaveState === 'error'
                          ? (lang === 'th' ? 'บันทึกรูปไม่สำเร็จ — กดค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ" แทนได้' : 'Could not save. Long-press the QR and choose “Save image” instead.')
                          : qrSaveState === 'saved'
                            ? (lang === 'th' ? 'บันทึกรูปแล้ว — เปิดแอปธนาคาร แล้วเลือกสแกนจากรูปภาพ' : 'Saved — open your bank app and scan from your photos.')
                            : (lang === 'th' ? 'จ่ายด้วยมือถือเครื่องนี้? บันทึกรูป QR ไว้ แล้วเปิดแอปธนาคาร → สแกนจากรูปภาพ/แกลเลอรี' : 'Paying from this phone? Save the QR, then use “scan from gallery” in your bank app.')}
                      </div>
                    </>
                  )}
                </div>

                {payStage === 'rejected' && (
                  <div style={{
                    background: '#fef2f2', border: '1.5px solid #fecaca', color: '#b91c1c',
                    borderRadius: '12px', padding: '0.85rem 1rem', marginBottom: '0.75rem',
                    fontSize: '0.88rem', fontWeight: '700', lineHeight: 1.5
                  }}>
                    ⚠️ {lang === 'th'
                      ? 'ร้านยังไม่พบยอดโอนของรายการนี้ — ตรวจสอบว่าโอนสำเร็จและยอดตรง แล้วกดแจ้งอีกครั้ง หรือแจ้งพนักงานพร้อมแสดงสลิป'
                      : 'The shop has not received this transfer yet. Check your transfer, then notify again or show your slip to our staff.'}
                  </div>
                )}

                {payError && (
                  <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', color: '#b91c1c', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.85rem', fontWeight: '700' }}>
                    ⚠️ {payError}
                  </div>
                )}

                <button
                  onClick={handleTransferDone}
                  disabled={payBusy || cart.length === 0}
                  style={{
                    width: '100%',
                    background: (payBusy || cart.length === 0) ? '#cbd5e1' : 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                    color: '#ffffff', border: 'none', borderRadius: '14px',
                    padding: '1rem', fontWeight: '900', fontSize: '1.1rem',
                    cursor: (payBusy || cart.length === 0) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    boxShadow: (payBusy || cart.length === 0) ? 'none' : '0 8px 20px rgba(22,163,74,0.35)',
                    fontFamily: 'inherit'
                  }}
                >
                  <CheckCircle size={22} />
                  {payBusy
                    ? (lang === 'th' ? 'กำลังแจ้งร้าน...' : 'Notifying the shop...')
                    : payStage === 'rejected'
                      ? (lang === 'th' ? 'แจ้งโอนอีกครั้ง' : 'Notify again')
                      : (lang === 'th' ? 'ฉันโอนเงินแล้ว' : 'I have transferred')}
                </button>
                <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.78rem', margin: '0.6rem 0 0', lineHeight: 1.45 }}>
                  {lang === 'th' ? 'สแกน QR แล้วโอนตามยอด จากนั้นกดปุ่มด้านบน พนักงานจะตรวจยอดแล้วส่งอาหารเข้าครัวให้' : 'Pay with the QR, then tap the button. Our staff will confirm and send your order to the kitchen.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerKiosk;
