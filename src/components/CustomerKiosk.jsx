import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ShoppingBag, CheckCircle, Globe, Plus, Minus, X, ChevronRight, ChevronLeft, Utensils, Menu, Download, ZoomIn, Pencil, Trash2, ShoppingCart, ChefHat, Receipt } from 'lucide-react';
import QRCode from 'qrcode';
import { generatePromptPayPayload, generateDynamicQRFromRaw } from '../utils/promptpay';
import OrderWizardModal from './OrderWizardModal';
import MenuImage from './MenuImage';
import { menuImageCandidates } from '../utils/menuImage';
import { categoryVisibleFor, menuVisibleFor } from '../utils/categoryVisibility';
import { resolveNoteConfig, getPriceOptions } from '../utils/popupConfig';
import { priceForSaleType } from '../utils/salePricing';
import { crmEnabled, lookupMember, crmCall, newCouponRef } from '../utils/crm';
import KioskBanner from './KioskBanner';
import Wordmark from './Wordmark';
import { BANNER_CLOSED_KEY, resolveBanner, activeSlides, hasPromoSlides } from '../utils/banner';

const TAKEAWAY_DINING = { id: 'takeaway', name: 'ห่อกลับบ้าน', nameEn: 'Takeaway' };
const DINE_IN_DINING = { id: 'dine_in', name: 'ทานที่ร้าน', nameEn: 'Dine-in' };
// ทานที่ร้านโดยไม่ได้สแกน QR โต๊ะ (เข้าจากหน้าแรกของเว็บ) → ไม่ถามโต๊ะ ลงชื่อนี้แทน
const DINE_IN_LABEL = 'ทานที่ร้าน';

// รูปเมนูขยาย: ใช้สองนิ้วซูม/ลากดู, แตะสองครั้งที่รูปเพื่อซูมเข้า-ออก
// ตอนซูมอยู่ แตะพื้นที่ว่างจะคืนขนาดเดิม (ยังไม่ปิด) — ตอนไม่ซูม แตะพื้นที่ว่างจะปิดรูป
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const ZoomableImage = ({ food, alt, onBackdropTap, hint }) => {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  // ระหว่างนิ้วแตะจอ ปิด transition ให้รูปตามนิ้วทันที
  const [touching, setTouching] = useState(false);
  const viewRef = useRef(view);
  const areaRef = useRef(null);
  const imgRef = useRef(null);
  const gesture = useRef(null);
  const lastTap = useRef(0);
  // แสดงรูปขนาดการ์ด (โหลดไว้แล้ว ขึ้นทันที) ก่อน แล้วค่อยสลับเป็นรูปคมชัดเมื่อโหลดเสร็จ — ไม่ต้องจ้องจอดำระหว่างรอ
  const [sharp, setSharp] = useState(false);
  useEffect(() => {
    const big = menuImageCandidates(food, 1080)[0];
    if (!big || big === menuImageCandidates(food, 640)[0]) return undefined;
    let alive = true;
    const pre = new Image();
    pre.referrerPolicy = 'no-referrer';
    pre.onload = () => { if (alive) setSharp(true); };
    pre.src = big;
    return () => { alive = false; pre.onload = null; };
  }, [food]);

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
      <MenuImage
        ref={imgRef}
        food={food}
        alt={alt}
        placeholderSize="4rem"
        width={sharp ? 1080 : 640}
        draggable={false}
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
          background: 'rgba(20, 20, 20, 0.7)', color: '#e4e4e4', fontSize: '0.75rem', fontWeight: '600',
          padding: '0.3rem 0.75rem', borderRadius: '20px', whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>
          {hint}
        </div>
      )}
    </div>
  );
};

