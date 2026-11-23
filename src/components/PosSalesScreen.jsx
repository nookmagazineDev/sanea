import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, LogOut, Settings, Trash2, Plus, Minus,
  MoreHorizontal, Globe, Receipt, Printer, Tag, X, UserRound, QrCode
} from 'lucide-react';
import QrScanner from './QrScanner';
import { crmEnabled, lookupMember, crmCall, newCouponRef } from '../utils/crm';
import { isQrCode, useScannerWedge } from '../utils/qrScan';
import FoodCard from './FoodCard';
import { SALE_TYPES, sameTable, readTablesConfig, priceTypeForTable, saleTypesForTable } from '../utils/salePricing';
import { categoryVisibleFor, menuVisibleFor } from '../utils/categoryVisibility';
import './PosSalesScreen.css';
import { menuCategoryLookup, discountAmount as calcDiscount } from '../utils/discount';

// โต๊ะที่มีของค้างนานเกินเท่านี้ (นาที) จะขึ้นสีส้มเตือน
const LATE_MINUTES = 90;

const PosSalesScreen = ({
  lang, setLang,
  tableNumber, onSelectTable,
  tableOrders = [],
  liveMenu = [], categories = [], itemInCategory,
  activeCategory, setActiveCategory,
  cart = [],
  onOrderClick, onUpdateQuantity, onRemoveFromCart, onUpdateNote, onClearCart,
  onSendOrder, onCheckout, onDeleteTableItem, onPrintKitchen, onPrintPreBill, onCloseTable,
  discounts = [],
  resolvePrice,
  hasPriceForCustomerType = () => true,
  customerType, setCustomerType,
  customerName, setCustomerName,
  settings = {},
  isAdmin, isCashier, branch, branchId = "", currentUser,
  onLogout, onRefresh, isRefreshing,
  onOpenBill, onOpenAdmin, onOpenWaste, onOpenSummary, onOpenKiosk, onOpenTaxInvoice, onOpenPrep, onOpenStockCount, onDecreaseQuantity
}) => {
  const t = (th, en) => (lang === 'th' ? th : en);

  // ── โต๊ะที่ตั้งค่าไว้หลังบ้าน (แหล่งเดียวกับหน้าเลือกโต๊ะ) ──
  const [configuredTables, setConfiguredTables] = useState([]);
  useEffect(() => {
    const saved = readTablesConfig();
    if (saved.length > 0) setConfiguredTables(saved);
  }, []);

  const zones = useMemo(() => {
    if (configuredTables.length > 0) {
      return {
        DineIn:   configuredTables.filter(x => x.zone === 'DineIn' || !x.zone).map(x => x.name),
        Takehome: configuredTables.filter(x => x.zone === 'Takehome').map(x => x.name),
        Delivery: configuredTables.filter(x => x.zone === 'Delivery').map(x => x.name),
        VIP:      configuredTables.filter(x => x.zone === 'VIP').map(x => x.name)
      };
    }
    return {
      DineIn:   Array.from({ length: 16 }, (_, i) => String(i + 1)),
      Takehome: ['Takehome 1', 'Takehome 2', 'Takehome 3', 'Takehome 4', 'Takehome 5'],
      Delivery: ['LineMan', 'Grab', 'Shopee'],
      VIP:      []
    };
  }, [configuredTables]);

  const [zone, setZone] = useState('DineIn');
  const tablesInZone = zones[zone] || [];

  // เปิดมาให้เห็นโซนของโต๊ะที่กำลังคีย์อยู่ และกันค้างอยู่โซนที่ไม่มีโต๊ะเลย
  useEffect(() => {
    const order = ['DineIn', 'Takehome', 'Delivery', 'VIP'];
    const zoneOfCurrent = order.find(z => (zones[z] || []).some(n => sameTable(n, tableNumber)));
    if (zoneOfCurrent) { setZone(zoneOfCurrent); return; }
    if ((zones[zone] || []).length === 0) {
      const firstFilled = order.find(z => (zones[z] || []).length > 0);
      if (firstFilled) setZone(firstFilled);
    }
    // เจตนาไม่ใส่ zone ใน deps — ไม่งั้นจะเด้งกลับทุกครั้งที่ผู้ใช้กดสลับโซนเอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, tableNumber]);

  // สถานะโต๊ะ: ว่าง / มีลูกค้า / ค้างเกิน 90 นาที / จ่ายมาแล้วจากคีออส
  // รายการที่ Status = 'paid' คือลูกค้าสแกน QR สั่งเองและโอนมาแล้ว — โต๊ะยังมีคนนั่งอยู่
  // จึงต้องนับเป็นโต๊ะไม่ว่าง แต่ไม่ใช่ยอดที่ต้องไปเก็บเงิน
  const tableState = (name) => {
    const rows = tableOrders.filter(o => sameTable(o.TableNumber, name));
    if (rows.length === 0) return { status: 'free', count: 0, mins: 0, paidCount: 0 };
    const unpaid = rows.filter(o => o.Status !== 'paid');
    const paidCount = rows.length - unpaid.length;
    let earliest = null;
    rows.forEach(r => {
      const ts = new Date(r.Timestamp).getTime();
      if (!isNaN(ts) && (earliest === null || ts < earliest)) earliest = ts;
    });
    const mins = earliest ? Math.floor((Date.now() - earliest) / 60000) : 0;
    if (unpaid.length === 0) return { status: 'prepaid', count: rows.length, mins, paidCount };
    return { status: mins > LATE_MINUTES ? 'late' : 'busy', count: rows.length, mins, paidCount };
  };

  // ชุดราคาที่ควรใช้เมื่อเลือกโต๊ะในโซนนั้น ๆ
  const tierOfTable = (name) => priceTypeForTable(name, configuredTables);

  // ประเภทการขายที่เลือกได้ของโต๊ะที่เปิดอยู่ — ล็อกตาม priceTier ของโต๊ะ
  // ประเภทที่โต๊ะนี้ไม่มีจะไม่ขึ้นในช่องเลือกเลย จะได้ไม่เผลอสลับไปคิดผิดชุดราคา
  const saleTypeOptions = saleTypesForTable(tableNumber, configuredTables);
  const saleTypeLocked = !!tableNumber && saleTypeOptions.length === 1;

  // โต๊ะถูกเปิดจากหน้าอื่น (เช่นหน้าเลือกโต๊ะ) ประเภทการขายอาจค้างของโต๊ะเก่า
  // ดึงกลับมาให้ตรงกับโต๊ะที่เปิดอยู่เสมอ ไม่งั้นช่องเลือกจะโชว์ค่าว่าง
  useEffect(() => {
    if (!tableNumber) return;
    const tier = tierOfTable(tableNumber);
    if (customerType !== tier) setCustomerType(tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableNumber, configuredTables]);

  // รายการในบิลที่ถูกแตะ เพื่อเลือกว่าจะพิมพ์ซ้ำหรือยกเลิก
  const [actionItem, setActionItem] = useState(null);

  // จำนวนลูกค้าของโต๊ะที่กำลังจะเปิด (ถามเฉพาะโต๊ะทานที่ร้านที่ยังว่าง)
  const [pendingTable, setPendingTable] = useState(null);
  const [guestCount, setGuestCount] = useState(1);

  const openTable = (name, tier) => {
    setCustomerType(tier);
    onSelectTable(name);
  };

  const handleTableClick = (name) => {
    if (sameTable(name, tableNumber)) return;
    if (cart.length > 0 && !window.confirm(t(
      'ยังมีรายการในตะกร้าที่ยังไม่ได้ส่ง ถ้าเปลี่ยนโต๊ะรายการจะถูกล้าง ต้องการเปลี่ยนหรือไม่?',
      'The cart still has unsent items. Switching tables clears them. Continue?'
    ))) return;

    const tier = tierOfTable(name);
    // โต๊ะทานที่ร้านที่ยังไม่มีรายการ = เปิดโต๊ะใหม่ → ถามจำนวนลูกค้าไว้ขึ้นบิล
    if (tier === '' && tableState(name).count === 0) {
      setPendingTable(name);
      setGuestCount(1);
      return;
    }
    openTable(name, tier);
  };

  const confirmGuestCount = (skip = false) => {
    const name = pendingTable;
    if (!name) return;
    if (!skip) localStorage.setItem('customer_count_' + name, String(guestCount));
    setPendingTable(null);
    openTable(name, tierOfTable(name));
  };

  // ── เมนูที่ยังไม่ได้ตั้งราคาของประเภทการขายที่เลือกอยู่ ──
  // ยังโชว์ในตารางให้เห็นว่ามีเมนูนี้อยู่ แต่กดสั่งไม่ได้
  // ไม่งั้นพนักงานกดสั่งแล้วได้ราคาปกติมาโดยไม่รู้ตัว
  const unpricedIds = useMemo(
    () => new Set(liveMenu.filter(m => !hasPriceForCustomerType(m)).map(m => m.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveMenu, customerType]
  );
  const isUnpriced = (m) => unpricedIds.has(m.id);
  const unpricedNote = () => {
    const type = SALE_TYPES.find(o => o.value === customerType);
    const label = type ? (lang === 'th' ? type.th : type.en) : customerType;
    return t(
      `เมนูนี้ยังไม่ได้ตั้งราคาสำหรับ "${label}" — ตั้งได้ที่หลังบ้าน > จัดการเมนู`,
      `This item has no "${label}" price yet — set it in Admin > Menu`
    );
  };


  // ── ค้นหาเมนูแล้วกดเพิ่มลงตะกร้าได้เลย ──
  const [query, setQuery] = useState('');
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return liveMenu
      .filter(m => menuVisibleFor(m, categories, 'staff'))
      .filter(m => String(m.name || '').toLowerCase().includes(q) || String(m.nameEn || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, liveMenu, categories]);

  // ── โต๊ะที่ลูกค้าจ่ายมาเองครบแล้ว = เหลือแค่กดว่าเรียบร้อยเพื่อคืนโต๊ะให้ว่าง ──
  // ต้องไม่มีของค้างในตะกร้าและไม่มีของที่ต้องเก็บเงิน ไม่งั้นของจะหายไปพร้อมการปิดโต๊ะ
  const handleCloseSettled = () => {
    if (!onCloseTable || !tableNumber) return;
    if (!window.confirm(t(
      `ลูกค้าโต๊ะ ${tableNumber} จ่ายเงินมาครบแล้ว — พิมพ์ใบเสร็จแล้วคืนเป็นโต๊ะว่าง?`,
      `Table ${tableNumber} is fully paid. Print the receipt and free the table?`
    ))) return;
    onCloseTable(tableNumber);
  };

  // ── ตะกร้า ──
  const unitPrice = (item) => {
    let p = Number(item.food.price) || 0;
    (item.allPopups || []).forEach(a => { p += Number(a.price) || 0; });
    if (item.promo && item.promo.price) p += Number(item.promo.price) || 0;
    return p;
  };
  const cartTotal = cart.reduce((s, i) => s + unitPrice(i) * (i.quantity || 1), 0);

  // รายการที่ส่งเข้าครัวไปแล้วของโต๊ะนี้ = ตัวบิลจริงที่จะเอาไปชำระเงิน
  const sentItems = useMemo(
    () => tableOrders.filter(o => sameTable(o.TableNumber, tableNumber) && o.Status !== 'paid'),
    [tableOrders, tableNumber]
  );

  // รายการที่ลูกค้าสแกน QR สั่งเองและโอนเงินมาแล้ว — ไม่ต้องเก็บเงินซ้ำ
  // โชว์ให้พนักงานเห็นว่าโต๊ะนี้สั่งอะไรไว้ และเป็นตัวบอกว่าโต๊ะยังไม่ว่าง
  const paidItems = useMemo(
    () => tableOrders.filter(o => sameTable(o.TableNumber, tableNumber) && o.Status === 'paid'),
    [tableOrders, tableNumber]
  );
  const paidTotal = paidItems.reduce(
    (sum, o) => sum + (Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1), 0
  );

  // โต๊ะนี้เหลือแต่ของที่ลูกค้าจ่ายมาเองแล้ว — ไม่มีอะไรต้องส่งครัวหรือเก็บเงินอีก
  const settledOnly = !!tableNumber && paidItems.length > 0
    && sentItems.length === 0 && cart.length === 0 && !!onCloseTable;
  const sentTotal = sentItems.reduce(
    (s, o) => s + (Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1), 0
  );

  const subtotal = sentTotal + cartTotal;

  // ส่วนลดที่พนักงานเลือกไว้ก่อนถึงหน้าชำระเงิน
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [showDiscounts, setShowDiscounts] = useState(false);   // หน้าต่างสมาชิก / คูปองสมาชิก
  // ── ส่วนลดของร้าน (ปุ่ม "ส่วนลด") — ไม่ต้องสแกนสมาชิก ──
  //   ใช้ได้เฉพาะส่วนลดที่ตั้งไว้ในหลังบ้าน > โปรโมชั่น/ส่วนลด (ไม่มีให้พนักงานใส่เอง)
  //   ใช้ได้ทีละอย่าง: เลือกส่วนลดร้าน = เอาคูปองสมาชิกออก (เหมือนเดิม)
  const [showStoreDisc, setShowStoreDisc] = useState(false);
  // ── สมาชิก: คูปองสมาชิกต้องสแกน QR บัตรสมาชิก (หรือ QR คูปอง) ก่อน · จำสมาชิกไว้ส่งต่อให้หน้าชำระเงิน ──
  const [crmOn, setCrmOn] = useState(false);
  useEffect(() => { let alive = true; crmEnabled().then(on => { if (alive) setCrmOn(on); }); return () => { alive = false; }; }, []);
  const [member, setMember] = useState(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  // ── คูปองสมาชิก: ยิง QR คูปองแล้วจองไว้กับบิลนี้ทันที ระบบสมาชิกคิดส่วนลดจากรายการในบิล → พนักงานเห็นยอดลดและยอดสุทธิเลย ──
  // ส่ง couponRef ต่อให้หน้าชำระเงินใช้การจองชุดเดียวกัน (ไม่ต้องยิงซ้ำ)
  const couponRef = useRef(newCouponRef('pos'));
  const [walletMsg, setWalletMsg] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const crmItems = sentItems
    .filter(i => i && i.ItemName && !String(i.ItemName).startsWith('↳'))
    .map(i => ({ name: i.ItemName, price: Number(i.ItemPrice) || 0, qty: Number(i.Quantity) || 1 }));
  // คูปองที่ใช้กับบิล (ได้หลายใบ) รวมเป็นส่วนลดเดียว รูปแบบเดียวกับหน้าชำระเงิน
  const applyCoupons = (list, sum) => {
    if (!list.length) { setSelectedDiscount(prev => (prev && prev.crmCoupons ? null : prev)); return; }
    setSelectedDiscount({
      id: 'crm', name: `คูปอง ${list.map(c => c.title).join(' + ')}`, type: 'baht', value: Number(sum) || 0,
      crmCoupons: list.map(c => ({ id: String(c.id), code: c.code, title: c.title, discount: Number(c.discount) || 0, cancel: c.cancel || null }))
    });
  };
  const loadWallet = async (m) => {
    if (!m) return;
    const res = await crmCall('crmWallet', { memberId: m.id, subtotal: sentTotal, ref: couponRef.current, branchId, items: crmItems });
    if (!res.success) { setWalletMsg(res.error || t('โหลดคูปองไม่สำเร็จ', 'Could not load coupons')); return; }
    setMember(prev => (prev && prev.id === m.id ? { ...prev, points: res.balance } : prev));
    if (Array.isArray(res.applied)) applyCoupons(res.applied, res.appliedTotal);
    if (res.dropped && res.dropped.length) setWalletMsg(t('เอาคูปองออกแล้ว: ', 'Coupon removed: ') + res.dropped.map(d => `${d.title} (${d.reason})`).join(', '));
  };
  const pickCoupon = async (c, m) => {
    setCouponBusy(true); setWalletMsg('');
    const res = await crmCall('crmReserveCoupon', { memberId: m.id, couponId: c.id, scanProof: c.scanProof, ref: couponRef.current, subtotal: sentTotal, branchId, items: crmItems });
    if (!res.success) setWalletMsg(res.error || t('ใช้คูปองไม่สำเร็จ', 'Could not use coupon'));
    await loadWallet(m);
    setCouponBusy(false);
  };
  const removeCoupon = async (c) => {
    setCouponBusy(true); setWalletMsg('');
    await crmCall('crmReleaseCoupon', { couponId: c.id, ref: couponRef.current, branchId });
    await loadWallet(member);
    setCouponBusy(false);
  };
  // เลือกส่วนลดร้านแทน / ไม่ใช้ส่วนลด → ปล่อยคูปองที่จองไว้
  const heldCoupons = useRef([]);
  useEffect(() => {
    const now = selectedDiscount && selectedDiscount.crmCoupons ? selectedDiscount.crmCoupons.map(c => c.id) : [];
    heldCoupons.current.filter(id => !now.includes(id)).forEach(id => crmCall('crmReleaseCoupon', { couponId: id, ref: couponRef.current, branchId }));
    heldCoupons.current = now;
  }, [selectedDiscount, branchId]);
  // เปลี่ยนโต๊ะ = คนละบิล ส่วนลด สมาชิก และคูปองที่จองไว้ของโต๊ะเก่าต้องไม่ติดมา
  useEffect(() => {
    heldCoupons.current.forEach(id => crmCall('crmReleaseCoupon', { couponId: id, ref: couponRef.current, branchId }));
    heldCoupons.current = [];
    couponRef.current = newCouponRef('pos');
    setSelectedDiscount(null); setMember(null); setMemberErr(''); setWalletMsg('');
  }, [tableNumber, branchId]);
  // รายการในบิลเปลี่ยน / เปิดหน้าต่างสมาชิก (เช่น กลับจากหน้าชำระเงิน) → คิดคูปองใหม่ให้ยอดตรงเสมอ
  const memberId = member ? member.id : '';
  const walletArgs = useRef({});
  useEffect(() => { walletArgs.current = { loadWallet, member }; });
  useEffect(() => {
    const a = walletArgs.current;
    if (memberId && a.member && (showDiscounts || heldCoupons.current.length)) a.loadWallet(a.member);
  }, [memberId, sentTotal, showDiscounts]);
  // ── เมนูเฉพาะสมาชิก: ต้องยิงบัตรสมาชิกก่อนถึงคีย์ได้ ──
  const [pendingFood, setPendingFood] = useState(null);
  const isMemberOnly = (food) => !!(food && food.memberOnly === true);
  const memberOnlyNames = useMemo(() => new Set(liveMenu.filter(m => m && m.memberOnly === true).map(m => m.name)), [liveMenu]);
  // โควตาเมนูสมาชิกวันนี้ของสมาชิกที่ยิงบัตร (หลังบ้าน > เมนูสมาชิก) · นับรวมทุกสาขา
  const [sQuota, setSQuota] = useState(null);
  const sMemberId = member ? member.id : '';
  useEffect(() => {
    let alive = true;
    setSQuota(null);
    if (sMemberId) crmCall('staffMemberQuota', { memberId: sMemberId, branchId }).then(res => { if (alive && res && res.success) setSQuota(res); });
    return () => { alive = false; };
  }, [sMemberId, branchId]);
  // สั่งเมนูนี้ได้อีกกี่ชิ้น (หักที่อยู่ในบิลนี้แล้ว ทั้งตะกร้าและที่ส่งครัว) · null = ไม่จำกัด
  const staffLeft = (food) => {
    if (!sQuota || !sQuota.enabled || !food || food.memberOnly !== true) return null;
    const idOf = (name) => { const m = liveMenu.find(x => x.name === name); return m ? String(m.id) : ''; };
    const inBill = (pred) => cart.filter(i => i.food && pred(String(i.food.id), i.food.memberOnly === true)).reduce((a, i) => a + (i.quantity || 1), 0)
      + sentItems.filter(o => memberOnlyNames.has(o.ItemName) && pred(idOf(o.ItemName), true)).reduce((a, o) => a + (Number(o.Quantity) || 1), 0);
    const q = sQuota.menus && sQuota.menus[String(food.id)];
    const lefts = [];
    if (q && q.limit) lefts.push(Math.max(0, q.limit - q.used - inBill((id) => id === String(food.id))));
    if (sQuota.total) lefts.push(Math.max(0, sQuota.total.left - inBill((_, mo) => mo)));
    return lefts.length ? Math.min(...lefts) : null;
  };
  // ปิดหน้าต่างสมาชิกโดยไม่ยิงบัตร → ไม่ค้างเมนูที่รอเพิ่ม
  useEffect(() => { if (!showDiscounts) setPendingFood(null); }, [showDiscounts]);
  const findMember = async (text) => {
    const q = String(text || '').trim();
    if (!q || memberBusy) return;
    if (!isQrCode(q)) { setMemberErr(t('QR นี้ไม่ใช่บัตรสมาชิก/คูปอง', 'Not a member/coupon QR')); return; }
    setMemberBusy(true); setMemberErr('');
    const res = await lookupMember(q, branchId);
    setMemberBusy(false);
    if (!res.success) { setMemberErr(res.error || t('ค้นหาสมาชิกไม่สำเร็จ', 'Member lookup failed')); return; }
    if (member && member.id !== res.member.id) { setMemberErr(t(`QR นี้เป็นของ ${res.member.name} ไม่ใช่สมาชิกที่เลือกไว้ กด "เปลี่ยน" ก่อน`, 'This QR belongs to another member')); return; }
    setMember(prev => (prev && prev.id === res.member.id ? prev : res.member));
    const sc = res.scannedCoupon;
    if (sc && sc.usable) await pickCoupon(sc, res.member);
    else if (sc) setWalletMsg(`${t('คูปอง', 'Coupon')} ${sc.code}: ${sc.reason}`);
    // กดเมนูสมาชิกไว้ก่อนยิงบัตร → เพิ่มให้เลย แล้วปิดหน้าต่าง
    if (pendingFood) { const f = pendingFood; setPendingFood(null); setShowDiscounts(false); onOrderClick(f); }
  };
  const removeMember = () => {
    // เอาสมาชิกออก: เมนูสมาชิกที่ยังไม่ส่งครัวถูกเอาออกจากตะกร้า · ที่ส่งครัวแล้วต้องยิงบัตรสมาชิกใหม่ก่อนชำระเงิน
    const unsent = cart.filter(i => isMemberOnly(i.food));
    const sentNames = sentItems.filter(o => memberOnlyNames.has(o.ItemName)).map(o => o.ItemName);
    if ((unsent.length || sentNames.length) && !window.confirm(t(
      `บิลนี้มีเมนูเฉพาะสมาชิก${unsent.length ? `\n• ยังไม่ส่งครัว ${unsent.length} รายการ จะถูกเอาออกจากตะกร้า` : ''}${sentNames.length ? `\n• ส่งครัวแล้ว: ${[...new Set(sentNames)].join(', ')} — ต้องยิงบัตรสมาชิกก่อนชำระเงิน` : ''}\n\nเอาสมาชิกออกไหม?`,
      'This bill has members-only items. Remove the member anyway?'))) return;
    unsent.forEach(i => onRemoveFromCart(i.cartId));
    setMember(null); setMemberErr(''); setWalletMsg(''); setSelectedDiscount(null);
  };
  // สั่งอาหารได้ต่อเมื่อเปิดกะและเลือกโต๊ะแล้ว — กันคีย์ของลอยแล้วหายตอนเลือกโต๊ะทีหลัง
  const guardedOrderClick = (food) => {
    if (!tableNumber) { alert(t('กรุณาเลือกโต๊ะด้านบนก่อนเริ่มคีย์รายการ', 'Please pick a table first.')); return; }
    // การ์ด/ผลค้นหาปิดปุ่มไว้อยู่แล้ว ตัวนี้กันทางอื่นที่อาจเรียกเข้ามาโดยตรง
    if (isUnpriced(food)) { alert(unpricedNote()); return; }
    // เมนูเฉพาะสมาชิก + ยังไม่ได้ยิงบัตร → เปิดหน้าต่างสแกนสมาชิก ยิงแล้วเพิ่มเมนูนี้ให้เอง
    if (isMemberOnly(food) && !member) {
      setPendingFood(food); setMemberErr(''); setShowDiscounts(true);
      return;
    }
    // ครบโควตาเมนูสมาชิกวันนี้ (รวมที่อยู่ในบิลนี้แล้ว)
    if (isMemberOnly(food) && staffLeft(food) === 0) {
      alert(t(`${member.name} สั่ง "${food.name}" ครบโควตาวันนี้แล้ว (รวมทุกสาขา) · สั่งได้อีกพรุ่งนี้`, `Today's limit for "${food.name}" is reached for this member`));
      return;
    }
    onOrderClick(food);
  };
  // หน้าต่างสมาชิก/ส่วนลดเปิดอยู่ → ยิง QR ด้วยเครื่องยิงได้เลย (แม้หน้าต่างกล้องเปิดอยู่)
  useScannerWedge(showDiscounts, (code) => { setScanOpen(false); findMember(code); });

  // ลำดับการคิดเหมือนหน้าชำระเงินเป๊ะ: ลดจากยอดอาหารก่อน แล้วค่อยบวกเซอร์วิสชาร์จและ VAT
  // ส่วนลดเฉพาะหมวด = ลดเฉพาะยอดของเมนูในหมวดนั้น (utils/discount ใช้ร่วมกับหน้าชำระเงิน)
  const categoriesOf = useMemo(() => menuCategoryLookup(liveMenu), [liveMenu]);
  const discountLines = [
    ...sentItems.map(o => ({ name: o.ItemName, amount: (Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1) })),
    ...cart.map(i => ({ name: i.food && i.food.name, amount: unitPrice(i) * (i.quantity || 1) }))
  ];
  const discountFor = (d) => Math.min(calcDiscount(d, discountLines, categoriesOf), subtotal);
  const discountAmount = discountFor(selectedDiscount);
  const couponActive = !!(selectedDiscount && selectedDiscount.crmCoupons);
  const storeDiscActive = !!(selectedDiscount && !selectedDiscount.crmCoupons);
  const afterDiscount = subtotal - discountAmount;

  const scRate  = settings?.serviceCharge?.enabled ? (settings.serviceCharge.rate || 0) : 0;
  const vatRate = settings?.vat?.enabled ? (settings.vat.rate || 0) : 0;
  const serviceCharge = Math.round(afterDiscount * scRate) / 100;
  const vat = Math.round((afterDiscount + serviceCharge) * vatRate) / 100;
  const grandTotal = afterDiscount + serviceCharge + vat;

  // ใบแจ้งยอดให้ลูกค้าตรวจก่อนจ่าย — พิมพ์เฉพาะของที่เข้าบิลแล้ว
  const handlePrintPreBill = () => {
    if (sentItems.length === 0) {
      alert(t('ยังไม่มีรายการในบิล', 'Nothing on the bill yet.'));
      return;
    }
    const summary = [{ label: 'ยอดอาหาร', value: `B ${subtotal.toLocaleString()}` }];
    if (discountAmount > 0) summary.push({ label: `ส่วนลด ${selectedDiscount?.name || ''}`.trim(), value: `-B ${discountAmount.toLocaleString()}` });
    if (serviceCharge > 0) summary.push({ label: `Service ${settings.serviceCharge.rate}%`, value: `B ${serviceCharge.toLocaleString()}` });
    if (vat > 0) summary.push({ label: `VAT ${settings.vat.rate}%`, value: `B ${vat.toLocaleString()}` });

    const guests = (() => { try { return localStorage.getItem('customer_count_' + tableNumber) || ''; } catch { return ''; } })();
    onPrintPreBill({
      orderNumber: `โต๊ะ ${tableNumber}`,
      customerDetails: { name: `โต๊ะ ${tableNumber}${guests ? ` (${guests} ท่าน)` : ''}` },
      items: sentItems.map(o => {
        const qty = Number(o.Quantity) || 1;
        return {
          isFlattened: true,
          name: qty > 1 ? `${o.ItemName} (x${qty})` : o.ItemName,
          // ราคาของบรรทัด → Print Server พิมพ์ชิดขวาเหมือนใบเสร็จ ลูกค้าตรวจได้ทีละรายการ
          amount: (Number(o.ItemPrice) || 0) * qty,
          subItems: o.Options ? String(o.Options).split(', ').filter(Boolean) : []
        };
      }),
      summary,
      total: grandTotal.toLocaleString(),
      totalAmount: grandTotal   // ยอดตัวเลขสำหรับ QR สแกนจ่ายท้ายบิล
    });
  };

  // ชำระเงินได้เฉพาะของที่ส่งครัวแล้ว — ของในตะกร้าที่ยังไม่ส่งจะไม่อยู่ในบิล
  // ถ้าปล่อยให้กดชำระทั้งที่ยังมีของค้างในตะกร้า ของนั้นจะหายไปพร้อมการปิดโต๊ะ
  const handleCheckoutClick = () => {
    if (cart.length > 0) {
      alert(t(
        `ยังมีรายการในตะกร้าอีก ${cart.length} รายการที่ยังไม่ได้ส่งครัว\nกรุณากด "ส่งรายการอาหาร" ก่อน แล้วจึงชำระเงิน`,
        `${cart.length} item(s) are still unsent. Please send the order before taking payment.`
      ));
      return;
    }
    if (sentItems.length === 0) {
      alert(t('โต๊ะนี้ยังไม่มีรายการอาหารที่ต้องชำระ', 'This table has nothing to pay for yet.'));
      return;
    }
    onCheckout(sentItems, sentTotal, selectedDiscount, member ? { member, couponRef: couponRef.current } : null);
  };

  // สรุปยอดหลังหักส่วนลด (ใช้ทั้งหน้าต่างสมาชิกและหน้าต่างส่วนลด)
  const summaryBox = (
              <div style={{ border: '1px solid #e4e4e4', borderRadius: '12px', padding: '0.6rem 0.75rem', marginBottom: '0.75rem', background: '#f8f8f8', fontSize: '0.86rem', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('ยอดอาหาร', 'Subtotal')}</span><b>฿{subtotal.toLocaleString()}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: discountAmount > 0 ? '#15803d' : '#7a7a7a' }}>
                  <span>{t('ส่วนลด', 'Discount')}{selectedDiscount ? ` · ${selectedDiscount.name}` : ` (${t('ยังไม่ได้ใช้', 'none')})`}</span><b>-฿{discountAmount.toLocaleString()}</b>
                </div>
                {serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service {settings.serviceCharge.rate}%</span><b>฿{serviceCharge.toLocaleString()}</b></div>}
                {vat > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>VAT {settings.vat.rate}%</span><b>฿{vat.toLocaleString()}</b></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e4e4e4', marginTop: '4px', paddingTop: '4px', fontSize: '1rem' }}>
                  <b>{t('สุทธิ', 'Net')}</b><b style={{ color: '#c8102e' }}>฿{grandTotal.toLocaleString()}</b>
                </div>
              </div>
  );

  const optionText = (item) => {
    const parts = [];
    const grouped = [];
    (item.allPopups || []).forEach(p => {
      const label = lang === 'th' ? p.name : (p.nameEn || p.name);
      const found = grouped.find(g => g.label === label);
      if (found) found.count += 1; else grouped.push({ label, count: 1 });
    });
    grouped.forEach(g => parts.push(g.count > 1 ? `${g.label} ×${g.count}` : g.label));
    // รายการที่แยกออกมาจากป๊อปอัพของอีกจาน — บอกว่าพ่วงมากับจานไหน
    if (item.fromPopupOf) parts.push(t(`พ่วงกับ ${item.fromPopupOf}`, `with ${item.fromPopupOf}`));
    if (item.dining && item.dining.name) parts.push(item.dining.name);
    if (item.customerName) parts.push(`${t('ลูกค้า', 'Customer')}: ${item.customerName}`);
    return parts.join(' · ');
  };

  // ── เมนู "เพิ่มเติม" บนแถบบน ──
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  // หมวดที่ตั้งเป็น "เฉพาะลูกค้า" ไม่แสดงในหน้าขายของพนักงาน
  const visibleCats = categories.filter(c => categoryVisibleFor(c, 'staff') && liveMenu.some(i => itemInCategory(i, c.slug)));
  const gridItems = liveMenu.filter(i => itemInCategory(i, activeCategory));

  return (
    <div className="pos2">
      {/* ── แถบบนสุด ── */}
      <header className="pos2-top">
        <div className="pos2-brand">
          <span className="pos2-shop">{t('เสน่ห์', 'SA-NAE')}</span>
          {tableNumber && <span className="pos2-table-badge">{t('โต๊ะ', 'Table')} {tableNumber}</span>}
        </div>

        <div className="pos2-top-right">
          {/* หน้ารายละเอียดบิล เหลือไว้สำหรับงานที่ทำในแผงขวาไม่ได้ — ย้ายโต๊ะ / รวมโต๊ะ / แยกบิล */}
          <button className="pos2-btn" onClick={onOpenBill} disabled={!tableNumber}>
            <Receipt size={15} /> {t('ย้าย/รวมโต๊ะ', 'Move/Merge')}
          </button>
          {(isAdmin || isCashier) && (
            <button className="pos2-btn" onClick={onOpenAdmin}>
              <Settings size={15} /> {t('หลังบ้าน', 'Admin')}
            </button>
          )}

          <div className="pos2-more" ref={moreRef}>
            <button className="pos2-btn" onClick={() => setMoreOpen(o => !o)}>
              <MoreHorizontal size={15} /> {t('เพิ่มเติม', 'More')}
            </button>
            {moreOpen && (
              <div className="pos2-more-menu">
                <button onClick={() => { setMoreOpen(false); onRefresh(); }}>
                  <RefreshCw size={15} /> {isRefreshing ? t('กำลังโหลด...', 'Loading...') : t('รีเฟรชข้อมูล', 'Refresh')}
                </button>
                <button onClick={() => { setMoreOpen(false); onOpenSummary('daily'); }}>📊 {t('สรุปยอดขายวันนี้', 'Today sales')}</button>
                <button onClick={() => { setMoreOpen(false); onOpenSummary('range'); }}>📅 {t('สรุปยอดขายระหว่างวัน', 'Sales by range')}</button>
                {(isAdmin || isCashier) && onOpenTaxInvoice && (
                  <button onClick={() => { setMoreOpen(false); onOpenTaxInvoice(); }}>🧾 {t('ใบกำกับภาษี', 'Tax invoice')}</button>
                )}
                <button onClick={() => { setMoreOpen(false); onOpenWaste(); }}>🗑️ {t('บันทึกการทิ้ง', 'Waste')}</button>
                {onOpenPrep && <button onClick={() => { setMoreOpen(false); onOpenPrep(); }}>🧑‍🍳 {t('บันทึกการเตรียม', 'Prep')}</button>}
                {onOpenStockCount && <button onClick={() => { setMoreOpen(false); onOpenStockCount(); }}>📋 {t('บันทึกการนับสต็อก', 'Stock count')}</button>}
                <button onClick={() => { setMoreOpen(false); onOpenKiosk(); }}>📱 {t('หน้าลูกค้าสั่งเอง', 'Customer kiosk')}</button>
                <button onClick={() => { setMoreOpen(false); setLang(lang === 'th' ? 'en' : 'th'); }}>
                  <Globe size={15} /> {lang === 'th' ? 'English' : 'ภาษาไทย'}
                </button>
              </div>
            )}
          </div>

          <div className="pos2-user">
            <b>{currentUser?.username || branch || '-'}</b>
            <span>{branch}</span>
          </div>
          <button
            className="pos2-btn danger"
            onClick={() => { if (window.confirm(t(`ออกจากระบบสาขา "${branch}"?`, 'Log out?'))) onLogout(); }}
          >
            <LogOut size={15} /> {t('ออกจากระบบ', 'Log out')}
          </button>
        </div>
      </header>

      <div className="pos2-body">
        <div className="pos2-main">
          {/* ── แถบเตือนสถานะ ── */}
          {!tableNumber && (
            <div className="pos2-notice">
              {t('เลือกโต๊ะจากแถบด้านล่างก่อน แล้วจึงกดเมนูเพื่อคีย์รายการ',
                    'Pick a table below, then tap menu items to add them.')}
            </div>
          )}

          {/* ── แถบโต๊ะ ── */}
          <div className="pos2-card pos2-tables">
            <div className="pos2-tables-head">
              <div className="pos2-legend">
                <strong style={{ color: '#141414' }}>🪑 {t('โต๊ะ', 'Tables')}</strong>
                <span><i className="pos2-dot-free" />{t('ว่าง', 'Free')}</span>
                <span><i className="pos2-dot-busy" />{t('มีลูกค้า', 'Occupied')}</span>
                <span><i className="pos2-dot-late" />{t(`เกิน ${LATE_MINUTES} นาที`, `Over ${LATE_MINUTES} min`)}</span>
                <span><i className="pos2-dot-prepaid" />{t('ลูกค้าจ่ายเองแล้ว', 'Paid via kiosk')}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {[
                  { key: 'DineIn',   label: t('ทานที่ร้าน', 'Dine-in') },
                  { key: 'Takehome', label: t('ห่อกลับบ้าน', 'Takeaway') },
                  { key: 'Delivery', label: t('Delivery', 'Delivery') },
                  { key: 'VIP',      label: 'VIP' }
                ].filter(z => (zones[z.key] || []).length > 0).map(z => (
                  <button
                    key={z.key}
                    className={`pos2-btn ${zone === z.key ? 'primary' : ''}`}
                    onClick={() => setZone(z.key)}
                  >
                    {z.label}
                  </button>
                ))}
                <button className="pos2-btn" onClick={onRefresh} disabled={isRefreshing} title={t('รีเฟรช', 'Refresh')}>
                  <RefreshCw size={15} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                </button>
                <form
                  className="pos2-custom-table"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const val = e.target.elements.customTable.value.trim();
                    if (val) { handleTableClick(val); e.target.reset(); }
                  }}
                >
                  <input name="customTable" placeholder={t('เบอร์โต๊ะอื่น', 'Other table')} />
                  <button type="submit" className="pos2-btn">{t('เปิด', 'Open')}</button>
                </form>
              </div>
            </div>

            <div className="pos2-table-list">
              {tablesInZone.map(name => {
                const st = tableState(name);
                const current = sameTable(name, tableNumber);
                return (
                  <button
                    key={name}
                    className={`pos2-table ${st.status} ${current ? 'current' : ''}`}
                    onClick={() => handleTableClick(name)}
                  >
                    <b>
                      <span className="pos2-table-no">{name}</span>
                      {st.count > 0 && (
                        <span className="pos2-table-count" title={t('จำนวนออเดอร์', 'Orders')}>
                          {st.count}
                        </span>
                      )}
                    </b>
                    <small>
                      {st.status === 'free'
                        ? t('ว่าง', 'Free')
                        : st.status === 'prepaid'
                          ? `💳 ${t('จ่ายแล้ว', 'Paid')}`
                          : `${st.mins} ${t('นาที', 'min')}`}
                    </small>
                  </button>
                );
              })}
              {tablesInZone.length === 0 && (
                <span style={{ color: '#7a7a7a', fontSize: '0.8rem', fontWeight: 700, padding: '0.4rem' }}>
                  {t('ยังไม่ได้ตั้งค่าโต๊ะในโซนนี้', 'No tables configured in this zone')}
                </span>
              )}
            </div>
          </div>

          {/* ── หมวดหมู่ ── */}
          <div className="pos2-cats">
            {visibleCats.map(cat => (
              <button
                key={cat.slug}
                className={`pos2-chip ${activeCategory === cat.slug ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.slug)}
              >
                {cat.icon} {lang === 'th' ? cat.name : (cat.nameEn || cat.name)}
              </button>
            ))}
          </div>

          {/* ── ตารางเมนู ── */}
          <div className="pos2-grid-wrap">
            <div className="pos-food-grid">
              {gridItems.map(item => (
                <FoodCard
                  key={item.id}
                  food={item}
                  lang={lang}
                  displayPrice={Number(resolvePrice(item)?.price) || 0}
                  disabled={isUnpriced(item)}
                  disabledReason={unpricedNote()}
                  onOrderClick={guardedOrderClick}
                  memberLocked={item.memberOnly === true && (!member || staffLeft(item) === 0)}
                  onDecreaseClick={onDecreaseQuantity}
                  cartQuantity={cart.filter(c => c.food.id === item.id).reduce((s, c) => s + (c.quantity || 1), 0)}
                />
              ))}
            </div>
            {gridItems.length === 0 && (
              <div className="pos2-empty">{t('ไม่มีรายการในหมวดหมู่นี้', 'No items in this category')}</div>
            )}
          </div>
        </div>

        {/* ── ตะกร้าด้านขวา ── */}
        <aside className="pos2-cart">
          {/* เลขโต๊ะของบิลที่กำลังคีย์อยู่ — กันคีย์ผิดโต๊ะเวลาสายตาอยู่ที่แผงขวา */}
          <div className={`pos2-cart-table ${tableNumber ? '' : 'empty'}`}>
            <span className="pos2-cart-table-label">🪑 {t('โต๊ะ', 'Table')}</span>
            <span className="pos2-cart-table-no">
              {tableNumber || t('ยังไม่ได้เลือก', 'not selected')}
            </span>
          </div>
          <div className="pos2-cart-head">
            <select
              className="pos2-type-select"
              value={customerType}
              disabled={saleTypeLocked}
              onChange={(e) => setCustomerType(e.target.value)}
              title={saleTypeLocked
                ? t('ประเภทการขายถูกกำหนดจากโต๊ะที่เลือก แก้ได้ที่หลังบ้าน > จัดการโต๊ะ',
                    'Sale type comes from the selected table — change it in Admin > Tables')
                : t('ประเภทการขาย — กำหนดชุดราคาของทุกเมนู', 'Sale type — sets the price tier')}
            >
              {saleTypeOptions.map(o => (
                <option key={o.value} value={o.value}>{lang === 'th' ? o.th : o.en}</option>
              ))}
            </select>
            <button
              className="pos2-clear"
              onClick={() => {
                if (cart.length === 0) return;
                if (window.confirm(t('ล้างรายการในตะกร้าทั้งหมด?', 'Clear the whole cart?'))) onClearCart();
              }}
            >
              {t('ล้าง', 'Clear')}
            </button>
          </div>

          <div className="pos2-cart-tools">
            <div className="pos2-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('🔍 พิมพ์ค้นหาเมนู แล้วกดเพื่อเพิ่ม', '🔍 Search a menu item to add')}
              />
              {searchResults.length > 0 && (
                <div className="pos2-results">
                  {searchResults.map(m => (
                    <button
                      key={m.id}
                      className={isUnpriced(m) ? 'unavailable' : ''}
                      disabled={isUnpriced(m)}
                      title={isUnpriced(m) ? unpricedNote() : undefined}
                      onClick={() => { guardedOrderClick(m); setQuery(''); }}
                    >
                      <span>{lang === 'th' ? m.name : (m.nameEn || m.name)}</span>
                      {isUnpriced(m)
                        ? <b className="unavailable">{t('ยังไม่ตั้งราคา', 'No price')}</b>
                        : <b>฿{Number(resolvePrice(m)?.price || 0).toLocaleString()}</b>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="pos2-custname"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t('ชื่อลูกค้า (ถ้ามี)', 'Customer name (optional)')}
            />
          </div>

          <div className="pos2-cart-items">
            {/* ── ของที่ลูกค้าสแกน QR สั่งเองและโอนมาแล้ว — ดูอย่างเดียว ไม่ต้องเก็บเงินซ้ำ ── */}
            {paidItems.length > 0 && (
              <>
                <div className="pos2-sec-head paid">
                  <span>💳 {t('ลูกค้าจ่ายเองแล้ว', 'Paid via kiosk')} ({paidItems.length})</span>
                  <b>฿{paidTotal.toLocaleString()}</b>
                </div>
                {paidItems.map((o, idx) => (
                  <div key={`paid-${o.SessionId}-${o.ItemName}-${idx}`} className="pos2-line-item paid">
                    <div className="pos2-line-top">
                      <div className="pos2-line-name">
                        <span className="pos2-qty-badge">{Number(o.Quantity) || 1}×</span> {o.ItemName}
                      </div>
                    </div>
                    {o.Options && <div className="pos2-line-opt">{o.Options}</div>}
                    <div className="pos2-line-bottom">
                      <span style={{ fontSize: '0.72rem', color: '#7a7a7a', fontWeight: 700 }}>
                        {t('ลูกค้าจ่ายมาแล้ว', 'already paid')}
                      </span>
                      <div className="pos2-line-price">
                        ฿{((Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1)).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ── ของที่ส่งครัวไปแล้ว = บิลของโต๊ะนี้ ── */}
            {sentItems.length > 0 && (
              <>
                <div className="pos2-sec-head">
                  <span>🍽️ {t('ส่งครัวแล้ว', 'Sent to kitchen')} ({sentItems.length})</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <b>฿{sentTotal.toLocaleString()}</b>
                    <button
                      className="pos2-reprint"
                      title={t('พิมพ์ใบครัวซ้ำ (กระดาษติด/ใบหาย)', 'Reprint kitchen ticket')}
                      onClick={() => onPrintKitchen(sentItems)}
                    >
                      <Printer size={13} />
                    </button>
                  </span>
                </div>
                {sentItems.map((o, idx) => (
                  <div
                    key={`${o.SessionId}-${o.ItemName}-${idx}`}
                    className="pos2-line-item sent tappable"
                    onClick={() => setActionItem(o)}
                    title={t('แตะเพื่อพิมพ์ซ้ำหรือยกเลิกรายการ', 'Tap to reprint or cancel')}
                  >
                    <div className="pos2-line-top">
                      <div className="pos2-line-name">
                        <span className="pos2-qty-badge">{Number(o.Quantity) || 1}×</span> {o.ItemName}
                      </div>
                      <span className="pos2-more-dots"><MoreHorizontal size={16} /></span>
                    </div>
                    {o.Options && <div className="pos2-line-opt">{o.Options}</div>}
                    <div className="pos2-line-bottom">
                      <span style={{ fontSize: '0.72rem', color: '#7a7a7a', fontWeight: 700 }}>
                        {t('ส่งครัวแล้ว · แตะเพื่อจัดการ', 'sent · tap to manage')}
                      </span>
                      <div className="pos2-line-price">
                        ฿{((Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1)).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
                {cart.length > 0 && (
                  <div className="pos2-sec-head new">
                    <span>🆕 {t('รายการใหม่ (ยังไม่ส่ง)', 'New (not sent)')} ({cart.length})</span>
                    <b>฿{cartTotal.toLocaleString()}</b>
                  </div>
                )}
              </>
            )}

            {cart.length === 0 && sentItems.length === 0 && paidItems.length === 0 ? (
              <div className="pos2-cart-empty">{t('ยังไม่มีรายการ — แตะเมนูเพื่อเพิ่ม', 'No items yet — tap a menu item')}</div>
            ) : cart.map(item => (
              <div key={item.cartId} className="pos2-line-item">
                <div className="pos2-line-top">
                  <div className="pos2-line-name">
                    {lang === 'th' ? item.food.name : (item.food.nameEn || item.food.name)}
                    {item.food.priceName && <span className="pos2-tag">{item.food.priceName}</span>}
                  </div>
                  <button className="pos2-icon-btn" onClick={() => onRemoveFromCart(item.cartId)} title={t('ลบ', 'Remove')}>
                    <Trash2 size={15} />
                  </button>
                </div>
                {optionText(item) && <div className="pos2-line-opt">{optionText(item)}</div>}
                <div className="pos2-line-bottom">
                  <div className="pos2-qty">
                    <button onClick={() => onUpdateQuantity(item.cartId, -1)} disabled={(item.quantity || 1) <= 1}><Minus size={14} /></button>
                    <span>{item.quantity || 1}</span>
                    <button onClick={() => onUpdateQuantity(item.cartId, 1)}><Plus size={14} /></button>
                  </div>
                  <div className="pos2-line-price">฿{(unitPrice(item) * (item.quantity || 1)).toLocaleString()}</div>
                </div>
                <input
                  className="pos2-note"
                  value={item.note || ''}
                  onChange={(e) => onUpdateNote(item.cartId, e.target.value)}
                  placeholder={t('📝 หมายเหตุ เช่น ไม่ใส่ผัก', '📝 Note e.g. no veggies')}
                />
              </div>
            ))}
          </div>

          <div className="pos2-cart-foot">
            <div className="pos2-tool-row">
              {crmOn && (
                <button
                  className="pos2-tool"
                  onClick={() => { setMemberErr(''); setShowDiscounts(true); }}
                  title={t('สแกน QR บัตรสมาชิก — สะสมแต้ม / คูปอง / เมนูสมาชิก', 'Scan member card — points / coupons / member menu')}
                  style={{ minWidth: 0, ...(member ? { borderColor: '#16a34a', color: '#166534', background: '#f0fdf4' } : {}) }}
                >
                  <UserRound size={14} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{member
                    ? `${member.name}${couponActive ? ` · ${t('คูปอง', 'coupon')} -฿${discountAmount.toLocaleString()}` : ''}`
                    : t('สมาชิก', 'Member')}</span>
                </button>
              )}
              <button
                className="pos2-tool"
                onClick={() => setShowStoreDisc(true)}
                title={t('ส่วนลดของร้าน — ไม่ต้องสแกนสมาชิก', 'Store discount — no member needed')}
                style={{ minWidth: 0, ...(storeDiscActive ? { borderColor: '#16a34a', color: '#166534', background: '#f0fdf4' } : {}) }}
              >
                <Tag size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{storeDiscActive
                  ? `${selectedDiscount.name} -฿${discountAmount.toLocaleString()}`
                  : t('ส่วนลด', 'Discount')}</span>
              </button>
              <button
                className="pos2-tool"
                onClick={handlePrintPreBill}
                disabled={sentItems.length === 0}
                title={t('พิมพ์ใบแจ้งยอดให้ลูกค้าตรวจก่อนชำระเงิน', 'Print a check bill for the customer')}
              >
                <Printer size={14} /> {t('ใบแจ้งยอด', 'Check bill')}
              </button>
            </div>

            <div className="pos2-sum">
              <span>{t('ส่งครัวแล้ว', 'Sent')}</span><b>฿{sentTotal.toLocaleString()}</b>
            </div>
            {/* ยอดที่ลูกค้าโอนมาเองแล้ว แยกไว้ต่างหาก ห้ามเอาไปรวมยอดที่ต้องเก็บ */}
            {paidItems.length > 0 && (
              <div className="pos2-sum" style={{ color: '#141414' }}>
                <span>{t('ลูกค้าจ่ายเองแล้ว', 'Paid via kiosk')}</span>
                <b style={{ color: '#141414' }}>฿{paidTotal.toLocaleString()}</b>
              </div>
            )}
            {cart.length > 0 && (
              <div className="pos2-sum" style={{ color: '#8e0b20' }}>
                <span>{t('ยังไม่ส่ง', 'Not sent')}</span><b style={{ color: '#8e0b20' }}>฿{cartTotal.toLocaleString()}</b>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="pos2-sum" style={{ color: '#15803d' }}>
                <span>{t('ส่วนลด', 'Discount')} {selectedDiscount?.name || ''}</span>
                <b style={{ color: '#15803d' }}>-฿{discountAmount.toLocaleString()}</b>
              </div>
            )}
            {serviceCharge > 0 && (
              <div className="pos2-sum">
                <span>{t(`เซอร์วิสชาร์จ ${settings.serviceCharge.rate}%`, `Service ${settings.serviceCharge.rate}%`)}</span>
                <b>+฿{serviceCharge.toLocaleString()}</b>
              </div>
            )}
            {vat > 0 && (
              <div className="pos2-sum">
                <span>{t(`VAT ${settings.vat.rate}%`, `VAT ${settings.vat.rate}%`)}</span>
                <b>+฿{vat.toLocaleString()}</b>
              </div>
            )}
            <div className="pos2-grand">
              <span>{t('สุทธิ', 'Total')}</span>
              <b>฿{grandTotal.toLocaleString()}</b>
            </div>
            <div className="pos2-actions">
              {settledOnly ? (
                <button className="pos2-close-table" onClick={handleCloseSettled}>
                  ✅ {t('เรียบร้อย — พิมพ์ใบเสร็จ แล้วคืนโต๊ะ', 'Done — print receipt & free table')}
                </button>
              ) : (
                <>
                  <button className="pos2-send" onClick={onSendOrder} disabled={cart.length === 0 || !tableNumber}>
                    ✅ {t('ส่งรายการอาหาร', 'Send order')}
                  </button>
                  <button className="pos2-bill" onClick={handleCheckoutClick} disabled={!tableNumber}>
                    💳 {t('ชำระเงิน', 'Payment')}
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── เลือกส่วนลดของบิลนี้ ── */}
      {showDiscounts && (
        <div className="pos2-modal-overlay" onClick={() => setShowDiscounts(false)}>
          <div className="pos2-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('สมาชิก / คูปองสมาชิก', 'Member / coupons')}</h3>
            {crmOn && <QrScanner open={scanOpen} onResult={(code) => { setScanOpen(false); findMember(code); }} onClose={() => setScanOpen(false)} title={t('สแกน QR บัตรสมาชิก / คูปอง', 'Scan member / coupon QR')} />}
            {pendingFood && !member && (
              <div role="alert" style={{ border: '2px solid #c8102e', background: '#fdf2f4', color: '#7a0a1c', borderRadius: '12px', padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontWeight: 700, fontSize: '0.88rem', textAlign: 'left' }}>
                👑 {t(`"${pendingFood.name}" เป็นเมนูเฉพาะสมาชิก · ยิงบัตรสมาชิกก่อน แล้วระบบจะเพิ่มเมนูนี้ให้`, `"${pendingFood.name}" is members-only · scan the member card first`)}
                {!crmOn && <div style={{ color: '#b91c1c', marginTop: 4 }}>{t('สาขานี้ยังไม่ได้เชื่อมระบบสมาชิก จึงขายเมนูนี้ไม่ได้', 'This branch is not connected to the member system')}</div>}
              </div>
            )}
            {crmOn && (
              <div style={{ border: '1px solid #e4e4e4', borderRadius: '12px', padding: '0.75rem', marginBottom: '0.75rem', background: member ? '#f0fdf4' : '#fff', textAlign: 'left' }}>
                {member ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserRound size={20} color="#16a34a" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>{member.name} <span style={{ color: '#5a5a5a', fontWeight: 600 }}>· {member.id}</span></div>
                      <div style={{ fontSize: '0.8rem', color: '#454545' }}>
                        {t('แต้มคงเหลือ', 'Points')} {Number(member.points || 0).toLocaleString()}{member.tier ? ` · ${member.tier}` : ''}
                      </div>
                    </div>
                    <button className="pos2-btn" onClick={removeMember}>{t('เปลี่ยน', 'Change')}</button>
                  </div>
                ) : (
                  <>
                    <button className="pos2-btn primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => setScanOpen(true)} disabled={memberBusy}>
                      <QrCode size={16} /> {memberBusy ? '…' : t('สแกน QR บัตรสมาชิก / คูปอง', 'Scan member / coupon QR')}
                    </button>
                    <div style={{ fontSize: '0.78rem', color: '#5a5a5a', marginTop: '6px' }}>
                      {t('มีเครื่องยิง QR: ยิงได้เลยไม่ต้องกดปุ่ม · ยิง QR คูปองก็ได้ทั้งสมาชิกและคูปอง', 'With a QR scanner just scan · a coupon QR gives both member and coupon')}
                    </div>
                  </>
                )}
                {memberErr && <div role="alert" style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 700, marginTop: '6px' }}>{memberErr}</div>}
                {member && (
                  <>
                    {(selectedDiscount && selectedDiscount.crmCoupons ? selectedDiscount.crmCoupons : []).map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', padding: '6px 8px', border: '2px solid #16a34a', borderRadius: '10px', background: '#fff' }}>
                        <Tag size={15} color="#16a34a" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{c.title}</div>
                          <div style={{ fontSize: '0.75rem', color: '#15803d' }}>✓ {c.discount > 0 ? `${t('ลด', 'Off')} ฿${c.discount.toLocaleString()}` : t('ใบรับของ (ไม่ลดเงิน)', 'Voucher item (no discount)')} · {c.code}</div>
                        </div>
                        <button className="pos2-btn" disabled={couponBusy} onClick={() => removeCoupon(c)}>{t('เอาออก', 'Remove')}</button>
                      </div>
                    ))}
                    <div style={{ fontSize: '0.76rem', color: '#5a5a5a', marginTop: '6px' }}>
                      {couponBusy ? t('กำลังคิดคูปอง…', 'Checking coupon…') : t('ยิง QR คูปองเพิ่มได้ (กด "ใช้คูปอง" ในบัตร LINE) · ใช้ส่วนลดร้าน (ปุ่ม "ส่วนลด") = เอาคูปองออก', 'Scan more coupon QRs · a store discount (Discount button) removes coupons')}
                    </div>
                    {walletMsg && <div role="alert" style={{ color: '#8e0b20', fontSize: '0.8rem', fontWeight: 700, marginTop: '4px' }}>{walletMsg}</div>}
                    {sQuota && sQuota.enabled && (
                      <div style={{ fontSize: '0.78rem', color: '#7a0a1c', fontWeight: 700, marginTop: '6px' }}>
                        👑 {t('เมนูสมาชิกวันนี้ (รวมทุกสาขา):', 'Member menu today (all branches):')}{' '}
                        {sQuota.total ? t(`สั่งไปแล้ว ${sQuota.total.used} · เหลือ ${sQuota.total.left} ชิ้น`, `${sQuota.total.used} used · ${sQuota.total.left} left`) : ''}
                        {Object.values(sQuota.menus || {}).filter(m => m.limit).map(m => ` · ${m.name} ${t('เหลือ', 'left')} ${Math.max(0, m.limit - m.used)}`).join('')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {/* คิดยอดให้พนักงานเห็นทันทีหลังใช้คูปอง (ลำดับเดียวกับหน้าชำระเงิน) */}
            {member && summaryBox}

            <div className="pos2-modal-actions">
              <button className="pos2-btn" onClick={() => setShowDiscounts(false)}>{t('ปิด', 'Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ส่วนลดของร้าน: ไม่ต้องสแกนสมาชิก ── */}
      {showStoreDisc && (
        <div className="pos2-modal-overlay" onClick={() => setShowStoreDisc(false)}>
          <div className="pos2-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('ส่วนลดของร้าน', 'Store discount')}</h3>
            <p style={{ marginTop: 0 }}>{t(`ไม่ต้องสแกนสมาชิก · ยอดอาหารบิลนี้ ฿${subtotal.toLocaleString()}`, `No member needed · subtotal ฿${subtotal.toLocaleString()}`)}</p>
            {couponActive && (
              <div style={{ fontSize: '0.82rem', color: '#7a0a1c', fontWeight: 700, padding: '0.55rem 0.75rem', border: '1px dashed #c8102e', borderRadius: '10px', background: '#fdf2f4', marginBottom: '0.6rem', textAlign: 'left' }}>
                {t('บิลนี้ใช้คูปองสมาชิกอยู่ · เลือกส่วนลดร้าน = เอาคูปองออก (ใช้ได้ทีละอย่าง)', 'A member coupon is applied · picking a store discount removes it')}
              </div>
            )}
            {summaryBox}
            <div className="pos2-action-list">
              {discounts.length === 0 && (
                <div style={{ fontSize: '0.82rem', color: '#5a5a5a', fontWeight: 700, padding: '0.5rem 0' }}>
                  {t('ยังไม่ได้ตั้งส่วนลดไว้ — ตั้งได้ที่ จัดการหลังบ้าน > โปรโมชั่น/ส่วนลด', 'No discounts configured yet.')}
                </div>
              )}
              {discounts.map((d, i) => {
                const amount = discountFor(d);
                const active = storeDiscActive && selectedDiscount.name === d.name && selectedDiscount.value === d.value;
                const catName = (slug) => { const c = categories.find(x => x && String(x.slug) === String(slug)); return c ? (lang === 'th' ? c.name : (c.nameEn || c.name)) : slug; };
                const cats = Array.isArray(d.categories) ? d.categories.filter(Boolean).map(catName) : [];
                const pct = d.type === 'percent' && !String(d.name || '').includes('%') ? ` (${d.value}%)` : '';
                return (
                  <button key={`${d.name}-${i}`} className={`pos2-action ${active ? 'active' : ''}`}
                    onClick={() => { setSelectedDiscount(d); setShowStoreDisc(false); }}>
                    <Tag size={16} />
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      {d.name}{pct}
                      <span style={{ display: 'block', fontSize: '0.74rem', color: '#5a5a5a', fontWeight: 400 }}>
                        {cats.length ? t(`เฉพาะหมวด ${cats.join(', ')}`, `Only ${cats.join(', ')}`) : t('ทั้งบิล', 'Whole bill')}
                      </span>
                    </span>
                    <b style={{ color: '#15803d' }}>-฿{amount.toLocaleString()}</b>
                  </button>
                );
              })}
            </div>
            {storeDiscActive && (
              <div className="pos2-action-list" style={{ marginTop: '0.6rem' }}>
                <button className="pos2-action danger" onClick={() => { setSelectedDiscount(null); setShowStoreDisc(false); }}>
                  <X size={16} /> {t('ไม่ใช้ส่วนลด', 'Remove discount')}
                </button>
              </div>
            )}
            <div className="pos2-modal-actions">
              <button className="pos2-btn" onClick={() => setShowStoreDisc(false)}>{t('ปิด', 'Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── เมนูจัดการรายการในบิล: พิมพ์ซ้ำ / ยกเลิก ── */}
      {actionItem && (
        <div className="pos2-modal-overlay" onClick={() => setActionItem(null)}>
          <div className="pos2-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{actionItem.ItemName}</h3>
            <p>
              {Number(actionItem.Quantity) || 1} {t('รายการ', 'pcs')} · ฿
              {((Number(actionItem.ItemPrice) || 0) * (Number(actionItem.Quantity) || 1)).toLocaleString()}
              {actionItem.Options ? ` · ${actionItem.Options}` : ''}
            </p>

            <div className="pos2-action-list">
              <button
                className="pos2-action"
                onClick={() => { onPrintKitchen([actionItem]); setActionItem(null); }}
              >
                <Printer size={17} /> {t('พิมพ์ใบครัวซ้ำ (เฉพาะรายการนี้)', 'Reprint this item')}
              </button>
              <button
                className="pos2-action danger"
                onClick={() => {
                  if (window.confirm(t(
                    `ยกเลิก "${actionItem.ItemName}" ออกจากบิลโต๊ะ ${tableNumber}?\n(ครัวอาจทำไปแล้ว — ควรแจ้งครัวด้วย)`,
                    `Cancel "${actionItem.ItemName}" from this bill?`
                  ))) {
                    onDeleteTableItem(actionItem);
                    setActionItem(null);
                  }
                }}
              >
                <Trash2 size={17} /> {t('ยกเลิกรายการนี้', 'Cancel this item')}
              </button>
            </div>

            <div className="pos2-modal-actions">
              <button className="pos2-btn" onClick={() => setActionItem(null)}>{t('ปิด', 'Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── จำนวนลูกค้าตอนเปิดโต๊ะใหม่ — ขึ้นบนบิลตอนเช็คบิล ── */}
      {pendingTable && (
        <div className="pos2-modal-overlay" onClick={() => setPendingTable(null)}>
          <div className="pos2-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(`เปิดโต๊ะ ${pendingTable}`, `Open table ${pendingTable}`)}</h3>
            <p>{t('ระบุจำนวนลูกค้า (ท่าน)', 'Number of guests')}</p>
            <div className="pos2-guest-row">
              <button onClick={() => setGuestCount(c => Math.max(1, c - 1))}><Minus size={18} /></button>
              <span>{guestCount}</span>
              <button onClick={() => setGuestCount(c => c + 1)}><Plus size={18} /></button>
            </div>
            <div className="pos2-modal-actions">
              <button className="pos2-btn" onClick={() => confirmGuestCount(true)}>{t('ข้าม', 'Skip')}</button>
              <button className="pos2-btn primary" onClick={() => confirmGuestCount(false)}>{t('เปิดโต๊ะ', 'Open table')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosSalesScreen;