// ── ตะกร้าที่เลือกค้างไว้ (sessionStorage = เฉพาะแท็บนี้ ปิดแท็บแล้วหายเอง) ──
const DRAFT_KEY = 'kiosk_cart_draft';
const DRAFT_MAX_AGE = 3 * 60 * 60 * 1000; // เกิน 3 ชั่วโมง = มื้อใหม่ เริ่มตะกร้าใหม่
function readKioskDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !Array.isArray(d.cart) || !(Date.now() - Number(d.at) < DRAFT_MAX_AGE)) return null;
    return { ...d, screen: (['sent', 'bill', 'pay'].includes(d.screen) || (d.screen === 'cart' && d.cart.length)) ? d.screen : 'menu' };
  } catch { return null; }
}
function saveKioskDraft(d) {
  try {
    if (!d.orderType && !d.cart.length) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch { /* ที่เก็บเต็ม/ปิดไว้ — ใช้ต่อได้ แค่จำตะกร้าไม่ได้ */ }
}

// ── สั่งก่อน จ่ายทีหลัง: บิลที่สั่งไปแล้ว (แต่ละรอบที่กด "ยืนยันสั่งอาหาร") ──
// เก็บใน localStorage แยกตามโต๊ะ — สลับไปแอปอื่น/ปิดแท็บแล้วกลับมาก็ยังเห็นบิลเดิม จ่ายต่อได้
// ถ้าดึงบิลจากร้านได้ (onLoadBill) ใช้ของร้านเป็นหลัก จะเห็นรายการที่คนอื่นในโต๊ะเดียวกันสั่งด้วย
const BILL_KEY = 'kiosk_open_bill';
const BILL_MAX_AGE = 8 * 60 * 60 * 1000;
function readBill(table) {
  try {
    const b = JSON.parse(localStorage.getItem(BILL_KEY) || 'null');
    if (!b || String(b.table) !== String(table) || !Array.isArray(b.rounds) || !(Date.now() - Number(b.at) < BILL_MAX_AGE)) return [];
    return b.rounds;
  } catch { return []; }
}
function saveBill(table, rounds) {
  try {
    if (!rounds || !rounds.length) localStorage.removeItem(BILL_KEY);
    else localStorage.setItem(BILL_KEY, JSON.stringify({ table, rounds, at: Date.now() }));
  } catch { /* ที่เก็บเต็ม/ปิดไว้ — บิลยังอยู่ที่ร้าน */ }
}
// ลูกค้าที่ไม่ได้สแกน QR โต๊ะ — ให้เลขคิวประจำเครื่อง บิลจะได้ไม่ปนกับลูกค้าคนอื่น
const QUEUE_KEY = 'kiosk_queue_no';
function deviceQueueNo() {
  try {
    let q = localStorage.getItem(QUEUE_KEY);
    if (!q) { q = String(100 + Math.floor(Math.random() * 900)); localStorage.setItem(QUEUE_KEY, q); }
    return q;
  } catch { return String(100 + Math.floor(Math.random() * 900)); }
}

// tables = ผังโต๊ะของสาขานี้ (ใช้ตอนเข้าหน้าลูกค้าจากหน้าแรกของเว็บ ที่ไม่มีเลขโต๊ะติดมากับลิงก์)
// ล็อกอินสมาชิกที่จำไว้ในมือถือลูกค้า (ตั้งจำนวนวันที่ หลังบ้าน > เมนูสมาชิก) — เข้าครั้งหน้าไม่ต้องยืนยันรหัสซ้ำ
const LOGIN_KEY = 'kiosk_member_login';
const readLogin = () => {
  try {
    const v = JSON.parse(localStorage.getItem(LOGIN_KEY) || 'null');
    if (v && v.member && Number(v.exp) > Date.now()) return v;
    if (v) localStorage.removeItem(LOGIN_KEY);
  } catch { /* ไม่มีที่เก็บ */ }
  return null;
};
// ttl = อายุการล็อกอิน (วินาที) ตามที่ระบบสมาชิกให้มา
const writeLogin = (v) => {
  try {
    if (v) localStorage.setItem(LOGIN_KEY, JSON.stringify({ member: v.member, token: v.token, exp: Date.now() + (Number(v.ttl) || 3600) * 1000 }));
    else localStorage.removeItem(LOGIN_KEY);
  } catch { /* ไม่มีที่เก็บ */ }
};

const CustomerKiosk = ({ liveMenu: rawMenu = [], categories = [], settings = {}, onSendOrder, onLoadBill, onRequestPayment, onCheckPayment, lang: initialLang = 'th', branchId = '' }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // QR โต๊ะมีเลขโต๊ะในลิงก์ (ส่งไปหลังบ้านให้พนักงานรู้โต๊ะ แต่ไม่แสดงให้ลูกค้าเห็น)
  const tableParam = searchParams.get('table') || searchParams.get('t') || '';
  // ตะกร้าที่เลือกค้างไว้ในแท็บนี้ — มือถือมักโหลดหน้าใหม่เองตอนสลับไปแอปธนาคารแล้วกลับมา
  // ถ้าไม่เก็บไว้ ลูกค้าโอนเงินแล้วกลับมาเจอตะกร้าว่าง กด "ฉันโอนเงินแล้ว" ไม่ได้
  const [draft] = useState(readKioskDraft);
  const [tableNo, setTableNo] = useState(tableParam || (draft && draft.tableNo) || '');

  // ทานที่ร้าน / ห่อกลับบ้าน — เลือกที่จอแรก ราคาทุกเมนูแสดงตามนี้
  // เสน่ห์: หน้าลูกค้าสั่งเองมีแค่ทานที่ร้าน (ไม่มีห่อกลับบ้าน) — ไม่ต้องเลือกที่จอแรก
  const [orderType, setOrderType] = useState(draft && draft.orderType === 'dine_in' ? 'dine_in' : '');

  // ── ระบบสมาชิก: ใส่เลขสมาชิก/เบอร์โทรก่อนสั่ง เพื่อสะสมแต้ม (ไม่บังคับ) ──
  // จำไว้ในแท็บนี้ รีเฟรชหน้าแล้วไม่ต้องกรอกใหม่
  const MEMBER_KEY = 'kiosk_member';
  const [crmOn, setCrmOn] = useState(false);
  const [member, setMember] = useState(() => {
    try { const m = JSON.parse(sessionStorage.getItem(MEMBER_KEY) || 'null'); if (m) return m; } catch { /* */ }
    const l = readLogin(); return l ? l.member : null;
  });
  const [memberInput, setMemberInput] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState('');
  const [crmChecked, setCrmChecked] = useState(false);
  useEffect(() => { let alive = true; crmEnabled().then(on => { if (alive) { setCrmOn(on); setCrmChecked(true); } }); return () => { alive = false; }; }, []);
  // ปุ่มสมัครสมาชิก: ขอลิงก์ LINE ไว้ก่อน (เปิดแท็บใหม่ทันทีที่กด ไม่โดนบล็อกป๊อปอัป)
  const [joinUrl, setJoinUrl] = useState('');
  const [joinOpened, setJoinOpened] = useState(false);
  useEffect(() => {
    if (!crmOn || member) return;
    let alive = true;
    crmCall('crmKioskJoinLink', { branchId }).then(res => { if (alive && res.success && res.url) setJoinUrl(res.url); });
    return () => { alive = false; };
  }, [crmOn, !!member, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepMember = (m) => {
    if (!m || !member || m.id !== member.id) { dropCoupon(); saveSession(VERIFY_KEY, null); setVerifyToken(''); setKWallet(null); setCardUrl(''); setCodeInput(''); writeLogin(null); setKQuota(null); }
    setMember(m); saveSession(MEMBER_KEY, m);
  };

  // ── คูปอง / แลกแต้มในหน้าตะกร้า ──
  // ต้องยืนยันตัวตนด้วยรหัส 4 หลักที่ส่งเข้า LINE ของสมาชิกก่อน (กันคนอื่นใส่เบอร์เราแล้วเอาแต้มไปใช้)
  // คูปองที่เลือกถูกจองไว้กับออเดอร์นี้ (kioskRef) และถูกตัดตอนพนักงานยืนยันยอดโอน
  const VERIFY_KEY = 'kiosk_member_verify';
  const COUPON_KEY = 'kiosk_coupons';
  const REF_KEY = 'kiosk_coupon_ref';
  function saveSession(key, v) { try { if (v) sessionStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v)); else sessionStorage.removeItem(key); } catch { /* ไม่มีที่เก็บ */ } }
  const readSession = (key, json) => { try { const v = sessionStorage.getItem(key); return json ? JSON.parse(v || 'null') : (v || ''); } catch { return json ? null : ''; } };
  const kioskRef = useRef(readSession(REF_KEY) || (() => { const r = newCouponRef('kiosk'); saveSession(REF_KEY, r); return r; })());
  const [verifyToken, setVerifyToken] = useState(() => {
    const t = readSession(VERIFY_KEY); if (t) return t;
    const l = readLogin(); return l && member && l.member.id === member.id ? (l.token || '') : '';
  });
  const [cardUrl, setCardUrl] = useState('');
  // ร้านเปิด "ยืนยันตัวตนก่อนใช้คูปอง" ไว้ไหม (CRM_KIOSK_VERIFY ที่เครื่อง API) — รู้จากคำตอบครั้งแรกที่ขอรหัส · ปิดอยู่ = แสดงคูปองทันที
  const [needVerify, setNeedVerify] = useState(false);
  const verified = !!verifyToken || !needVerify;
  // ── เมนูเฉพาะสมาชิก: ต้องล็อกอินสมาชิก = ใส่เลขสมาชิก + ยืนยันรหัส 6 หลักในบัตร LINE (บังคับเสมอ ไม่ขึ้นกับการตั้งค่าคูปอง) ──
  // หลังบ้านเลือกได้ว่าต้องใส่รหัส 6 หลักไหม (หลังบ้าน > เมนูสมาชิก) · null = ยังโหลดไม่เสร็จ (ถือว่าต้องใส่ไว้ก่อน)
  const [memberCfg, setMemberCfg] = useState({ requireCode: null, rememberDays: 30, limit: null });
  useEffect(() => {
    if (!crmOn) return undefined;
    let alive = true;
    crmCall('memberMenuConfig', {}).then(res => { if (alive && res && res.success) setMemberCfg({ requireCode: res.requireCode === true, rememberDays: Number(res.rememberDays) || 0, limit: res.limit || null }); });
    return () => { alive = false; };
  }, [crmOn]);
  const noCode = memberCfg.requireCode === false;
  const memberLoggedIn = !!(member && (verifyToken || noCode));
  // ไม่ต้องใส่รหัส → จำเลขสมาชิกไว้ในมือถือลูกค้าตามจำนวนวันที่ตั้ง (เข้าครั้งหน้าเป็นสมาชิกเลย)
  const rememberDays = memberCfg.rememberDays;
  useEffect(() => {
    if (!noCode || !member || verifyToken) return;
    writeLogin({ member, token: '', ttl: (rememberDays || 1) * 86400 });
  }, [noCode, member, verifyToken, rememberDays]);
  const isMemberOnly = (food) => !!(food && food.memberOnly === true);
  const [gateFood, setGateFood] = useState(null);    // เมนูที่ลูกค้ากดตอนยังไม่ล็อกอิน → เปิดหน้าต่างล็อกอิน
  const [gateMsg, setGateMsg] = useState('');
  const [memberNotice, setMemberNotice] = useState('');
  // โควตาเมนูสมาชิกวันนี้ (หลังบ้าน > เมนูสมาชิก) — { enabled, total: {limit,used,left}|null, menus: { [id]: { limit, used, left } } } · left null = ไม่จำกัด
  const [kQuota, setKQuota] = useState(null);
  const loadQuota = async () => {
    if (!member || !memberLoggedIn) { setKQuota(null); return; }
    const res = await crmCall('memberMenuQuota', { memberId: member.id, verifyToken, branchId });
    if (res && res.success) setKQuota(res);
    else if (res && res.needLogin) { setVerifyToken(''); saveSession(VERIFY_KEY, null); writeLogin(null); setKQuota(null); }
  };
  const loadQuotaRef = useRef(loadQuota);
  useEffect(() => { loadQuotaRef.current = loadQuota; });
  const kMemberId = member ? member.id : '';
  useEffect(() => { loadQuotaRef.current(); }, [kMemberId, verifyToken, noCode]);
  const [codeInput, setCodeInput] = useState('');
  const [kWallet, setKWallet] = useState(null);
  // คูปองที่ใช้กับออเดอร์นี้ (ใช้ได้หลายใบ ตามลำดับที่กด) · ระบบสมาชิกคิดส่วนลดและแบ่งชิ้นในตะกร้าให้แต่ละใบ
  const [kApplied, setKApplied] = useState(() => { const v = readSession(COUPON_KEY, true); return Array.isArray(v) ? v : []; });
  const [kBusy, setKBusy] = useState('');
  const [kMsg, setKMsg] = useState('');
  const keepApplied = (list) => { const l = list || []; setKApplied(l); saveSession(COUPON_KEY, l.length ? l : null); };
  // เปลี่ยนสมาชิก/ล้างตะกร้า → ปล่อยทุกใบที่ใช้อยู่
  function dropCoupon() {
    const list = readSession(COUPON_KEY, true);
    if (Array.isArray(list)) list.forEach(c => crmCall('crmKioskRelease', { couponId: c.id, ref: kioskRef.current, branchId }));
    keepApplied([]);
  }
  // ใช้คูปองไปแล้ว (พนักงานยืนยันยอด) → ออเดอร์ถัดไปเริ่มรหัสอ้างอิงใหม่
  const finishCoupon = () => { keepApplied([]); kioskRef.current = newCouponRef('kiosk'); saveSession(REF_KEY, kioskRef.current); setKWallet(null); };
  const kioskCall = async (action, extra) => {
    const res = await crmCall(action, { memberId: member && member.id, verifyToken, ref: kioskRef.current, branchId, items: kioskItems, ...extra });
    if (!res.success && res.verify) { setNeedVerify(true); setVerifyToken(''); saveSession(VERIFY_KEY, null); writeLogin(null); }
    return res;
  };
  const checkMember = async () => {
    const q = memberInput.trim();
    if (!q || memberBusy) return;
    setMemberBusy(true); setMemberErr('');
    const res = await lookupMember(q, branchId, { kiosk: true });
    setMemberBusy(false);
    if (res.success) { keepMember(res.member); setMemberInput(''); }
    else setMemberErr(res.notFound
      ? (lang === 'th' ? 'ไม่พบสมาชิก ตรวจเลขอีกครั้ง หรือกดสมัครผ่าน LINE ด้านล่าง' : 'Member not found')
      : (res.error || (lang === 'th' ? 'ตรวจสอบไม่สำเร็จ ลองอีกครั้ง' : 'Please try again')));
  };

  const chooseOrderType = (type) => {
    setOrderType(type);
    // สั่งก่อนจ่ายทีหลัง: ไม่มีเลขโต๊ะ → ใช้เลขคิวของเครื่องนี้ (โต๊ะรวมแบบเดิมจะทำให้บิลหลายคนปนกัน)
    if (!tableParam) setTableNo(`คิว ${deviceQueueNo()}`);
  };
  // ไม่มีระบบสมาชิก → ไม่มีอะไรให้ทำที่จอแรก เข้าหน้าเมนูเลย (มีระบบสมาชิก = จอแรกให้ใส่เลขสมาชิกก่อน)
  useEffect(() => {
    if (!orderType && crmChecked && !crmOn) chooseOrderType('dine_in');
  }, [orderType, crmChecked, crmOn]); // eslint-disable-line react-hooks/exhaustive-deps

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



  const [lang, setLang] = useState(initialLang);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.slug || 'food');
  const [cart, setCart] = useState((draft && draft.cart) || []);
  const [selectedFood, setSelectedFood] = useState(null);
  // เมนูที่กำลังเปิดดูรูปขยายเต็มจอ (แตะที่รูปในการ์ด)
  const [previewFood, setPreviewFood] = useState(null);
  // หน้าที่ลูกค้าอยู่: 'menu' เลือกเมนู → 'cart' ตรวจ/แก้ไขตะกร้า → 'pay' ชำระเงิน
  const [screen, setScreen] = useState((draft && draft.screen) || 'menu');
  const isCheckoutOpen = screen === 'pay';
  // รายการในตะกร้าที่กำลังเปิดแก้ไขตัวเลือก (ใช้ป๊อปอัพเดิมแบบทีละขั้น เปิดมาพร้อมที่เลือกไว้)
  const [editingRow, setEditingRow] = useState(null);
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

  // ── สั่งก่อน จ่ายทีหลัง ──
  // "ยืนยันสั่งอาหาร" → รายการเข้าบิลของโต๊ะทันที ครัวได้ใบเลย · ทานเสร็จแล้วค่อยกด "ชำระเงิน" จ่ายรวมทั้งบิล
  const [bill, setBill] = useState(() => readBill(tableParam || (draft && draft.tableNo) || ''));
  const [lastSent, setLastSent] = useState(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const sendSessionRef = useRef('');

  // ข้อความใต้ปุ่มบันทึกรูป QR ('saved' | 'error' | '')
  const [qrSaveState, setQrSaveState] = useState('');

  // แผงเลือกหมวดหมู่ (เปิดจากปุ่ม 3 ขีด)
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // ── แบนเนอร์สไลด์หัวจอ (หลังบ้าน > ตั้งค่าแบนเนอร์) ──
  const banner = useMemo(() => resolveBanner(settings), [settings]);
  // ค้างจอ/ปุ่มปิด ใช้เมื่อมีรูปแบนเนอร์จริง — เหลือแต่โลโก้ = หัวร้านธรรมดาแบบเดิม
  const bannerPromo = hasPromoSlides(banner);
  const bannerClosable = bannerPromo && banner.closable;
  const bannerSticky = bannerPromo && banner.sticky;
  // ลูกค้ากดปิดแล้ว ไม่โผล่อีกจนกว่าจะเปิดหน้าใหม่ (สแกน QR ใหม่)
  const [bannerClosed, setBannerClosed] = useState(() => {
    try { return sessionStorage.getItem(BANNER_CLOSED_KEY) === '1'; } catch { return false; }
  });
  const closeBanner = () => {
    setBannerClosed(true);
    try { sessionStorage.setItem(BANNER_CLOSED_KEY, '1'); } catch { /* โหมดส่วนตัวเขียนไม่ได้ — ปิดเฉพาะรอบนี้ */ }
  };
  const bannerShown = activeSlides(banner).length > 0 && !(bannerClosed && bannerClosable);
  // กดแบนเนอร์ที่ลิงก์ไปหมวดเมนูตั้งแต่จอแรก → จำไว้ก่อน เลือกทานที่ร้าน/ห่อกลับบ้านแล้วค่อยพาไป (ราคาสองแบบไม่เท่ากัน)
  const [pendingCat, setPendingCat] = useState('');
  // ความสูงแบนเนอร์ที่ค้างอยู่บนจอ — แถบหมวดหมู่ต้องเกาะต่อใต้แบนเนอร์ และเลื่อนไปหมวดแล้วหัวข้อไม่โดนบัง
  const bannerBoxRef = useRef(null);
  const [bannerH, setBannerH] = useState(0);
  useEffect(() => {
    const el = bannerBoxRef.current;
    if (!el) { setBannerH(0); return; }
    const measure = () => setBannerH(el.offsetHeight || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orderType, screen, bannerShown, bannerSticky]);
  const stickyBannerH = bannerSticky && bannerShown ? bannerH : 0;


  // PromptPay QR configurations
  const promptPayId = settings?.promptPayId || '004000001641684';
  const qrType = settings?.qrType || 'kshop_dynamic';
  const kshopRawPayload = settings?.kshopRawPayload || '00020101021130810016A00000067701011201150107536000315080214KB0000016416840320KPS004KB00000164168431690016A00000067701011301030040214KB0000016416840420KPS004KB00000164168453037645802TH6304A14E';
  const staticQrUrl = settings?.staticQrUrl || '/kshop_qr.png';

  // รายการในตะกร้าให้ระบบสมาชิกตรวจคูปองของฟรี/เงื่อนไขสินค้า (ราคารวมตัวเลือกเสริม)
  const kioskItems = cart.map(item => {
    let price = Number(item.food.price) || 0;
    if (item.allPopups) item.allPopups.forEach(p => price += Number(p.price || 0));
    return { menuId: item.food.id, name: item.food.name, price, qty: item.quantity, category: item.food.category };
  });

  // Calculate cart subtotal
  const cartSubtotal = cart.reduce((sum, item) => {
    let price = Number(item.food.price) || 0;
    if (item.allPopups) item.allPopups.forEach(p => price += Number(p.price || 0));
    return sum + (price * item.quantity);
  }, 0);

  // ยอดที่ลูกค้าต้องโอน = ยอดอาหาร - ส่วนลดคูปองสมาชิก (QR พร้อมเพย์ใช้ยอดนี้)
  // ยอดที่ต้องจ่าย = ทุกรายการที่ส่งเข้าบิลไปแล้ว (ตะกร้าคือรอบที่กำลังจะสั่ง ยังไม่นับ)
  const billRows = bill.flatMap(r => r.items || []);
  const billTotal = Math.round(billRows.reduce((sum, it) => sum + (Number(it.amount) || 0), 0) * 100) / 100;
  const billCount = billRows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const couponOff = Math.min(kApplied.reduce((a, c) => a + (Number(c.discount) || 0), 0), billTotal);
  const payTotal = Math.max(0, Math.round((billTotal - couponOff) * 100) / 100);

  // รายการพ่วง/ของแถมที่ผูกอยู่กับจานหลักในตะกร้า — แสดงอยู่ในการ์ดของจานหลัก ไม่นับเป็นรายการแยก
  const isGroupMember = (row) => !!(row.groupId && !row.wizardState
    && cart.some(m => m.wizardState && m.groupId === row.groupId));
  const cartCards = cart.filter(row => !isGroupMember(row));
  const totalItemsCount = cartCards.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => { setQrSaveState(''); }, [isCheckoutOpen, payTotal]);
  // จำตะกร้า/หน้าที่อยู่ไว้ทุกครั้งที่เปลี่ยน
  useEffect(() => { saveKioskDraft({ orderType, tableNo, cart, screen }); }, [orderType, tableNo, cart, screen]);

  // ฟังก์ชันคูปอง (ใช้ cartSubtotal จึงต้องอยู่หลังคำนวณยอด)
  const loadKWallet = async () => {
    if (!member || !verified) return;
    setKMsg('');
    const res = await kioskCall('crmKioskWallet', { subtotal: cartSubtotal });
    if (!res.success) { setKMsg(res.error || (lang === 'th' ? 'โหลดคูปองไม่สำเร็จ' : 'Could not load coupons')); return; }
    setKWallet(res);
    if (Array.isArray(res.applied)) keepApplied(res.applied);
    if (res.dropped && res.dropped.length) setKMsg((lang === 'th' ? 'เอาคูปองออกแล้ว: ' : 'Coupon removed: ') + res.dropped.map(d => d.title + ' (' + d.reason + ')').join(', '));
  };
  // ยืนยันตัวตนด้วยรหัส 6 หลักในบัตรสมาชิก LINE (เปลี่ยนทุกนาที) — ไม่ส่งข้อความ จึงไม่เสียโควต้า LINE OA
  // ถามระบบสมาชิกครั้งเดียวเพื่อเอาลิงก์เปิดบัตรสมาชิก และเช็กว่าสมาชิกคนนี้ผูก LINE แล้ว
  useEffect(() => {
    if (!crmOn || !member || verified || cardUrl || cart.length === 0) return;
    let alive = true;
    crmCall('crmKioskSendCode', { memberId: member.id, branchId }).then(res => {
      if (!alive) return;
      if (res.success) setCardUrl(res.liffUrl || '-');
      else setKMsg(res.error || '');
    });
    return () => { alive = false; };
  }, [crmOn, member && member.id, verified, cardUrl, cart.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkCode = async () => {
    if (kBusy || codeInput.length !== 6) return;
    setKBusy('check'); setKMsg('');
    const res = await crmCall('crmKioskCheckCode', { memberId: member.id, code: codeInput, branchId });
    setKBusy('');
    if (res.success && res.verifyToken) {
      setVerifyToken(res.verifyToken); saveSession(VERIFY_KEY, res.verifyToken); setCodeInput('');
      // จำการล็อกอินไว้ในเครื่อง (อายุตามที่ระบบสมาชิกให้มา) — สแกน QR ครั้งหน้าเป็นสมาชิกเลย
      writeLogin({ member, token: res.verifyToken, ttl: res.expiresIn });
    }
    else setKMsg(res.error || (lang === 'th' ? 'รหัสไม่ถูกต้อง' : 'Wrong code'));
  };
  const pickKCoupon = async (c) => {
    if (kBusy) return;
    setKBusy('c' + c.id); setKMsg('');
    const res = await kioskCall('crmKioskReserve', { couponId: c.id, subtotal: cartSubtotal });
    setKBusy('');
    if (!res.success) setKMsg(res.error || 'ใช้คูปองไม่สำเร็จ');
    loadKWallet();
  };
  const redeemK = async (r) => {
    if (kBusy) return;
    if (!window.confirm(lang === 'th'
      ? `แลก "${r.name}" ใช้ ${Number(r.cost).toLocaleString()} แต้ม แล้วใช้กับออเดอร์นี้เลย?\n(ตัดแต้มทันที ถ้าไม่สั่งต่อ คูปองยังอยู่ในบัตรสมาชิกไว้ใช้ครั้งหน้า)`
      : `Redeem "${r.name}" for ${r.cost} points and use it now?`)) return;
    setKBusy('r' + r.id); setKMsg('');
    const res = await kioskCall('crmKioskRedeem', { rewardId: r.id, subtotal: cartSubtotal });
    setKBusy('');
    if (!res.success) setKMsg(res.error || 'แลกแต้มไม่สำเร็จ');
    loadKWallet();
  };
  // ยืนยันตัวตนแล้ว (หรือร้านไม่บังคับยืนยัน) → โหลดคูปอง · ยอดในตะกร้าเปลี่ยน → คำนวณส่วนลดของคูปองที่ใช้อยู่ใหม่ (ไม่ถึงขั้นต่ำแล้วเอาออก)
  // โหลดใหม่ทุกครั้งที่ตะกร้าเปลี่ยน (รอให้หยุดกดสักครู่) · คูปองของฟรี/เงื่อนไขสินค้า/ขั้นต่ำ ตรวจจากตะกร้าปัจจุบัน
  const kItemsKey = JSON.stringify(kioskItems.map(i => [i.menuId, i.price, i.qty]));
  useEffect(() => {
    if (!crmOn || !member || !verified || payStage) return undefined;
    const t = setTimeout(loadKWallet, 400);
    return () => clearTimeout(t);
  }, [crmOn, member && member.id, verified, kItemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // ยกเลิกการแลกแต้ม → คืนแต้มเข้าบัตร (วันหมดอายุเดิม) และเอาออกจากออเดอร์
  const [kOk, setKOk] = useState('');
  const cancelKRedeem = async (c) => {
    if (kBusy || !c.cancel) return;
    const th = lang === 'th';
    if (!window.confirm(th
      ? `ยกเลิกการแลก "${c.title}"?\nคืน ${Number(c.cancel.restore).toLocaleString()} แต้มเข้าบัตรสมาชิกทันที${c.cancel.lost ? ` (อีก ${c.cancel.lost} แต้มหมดอายุไปแล้ว)` : ''}\nคูปองใบนี้จะถูกยกเลิก และเอาออกจากออเดอร์นี้`
      : `Cancel "${c.title}" and get ${c.cancel.restore} points back?`)) return;
    setKBusy('v' + c.id); setKMsg(''); setKOk('');
    const res = await kioskCall('crmKioskCancelRedeem', { couponId: c.id });
    setKBusy('');
    if (res.success) setKOk(th ? `ยกเลิกการแลกแล้ว คืน ${Number(res.restored).toLocaleString()} แต้ม` : `Cancelled · ${res.restored} points returned`);
    else setKMsg(res.error || (th ? 'ยกเลิกการแลกไม่สำเร็จ' : 'Could not cancel'));
    loadKWallet();
  };
  // เอาคูปองใบหนึ่งออก
  const removeKCoupon = async (c) => {
    if (kBusy) return;
    setKBusy('x' + c.id); setKMsg('');
    await kioskCall('crmKioskRelease', { couponId: c.id });
    setKBusy('');
    loadKWallet();
  };

  // Generate QR Code when checkout opens
  useEffect(() => {
    if (!isCheckoutOpen || payTotal <= 0) { setQrDataUrl(''); return; }
    let cancelled = false;
    let payload = '';

    if (qrType === 'kshop_dynamic') {
      payload = generateDynamicQRFromRaw(kshopRawPayload, payTotal);
    } else {
      payload = generatePromptPayPayload(promptPayId, payTotal);
    }

    if (payload) {
      QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(url => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(''); });
    } else {
      setQrDataUrl('');
    }
    return () => { cancelled = true; };
  }, [isCheckoutOpen, payTotal, qrType, kshopRawPayload, promptPayId]);

  // เมนูที่เพิ่มอัตโนมัติเมื่อสั่ง (Bundled Items) = เมนูจริงที่แถมไปกับจานนี้
  // ลงตะกร้าเป็นรายการของตัวเองราคา ฿0 เหมือนฝั่งพนักงานสั่ง ครัวจะได้เห็นเป็นคนละรายการ
  const bundledRowsFor = (food, dining, groupId) => {
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
        fromPopupOf: food.name,
        ...(groupId ? { groupId } : {})
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

  // สั่งเมนูสมาชิกนี้ได้อีกกี่ชิ้นวันนี้ (หักที่อยู่ในตะกร้าแล้ว) · null = ไม่จำกัด
  const memberLeft = (food) => {
    if (!kQuota || !kQuota.enabled || !isMemberOnly(food)) return null;
    const inCart = (pred) => cart.filter(r => !r.food.isBundled && pred(r)).reduce((a, r) => a + (r.quantity || 1), 0);
    const q = kQuota.menus && kQuota.menus[String(food.id)];
    const lefts = [];
    if (q && q.limit) lefts.push(Math.max(0, q.limit - q.used - inCart(r => String(r.food.id) === String(food.id))));
    if (kQuota.total) lefts.push(Math.max(0, kQuota.total.left - inCart(r => isMemberOnly(r.food))));
    return lefts.length ? Math.min(...lefts) : null;
  };
  // สิทธิ์เมนูสมาชิกของการ์ด: L = สิทธิ์ต่อวัน · U = ใช้ไปแล้ว (ทุกสาขา) · C = อยู่ในตะกร้า · R = เหลือ
  //   ยังไม่ล็อกอิน → บอกแค่กติกา (L) จากการตั้งค่า · ไม่ได้จำกัด → null
  const quotaInfo = (food) => {
    if (!isMemberOnly(food)) return null;
    const minOf = (arr) => { const v = arr.filter(x => Number(x) > 0).map(Number); return v.length ? Math.min(...v) : null; };
    if (!memberLoggedIn) {
      const lim = memberCfg.limit;
      const L = lim ? minOf([lim.perMenu && lim.perMenu[String(food.id)], lim.total]) : null;
      return L ? { L, loggedIn: false } : null;
    }
    if (!kQuota || !kQuota.enabled) return null;
    const q = kQuota.menus && kQuota.menus[String(food.id)];
    const L = minOf([q && q.limit, kQuota.total && kQuota.total.limit]);
    if (!L) return null;
    const serverLeft = q && q.left !== null && q.left !== undefined ? q.left : (kQuota.total ? kQuota.total.left : L);
    const U = Math.max(0, L - serverLeft);
    const R = Math.max(0, memberLeft(food) ?? serverLeft);
    const C = Math.max(0, L - U - R);
    return { L, U, C, R, loggedIn: true };
  };
  const handleFoodClick = (food) => {
    // เมนูเฉพาะสมาชิกที่ครบโควตาวันนี้แล้ว (รวมที่อยู่ในตะกร้า)
    if (isMemberOnly(food) && memberLoggedIn && memberLeft(food) === 0) {
      setMemberNotice(lang === 'th' ? `วันนี้สั่ง "${food.name}" ครบโควตาแล้ว · สั่งได้อีกพรุ่งนี้` : `Today's limit for "${food.name}" is reached`);
      return;
    }
    // เมนูเฉพาะสมาชิก: ยังไม่ล็อกอิน → เปิดหน้าต่างล็อกอินสมาชิกก่อน (ล็อกอินเสร็จแล้วสั่งต่อให้เลย)
    if (isMemberOnly(food) && !memberLoggedIn) { setGateMsg(''); setGateFood(food); return; }
    // Check if food has popups/options configured
    if (food.hasPopup1 || food.hasPopup2 || food.hasPopup3 || food.hasPopup4 || food.hasPopup5 || food.hasPopup6 || (food.priceOptions && food.priceOptions.length > 1)) {
      setSelectedFood(food);
    } else {
      handleAddToCartDirect(food);
    }
  };

  // ร้านมีเมนูเฉพาะสมาชิก → จอแรกให้ล็อกอิน (รหัส 6 หลัก) ต่อจากใส่เลขสมาชิกได้เลย เข้าหน้าเมนูแล้วกดสั่งเมนูสมาชิกได้ทันที
  const hasMemberMenu = liveMenu.some(isMemberOnly);
  const startLogin = !orderType && hasMemberMenu;
  // หน้าต่างล็อกอินเปิดอยู่ (หรือจอแรกที่มีเมนูสมาชิก) → ขอลิงก์เปิดบัตรสมาชิก LINE ไว้ (ใช้ดูรหัส 6 หลัก)
  useEffect(() => {
    if (!(gateFood || startLogin) || !crmOn || !member || memberLoggedIn || cardUrl) return undefined;
    let alive = true;
    crmCall('crmKioskSendCode', { memberId: member.id, branchId }).then(res => {
      if (!alive) return;
      if (res.success) setCardUrl(res.liffUrl || '-'); else setGateMsg(res.error || '');
    });
    return () => { alive = false; };
  }, [gateFood, startLogin, crmOn, member, memberLoggedIn, cardUrl, branchId]);
  const handleFoodClickRef = useRef(handleFoodClick);
  useEffect(() => { handleFoodClickRef.current = handleFoodClick; });
  // ล็อกอินสำเร็จ → ปิดหน้าต่าง แล้วสั่งเมนูที่กดไว้ต่อเลย
  const gateFoodRef = useRef(null);
  useEffect(() => { gateFoodRef.current = gateFood; });
  useEffect(() => {
    if (!memberLoggedIn || !gateFoodRef.current) return;
    const f = gateFoodRef.current;
    setGateFood(null);
    handleFoodClickRef.current(f);
  }, [memberLoggedIn]);
  // ออกจากสมาชิก/เปลี่ยนสมาชิก/ยังไม่ล็อกอิน แต่มีเมนูสมาชิกในตะกร้า → เอาออก (รวมของแถม/รายการที่ผูกกับจานนั้น) และแจ้งลูกค้า
  useEffect(() => {
    if (memberLoggedIn) return;
    const bad = cart.filter(r => isMemberOnly(r.food));
    if (!bad.length) return;
    const groups = new Set(bad.filter(r => r.groupId).map(r => r.groupId));
    const names = new Set(bad.map(r => r.food.name));
    setCart(prev => prev.filter(r => !isMemberOnly(r.food) && !(r.groupId && groups.has(r.groupId)) && !(!r.groupId && r.fromPopupOf && names.has(r.fromPopupOf))));
    setMemberNotice(lang === 'th'
      ? `เอาเมนูเฉพาะสมาชิกออกจากตะกร้าแล้ว (${[...names].join(', ')}) · ล็อกอินสมาชิกแล้วสั่งใหม่ได้`
      : `Members-only items were removed (${[...names].join(', ')}). Log in as a member to order them.`);
  }, [memberLoggedIn, cart]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // หมายเหตุฝั่งลูกค้าสั่งเอง — สวิตช์พิมพ์เองแยกจากหน้าขาย (ค่าเริ่มต้นคือเลือกได้เฉพาะปุ่ม)
  const kioskNoteConfig = useMemo(() => resolveNoteConfig(settings), [settings]);

  // รายการจากป๊อปอัพหนึ่งครั้ง = จานหลัก + รายการที่แยกบรรทัด + ของแถม ผูกกันด้วย groupId
  // จานหลักเก็บตัวเลือกดิบ (wizardState) ไว้ เปิดแก้ไขในตะกร้าได้ภายหลัง
  // ไม่รวมบรรทัดกับรายการอื่น เพื่อให้แก้ไข/ลบทั้งชุดได้ถูกตัว
  const buildWizardRows = (rawFood, orderDetails, wizardState) => {
    const chosenPrice = orderDetails?.selectedPrice;
    const baseFood = chosenPrice ? { ...rawFood, price: Number(chosenPrice.price) || 0, priceName: chosenPrice.name } : rawFood;
    // ประเภทมาจากที่ลูกค้าเลือกที่จอแรกเท่านั้น — ป๊อปอัพของหมวดที่ปิดคำถามการรับประทานไว้
    // ส่งชื่อหมวดมาเป็น dining (เช่น "ชุดอิ่มเดี่ยว") ซึ่งไปโผล่เป็นหัวใบครัวแทน "ทานที่ร้าน"
    const dining = orderType === 'takeaway' ? TAKEAWAY_DINING : DINE_IN_DINING;
    const groupId = `g${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rows = [{
      cartId: Date.now() + Math.random(),
      food: baseFood,
      quantity: 1,
      allPopups: orderDetails.allPopups || [],
      note: orderDetails.note || '',
      dining,
      groupId,
      sourceFoodId: rawFood.id,
      wizardState: wizardState || null
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
        fromPopupOf: baseFood.name,
        groupId
      });
    });

    return [...rows, ...bundledRowsFor(baseFood, dining, groupId)];
  };

  // จานหลัก (สั่งผ่านป๊อปอัพ) กับรายการพ่วง/ของแถมของมัน = 1 ชุด แสดงในการ์ดเดียวกันในตะกร้า
  // จำนวนของชุด = จำนวนของจานหลัก ทุกรายการในชุดมีจำนวนเท่ากันเสมอ (สั่ง 2 ชุด = พ่วงมา 2 ด้วย)
  const isGroupMain = (row) => !!(row && row.wizardState && row.groupId);
  const groupMembersOf = (main, list = cart) => (isGroupMain(main)
    ? list.filter(r => r.groupId === main.groupId && r.cartId !== main.cartId)
    : []);

  // แก้ไขแล้ว: แทนที่ทั้งชุดเดิม ณ ตำแหน่งเดิม — จำนวนชุดคงเดิม
  const replaceGroup = (list, oldRow, rows) => {
    const oldGroup = list.filter(r => r.cartId === oldRow.cartId || (oldRow.groupId && r.groupId === oldRow.groupId));
    const fresh = rows.map(r => ({ ...r, quantity: oldRow.quantity }));
    const at = list.findIndex(r => oldGroup.includes(r));
    if (at < 0) return [...list, ...fresh];
    const rest = list.filter(r => !oldGroup.includes(r));
    rest.splice(at, 0, ...fresh);
    return rest;
  };

  const handleConfirmWizardOrder = (rawFood, orderDetails, wizardState) => {
    const rows = buildWizardRows(rawFood, orderDetails, wizardState);
    if (editingRow) setCart(prev => replaceGroup(prev, editingRow, rows));
    else setCart(prev => [...prev, ...rows]);
    setSelectedFood(null);
    setEditingRow(null);
  };

  // ลบจานหลักที่มาจากป๊อปอัพ = ลบรายการพ่วง/ของแถมของจานนั้นไปด้วย (ไม่ให้ของแถม ฿0 ค้างอยู่เดี่ยว ๆ)
  const removeRow = (row) => {
    setCart(prev => prev.filter(r => r.cartId !== row.cartId && !(row.wizardState && row.groupId && r.groupId === row.groupId)));
  };

  const handleUpdateQty = (cartId, delta) => {
    const row = cart.find(item => item.cartId === cartId);
    if (!row) return;
    const n = row.quantity + delta;
    if (n <= 0) { removeRow(row); return; }
    // ปรับจำนวนจานหลัก = ปรับทั้งชุด
    setCart(cart.map(item => (item.cartId === cartId || (isGroupMain(row) && item.groupId === row.groupId)
      ? { ...item, quantity: n }
      : item)));
  };

  // แก้ตัวเลือกได้เฉพาะจานที่สั่งผ่านป๊อปอัพ (มีขั้นตอนให้เลือก) และเมนูยังขายอยู่
  const editSourceFor = (row) => (row && row.wizardState && row.wizardState.stepCount > 0
    ? liveMenu.find(m => String(m.id) === String(row.sourceFoodId)) || null
    : null);

  // ── บันทึกรูป QR ลงเครื่อง ──
  // ลูกค้าถือมือถือเครื่องเดียว จะสแกน QR บนจอตัวเองไม่ได้ ต้องเซฟรูปไว้ก่อน
  // แล้วเข้าแอปธนาคาร → "สแกนจากรูปภาพ/แกลเลอรี" ถึงจะโอนได้
  // มือถือส่วนใหญ่ใช้ Web Share (มีเมนู "บันทึกรูปภาพ" ให้เลย) ส่วนเครื่องที่ไม่มีค่อยตกไปใช้ลิงก์ดาวน์โหลด
  const handleSaveQr = async () => {
    const src = qrType === 'static' ? staticQrUrl : qrDataUrl;
    if (!src) return;
    setQrSaveState('');
    const fileName = `promptpay-table${tableNo}-${Math.round(payTotal)}baht.png`;

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
        setOrderType('dine_in');
        setPayStage('waiting');
        setScreen('pay');
      }
    } catch { /* ข้อมูลเสีย ข้าม */ }
  }, []);

  // ลูกค้ากด "ฉันโอนเงินแล้ว" (หรือแจ้งอีกครั้งหลังร้านยังไม่พบยอด)
  const handleTransferDone = async () => {
    if (billRows.length === 0 || payBusy) return;
    if (!paySessionRef.current) paySessionRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snap = {
      id: paySessionRef.current,
      total: payTotal,
      orderType,
      tableNo,
      items: billRows
    };
    setPayBusy(true); setPayError('');
    const dining = orderType === 'takeaway' ? 'ห่อกลับบ้าน' : 'ทานที่ร้าน';
    const res = onRequestPayment
      ? await onRequestPayment(tableNo, billRows, payTotal, snap.id, dining, member ? member.id : null,
          kApplied.length && member ? { ids: kApplied.map(c => String(c.id)), ref: kioskRef.current, discount: couponOff } : null,
          verifyToken || '')
      : { success: false, error: 'ระบบยังไม่พร้อม' };
    setPayBusy(false);
    if (!res || !res.success) {
      // เซิร์ฟเวอร์ปฏิเสธเพราะเมนูสมาชิก (ล็อกอินหมดเวลา) → ล้างการล็อกอิน ระบบจะเอาเมนูสมาชิกออกและแจ้งลูกค้าเอง
      if (res && res.memberOnly && res.retry) { setPayError(res.error); return; }
      if (res && res.memberOnly) { setVerifyToken(''); saveSession(VERIFY_KEY, null); writeLogin(null); setPayError(res.error); return; }
      // เกินโควตาเมนูสมาชิกวันนี้ (เช่น สั่งจากเครื่องอื่น/สาขาอื่นไปก่อน) → บอกลูกค้า และโหลดสิทธิ์ใหม่
      if (res && res.memberQuota) { setPayError(res.error); loadQuota(); return; }
      setPayError(lang === 'th'
        ? `แจ้งร้านไม่สำเร็จ${res && /Unknown action/i.test(res.error || '') ? ' (ระบบร้านยังไม่อัปเดต)' : ''} — กดอีกครั้ง หรือแจ้งพนักงาน`
        : 'Could not notify the shop — please try again or call our staff.');
      return;
    }
    // ยอดจริงคิดที่เซิร์ฟเวอร์จากบิลโต๊ะ (รวมที่คนอื่นในโต๊ะสั่ง) — ใช้ยอดนั้นแสดงในหน้ารอ
    if (typeof res.total === 'number') snap.total = res.total;
    setPaySnap(snap);
    savePending(snap);
    if (res.status === 'approved') {
      setOrderNumber(res.orderNumber || '');
      setPayStage('approved'); loadQuotaRef.current();
      finishCoupon();
      savePending(null);
      setBill([]); saveBill(tableNo, null);
    } else {
      setPayStage('waiting');
    }
  };

  // ── ส่งตะกร้ารอบนี้เข้าบิล (ยังไม่จ่าย) ──
  const snapItems = (rows) => rows.map(item => {
    const unit = (Number(item.food.price) || 0) + (item.allPopups || []).reduce((sum, p) => sum + (Number(p.price) || 0), 0);
    return {
      name: lang === 'th' ? item.food.name : (item.food.nameEn || item.food.name),
      options: (item.allPopups || []).map(p => p.name).join(', '),
      note: item.note || '',
      qty: item.quantity,
      amount: unit * item.quantity
    };
  });
  const handleSendOrder = async () => {
    if (cart.length === 0 || sendBusy) return;
    // รหัสรอบนี้คงเดิมทุกครั้งที่กดส่งซ้ำ (เน็ตหลุดแล้วกดใหม่) หลังบ้านจะได้ไม่ลงรายการซ้อน
    if (!sendSessionRef.current) sendSessionRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dining = orderType === 'takeaway' ? 'ห่อกลับบ้าน' : 'ทานที่ร้าน';
    setSendBusy(true); setSendError('');
    const res = onSendOrder
      ? await onSendOrder(tableNo, cart, cartSubtotal, sendSessionRef.current, dining, member ? member.id : null, verifyToken || '')
      : { success: false, error: 'ระบบยังไม่พร้อม' };
    setSendBusy(false);
    if (!res || !res.success) {
      if (res && res.memberOnly) { setVerifyToken(''); saveSession(VERIFY_KEY, null); writeLogin(null); }
      setSendError(res && (res.memberOnly || res.memberQuota) ? res.error : (lang === 'th'
        ? 'ส่งออเดอร์ไม่สำเร็จ — กดอีกครั้ง หรือแจ้งพนักงาน'
        : 'Could not send your order — please try again or call our staff.'));
      if (res && res.memberQuota) loadQuota();
      return;
    }
    const round = { id: sendSessionRef.current, at: Date.now(), items: snapItems(cart) };
    sendSessionRef.current = '';
    const next = [...bill.filter(r => r.id !== round.id), round];
    setBill(next); saveBill(tableNo, next);
    setLastSent(round);
    setCart([]);
    loadQuotaRef.current();
    // แทนที่หน้าตะกร้าในประวัติ — กดย้อนกลับจากหน้า "สั่งแล้ว" ไปหน้าเมนู ไม่ใช่ตะกร้าว่าง
    window.history.replaceState({ ...(window.history.state || {}), kioskScreen: 'sent' }, '');
    setScreen('sent');
  };

  // ดึงบิลล่าสุดจากร้าน (รวมที่คนอื่นในโต๊ะสั่ง) — รอบที่เพิ่งส่งแต่ร้านยังไม่บันทึกเสร็จ เก็บไว้ก่อน
  const loadBillRef = useRef(onLoadBill);
  loadBillRef.current = onLoadBill;
  const refreshBill = async () => {
    if (!loadBillRef.current || !tableNo) return;
    const rounds = await loadBillRef.current(tableNo);
    if (!Array.isArray(rounds)) return;
    setBill(prev => {
      const fresh = prev.filter(r => !rounds.some(x => x.id === r.id) && Date.now() - r.at < 60 * 1000);
      const next = [...rounds, ...fresh].sort((a, b) => a.at - b.at);
      saveBill(tableNo, next);
      return next;
    });
  };
  const refreshBillRef = useRef(refreshBill);
  refreshBillRef.current = refreshBill;
  useEffect(() => {
    if (!['bill', 'pay', 'sent'].includes(screen) || payStage) return;
    refreshBillRef.current();
    const timer = setInterval(() => refreshBillRef.current(), 15000);
    return () => clearInterval(timer);
  }, [screen, payStage]);

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
        setPayStage('approved'); loadQuotaRef.current();
        finishCoupon();
        savePending(null);
        setBill([]); saveBill(tableNo, null);
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
    setScreen('menu');
    setPayStage('');
    setPaySnap(null);
    setPayError('');
    setOrderNumber('');
    paySessionRef.current = '';
    savePending(null);
  };

  // ── เปลี่ยนหน้า เมนู → ตะกร้า → ชำระเงิน ──
  // ดันประวัติไว้ทุกครั้งที่ไปหน้าถัดไป ให้ปุ่มย้อนกลับของมือถือถอยทีละหน้า ไม่หลุดออกจากเว็บ
  // ระหว่างรอพนักงานยืนยันยอด/ชำระเสร็จแล้ว ห้ามย้อนออกจากหน้าชำระเงิน
  const payLockedRef = useRef(false);
  payLockedRef.current = screen === 'pay' && (payStage === 'waiting' || payStage === 'approved');
  const menuScrollRef = useRef(0);

  const goTo = (next) => {
    if (screen === 'menu') menuScrollRef.current = window.scrollY;
    window.history.pushState({ ...(window.history.state || {}), kioskScreen: next }, '');
    setScreen(next);
  };

  const goBack = () => {
    if (window.history.state?.kioskScreen) window.history.back();
    else setScreen(screen === 'pay' ? 'bill' : 'menu');
  };

  useEffect(() => {
    const onPop = (e) => {
      if (payLockedRef.current) {
        window.history.pushState({ ...(e.state || {}), kioskScreen: 'pay' }, '');
        return;
      }
      setScreen((e.state && e.state.kioskScreen) || 'menu');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // กลับมาหน้าเมนู = กลับไปตำแหน่งที่เลื่อนดูค้างไว้ / หน้าอื่นเริ่มบนสุด
  useEffect(() => {
    window.scrollTo(0, screen === 'menu' ? menuScrollRef.current : 0);
  }, [screen]);


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
  const catBarRef = React.useRef(null);
  const sectionRefs = React.useRef({});
  const [catBarH, setCatBarH] = useState(0);

  useEffect(() => {
    const measure = () => {
      setCatBarH(catBarRef.current ? catBarRef.current.offsetHeight : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [lang, menuSections.length, screen, orderType]); // orderType: แถบหมวดหมู่เพิ่งโผล่หลังเลือกทานที่ร้าน/ห่อกลับบ้าน

  // หมวดที่เลือกอยู่หายไปจากเมนู (ร้านลบ/ปิดขาย) ให้กลับไปหมวดแรกที่ยังมีของ
  useEffect(() => {
    if (menuSections.length > 0 && !menuSections.some(section => section.slug === activeCategory)) {
      setActiveCategory(menuSections[0].slug);
    }
  }, [menuSections, activeCategory]);

  const scrollOffset = stickyBannerH + catBarH + 8;

  const scrollToCategory = (slug) => {
    setActiveCategory(slug);
    setShowCategoryMenu(false);
    // รอให้แผงหมวดหมู่ปิดก่อน ค่อยเลื่อน ไม่งั้นตำแหน่งเพี้ยนตอนคืนสกอร์ล
    requestAnimationFrame(() => {
      const el = sectionRefs.current[slug];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // กดแบนเนอร์ที่ลิงก์ไปหมวดเมนู
  const openBannerCategory = (slug) => {
    if (!orderType) { setPendingCat(slug); return; }
    if (menuSections.some(section => section.slug === slug)) scrollToCategory(slug);
  };
  // เลือกทานที่ร้าน/ห่อกลับบ้านแล้ว → พาไปหมวดที่กดค้างไว้จากจอแรก
  useEffect(() => {
    // รอเมนูโหลดก่อน — ถ้าโหลดแล้วไม่มีหมวดนี้ (ร้านปิดหมวด/ไม่มีราคาห่อกลับบ้าน) ก็เลิกรอเฉย ๆ
    if (!pendingCat || !orderType || menuSections.length === 0) return;
    const slug = pendingCat;
    const timer = setTimeout(() => {
      if (menuSections.some(section => section.slug === slug)) scrollToCategory(slug);
      setPendingCat('');
    }, 200);
    return () => clearTimeout(timer);
  }, [pendingCat, orderType, menuSections]);

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
    // ของแถม ฿0 ที่ติดมากับจานอื่น ไม่นับเป็นจำนวนที่ลูกค้าสั่งเมนูนี้
    const inCartItems = cart.filter(c => c.food.id === food.id && !c.food.isBundled);
    const inCartQty = inCartItems.reduce((sum, c) => sum + c.quantity, 0);
    const price = Number(food.price) || 0;
    // เมนูเฉพาะสมาชิก: ป้าย + กรอบส้ม · ยังไม่ล็อกอิน = ปุ่มล็อก (กดแล้วเปิดหน้าต่างล็อกอิน)
    const memberOnly = isMemberOnly(food);
    const locked = memberOnly && !memberLoggedIn;
    const left = memberOnly && memberLoggedIn ? memberLeft(food) : null;
    const soldOut = left === 0;
    const qi = quotaInfo(food);

    return (
      <div
        key={food.id}
        /* ตั้งใจไม่ให้กดที่การ์ด/รูปแล้วสั่ง — ลูกค้ามักแตะรูปเพื่อดูให้ชัด
           ถ้าแตะแล้วเพิ่มของทันทีจะได้ของที่ไม่ได้ตั้งใจสั่ง ต้องกดปุ่ม "+ สั่ง" เท่านั้น */
        style={{
          background: '#ffffff', borderRadius: '18px',
          border: memberOnly ? '2px solid #c8102e' : '1px solid #e4e4e4', overflow: 'hidden',
          boxShadow: memberOnly ? '0 6px 20px rgba(200, 16, 46, 0.18)' : '0 6px 20px rgba(0,0,0,0.04)',
          transition: 'transform 0.15s',
          display: 'flex', flexDirection: 'column', height: '100%',
          position: 'relative'
        }}
      >
        {/* Image Container with high visual impact */}
        {/* แตะรูป = เปิดดูรูปขยาย (ไม่เพิ่มลงตะกร้า) */}
        <div
          onClick={() => setPreviewFood(food)}
          style={{ width: '100%', aspectRatio: '1 / 1', position: 'relative', background: '#f1f1f1', cursor: 'zoom-in' }}
        >
          <MenuImage
            food={food}
            alt={food.name}
            loading="lazy"
            placeholderSize="3rem"
            style={{ width: '100%', height: '100%', objectFit: 'cover', ...(locked ? { filter: 'grayscale(0.35) brightness(0.92)' } : {}) }}
          />

          {memberOnly && (
            <div style={{
              position: 'absolute', top: '8px', left: '42px', pointerEvents: 'none',
              background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#ffffff',
              fontWeight: 900, fontSize: '0.72rem', padding: '0.22rem 0.55rem', borderRadius: '20px',
              border: '1.5px solid #ffffff', boxShadow: '0 3px 10px rgba(165, 13, 37, 0.45)', whiteSpace: 'nowrap'
            }}>
              👑 {locked ? (lang === 'th' ? 'เฉพาะสมาชิก' : 'Members only') : (lang === 'th' ? 'เมนูสมาชิก' : 'Member menu')}
            </div>
          )}

          <div style={{
            position: 'absolute', top: '8px', left: '8px',
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'rgba(20, 20, 20, 0.55)', color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
          }}>
            <ZoomIn size={15} />
          </div>

          {/* Badge & Price tag overlay */}
          <div style={{
            position: 'absolute', bottom: '8px', right: '8px',
            background: 'rgba(20, 20, 20, 0.9)', backdropFilter: 'blur(8px)',
            color: '#ffffff', padding: '0.28rem 0.6rem', borderRadius: '20px',
            fontWeight: '900', fontSize: '0.92rem', border: '1.5px solid rgba(255,255,255,0.2)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}>
            <span style={{ color: '#c8102e', fontSize: '0.75rem', marginRight: '2px' }}>฿</span>
            {price.toLocaleString()}
          </div>

          {inCartQty > 0 && (
            <div style={{
              position: 'absolute', top: '8px', right: '8px',
              background: '#c8102e', color: 'white', fontWeight: '900',
              fontSize: '0.8rem', borderRadius: '50%', width: '26px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(200, 16, 46, 0.4)', border: '2px solid white'
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
              fontSize: '0.95rem', fontWeight: '800', margin: 0, color: '#141414', lineHeight: 1.3,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
            }}>
              {lang === 'th' ? food.name : (food.nameEn || food.name)}
            </h4>
            {food.description && (
              <p style={{
                fontSize: '0.74rem', color: '#5a5a5a', margin: '0.2rem 0 0 0', fontWeight: '500', lineHeight: 1.35,
                display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden'
              }}>
                {food.description}
              </p>
            )}
          </div>

          {qi && (() => {
            const th = lang === 'th';
            const rule = th ? `${qi.L} สิทธิ์ / 1 หมายเลขสมาชิก / วัน` : `${qi.L} per member per day`;
            if (!qi.loggedIn) {
              return (
                <div style={{ fontSize: '0.72rem', fontWeight: 800, borderRadius: 8, padding: '0.25rem 0.4rem', textAlign: 'center', background: '#fdf2f4', color: '#7a0a1c', border: '1px dashed #f07a8a' }}>
                  👑 {rule}
                </div>
              );
            }
            // มีของในตะกร้า = สีฟ้า (ยังไม่ได้จ่าย) · ใช้ครบวันนี้แล้ว = สีแดง · ยังเหลือ = สีเขียว
            const tone = qi.C > 0 ? { bg: '#f5f5f5', fg: '#000000' } : soldOut ? { bg: '#fef2f2', fg: '#b91c1c' } : { bg: '#f0fdf4', fg: '#166534' };
            const head = th
              ? (qi.C > 0
                  ? (qi.R === 0
                      ? `ใช้ไปแล้ว ${qi.U + qi.C}/${qi.L} สิทธิ์ (${qi.U > 0 ? `ในตะกร้า ${qi.C}` : 'อยู่ในตะกร้า'})`
                      : `ใช้ไปแล้ว ${qi.U}/${qi.L} · ในตะกร้า ${qi.C} · เหลือ ${qi.R}`)
                  : `ใช้ไปแล้ว ${qi.U}/${qi.L} สิทธิ์วันนี้${!soldOut && qi.U > 0 ? ` · เหลือ ${qi.R}` : ''}`)
              : (qi.C > 0 ? `Used ${qi.U}/${qi.L} · in cart ${qi.C} · ${qi.R} left` : `Used ${qi.U}/${qi.L} today`);
            return (
              <div style={{ fontSize: '0.72rem', fontWeight: 800, borderRadius: 8, padding: '0.25rem 0.4rem', textAlign: 'center', background: tone.bg, color: tone.fg, lineHeight: 1.4 }}>
                {head}
                {qi.L <= 8 && (
                  <div aria-hidden="true" style={{ display: 'flex', gap: 3, justifyContent: 'center', margin: '2px 0' }}>
                    {Array.from({ length: qi.L }, (_, i) => (
                      <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i < qi.U ? '#16a34a' : i < qi.U + qi.C ? '#333333' : '#d1d5db' }} />
                    ))}
                  </div>
                )}
                <div style={{ fontWeight: 600, fontSize: '0.66rem' }}>{soldOut && qi.C === 0 ? (th ? 'ใช้ได้อีกครั้งพรุ่งนี้' : 'Available again tomorrow') : rule}</div>
              </div>
            );
          })()}
          {soldOut ? (
            /* ใช้สิทธิ์ครบ (ในตะกร้าแล้ว / สั่งครบวันนี้) → ปุ่มใส่ตะกร้าสีเทา กดไม่ได้ · เหตุผลอยู่ในกรอบสิทธิ์ด้านบน */
            <button disabled aria-disabled="true"
              style={{
                marginTop: 'auto', background: '#e5e7eb', color: '#9ca3af', border: 'none', borderRadius: '11px',
                padding: '0.6rem 0.5rem', fontWeight: '800', fontSize: '0.88rem', cursor: 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', fontFamily: 'inherit'
              }}>
              <Plus size={16} /> {lang === 'th' ? 'ใส่ตะกร้า' : 'Add to cart'}
            </button>
          ) : locked ? (
            <button
              onClick={() => handleFoodClick(food)}
              style={{
                marginTop: 'auto', background: '#fdf2f4', color: '#7a0a1c', border: '1.5px dashed #c8102e', borderRadius: '11px',
                padding: '0.6rem 0.4rem', fontWeight: '800', fontSize: '0.84rem', cursor: 'pointer', width: '100%', fontFamily: 'inherit'
              }}
            >
              🔒 {lang === 'th' ? 'สั่งได้เฉพาะสมาชิก' : 'Members only'}
            </button>
          ) : (
          <button
            onClick={() => handleFoodClick(food)}
            style={{
              marginTop: 'auto',
              background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)',
              color: '#ffffff', border: 'none', borderRadius: '11px',
              padding: '0.6rem 0.5rem', fontWeight: '800', fontSize: '0.88rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              boxShadow: '0 4px 12px rgba(165, 13, 37, 0.3)', width: '100%', fontFamily: 'inherit'
            }}
          >
            <Plus size={16} /> {lang === 'th' ? 'ใส่ตะกร้า' : 'Add to cart'}{qi && qi.loggedIn && qi.C > 0 && qi.R > 0 ? (lang === 'th' ? ` (เหลือ ${qi.R})` : ` (${qi.R} left)`) : ''}
          </button>
          )}
        </div>
      </div>
    );
  };


  const renderBanner = (maxWidth) => (
    <KioskBanner banner={banner} lang={lang} maxWidth={maxWidth}
      joinUrl={joinUrl} onMember={() => setJoinOpened(true)}
      onCategory={openBannerCategory}
      onClose={bannerClosable ? closeBanner : undefined} />
  );
  const captionStyle = { textAlign: 'center', color: '#c8102e', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 };

  // ── จอแรก (เฉพาะร้านที่เปิดระบบสมาชิก): ใส่เลขสมาชิก แล้วกดเริ่มสั่งอาหาร ──
  if (!orderType && !crmOn) {
    return <div style={{ minHeight: '100dvh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Wordmark size={40} /></div>;
  }
  if (!orderType) {
    const pendingCatInfo = pendingCat ? categories.find(cat => cat.slug === pendingCat) : null;
    const bigBtn = {
      display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', textAlign: 'left',
      padding: '1.25rem', borderRadius: 18, border: '2px solid #e4e4e4',
      background: '#ffffff', cursor: 'pointer', fontFamily: 'inherit', color: '#141414',
      boxShadow: '0 6px 20px rgba(0,0,0,0.05)'
    };
    return (
      <div style={{ minHeight: '100dvh', background: '#ffffff', width: '100%', maxWidth: 480, margin: '0 auto', padding: '1rem 1rem 1.5rem', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#141414' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            style={{ background: '#f1f1f1', border: '1px solid #d0d0d0', borderRadius: 20, padding: '0.35rem 0.6rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: '#141414', fontFamily: 'inherit' }}>
            <Globe size={13} /> {lang === 'th' ? 'TH' : 'EN'}
          </button>
        </div>

        {/* แบนเนอร์สไลด์ (โลโก้ร้าน + รูปโปรโมชัน) — ตั้งค่าที่หลังบ้าน */}
        {bannerShown && (
          <div ref={bannerBoxRef} style={bannerSticky
            ? { position: 'sticky', top: 0, zIndex: 60, background: '#ffffff', padding: '0.35rem 0 0.3rem' }
            : { padding: '0.35rem 0 0.2rem' }}>
            {renderBanner(bannerPromo ? 448 : 340)}
          </div>
        )}
        {banner.showCaption && (
          <div style={{ ...captionStyle, fontSize: '0.85rem' }}>
            <Utensils size={14} /> {lang === 'th' ? 'สั่งอาหารด้วยตนเอง' : 'Self-ordering'}
          </div>
        )}
        {pendingCat && (
          <div role="status" style={{ marginTop: '0.6rem', background: '#fdf2f4', border: '1px solid #f5b5bf', color: '#7a0a1c', borderRadius: 12, padding: '0.55rem 0.75rem', fontSize: '0.88rem', fontWeight: 700, textAlign: 'center' }}>
            {lang === 'th'
              ? `กดเริ่มสั่งอาหาร แล้วจะพาไปที่${pendingCatInfo ? `หมวด ${pendingCatInfo.name}` : 'เมนูที่เลือก'}`
              : `Tap Start ordering — we'll take you to ${pendingCatInfo ? (pendingCatInfo.nameEn || pendingCatInfo.name) : 'that menu'}`}
          </div>
        )}
        <div style={{ height: '1.6rem' }} />

        {crmOn && (
          <div style={{ border: '2px solid ' + (member ? '#86efac' : '#f5b5bf'), background: member ? '#f0fdf4' : '#fdf2f4', borderRadius: 18, padding: '1rem', marginBottom: '1.4rem' }}>
            {member ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.8rem' }} aria-hidden="true">🎉</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{lang === 'th' ? `สวัสดีคุณ${member.name}` : `Hi ${member.name}`}{memberLoggedIn ? (lang === 'th' ? ' (ล็อกอินอยู่)' : ' (logged in)') : ''}</b>
                  <span style={{ fontSize: '0.85rem', color: '#166534' }}>{member.id} · {lang === 'th' ? 'บิลนี้สะสมแต้มให้อัตโนมัติ' : 'Points will be added to this bill'}{memberLoggedIn ? (lang === 'th' ? ' · 👑 สั่งเมนูสมาชิกได้' : ' · 👑 member menu unlocked') : ''}</span>
                </div>
                <button onClick={() => keepMember(null)} style={{ border: 'none', background: 'none', color: '#5a5a5a', textDecoration: 'underline', fontFamily: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}>
                  {memberLoggedIn ? (lang === 'th' ? 'ออกจากระบบ' : 'Log out') : (lang === 'th' ? 'ไม่ใช่ฉัน' : 'Not me')}
                </button>
              </div>
            ) : null}
            {member && !memberLoggedIn && hasMemberMenu && memberCfg.requireCode === true && (
              <div style={{ borderTop: '1px dashed #86efac', marginTop: '0.8rem', paddingTop: '0.8rem' }}>
                <label htmlFor="start-code" style={{ display: 'block', fontWeight: 800, marginBottom: '0.15rem' }}>
                  {lang === 'th' ? '👑 ล็อกอินเพื่อสั่งเมนูเฉพาะสมาชิก' : '👑 Log in for member-only menu'}
                </label>
                <span style={{ display: 'block', fontSize: '0.82rem', color: '#166534', marginBottom: '0.5rem' }}>
                  {lang === 'th' ? 'เปิดบัตรสมาชิกใน LINE แล้วพิมพ์รหัส 6 หลักใต้ QR · ล็อกอินครั้งเดียว ครั้งต่อไปไม่ต้องใส่อีก' : 'Open your LINE member card and type the 6-digit code under the QR · once only'}
                </span>
                {cardUrl && cardUrl !== '-' && (
                  <a href={cardUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-block', background: '#06c755', color: '#fff', borderRadius: 10, padding: '0.45rem 0.85rem', fontWeight: 800, textDecoration: 'none', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    {lang === 'th' ? 'เปิดบัตรสมาชิกใน LINE' : 'Open LINE member card'}
                  </a>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input id="start-code" value={codeInput} inputMode="numeric" maxLength={6} autoComplete="off" placeholder="000000"
                    onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setKMsg(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') checkCode(); }}
                    style={{ flex: 1, minWidth: 0, border: '1px solid #86efac', borderRadius: 12, padding: '0.65rem', fontSize: '1.15rem', letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'inherit', background: '#fff' }} />
                  <button onClick={checkCode} disabled={kBusy === 'check' || codeInput.length !== 6}
                    style={{ border: 'none', borderRadius: 12, padding: '0 1rem', background: '#16a34a', color: '#fff', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', opacity: kBusy === 'check' || codeInput.length !== 6 ? 0.5 : 1 }}>
                    {kBusy === 'check' ? '…' : (lang === 'th' ? 'ล็อกอิน' : 'Log in')}
                  </button>
                </div>
                {kMsg && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{kMsg}</div>}
                <span style={{ display: 'block', fontSize: '0.78rem', color: '#5a5a5a', marginTop: '0.4rem' }}>
                  {lang === 'th' ? 'ไม่สั่งเมนูสมาชิก ข้ามได้ · ยังสะสมแต้มบิลนี้ได้ตามปกติ' : 'Optional · points are still collected'}
                </span>
              </div>
            )}
            {member ? null : (
              <>
                <label htmlFor="kiosk-member" style={{ display: 'block', fontWeight: 800, marginBottom: '0.15rem' }}>{lang === 'th' ? 'เป็นสมาชิกเสน่ห์ไหม? สะสมแต้มได้เลย' : 'Member? Earn points'}</label>
                <span style={{ display: 'block', fontSize: '0.82rem', color: '#7a0a1c', marginBottom: '0.6rem' }}>
                  {lang === 'th' ? 'ใส่เลขที่สมาชิก (ดูในบัตรสมาชิกใน LINE) หรือเบอร์โทรที่สมัครไว้ · ไม่มีข้ามได้' : 'Member no. (in your LINE member card) or phone · optional'}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input id="kiosk-member" value={memberInput} inputMode="text" autoComplete="off"
                    onChange={e => { setMemberInput(e.target.value); setMemberErr(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); checkMember(); } }}
                    placeholder={lang === 'th' ? 'เช่น MB-0000123 หรือ 0812345678' : 'e.g. MB-0000123 or 0812345678'}
                    style={{ flex: 1, minWidth: 0, border: '1px solid #f07a8a', borderRadius: 12, padding: '0.75rem', fontSize: '1rem', fontFamily: 'inherit', background: '#fff' }} />
                  <button onClick={checkMember} disabled={memberBusy || !memberInput.trim()}
                    style={{ border: 'none', borderRadius: 12, padding: '0 1rem', background: '#c8102e', color: '#fff', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', opacity: memberBusy || !memberInput.trim() ? 0.5 : 1 }}>
                    {memberBusy ? '…' : (lang === 'th' ? 'ตรวจสอบ' : 'Check')}
                  </button>
                </div>
                {memberErr && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{memberErr}</div>}
                {joinUrl && (
                  <div style={{ borderTop: '1px dashed #f07a8a', marginTop: '0.8rem', paddingTop: '0.8rem' }}>
                    <a href={joinUrl} target="_blank" rel="noopener noreferrer" onClick={() => setJoinOpened(true)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: '#06c755', color: '#fff', borderRadius: 12, padding: '0.75rem', fontWeight: 800, textDecoration: 'none' }}>
                      {lang === 'th' ? 'ยังไม่เป็นสมาชิก? สมัครฟรีผ่าน LINE' : 'Not a member? Join free on LINE'}
                    </a>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: joinOpened ? '#166534' : '#7a0a1c', marginTop: '0.4rem', textAlign: 'center', fontWeight: joinOpened ? 700 : 400 }}>
                      {joinOpened
                        ? (lang === 'th' ? 'สมัครเสร็จแล้วกลับมาหน้านี้ ใส่เบอร์โทรที่สมัครในช่องด้านบน แล้วกดตรวจสอบ' : 'After joining, come back and enter your phone above')
                        : (lang === 'th' ? 'กรอกชื่อ เบอร์โทร ใน LINE ไม่ถึง 1 นาที รับแต้มและคูปองสมาชิกใหม่ แล้วสะสมแต้มบิลนี้ได้เลย' : 'Takes under a minute · get welcome points & coupon')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button style={{ ...bigBtn, background: '#c8102e', border: '2px solid #c8102e', color: '#ffffff', justifyContent: 'center' }} onClick={() => chooseOrderType('dine_in')}>
          <span style={{ fontSize: '2rem' }}>🍽️</span>
          <b style={{ fontSize: '1.25rem' }}>{lang === 'th' ? 'เริ่มสั่งอาหาร' : 'Start ordering'}</b>
        </button>
      </div>
    );
  }

  const th = lang === 'th';
  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lineTotal = (item) => ((Number(item.food.price) || 0) + (item.allPopups || []).reduce((sum, p) => sum + (Number(p.price) || 0), 0)) * item.quantity;

  // การ์ด "คูปองและแต้มของคุณ" ในหน้าตะกร้า
  const renderCouponCard = () => {
    const box = { margin: '0 1rem 1rem', border: '2px solid #f5b5bf', background: '#fdf2f4', borderRadius: 16, padding: '0.9rem' };
    const btn = (on) => ({ border: on ? '2px solid #16a34a' : 'none', background: on ? '#dcfce7' : '#c8102e', color: on ? '#166534' : '#fff', borderRadius: 10, padding: '0.45rem 0.8rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
    const head = <b style={{ display: 'block', marginBottom: '0.4rem' }}>🎁 {th ? `คูปองและแต้มของคุณ${member.name}` : 'Your coupons & points'}</b>;
    if (!verified) {
      return (
        <div style={box}>
          {head}
          <label htmlFor="kiosk-code" style={{ display: 'block', fontSize: '0.85rem', color: '#7a0a1c', marginBottom: '0.5rem' }}>
            {th ? 'ยืนยันตัวตนก่อนใช้คูปองหรือแลกแต้ม: เปิดบัตรสมาชิกใน LINE แล้วพิมพ์รหัส 6 หลักที่อยู่ใต้ QR' : 'Open your LINE member card and type the 6-digit code under the QR'}
          </label>
          {cardUrl && cardUrl !== '-' && (
            <a href={cardUrl} target="_blank" rel="noopener noreferrer"
              style={{ ...btn(false), display: 'inline-block', textDecoration: 'none', background: '#06c755', marginBottom: '0.6rem' }}>
              {th ? 'เปิดบัตรสมาชิกใน LINE' : 'Open LINE member card'}
            </a>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input id="kiosk-code" value={codeInput} inputMode="numeric" maxLength={6} autoComplete="off" placeholder="000000"
              onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setKMsg(''); }}
              onKeyDown={e => { if (e.key === 'Enter') checkCode(); }}
              style={{ width: 140, letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.2rem', border: '1px solid #f07a8a', borderRadius: 10, padding: '0.5rem', fontFamily: 'inherit' }} />
            <button onClick={checkCode} disabled={kBusy === 'check' || codeInput.length !== 6} style={{ ...btn(false), opacity: codeInput.length === 6 ? 1 : 0.5 }}>{kBusy === 'check' ? '…' : (th ? 'ยืนยัน' : 'Verify')}</button>
          </div>
        {kMsg && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{kMsg}</div>}
        </div>
      );
    }
    const coupons = (kWallet && kWallet.coupons) || [];
    const rewards = ((kWallet && kWallet.rewards) || []).filter(r => r.affordable);
    return (
      <div style={box}>
        {head}
        {!kWallet && !kMsg && <span style={{ fontSize: '0.85rem', color: '#7a0a1c' }}>{th ? 'กำลังโหลด…' : 'Loading…'}</span>}
        {kWallet && <span style={{ display: 'block', fontSize: '0.85rem', color: '#7a0a1c', marginBottom: '0.5rem' }}>{th ? `แต้มคงเหลือ ${Number(kWallet.balance || 0).toLocaleString()} แต้ม` : `${Number(kWallet.balance || 0).toLocaleString()} points left`}<br />{th ? 'การแลกแต้มเป็นไปตามเงื่อนไขที่บริษัทฯ กำหนด' : 'Points redemption is subject to company terms and conditions'}</span>}
        {kWallet && coupons.length === 0 && rewards.length === 0 && <span style={{ fontSize: '0.85rem', color: '#5a5a5a' }}>{th ? 'ยังไม่มีคูปองที่ใช้ได้ และแต้มยังไม่พอแลก' : 'No coupons yet'}</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {kApplied.map(c => (
            <div key={'a' + c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#f0fdf4', border: '1.5px solid #16a34a', borderRadius: 12, padding: '0.5rem 0.6rem' }}>
              <span style={{ minWidth: 48, textAlign: 'center', fontWeight: 900, color: '#16a34a' }}>{c.big}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.title}</div>
                <div style={{ fontSize: '0.75rem', color: '#15803d' }}>{c.voucher ? (th ? 'ใบรับของ · แจ้งพนักงานรับของ' : 'Voucher · ask staff') : (th ? `✓ ใช้อยู่ · ลด ฿${money(c.discount)}` : `✓ Applied · -฿${money(c.discount)}`)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {/* คูปองที่แลกแต้มมาและยกเลิกได้ → มีแค่ปุ่มยกเลิกแลก คืนแต้ม · คูปองอื่นยังมีปุ่มเอาออก */}
                {!c.cancel && <button onClick={() => removeKCoupon(c)} disabled={!!kBusy} style={btn(true)}>{kBusy === 'x' + c.id ? '…' : (th ? 'เอาออก' : 'Remove')}</button>}
                {c.cancel && <button onClick={() => cancelKRedeem(c)} disabled={!!kBusy} style={{ ...btn(false), background: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fca5a5' }}>{kBusy === 'v' + c.id ? '…' : (th ? 'ยกเลิกแลก คืนแต้ม' : 'Cancel · refund')}</button>}
              </div>
            </div>
          ))}
          {coupons.map(c => {
            return (
              <div key={'c' + c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#fff', borderRadius: 12, padding: '0.5rem 0.6rem', opacity: c.usable ? 1 : 0.55 }}>
                <span style={{ minWidth: 48, textAlign: 'center', fontWeight: 900, color: '#c8102e' }}>{c.big}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.title}</div>
                  <div style={{ fontSize: '0.75rem', color: c.usable ? '#5a5a5a' : '#b91c1c' }}>{c.usable ? (th ? `ลด ฿${money(c.discount)}` : `-฿${money(c.discount)}`) : c.reason}</div>
                </div>
                {c.usable && <button onClick={() => pickKCoupon(c)} disabled={!!kBusy} style={btn(false)}>{kBusy === 'c' + c.id ? '…' : (th ? 'ใช้' : 'Use')}</button>}
              </div>
            );
          })}
          {rewards.length > 0 && <b style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>{th ? 'แลกแต้มเป็นคูปอง' : 'Redeem points'}</b>}
          {rewards.map(r => (
            <div key={'r' + r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#fff', borderRadius: 12, padding: '0.5rem 0.6rem', border: '1px dashed #f07a8a' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{r.name}</div>
                <div style={{ fontSize: '0.75rem', color: r.fits === false ? '#b91c1c' : '#5a5a5a' }}>{r.fits === false ? r.reason : r.discount ? (th ? `แลกแล้วใช้กับออเดอร์นี้ทันที · ลด ฿${money(r.discount)}` : `Applies now · -฿${money(r.discount)}`) : (<>{r.big === 'ฟรี' ? (th ? `ของฟรี มูลค่า ฿${r.value}` : `Free (฿${r.value})`) : (th ? `ส่วนลด ฿${r.value}` : `-฿${r.value}`)}{r.minSpend ? (th ? ` · ขั้นต่ำ ฿${r.minSpend}` : ` · min ฿${r.minSpend}`) : ''}</>)}</div>
              </div>
              <button onClick={() => redeemK(r)} disabled={!!kBusy || r.fits === false} style={btn(false)}>{kBusy === 'r' + r.id ? '…' : (th ? `แลก ${Number(r.cost).toLocaleString()} แต้ม` : `${r.cost} pts`)}</button>
            </div>
          ))}
        </div>
        {kOk && <div role="status" style={{ color: '#166534', background: '#dcfce7', borderRadius: 10, padding: '0.4rem 0.6rem', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 700 }}>{kOk}</div>}
        {kMsg && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{kMsg}</div>}
      </div>
    );
  };

  // แถบบนของหน้าตะกร้า/ชำระเงิน: ปุ่มย้อนกลับ + ชื่อหน้า + โลโก้ร้าน
  const renderTopBar = (title, icon, canBack) => (
    <div style={{
      position: 'sticky', top: 0, zIndex: 100, background: '#ffffff',
      borderBottom: '1px solid #e4e4e4', padding: '0.65rem 0.9rem',
      display: 'flex', alignItems: 'center', gap: '0.6rem', boxShadow: '0 4px 15px rgba(0,0,0,0.03)'
    }}>
      {canBack ? (
        <button onClick={goBack} aria-label={th ? 'ย้อนกลับ' : 'Back'}
          style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <ChevronLeft size={22} color="#141414" />
        </button>
      ) : <div style={{ width: 2 }} />}
      <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: '1.12rem', fontWeight: 900, color: '#141414', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </h2>
      <Wordmark size={20} />
    </div>
  );

  // ขั้นตอน 1 ตะกร้า → 2 ส่งเข้าครัว → 3 ชำระเงิน (ทานเสร็จแล้วค่อยจ่าย)
  const renderSteps = (active, allDone = false) => {
    const labels = th ? ['ตะกร้า', 'ส่งเข้าครัว', 'ชำระเงิน'] : ['Cart', 'Order sent', 'Payment'];
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0.8rem 1rem 0.3rem', fontSize: '0.8rem', fontWeight: 800 }}>
        {labels.map((label, i) => {
          const n = i + 1;
          const done = n < active || allDone;
          const on = n === active && !done;
          return (
            <React.Fragment key={n}>
              {i > 0 && <div style={{ width: 20, height: 2, background: n <= active ? '#16a34a' : '#e4e4e4' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: done ? '#16a34a' : on ? '#c8102e' : '#7a7a7a' }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', fontSize: '0.72rem',
                  background: done ? '#16a34a' : on ? '#c8102e' : '#e4e4e4', color: (done || on) ? '#ffffff' : '#5a5a5a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>{done ? '✓' : n}</span>
                {label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // แถบปุ่มติดล่างจอ ของหน้าตะกร้า/ชำระเงิน
  const footerStyle = {
    position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
    width: '100%', maxWidth: '480px', zIndex: 90, boxSizing: 'border-box',
    background: '#ffffff', borderTop: '1px solid #e4e4e4',
    padding: '0.75rem 1rem', paddingBottom: 'calc(0.85rem + env(safe-area-inset-bottom))',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.06)'
  };
  const bigBtnStyle = (bg, disabled) => ({
    width: '100%', border: 'none', borderRadius: '14px', padding: '0.95rem 1.1rem',
    fontWeight: 900, fontSize: '1.08rem', fontFamily: 'inherit', color: '#ffffff',
    background: disabled ? '#d0d0d0' : bg, cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
  });
  const ORANGE = 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)';
  // ปุ่มชำระเงิน/แจ้งโอน = ดำ (CI เสน่ห์ แดง-ดำ) · ปุ่มสั่งอาหาร = แดง
  const BLACK = 'linear-gradient(135deg, #222222 0%, #000000 100%)';
  const chipBtn = (color, bg) => ({
    border: 'none', background: bg, color, borderRadius: '8px', padding: '0.32rem 0.65rem',
    fontSize: '0.78rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4
  });

  // รายการหนึ่งบรรทัดในหน้าตะกร้า: รูป · ชื่อ/ตัวเลือก/หมายเหตุ · จำนวน · แก้ไข/ลบ
  const renderCartRow = (item) => {
    const editSource = editSourceFor(item);
    const members = groupMembersOf(item);
    const unitTotal = (row) => (Number(row.food.price) || 0) + (row.allPopups || []).reduce((sum, p) => sum + (Number(p.price) || 0), 0);
    const cardTotal = lineTotal(item) + members.reduce((sum, m) => sum + lineTotal(m), 0);
    const stepBtn = { width: 34, height: 32, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#141414' };
    return (
      <div key={item.cartId} style={{
        background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: '16px', padding: '0.65rem',
        display: 'flex', gap: '0.7rem', boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
      }}>
        <MenuImage food={item.food} width={256} alt="" loading="lazy" placeholderSize="1.8rem"
          style={{ width: 68, height: 68, borderRadius: '12px', objectFit: 'cover', flexShrink: 0, background: '#f1f1f1' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '0.93rem', lineHeight: 1.3, color: '#141414' }}>
            {th ? item.food.name : (item.food.nameEn || item.food.name)}
          </div>
          {item.allPopups && item.allPopups.length > 0 && (
            <div style={{ fontSize: '0.76rem', color: '#5a5a5a', marginTop: 2 }}>
              {item.allPopups.map(p => p.name).join(', ')}
            </div>
          )}
          {item.note && (
            <div style={{ display: 'inline-block', fontSize: '0.76rem', color: '#8e0b20', background: '#fdf2f4', borderRadius: 6, padding: '1px 6px', marginTop: 3 }}>
              📝 {item.note}
            </div>
          )}
          {/* รายการพ่วง/ของแถมของชุดนี้ — อยู่ในการ์ดเดียวกัน แก้ไข/ลบ/ปรับจำนวนไปพร้อมจานหลัก */}
          {members.length > 0 && (
            <div style={{ marginTop: 5, borderLeft: '3px solid #f5b5bf', paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {members.map(m => (
                <div key={m.cartId} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', fontSize: '0.8rem', color: '#333333', lineHeight: 1.35 }}>
                  <span style={{ minWidth: 0 }}>
                    + {th ? m.food.name : (m.food.nameEn || m.food.name)}
                    {m.allPopups && m.allPopups.length > 0 && <span style={{ color: '#5a5a5a' }}> ({m.allPopups.map(p => p.name).join(', ')})</span>}
                    {m.food.isBundled && <span style={{ color: '#16a34a', fontWeight: 800 }}> {th ? '🎁 ฟรี' : '🎁 free'}</span>}
                  </span>
                  {unitTotal(m) > 0 && <span style={{ flexShrink: 0, color: '#5a5a5a', fontWeight: 700 }}>฿{unitTotal(m).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
          {/* รายการพ่วง/ของแถมที่ไม่มีจานหลักอยู่ในตะกร้าแล้ว */}
          {item.fromPopupOf && (
            <div style={{ fontSize: '0.74rem', color: '#000000', fontWeight: 700, marginTop: 2 }}>
              {item.food.isBundled
                ? `🎁 ${item.fromPopupOf}`
                : (th ? `พ่วงกับ ${item.fromPopupOf}` : `with ${item.fromPopupOf}`)}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.45rem', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #d0d0d0', borderRadius: '10px', overflow: 'hidden' }}>
              <button onClick={() => handleUpdateQty(item.cartId, -1)} aria-label={th ? 'ลดจำนวน' : 'Decrease'} style={stepBtn}><Minus size={16} /></button>
              <span style={{ minWidth: 30, textAlign: 'center', fontWeight: 900, fontSize: '0.95rem', borderLeft: '1px solid #e4e4e4', borderRight: '1px solid #e4e4e4', lineHeight: '32px' }}>{item.quantity}</span>
              <button onClick={() => handleUpdateQty(item.cartId, 1)} aria-label={th ? 'เพิ่มจำนวน' : 'Increase'} style={stepBtn}><Plus size={16} /></button>
            </div>
            <span style={{ fontWeight: 900, color: '#c8102e', fontSize: '1rem' }}>฿{cardTotal.toLocaleString()}</span>
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: '0.45rem', flexWrap: 'wrap' }}>
            {editSource && (
              <button onClick={() => setEditingRow(item)} style={chipBtn('#141414', '#efefef')}>
                <Pencil size={13} /> {th ? 'แก้ไขตัวเลือก' : 'Edit options'}
              </button>
            )}
            <button onClick={() => removeRow(item)} style={chipBtn('#b91c1c', '#fef2f2')}>
              <Trash2 size={13} /> {th ? 'ลบ' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── หน้า 2: ตะกร้า — ตรวจ/แก้ไข/ลบ ก่อนไปชำระเงิน ──
  const renderCartPage = () => (
    <>
      {renderTopBar(th ? 'ตะกร้าของฉัน' : 'My cart', <ShoppingCart size={22} color="#c8102e" style={{ flexShrink: 0 }} />, true)}
      {renderSteps(1)}
      {cart.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: '#5a5a5a' }}>
          <ShoppingCart size={56} color="#d0d0d0" style={{ margin: '0 auto 0.75rem', display: 'block' }} />
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#141414', marginBottom: '0.3rem' }}>{th ? 'ยังไม่มีรายการในตะกร้า' : 'Your cart is empty'}</div>
          <div style={{ fontSize: '0.88rem', marginBottom: '1.25rem' }}>{th ? 'เลือกเมนูที่ชอบใส่ตะกร้าได้เลย' : 'Add some dishes to get started.'}</div>
          <button onClick={goBack} style={{ ...bigBtnStyle(ORANGE, false), width: 'auto', display: 'inline-flex', padding: '0.8rem 1.6rem' }}>
            {th ? 'เลือกเมนู' : 'Browse menu'}
          </button>
        </div>
      ) : (
        <div style={{ padding: '0.5rem 1rem 1rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#5a5a5a', fontWeight: 700, marginBottom: '0.6rem' }}>
            {th ? `${totalItemsCount} รายการ · ตรวจสอบและแก้ไขได้ก่อนส่งเข้าครัว` : `${totalItemsCount} items · review before sending to the kitchen`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {cartCards.map(renderCartRow)}
          </div>
          <button onClick={goBack} style={{
            width: '100%', marginTop: '0.75rem', border: '2px dashed #f07a8a', background: '#fdf2f4', color: '#a50d25',
            borderRadius: '14px', padding: '0.75rem', fontWeight: 800, fontSize: '0.92rem', fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
            <Plus size={17} /> {th ? 'เลือกเมนูเพิ่ม' : 'Add more items'}
          </button>
        </div>
      )}

      {cart.length > 0 && (
        <div style={footerStyle}>
          {billRows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, color: '#5a5a5a', marginBottom: '0.2rem' }}>
              <span>{th ? `สั่งไปแล้วก่อนหน้า (${billCount} รายการ)` : `Already ordered (${billCount})`}</span>
              <span>฿{money(billTotal)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 800, marginBottom: '0.3rem', color: '#141414' }}>
            <span>{th ? `สั่งรอบนี้ (${totalItemsCount} รายการ)` : `This order (${totalItemsCount} items)`}</span>
            <span style={{ color: '#c8102e', fontSize: '1.3rem', fontWeight: 900 }}>฿{money(cartSubtotal)}</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 700, marginBottom: '0.6rem', background: '#f0fdf4', borderRadius: 8, padding: '0.35rem 0.55rem' }}>
            💡 {th ? 'ยังไม่ต้องจ่ายตอนนี้ — ทานเสร็จแล้วกด "ชำระเงิน" จ่ายรวมทีเดียว' : 'No need to pay now — pay for everything when you are done.'}
          </div>
          {sendError && (
            <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '0.4rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.5rem' }}>⚠️ {sendError}</div>
          )}
          <button onClick={handleSendOrder} disabled={sendBusy} style={{ ...bigBtnStyle(ORANGE, sendBusy), justifyContent: 'space-between', boxShadow: sendBusy ? 'none' : '0 8px 20px rgba(165, 13, 37, 0.3)' }}>
            <span>{sendBusy ? (th ? 'กำลังส่งออเดอร์...' : 'Sending...') : (th ? 'ยืนยันสั่งอาหาร' : 'Place order')}</span>
            <ChefHat size={22} />
          </button>
        </div>
      )}
    </>
  );

  // ── หน้า 3: ชำระเงิน (QR พร้อมเพย์ → แจ้งโอน → รอพนักงานยืนยัน → สำเร็จ) ──
  const renderPayPage = () => {
    if (payStage === 'approved' || payStage === 'waiting') {
      return (
        <>
          {renderTopBar(th ? 'ชำระเงิน' : 'Payment', <ShoppingBag size={22} color="#c8102e" style={{ flexShrink: 0 }} />, false)}
          {renderSteps(3, payStage === 'approved')}
          <div style={{ padding: '0 1rem' }}>
            {payStage === 'approved' ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
              <CheckCircle size={64} color="#16a34a" style={{ margin: '0 auto 0.75rem' }} />
              <h3 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#16a34a', marginBottom: '0.4rem' }}>
                {lang === 'th' ? 'ชำระเงินสำเร็จ!' : 'Payment confirmed!'}
              </h3>
              <p style={{ color: '#454545', fontSize: '0.95rem', fontWeight: '600', marginBottom: '1.25rem' }}>
                {lang === 'th' ? 'ร้านได้รับเงินแล้ว ขอบคุณที่ใช้บริการครับ' : 'We received your payment. Thank you!'}
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
                style={{ width: '100%', marginTop: '1.25rem', background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#fff', border: 'none', borderRadius: '14px', padding: '1rem', fontWeight: '900', fontSize: '1.05rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                🍽️ {lang === 'th' ? 'กลับหน้าเมนู' : 'Back to menu'}
              </button>
            </div>
          
            ) : (
            <div style={{ textAlign: 'center', padding: '1.25rem 0.25rem' }}>
              <div style={{ width: 64, height: 64, margin: '0.5rem auto 0.75rem', borderRadius: '50%', border: '7px solid #f5b5bf', borderTopColor: '#c8102e', animation: 'kioskspin 1s linear infinite' }} />
              <style>{'@keyframes kioskspin { to { transform: rotate(360deg); } }'}</style>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '900', color: '#8e0b20', margin: '0 0 0.35rem' }}>
                {lang === 'th' ? 'กำลังตรวจสอบการโอน...' : 'Checking your transfer...'}
              </h3>
              <p style={{ color: '#5a5a5a', fontSize: '0.88rem', fontWeight: '600', margin: '0 0 1rem', lineHeight: 1.5 }}>
                {lang === 'th' ? 'พนักงานกำลังเช็กยอดเงินเข้า กรุณาอย่าปิดหน้านี้' : 'Our staff are confirming the payment. Please keep this page open.'}
              </p>
              <div style={{ background: '#f8f8f8', border: '1px solid #e4e4e4', borderRadius: '12px', padding: '0.75rem 0.9rem', textAlign: 'left' }}>
                {(paySnap?.items || []).map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.88rem', padding: '0.15rem 0' }}>
                    <span>{it.qty}× {it.name}{it.options ? <span style={{ color: '#5a5a5a' }}> ({it.options})</span> : null}</span>
                    <b>฿{Number(it.amount || 0).toLocaleString()}</b>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #d0d0d0', marginTop: '0.4rem', paddingTop: '0.45rem', fontWeight: '900' }}>
                  <span>{lang === 'th' ? 'ยอดโอน' : 'Amount'}</span>
                  <span style={{ color: '#c8102e' }}>฿{Number(paySnap?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <p style={{ color: '#7a7a7a', fontSize: '0.78rem', marginTop: '1rem' }}>
                {lang === 'th' ? 'รอนานเกิน 5 นาที กรุณาแจ้งพนักงาน' : 'Waiting more than 5 minutes? Please call our staff.'}
              </p>
            </div>
            )}
          </div>
        </>
      );
    }

    return (
      <>
        {renderTopBar(th ? 'ชำระเงิน' : 'Payment', <ShoppingBag size={22} color="#c8102e" style={{ flexShrink: 0 }} />, true)}
        {renderSteps(3)}
        <div style={{ padding: '0.5rem 1rem 1rem' }}>
          {/* สรุปรายการ — กดกลับไปแก้ไขตะกร้าได้ */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: '14px', padding: '0.7rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 900, marginBottom: '0.3rem' }}>
              <span>{th ? `รายการทั้งบิล (${billCount})` : `Whole bill (${billCount})`}</span>
              <button onClick={goBack} style={chipBtn('#141414', '#efefef')}>
                <Receipt size={13} /> {th ? 'ดูบิล' : 'View bill'}
              </button>
            </div>
            {billRows.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.12rem 0' }}>
                <span style={{ minWidth: 0 }}>
                  {it.qty}× {it.name}
                  {it.options ? <span style={{ color: '#5a5a5a' }}> ({it.options})</span> : null}
                </span>
                <b style={{ flexShrink: 0 }}>฿{Number(it.amount || 0).toLocaleString()}</b>
              </div>
            ))}
            {/* ส่วนลดคูปองสมาชิก: แยกทีละใบ แล้วสรุปยอดที่ต้องจ่าย */}
            {couponOff > 0 && (
              <div style={{ borderTop: '1px dashed #d0d0d0', marginTop: '0.4rem', paddingTop: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{th ? 'รวมค่าอาหาร' : 'Subtotal'}</span><b>฿{money(billTotal)}</b></div>
                {kApplied.filter(c => Number(c.discount) > 0).map(c => (
                  <div key={'d' + c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', color: '#16a34a' }}>
                    <span style={{ minWidth: 0 }}>{th ? 'ส่วนลด' : 'Discount'} · {c.title}</span><b style={{ flexShrink: 0 }}>-฿{money(c.discount)}</b>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, marginTop: '0.2rem' }}><span>{th ? 'ยอดชำระ' : 'Total'}</span><span style={{ color: '#c8102e' }}>฿{money(payTotal)}</span></div>
              </div>
            )}
            {kApplied.filter(c => !(Number(c.discount) > 0)).map(c => (
              <div key={'v' + c.id} style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.2rem' }}>🎁 {c.title} · {th ? 'ใบรับของ แจ้งพนักงานรับของ' : 'voucher, ask staff'}</div>
            ))}
          </div>

          {/* PromptPay QR Code container */}
          <div style={{ background: '#ffffff', border: '1px solid #d0d0d0', borderRadius: '16px', padding: '1rem', textAlign: 'center', marginBottom: '1.25rem', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
            <div style={{ color: '#003d6a', fontWeight: '900', fontSize: '1rem', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>
              THAI QR PAYMENT
            </div>
            <div style={{ background: '#003d6a', color: 'white', fontWeight: '800', fontSize: '0.8rem', borderRadius: '6px', padding: '0.25rem', marginBottom: '0.75rem' }}>
              PromptPay (พร้อมเพย์)
            </div>

            {qrType === 'static' ? (
              <img src={staticQrUrl} alt="Static QR" style={{ width: '220px', height: '220px', margin: '0 auto', display: 'block' }} />
            ) : payTotal <= 0 ? (
              <div style={{ height: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: '#166534', fontWeight: 800 }}>
                <CheckCircle size={48} color="#16a34a" />
                {th ? 'คูปองครอบคลุมยอดทั้งหมด ไม่ต้องโอนเงิน' : 'Fully covered by coupons — no transfer needed'}
              </div>
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt="Dynamic PromptPay QR" style={{ width: '220px', height: '220px', margin: '0 auto', display: 'block' }} />
            ) : (
              <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a5a' }}>
                {lang === 'th' ? 'กำลังสร้าง QR Code...' : 'Generating QR Code...'}
              </div>
            )}

            <div style={{ marginTop: '0.5rem', color: '#141414' }}>
              <div style={{ fontSize: '0.78rem', color: '#5a5a5a' }}>{lang === 'th' ? 'ยอดชำระทั้งสิ้น' : 'Total Amount'}</div>
              <div style={{ fontSize: '1.75rem', fontWeight: '900', color: '#c8102e' }}>
                ฿{payTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* บันทึกรูป QR ไว้เปิดในแอปธนาคาร (สแกนจอตัวเองด้วยเครื่องเดียวกันไม่ได้) */}
            {payTotal > 0 && (qrType === 'static' ? staticQrUrl : qrDataUrl) && (
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
                  color: qrSaveState === 'error' ? '#b91c1c' : qrSaveState === 'saved' ? '#166534' : '#5a5a5a'
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
          <p style={{ textAlign: 'center', color: '#5a5a5a', fontSize: '0.78rem', margin: '0.6rem 0 0', lineHeight: 1.45 }}>
            {th ? 'สแกน QR แล้วโอนตามยอด จากนั้นกดปุ่ม "ฉันโอนเงินแล้ว" พนักงานจะตรวจยอดแล้วปิดบิลให้' : 'Pay with the QR, then tap "I have transferred". Our staff will confirm and close your bill.'}
          </p>
        </div>

        <div style={footerStyle}>
          <button
            onClick={handleTransferDone}
            disabled={payBusy || billRows.length === 0}
            style={{ ...bigBtnStyle(BLACK, payBusy || billRows.length === 0), boxShadow: (payBusy || billRows.length === 0) ? 'none' : '0 8px 20px rgba(0,0,0,0.3)' }}
          >
            <CheckCircle size={22} />
            {payBusy
              ? (th ? 'กำลังแจ้งร้าน...' : 'Notifying the shop...')
              : payTotal <= 0
                ? (th ? 'ยืนยันปิดบิล' : 'Close my bill')
                : payStage === 'rejected'
                ? (th ? 'แจ้งโอนอีกครั้ง' : 'Notify again')
                : (th ? 'ฉันโอนเงินแล้ว' : 'I have transferred')}
          </button>
          <button onClick={goBack} style={{ width: '100%', marginTop: '0.4rem', background: 'none', border: 'none', color: '#5a5a5a', fontSize: '0.82rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <ChevronLeft size={15} /> {th ? 'กลับไปดูบิล' : 'Back to bill'}
          </button>
        </div>
      </>
    );
  };

  // เลขคิว (ลูกค้าที่ไม่ได้สแกน QR โต๊ะ) — ให้ลูกค้าบอกพนักงานได้ตอนรับอาหาร/ชำระเงิน
  const queueLabel = !tableParam && /^คิว /.test(tableNo) ? tableNo.split(' ')[1] : '';
  const timeOf = (at) => new Date(at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const renderBillLines = (items) => items.map((it, idx) => (
    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.9rem', padding: '0.18rem 0' }}>
      <span style={{ minWidth: 0 }}>
        <b>{it.qty}×</b> {it.name}
        {it.options ? <span style={{ color: '#5a5a5a', fontSize: '0.8rem' }}> ({it.options})</span> : null}
        {it.note ? <span style={{ color: '#8e0b20', fontSize: '0.78rem' }}> 📝 {it.note}</span> : null}
      </span>
      <b style={{ flexShrink: 0 }}>฿{Number(it.amount || 0).toLocaleString()}</b>
    </div>
  ));
  const queueBadge = queueLabel ? (
    <div style={{ background: '#141414', color: '#fff', borderRadius: 14, padding: '0.6rem 0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
      <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{th ? 'เลขคิวของคุณ' : 'Your queue no.'}</span>
      <span style={{ fontWeight: 900, fontSize: '1.5rem', letterSpacing: 1 }}>{queueLabel}</span>
    </div>
  ) : null;

  // ── หน้า "สั่งแล้ว": ส่งเข้าครัวสำเร็จ ยังไม่ต้องจ่าย ──
  const renderSentPage = () => (
    <>
      {renderTopBar(th ? 'สั่งอาหารแล้ว' : 'Order sent', <ChefHat size={22} color="#16a34a" style={{ flexShrink: 0 }} />, false)}
      {renderSteps(3)}
      <div style={{ padding: '0.5rem 1rem 1rem' }}>
        <div style={{ textAlign: 'center', padding: '0.75rem 0.5rem 1rem' }}>
          <CheckCircle size={60} color="#16a34a" style={{ margin: '0 auto 0.6rem' }} />
          <h3 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#16a34a', margin: '0 0 0.3rem' }}>{th ? 'ส่งออเดอร์เข้าครัวแล้ว!' : 'Sent to the kitchen!'}</h3>
          <p style={{ color: '#454545', fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>{th ? 'ครัวกำลังเตรียมอาหารให้ รอสักครู่นะครับ' : 'Your food is being prepared.'}</p>
        </div>
        {queueBadge}
        {lastSent && (
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: 14, padding: '0.75rem 0.9rem', marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 900, fontSize: '0.88rem', color: '#5a5a5a', marginBottom: '0.3rem' }}>
              {th ? `รอบนี้ · ${timeOf(lastSent.at)} น.` : `This order · ${timeOf(lastSent.at)}`}
            </div>
            {renderBillLines(lastSent.items)}
          </div>
        )}
        <div style={{ background: '#fdf2f4', border: '1.5px solid #f5b5bf', borderRadius: 14, padding: '0.75rem 0.9rem', color: '#7a0a1c', fontSize: '0.86rem', fontWeight: 700, lineHeight: 1.5 }}>
          💳 {th ? 'ยังไม่ต้องชำระตอนนี้ — สั่งเพิ่มได้เรื่อย ๆ ทานเสร็จแล้วกด "ชำระเงิน" จ่ายรวมทั้งบิลทีเดียว' : 'No need to pay yet — order more anytime and pay for everything at the end.'}
        </div>
      </div>
      <div style={footerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 800, marginBottom: '0.6rem' }}>
          <span>{th ? `ยอดรวมทั้งบิล (${billCount} รายการ)` : `Bill total (${billCount} items)`}</span>
          <span style={{ color: '#c8102e', fontSize: '1.3rem', fontWeight: 900 }}>฿{money(billTotal)}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => { window.history.replaceState({ ...(window.history.state || {}), kioskScreen: 'menu' }, ''); setScreen('menu'); }}
            style={{ ...bigBtnStyle(ORANGE, false), flex: 1, padding: '0.9rem 0.6rem' }}>
            <Plus size={20} /> {th ? 'สั่งเพิ่ม' : 'Order more'}
          </button>
          <button onClick={() => { window.history.replaceState({ ...(window.history.state || {}), kioskScreen: 'bill' }, ''); setScreen('bill'); }}
            style={{ ...bigBtnStyle('#ffffff', false), flex: 1, padding: '0.9rem 0.6rem', color: '#141414', border: '2px solid #141414' }}>
            <Receipt size={20} /> {th ? 'ดูบิล / ชำระเงิน' : 'Bill / Pay'}
          </button>
        </div>
      </div>
    </>
  );

  // ── หน้า "บิลของฉัน": ทุกรอบที่สั่งไป + ปุ่มชำระเงิน ──
  const renderBillPage = () => (
    <>
      {renderTopBar(th ? 'บิลของฉัน' : 'My bill', <Receipt size={22} color="#c8102e" style={{ flexShrink: 0 }} />, true)}
      {renderSteps(3)}
      <div style={{ padding: '0.5rem 1rem 1rem' }}>
        {queueBadge}
        {bill.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem', color: '#5a5a5a' }}>
            <Receipt size={52} color="#d0d0d0" style={{ margin: '0 auto 0.75rem', display: 'block' }} />
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#141414', marginBottom: '0.3rem' }}>{th ? 'ยังไม่มีรายการในบิล' : 'Nothing ordered yet'}</div>
            <div style={{ fontSize: '0.88rem' }}>{th ? 'เลือกเมนูแล้วกด "ยืนยันสั่งอาหาร" รายการจะมาอยู่ที่นี่' : 'Items you order will appear here.'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {bill.map((round, i) => (
              <div key={round.id} style={{ background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: 14, padding: '0.7rem 0.9rem', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 900, fontSize: '0.9rem' }}>{th ? `สั่งครั้งที่ ${i + 1}` : `Order #${i + 1}`} <span style={{ color: '#7a7a7a', fontWeight: 700 }}>· {timeOf(round.at)}{th ? ' น.' : ''}</span></span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '0.15rem 0.55rem' }}>✓ {th ? 'ส่งเข้าครัวแล้ว' : 'Sent'}</span>
                </div>
                {renderBillLines(round.items || [])}
              </div>
            ))}
          </div>
        )}
        <button onClick={() => { window.history.replaceState({ ...(window.history.state || {}), kioskScreen: 'menu' }, ''); setScreen('menu'); }} style={{
          width: '100%', marginTop: '0.75rem', border: '2px dashed #f07a8a', background: '#fdf2f4', color: '#a50d25',
          borderRadius: '14px', padding: '0.75rem', fontWeight: 800, fontSize: '0.92rem', fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
        }}>
          <Plus size={17} /> {th ? 'สั่งอาหารเพิ่ม' : 'Order more'}
        </button>
      </div>
      {bill.length > 0 && crmOn && member && renderCouponCard()}
      {bill.length > 0 && (
        <div style={footerStyle}>
          {couponOff > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '0.3rem', color: '#16a34a', fontSize: '0.9rem' }}>
              <span>{th ? 'ส่วนลดคูปอง' : 'Coupons'} · {kApplied.map(c => c.title).join(' + ')}</span>
              <span>-฿{money(couponOff)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 800, marginBottom: '0.6rem' }}>
            <span>{th ? `ยอดรวมทั้งบิล (${billCount} รายการ)` : `Bill total (${billCount} items)`}</span>
            <span style={{ color: '#c8102e', fontSize: '1.3rem', fontWeight: 900 }}>
              {couponOff > 0 && <s style={{ color: '#7a7a7a', fontSize: '0.9rem', marginRight: 6 }}>฿{money(billTotal)}</s>}
              ฿{money(payTotal)}
            </span>
          </div>
          <button onClick={() => goTo('pay')} style={{ ...bigBtnStyle(BLACK, false), justifyContent: 'space-between', boxShadow: '0 8px 20px rgba(0,0,0,0.3)' }}>
            <span>💳 {th ? 'ชำระเงิน' : 'Pay now'}</span>
            <ChevronRight size={22} />
          </button>
        </div>
      )}
    </>
  );

  // เปิดหน้าชำระเงินค้างไว้แต่บิลว่าง (เช่นกดย้อน/ไปหน้าหลังชำระเสร็จ) → แสดงหน้าบิลแทน
  const page = (screen === 'pay' && !payStage && billRows.length === 0) ? 'bill' : screen;

  return (
    <div style={{
      // 100dvh = ความสูงจอ "จริง" ตอนนั้น — 100vh บนมือถือจะนับรวมแถบที่อยู่เว็บที่ยุบ ๆ ยืด ๆ
      minHeight: '100dvh',
      background: '#f8f8f8',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#141414',
      // กล่องนี้เป็นลูกของ .app-container ซึ่งเป็น flex column — พอใส่ margin auto
      // ตัวมันจะเลิก stretch แล้วกว้างตามเนื้อหา (ไปชน max-width 480) ทำให้จอ 320-430px
      // เลื่อนซ้ายขวาได้ ต้องกำหนด width 100% + min-width 0 บังคับให้กว้างเท่าจอเสมอ
      width: '100%',
      minWidth: 0,
      maxWidth: '480px',
      margin: '0 auto',
      boxShadow: '0 0 30px rgba(0,0,0,0.1)',
      position: 'relative',
      // เผื่อที่ให้แถบตะกร้าลอย / แถบปุ่มติดล่าง + แถบ home ของ iPhone
      paddingBottom: page === 'menu' ? 'calc(110px + env(safe-area-inset-bottom))' : 'calc(170px + env(safe-area-inset-bottom))',
      WebkitTapHighlightColor: 'transparent',
      // clip (ไม่ใช่ hidden) — hidden ทำให้กล่องนี้กลายเป็นกรอบเลื่อน แถบที่ตั้ง sticky ข้างใน
      // (แบนเนอร์ แถบหมวดหมู่ แถบบนของหน้าตะกร้า) จะไม่เกาะจอตอนเลื่อนหน้า
      overflowX: 'clip'
    }}>

      {/* ─── หน้า 1: เมนู — ซ่อนไว้ (ไม่ถอดออก) ตอนอยู่หน้าตะกร้า/ชำระเงิน กลับมาแล้วอยู่ที่เดิม ─── */}
      <div style={{ display: page === 'menu' ? 'block' : 'none' }}>
        {/* หัวร้าน: โลโก้เต็มความกว้าง */}
        <header style={{ background: '#ffffff', padding: '0.6rem 0.9rem 0.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
              <div style={{
                background: '#fdf2f4', border: '1.5px solid #fbe0e4',
                color: '#a50d25', fontWeight: '800', fontSize: 'clamp(0.72rem, 3vw, 0.85rem)',
                padding: '0.35rem 0.6rem', borderRadius: '20px', whiteSpace: 'nowrap'
              }}>
                🍽️ {th ? 'ทานที่ร้าน' : 'Dine in'}
              </div>
            </div>
            <button
              onClick={() => setLang(th ? 'en' : 'th')}
              style={{
                background: '#f1f1f1', border: '1px solid #d0d0d0',
                borderRadius: '20px', padding: '0.35rem 0.55rem',
                color: '#141414', fontWeight: '700', fontSize: 'clamp(0.7rem, 3vw, 0.8rem)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
                whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit'
              }}
            >
              <Globe size={13} /> {th ? 'TH' : 'EN'}
            </button>
          </div>
        </header>

        {/* แบนเนอร์สไลด์ — ตั้งให้ค้างจอได้ที่หลังบ้าน (แถบหมวดหมู่จะเกาะต่อใต้แบนเนอร์) */}
        {bannerShown && (
          <div ref={bannerBoxRef} style={{
            ...(bannerSticky ? { position: 'sticky', top: 0, zIndex: 96 } : {}),
            background: '#ffffff', padding: '0.45rem 0.9rem 0.35rem'
          }}>
            {renderBanner(bannerPromo ? 448 : 330)}
          </div>
        )}
        <div style={{ background: '#ffffff', borderBottom: '1px solid #e4e4e4', padding: banner.showCaption ? '0.1rem 0.9rem 0.7rem' : '0 0 0.35rem' }}>
          {banner.showCaption && (
            <div style={{ ...captionStyle, fontSize: 'clamp(0.72rem, 3vw, 0.82rem)' }}>
              <Utensils size={13} style={{ flexShrink: 0 }} />
              {th ? 'สั่งอาหารด้วยตนเอง · สั่งได้เลย ทานเสร็จค่อยชำระเงิน' : 'Self-order · order now, pay when you are done'}
            </div>
          )}
        </div>

        {/* ─── แถบหมวดหมู่ (3 ขีด) — กดแล้วเลื่อนไปยังหมวดนั้นในหน้าเดียวกัน ─── */}
        <div
          ref={catBarRef}
          style={{
            position: 'sticky', top: stickyBannerH, zIndex: 95,
            background: '#f8f8f8', padding: '0.5rem 1rem 0.6rem'
          }}
        >
          <button
            onClick={() => setShowCategoryMenu(true)}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.75rem 0.9rem', borderRadius: '14px',
              border: '2px solid #e4e4e4', background: '#ffffff',
              color: '#141414', fontWeight: '800', fontSize: '0.95rem',
              fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
              boxShadow: '0 4px 12px rgba(20, 20, 20, 0.05)'
            }}
          >
            <Menu size={20} color="#c8102e" />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeCat ? `${activeCat.icon} ${activeCat.name}` : (lang === 'th' ? 'เลือกหมวดหมู่' : 'Choose a category')}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#7a7a7a', fontWeight: '700', flexShrink: 0 }}>
              {lang === 'th' ? 'ข้ามไปหมวด' : 'Jump to'}
            </span>
            <ChevronRight size={18} color="#7a7a7a" style={{ transform: 'rotate(90deg)', flexShrink: 0 }} />
          </button>
        </div>

        {/* ─── เมนูทั้งหมด แยกเป็นบล็อกตามหมวด ไล่ดูรวดเดียวได้ ─── */}
        <main style={{ padding: '0 1rem' }}>
          {menuSections.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#5a5a5a', fontWeight: '700', padding: '2.5rem 1rem' }}>
              {lang === 'th' ? 'ยังไม่มีเมนูให้สั่งตอนนี้' : 'No menu items available right now.'}
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.8rem', color: '#5a5a5a', fontWeight: '700', marginBottom: '0.75rem' }}>
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
                    <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#141414', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
                      <span style={{ flexShrink: 0 }}>{section.icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.name}</span>
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: '#5a5a5a', fontWeight: '700', flexShrink: 0 }}>
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

        {/* ─── แถบบิลลอยด้านล่าง (ตะกร้าว่าง แต่สั่งไปแล้ว) → ไปหน้าบิล/ชำระเงิน ─── */}
        {cart.length === 0 && billRows.length > 0 && (
          <div style={{
            position: 'fixed', bottom: 'calc(15px + env(safe-area-inset-bottom))',
            left: '50%', transform: 'translateX(-50%)',
            width: 'calc(100% - 2rem)', maxWidth: '440px', zIndex: 90
          }}>
            <button onClick={() => goTo('bill')} style={{
              width: '100%', background: 'linear-gradient(135deg, #222222 0%, #000000 100%)', color: '#ffffff',
              border: '1.5px solid #c8102e', borderRadius: '20px', padding: '0.95rem 1.25rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: '0 12px 30px rgba(20,83,45,0.4)', cursor: 'pointer', fontFamily: 'inherit'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Receipt size={28} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.78rem', color: '#d0d0d0', fontWeight: '600' }}>{th ? `บิลของฉัน · ${billCount} รายการ` : `My bill · ${billCount} items`}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: '900' }}>฿{billTotal.toLocaleString()}</div>
                </div>
              </div>
              <div style={{ background: '#c8102e', color: '#ffffff', fontWeight: '900', fontSize: '0.95rem', padding: '0.6rem 1.1rem', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{th ? 'ชำระเงิน' : 'Pay'}</span>
                <ChevronRight size={18} />
              </div>
            </button>
          </div>
        )}

        {/* ─── แถบตะกร้าลอยด้านล่าง ─── */}
        {cart.length > 0 && (
          <div style={{
            position: 'fixed', bottom: 'calc(15px + env(safe-area-inset-bottom))',
            left: '50%', transform: 'translateX(-50%)',
            width: 'calc(100% - 2rem)', maxWidth: '440px', zIndex: 90
          }}>
            <button
              onClick={() => goTo('cart')}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #141414 0%, #222222 100%)',
                color: '#ffffff', border: '1.5px solid #333333', borderRadius: '20px',
                padding: '0.95rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 12px 30px rgba(20, 20, 20, 0.4)', cursor: 'pointer', fontFamily: 'inherit'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  background: '#c8102e', color: 'white', borderRadius: '50%',
                  width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: '900', fontSize: '0.95rem'
                }}>
                  {totalItemsCount}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.78rem', color: '#7a7a7a', fontWeight: '600' }}>
                    {th ? 'ตะกร้า (ยังไม่ได้สั่ง)' : 'Cart (not sent yet)'}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: '900', color: '#ffffff' }}>
                    ฿{cartSubtotal.toLocaleString()}
                  </div>
                </div>
              </div>

              <div style={{
                background: ORANGE,
                color: '#ffffff', fontWeight: '800', fontSize: '0.95rem',
                padding: '0.6rem 1.1rem', borderRadius: '14px',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}>
                <span>{th ? 'ดูตะกร้า' : 'View cart'}</span>
                <ChevronRight size={18} />
              </div>
            </button>
          </div>
        )}
      </div>

      {page === 'cart' && renderCartPage()}
      {page === 'sent' && renderSentPage()}
      {page === 'bill' && renderBillPage()}
      {page === 'pay' && renderPayPage()}

      {/* ─── รูปเมนูขยายเต็มจอ ─── */}
      {/* แจ้งว่าเอาเมนูเฉพาะสมาชิกออกจากตะกร้าแล้ว (ออกจาก/เปลี่ยนสมาชิก หรือล็อกอินหมดเวลา) */}
      {memberNotice && (
        <div role="alert" style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3100, width: 'min(92vw, 480px)', background: '#fdf2f4', border: '2px solid #c8102e', color: '#7a0a1c', borderRadius: 14, padding: '0.7rem 2.4rem 0.7rem 0.9rem', fontWeight: 700, fontSize: '0.9rem', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          👑 {memberNotice}
          <button onClick={() => setMemberNotice('')} aria-label={lang === 'th' ? 'ปิด' : 'Close'} style={{ position: 'absolute', top: 6, right: 8, border: 0, background: 'none', fontSize: '1.2rem', color: '#7a0a1c', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* ── ล็อกอินสมาชิก (กดเมนูเฉพาะสมาชิกตอนยังไม่ล็อกอิน): ใส่เลขสมาชิก → ยืนยันรหัส 6 หลักในบัตร LINE ── */}
      {gateFood && (() => {
        const th = lang === 'th';
        const field = { flex: 1, minWidth: 0, border: '1.5px solid #d0d0d0', borderRadius: 12, padding: '0.7rem 0.8rem', fontSize: '1rem', fontFamily: 'inherit' };
        const goBtn = (on) => ({ border: 0, background: '#141414', color: '#fff', borderRadius: 12, padding: '0 1rem', fontWeight: 800, fontFamily: 'inherit', fontSize: '0.95rem', opacity: on ? 1 : 0.5, cursor: 'pointer' });
        const close = () => { setGateFood(null); setGateMsg(''); };
        return (
          <div role="dialog" aria-modal="true" aria-label={th ? 'ล็อกอินสมาชิก' : 'Member login'} onClick={close}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20, 20, 20, 0.5)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: '22px 22px 0 0', padding: '1rem 1.1rem 1.4rem', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: '#d0d0d0', margin: '0 auto 0.8rem' }} />
              <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', marginBottom: '0.9rem' }}>
                <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: '#f1f1f1' }}>
                  <MenuImage food={gateFood} alt="" placeholderSize="1.5rem" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '1.05rem' }}>{th ? gateFood.name : (gateFood.nameEn || gateFood.name)}</div>
                  <div style={{ color: '#8e0b20', fontWeight: 800, fontSize: '0.88rem' }}>👑 {th ? 'เมนูนี้สั่งได้เฉพาะสมาชิก · ล็อกอินก่อนนะ' : 'Members only · please log in'}</div>
                </div>
              </div>
              {!crmOn ? (
                <p style={{ color: '#b91c1c', fontWeight: 700 }}>{th ? 'ตอนนี้ระบบสมาชิกยังไม่พร้อม สั่งเมนูนี้ไม่ได้ชั่วคราว' : 'Membership is unavailable right now.'}</p>
              ) : !member ? (
                <>
                  <label htmlFor="gate-member" style={{ display: 'block', fontWeight: 800, marginBottom: '0.4rem' }}>{th ? 'ขั้นที่ 1/2: ใส่เลขที่สมาชิก หรือเบอร์โทรที่สมัครไว้' : 'Step 1/2: member no. or phone'}</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input id="gate-member" value={memberInput} autoComplete="off" autoFocus
                      onChange={e => { setMemberInput(e.target.value); setMemberErr(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') checkMember(); }} style={field} />
                    <button onClick={checkMember} disabled={memberBusy || !memberInput.trim()} style={goBtn(!memberBusy && memberInput.trim())}>{memberBusy ? '…' : (th ? 'ถัดไป' : 'Next')}</button>
                  </div>
                  {memberErr && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 600 }}>{memberErr}</div>}
                  <div style={{ fontSize: '0.8rem', color: '#5a5a5a', marginTop: '0.4rem' }}>{th ? 'ดูเลขที่สมาชิกได้ในบัตรสมาชิก LINE' : 'Your member no. is in your LINE member card'}</div>
                  {joinUrl && (
                    <>
                      <div style={{ textAlign: 'center', color: '#7a7a7a', fontSize: '0.8rem', margin: '0.9rem 0 0' }}>{th ? 'ยังไม่เป็นสมาชิก?' : 'Not a member yet?'}</div>
                      <a href={joinUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', textAlign: 'center', background: '#06c755', color: '#fff', borderRadius: 12, padding: '0.7rem', fontWeight: 800, marginTop: '0.4rem', textDecoration: 'none' }}>
                        {th ? 'สมัครสมาชิกฟรีผ่าน LINE' : 'Join free on LINE'}
                      </a>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 800, marginBottom: '0.3rem' }}>{th ? `ขั้นที่ 2/2: ยืนยันตัวตนคุณ${member.name}` : `Step 2/2: verify, ${member.name}`}</div>
                  <label htmlFor="gate-code" style={{ display: 'block', fontSize: '0.88rem', color: '#7a0a1c', marginBottom: '0.5rem' }}>
                    {th ? 'เปิดบัตรสมาชิกใน LINE แล้วพิมพ์รหัส 6 หลักที่อยู่ใต้ QR' : 'Open your LINE member card and type the 6-digit code under the QR'}
                  </label>
                  {cardUrl && cardUrl !== '-' && (
                    <a href={cardUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-block', background: '#06c755', color: '#fff', borderRadius: 10, padding: '0.5rem 0.9rem', fontWeight: 800, textDecoration: 'none', marginBottom: '0.6rem' }}>
                      {th ? 'เปิดบัตรสมาชิกใน LINE' : 'Open LINE member card'}
                    </a>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input id="gate-code" value={codeInput} inputMode="numeric" maxLength={6} autoComplete="off" placeholder="000000"
                      onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setKMsg(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') checkCode(); }}
                      style={{ ...field, flex: '0 0 150px', letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.2rem' }} />
                    <button onClick={checkCode} disabled={kBusy === 'check' || codeInput.length !== 6} style={goBtn(codeInput.length === 6)}>{kBusy === 'check' ? '…' : (th ? 'ล็อกอิน' : 'Log in')}</button>
                  </div>
                  {(kMsg || gateMsg) && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>{kMsg || gateMsg}</div>}
                  <button onClick={() => keepMember(null)} style={{ marginTop: '0.7rem', border: 0, background: 'none', color: '#141414', textDecoration: 'underline', fontFamily: 'inherit', cursor: 'pointer', padding: 0 }}>
                    {th ? `ไม่ใช่คุณ${member.name}? เปลี่ยนสมาชิก` : 'Not you? Change member'}
                  </button>
                </>
              )}
              <button onClick={close} style={{ display: 'block', width: '100%', marginTop: '1rem', border: 0, background: 'none', color: '#454545', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer' }}>
                {th ? 'ไม่ใช่ตอนนี้' : 'Not now'}
              </button>
            </div>
          </div>
        );
      })()}

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
            food={previewFood}
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
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '900', color: '#141414', lineHeight: 1.3 }}>
              {lang === 'th' ? previewFood.name : (previewFood.nameEn || previewFood.name)}
            </h3>
            {previewFood.description && (
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#5a5a5a', lineHeight: 1.45, maxHeight: '20dvh', overflowY: 'auto' }}>
                {previewFood.description}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '0.25rem' }}>
              <div style={{ fontSize: '1.35rem', fontWeight: '900', color: '#c8102e' }}>
                ฿{(Number(previewFood.price) || 0).toLocaleString()}
              </div>
              <button
                onClick={() => { const food = previewFood; closePreview(); handleFoodClick(food); }}
                style={{
                  background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)',
                  color: '#ffffff', border: 'none', borderRadius: '11px',
                  padding: '0.75rem 1.4rem', fontWeight: '800', fontSize: '1rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                  boxShadow: '0 4px 12px rgba(165, 13, 37, 0.3)', fontFamily: 'inherit'
                }}
              >
                <Plus size={18} /> {lang === 'th' ? 'ใส่ตะกร้า' : 'Add to cart'}
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
          customerView
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
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '900', color: '#141414' }}>
                {lang === 'th' ? 'หมวดหมู่' : 'Categories'}
              </h3>
              <button
                onClick={() => setShowCategoryMenu(false)}
                style={{ background: '#f1f1f1', border: 'none', borderRadius: '50%', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={18} color="#141414" />
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
                      border: `2px solid ${isActive ? '#c8102e' : '#e4e4e4'}`,
                      background: isActive ? '#fdf2f4' : '#ffffff',
                      color: '#141414', fontWeight: '800', fontSize: '0.95rem',
                      fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%'
                    }}
                  >
                    <span style={{ flexShrink: 0, fontSize: '1.15rem' }}>{cat.icon}</span>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {cat.name}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#7a7a7a', flexShrink: 0 }}>
                      {count}
                    </span>
                    {isActive && <CheckCircle size={17} color="#c8102e" style={{ flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── แก้ไขตัวเลือกของรายการในตะกร้า — ป๊อปอัพเดิม เปิดมาพร้อมที่เลือกไว้ ─── */}
      {editingRow && editSourceFor(editingRow) && (() => {
        const source = editSourceFor(editingRow);
        return (
          <OrderWizardModal
            key={editingRow.cartId}
            food={source}
            lang={lang}
            liveMenu={liveMenu}
            categories={categories}
            basePrice={Number(source.price) || 0}
            askDining={false}
            hasPriceForCustomerType={(m) => !m.noTakehomePrice}
            noteOptions={kioskNoteConfig.options}
            allowCustomNote={kioskNoteConfig.allowCustom}
            customerView
            initialState={editingRow.wizardState}
            confirmLabel={th ? 'บันทึกการแก้ไข' : 'Save changes'}
            onClose={() => setEditingRow(null)}
            onConfirm={handleConfirmWizardOrder}
          />
        );
      })()}
    </div>
  );
};

export default CustomerKiosk;
