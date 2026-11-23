import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { X, CheckCircle, ArrowLeft, CreditCard, Ticket, Smartphone, Tag, ChevronRight, Split, Clock, Printer, UserRound, QrCode } from 'lucide-react';
import { crmEnabled, lookupMember, maskPhone, crmCall, newCouponRef } from '../utils/crm';
import QrScanner from './QrScanner';
import { isQrCode, scannerChar, useScannerWedge } from '../utils/qrScan';
import { generatePromptPayPayload, generateDynamicQRFromRaw, parseKShopPayload } from '../utils/promptpay';
import { scopedSlipCss } from '../utils/print80mm';
import { getReceiptHeader } from '../utils/printServer';
import { logoHtml } from '../utils/receiptStyle';
import { menuCategoryLookup, discountAmount as calcDiscount } from '../utils/discount';

// discountAmount คิดมาแล้วจาก utils/discount (ส่วนลดเฉพาะหมวด ลดเฉพาะยอดของหมวดนั้น)
const calcCharges = (subtotal, settings = {}, discountAmountIn = 0) => {
  const discountAmount = Math.min(Math.max(0, Number(discountAmountIn) || 0), subtotal);
  const afterDiscount = subtotal - discountAmount;
  const scRate = settings?.serviceCharge?.enabled ? (settings.serviceCharge.rate || 0) : 0;
  const vatRate = settings?.vat?.enabled ? (settings.vat.rate || 0) : 0;
  const sc = Math.round(afterDiscount * scRate) / 100;
  const vatBase = afterDiscount + sc;
  const vat = Math.round(vatBase * vatRate) / 100;
  return { subtotal, discountAmount, afterDiscount, sc, vat, grand: afterDiscount + sc + vat };
};

const CheckoutModal = ({
  tableOrderItems = [], total = 0, orderNumber, tableNo = '',
  onClose, onComplete, lang = 'th',
  // ส่วนลดเลือกที่หน้าขาย (ปุ่มสแกนสมาชิก / ใช้ส่วนลด) ส่งมาเป็น initialDiscount · หน้านี้ไม่มีหน้าเลือกส่วนลดแล้ว
  settings = {}, initialDiscount = null, branchId = '', menu = [],
  // สมาชิกที่สแกนไว้แล้วที่หน้าขาย + รหัสการจองคูปองของบิล (คูปองที่ยิงที่หน้าขาย) → ไม่ต้องสแกนซ้ำ
  initialMember = null, initialCouponRef = null
}) => {
  const [paymentStep, setPaymentStep] = useState('summary');
  // รับส่วนลดที่เลือกมาจากหน้าขายเป็นค่าตั้งต้น พนักงานจะได้ไม่ต้องเลือกซ้ำ
  // (ต้องประกาศก่อนส่วนคูปองสมาชิก ที่ใช้ค่านี้ใน useEffect ด้านล่าง ไม่งั้นพังตอนเปิดหน้าชำระเงิน)
  const [selectedDiscount, setSelectedDiscount] = useState(initialDiscount);
  // ── ระบบสมาชิก: หน้าพนักงานรับเฉพาะสแกน QR บัตรสมาชิก/คูปอง (กล้อง หรือเครื่องยิง QR) · พิมพ์เบอร์/เลขสมาชิกไม่ได้ ──
  const [crmOn, setCrmOn] = useState(false);
  const [member, setMember] = useState(initialMember);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState('');
  useEffect(() => { let alive = true; crmEnabled().then(on => { if (alive) setCrmOn(on); }); return () => { alive = false; }; }, []);
  // text = ผลจากกล้อง/เครื่องยิง QR · QR คูปอง (CQ.xxx) ได้ทั้งสมาชิกและคูปองที่ใช้กับบิลนี้
  const findMember = async (text) => {
    const q = String(text || '').trim();
    if (!q || memberBusy) return;
    const fail = (msg) => (member ? setWalletMsg(msg) : setMemberErr(msg));
    if (!isQrCode(q)) return fail('QR นี้ไม่ใช่บัตรสมาชิก/คูปอง · ใช้ได้เฉพาะสแกน QR จากบัตรสมาชิก LINE ของลูกค้า');
    setMemberBusy(true); setMemberErr('');
    const res = await lookupMember(q, branchId);
    setMemberBusy(false);
    if (!res.success) return fail(res.error || 'ค้นหาสมาชิกไม่สำเร็จ');
    if (member && member.id !== res.member.id) return fail(`QR นี้เป็นของ ${res.member.name} (${res.member.id}) ไม่ใช่สมาชิกที่เลือกไว้ กด "เปลี่ยน" ก่อนถ้าจะใช้`);
    if (!member) { setMember(res.member); loadWallet(res.member); }
    const sc = res.scannedCoupon;
    if (sc && sc.usable) pickCoupon(sc, res.member);
    else if (sc) setWalletMsg(`คูปอง ${sc.code}: ${sc.reason} · สะสมแต้มให้สมาชิกแล้ว`);
  };
  const [scanOpen, setScanOpen] = useState(false);
  const findRef = useRef(findMember);
  useEffect(() => { findRef.current = findMember; });
  const onScan = useCallback((text) => { setScanOpen(false); findRef.current(text); }, []);
  // เครื่องยิง QR (พิมพ์เป็นคีย์บอร์ดเร็วมากแล้วกด Enter) · ทำงานตลอดในหน้าสรุปบิล แม้เปิดหน้าต่างกล้องค้างไว้
  useScannerWedge(crmOn && paymentStep === 'summary', (code) => { setScanOpen(false); findRef.current(code); });

  // ── คูปองสมาชิก / แลกแต้ม: คูปองที่เลือกถูกจองไว้กับบิลนี้ (couponRef) จนกว่าจะจ่ายหรือเปลี่ยนใจ ──
  const couponRef = useRef(initialCouponRef || newCouponRef('pos'));
  const completedRef = useRef(false);
  const [wallet, setWallet] = useState(null);
  const [walletMsg, setWalletMsg] = useState('');
  const [couponBusy, setCouponBusy] = useState('');
  // รายการในบิลให้ระบบสมาชิกตรวจคูปองของฟรี/เงื่อนไขสินค้า (แถวตัวเลือก ↳ ไม่นับ)
  const crmItems = tableOrderItems
    .filter(i => i && i.ItemName && !String(i.ItemName).startsWith('↳'))
    .map(i => ({ name: i.ItemName, price: Number(i.ItemPrice) || 0, qty: Number(i.Quantity) || 1 }));
  const loadWallet = async (m = member) => {
    if (!m) return;
    setWalletMsg('');
    const res = await crmCall('crmWallet', { memberId: m.id, subtotal: total, ref: couponRef.current, branchId, items: crmItems });
    if (!res.success) { setWalletMsg(res.error || 'โหลดคูปองไม่สำเร็จ'); return; }
    setWallet(res); setMember(prev => (prev && prev.id === m.id ? { ...prev, points: res.balance } : prev));
    // คูปองที่ใช้กับบิลนี้ (ได้หลายใบ) รวมเป็นส่วนลดเดียว · ระบบสมาชิกคิดและแบ่งรายการในบิลให้แต่ละใบแล้ว
    if (Array.isArray(res.applied)) applyCoupons(res.applied, res.appliedTotal);
    if (res.dropped && res.dropped.length) setWalletMsg('เอาคูปองออกแล้ว: ' + res.dropped.map(d => `${d.title} (${d.reason})`).join(', '));
  };
  const applyCoupons = (list, total) => {
    if (!list.length) { setSelectedDiscount(prev => (prev && prev.crmCoupons ? null : prev)); return; }
    setSelectedDiscount({
      id: 'crm', name: `คูปอง ${list.map(c => c.title).join(' + ')}`, type: 'baht', value: Number(total) || 0,
      crmCoupons: list.map(c => ({ id: String(c.id), code: c.code, title: c.title, discount: Number(c.discount) || 0, cancel: c.cancel || null }))
    });
  };
  const pickCoupon = async (c, m = member) => {
    if (couponBusy) return;
    setCouponBusy('c' + c.id); setWalletMsg('');
    const res = await crmCall('crmReserveCoupon', { memberId: m.id, couponId: c.id, scanProof: c.scanProof, ref: couponRef.current, subtotal: total, branchId, items: crmItems });
    setCouponBusy('');
    if (!res.success) setWalletMsg(res.error || 'ใช้คูปองไม่สำเร็จ');
    loadWallet(m);
  };
  // สมาชิกจากหน้าขาย: โหลดกระเป๋า → ได้คูปองที่จองไว้ที่หน้าขาย (couponRef เดียวกัน) คิดยอดใหม่ตามบิลนี้
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !initialMember) return;
    startedRef.current = true;
    loadWallet(initialMember);
  });   // ไม่ใส่ dependency: startedRef กันให้ทำครั้งเดียวตอนเปิดหน้าต่าง
  // ยกเลิกการแลกแต้ม → คืนแต้มเข้าบัตร (วันหมดอายุเดิม) และถอดออกจากบิล
  const cancelRedeem = async (c) => {
    if (couponBusy || !c.cancel) return;
    if (!window.confirm(`ยกเลิกการแลก "${c.title}"?\nคืน ${Number(c.cancel.restore).toLocaleString()} แต้มเข้าบัตรสมาชิก${c.cancel.lost ? ` (อีก ${c.cancel.lost} แต้มหมดอายุไปแล้ว คืนไม่ได้)` : ''}\nคูปองใบนี้จะใช้ไม่ได้แล้ว`)) return;
    setCouponBusy('v' + c.id); setWalletMsg('');
    const res = await crmCall('crmCancelRedeem', { memberId: member.id, couponId: c.id, branchId });
    setCouponBusy('');
    if (res.success) setWalletMsg(`ยกเลิกการแลกแล้ว คืน ${Number(res.restored).toLocaleString()} แต้ม`);
    else setWalletMsg(res.error || 'ยกเลิกการแลกไม่สำเร็จ');
    loadWallet();
  };
  const removeCoupon = async (c) => {
    if (couponBusy) return;
    setCouponBusy('x' + c.id); setWalletMsg('');
    await crmCall('crmReleaseCoupon', { couponId: c.id, ref: couponRef.current, branchId });
    setCouponBusy('');
    loadWallet();
  };
  // เปลี่ยนจากคูปองเป็นส่วนลดอื่น / ไม่ใช้ส่วนลด → ปล่อยคูปองที่จองไว้ทุกใบ
  const heldCoupons = useRef([]);
  useEffect(() => {
    const now = selectedDiscount && selectedDiscount.crmCoupons ? selectedDiscount.crmCoupons.map(c => c.id) : [];
    heldCoupons.current.filter(id => !now.includes(id)).forEach(id => crmCall('crmReleaseCoupon', { couponId: id, ref: couponRef.current, branchId }));
    heldCoupons.current = now;
  }, [selectedDiscount, branchId]);
  // ปิดหน้าต่างโดยไม่จ่าย → ปล่อยคูปอง (ถ้าปล่อยไม่ทัน ระบบปล่อยเองเมื่อหมดเวลาจอง)
  // คูปองที่จองมาจากหน้าขาย ไม่ปล่อย: กลับไปหน้าขายแล้วยังใช้อยู่
  useEffect(() => () => {
    if (!completedRef.current && !initialCouponRef) heldCoupons.current.forEach(id => crmCall('crmReleaseCoupon', { couponId: id, ref: couponRef.current, branchId }));
  }, [branchId, initialCouponRef]);
  // ส่วนลดของร้านใช้ได้โดยไม่ต้องมีสมาชิก (ปุ่ม "ส่วนลด" ที่หน้าขาย) · คูปองสมาชิกต้องมีสมาชิก (ถอดสมาชิก = เอาคูปองออก)
  const removeMember = () => {
    if (selectedDiscount && selectedDiscount.crmCoupons) setSelectedDiscount(null);
    setMember(null); setWallet(null); setWalletMsg('');
  };

  const [qrApproved, setQrApproved] = useState(true);
  const [approverName] = useState('');
  const [approvalId] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('approved');

  const [pendingComplete, setPendingComplete] = useState(null);
  const [splitTransfer, setSplitTransfer] = useState('');
  const [splitCard, setSplitCard] = useState('');

  // ส่วนลดเฉพาะหมวด: หาหมวดของแต่ละรายการจากชื่อเมนู แล้วลดเฉพาะยอดของหมวดที่เลือกไว้
  const categoriesOf = React.useMemo(() => menuCategoryLookup(menu), [menu]);
  // เมนูเฉพาะสมาชิกในบิล → ต้องยิงบัตรสมาชิกก่อนชำระเงิน
  const memberOnlyInBill = React.useMemo(() => {
    const names = new Set((menu || []).filter(m => m && m.memberOnly === true).map(m => m.name));
    return [...new Set((tableOrderItems || []).map(i => i && i.ItemName).filter(n => names.has(n)))];
  }, [menu, tableOrderItems]);
  // โควตาเมนูสมาชิกวันนี้ (หลังบ้าน > เมนูสมาชิก) — บิลนี้สั่งเกินที่เหลือ = ชำระเงินไม่ได้
  const [mQuota, setMQuota] = useState(null);
  const mqMemberId = member ? member.id : '';
  const needQuota = memberOnlyInBill.length > 0;
  useEffect(() => {
    let alive = true;
    if (!mqMemberId || !needQuota) { setMQuota(null); return undefined; }
    crmCall('staffMemberQuota', { memberId: mqMemberId, branchId }).then(res => { if (alive && res && res.success) setMQuota(res); });
    return () => { alive = false; };
  }, [mqMemberId, needQuota, branchId]);
  const quotaProblem = React.useMemo(() => {
    if (!mQuota || !mQuota.enabled || !member) return '';
    const byName = new Map((menu || []).filter(m => m && m.memberOnly === true).map(m => [m.name, String(m.id)]));
    const want = {}; let total = 0;
    (tableOrderItems || []).forEach(i => { const id = i && byName.get(i.ItemName); if (id) { const q = Number(i.Quantity) || 1; want[id] = (want[id] || 0) + q; total += q; } });
    for (const [id, q] of Object.entries(want)) {
      const m = mQuota.menus && mQuota.menus[id];
      if (m && m.limit && m.used + q > m.limit) return `${m.name} สั่งได้ ${m.limit} ชิ้นต่อวัน · วันนี้สั่งไปแล้ว ${m.used} · บิลนี้มี ${q}`;
    }
    if (mQuota.total && total > mQuota.total.left) return `เมนูสมาชิกสั่งได้รวม ${mQuota.total.limit} ชิ้นต่อวัน · วันนี้เหลือ ${mQuota.total.left} · บิลนี้มี ${total}`;
    return '';
  }, [mQuota, member, menu, tableOrderItems]);
  const discountLines = tableOrderItems.map(i => ({ name: i.ItemName, amount: (Number(i.ItemPrice) || 0) * (Number(i.Quantity) || 1) }));
  const discountFor = (d) => calcDiscount(d, discountLines, categoriesOf);
  const { subtotal, discountAmount, sc, vat, grand } = calcCharges(total, settings, discountFor(selectedDiscount));
  const hasCharges = sc > 0 || vat > 0;
  const hasDiscount = discountAmount > 0;


  const promptPayId = settings?.promptPayId || '004000001641684';
  const qrType = settings?.qrType || 'kshop_dynamic';
  const staticQrUrl = settings?.staticQrUrl || '/kshop_qr.png';
  const [qrDataUrl, setQrDataUrl] = useState('');

  const kshopRawPayload = settings?.kshopRawPayload || '00020101021130810016A00000067701011201150107536000315080214KB0000016416840320KPS004KB00000164168431690016A00000067701011301030040214KB0000016416840420KPS004KB00000164168453037645802TH6304A14E';
  const qrShopName = settings?.qrShopName || 'เสน่ห์';
  const qrAccountName = settings?.qrAccountName || 'เสน่ห์';
  // ยอดที่ต้องโอน: null = ทั้งบิล · ตัวเลข = ส่วนที่เหลือหลังหัก Voucher (QR พร้อมเพย์สร้างตามยอดนี้)
  const [transferDue, setTransferDue] = useState(null);
  const qrAmount = transferDue ?? grand;

  const requestApproval = () => {};

  useEffect(() => {
    if (paymentStep === 'transfer') {
      setQrApproved(true);
      setApprovalStatus('approved');
    } else {
      setQrApproved(true);
      setApprovalStatus('approved');
    }
  }, [paymentStep]);

  useEffect(() => {
    const isDynamic = qrType === 'dynamic' || qrType === 'kshop_dynamic';
    if (!isDynamic || paymentStep !== 'transfer' || qrAmount <= 0) { setQrDataUrl(''); return; }
    let cancelled = false;

    let payload = '';
    if (qrType === 'kshop_dynamic') {
      payload = generateDynamicQRFromRaw(kshopRawPayload, qrAmount);
    } else {
      payload = generatePromptPayPayload(promptPayId, qrAmount);
    }

    if (payload) {
      QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(url => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(''); });
    } else {
      setQrDataUrl('');
    }
    return () => { cancelled = true; };
  }, [paymentStep, qrAmount, promptPayId, qrType, kshopRawPayload]);

  const splitTransferN = parseFloat(splitTransfer) || 0;
  const splitCardN = parseFloat(splitCard) || 0;
  const splitSum = Math.round((splitTransferN + splitCardN) * 100) / 100;
  const splitRemaining = Math.round((grand - splitSum) * 100) / 100;
  const splitValid = splitRemaining === 0 && splitSum > 0 && [splitTransferN, splitCardN].filter(v => v > 0).length >= 2;

  // ── Voucher (ใช้แทนเงิน ไม่ใช่ส่วนลด): ยิง QR / พิมพ์รหัส Voucher กระดาษ หรือสแกน QR Voucher ในบัตรสมาชิก LINE ──
  // ระบบสมาชิกตรวจและจองไว้กับบิลนี้ · ตัดเป็นใช้แล้วตอนบันทึกบิล · ยอดขาดจ่ายเพิ่มด้วยโอน/บัตร · ยอดเกินไม่ทอน
  const voucherRef = useRef(newCouponRef('vc'));
  const [vouchers, setVouchers] = useState([]);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherErr, setVoucherErr] = useState('');
  const [vScanOpen, setVScanOpen] = useState(false);
  const voucherTotal = Math.round(vouchers.reduce((a, v) => a + (Number(v.value) || 0), 0) * 100) / 100;
  const voucherShort = Math.round((grand - voucherTotal) * 100) / 100;   // > 0 = ยังขาด · < 0 = เกิน (ไม่ทอน)
  const addVoucher = async (text) => {
    const code = String(typeof text === 'string' ? text : voucherCode).trim();
    if (!code || voucherBusy) return;
    if (voucherTotal >= grand) { setVoucherErr('ยอด Voucher ครบยอดบิลแล้ว'); return; }
    setVoucherBusy(true); setVoucherErr('');
    const res = await crmCall('crmVoucherCheck', { code, ref: voucherRef.current, branchId });
    setVoucherBusy(false);
    if (!res.success) { setVoucherErr(res.error || 'ตรวจ Voucher ไม่สำเร็จ'); return; }
    const v = res.voucher;
    setVouchers(prev => (prev.some(x => x.id === v.id) ? prev : [...prev, v]));
    setVoucherCode('');
  };
  const removeVoucher = (v) => {
    crmCall('crmVoucherRelease', { voucherId: v.id, ref: voucherRef.current, branchId });
    setVouchers(prev => prev.filter(x => x.id !== v.id));
  };
  const addVoucherRef = useRef(addVoucher);
  useEffect(() => { addVoucherRef.current = addVoucher; });
  const onVoucherScan = useCallback((text) => { setVScanOpen(false); addVoucherRef.current(text); }, []);
  // ยอดที่ Voucher แต่ละใบจ่ายจริง ตามลำดับที่ยิง (ใบสุดท้ายอาจจ่ายไม่เต็มใบ = ส่วนเกินไม่ทอน)
  const voucherAlloc = () => {
    let left = grand;
    return vouchers.map(v => { const amount = Math.round(Math.min(Number(v.value) || 0, Math.max(0, left)) * 100) / 100; left -= amount; return { id: v.id, amount }; }).filter(x => x.amount > 0);
  };
  // ปิดหน้าต่างโดยไม่จ่าย → ปล่อย Voucher ที่จองไว้ (ปล่อยไม่ทันระบบปล่อยเองเมื่อหมดเวลาจอง)
  const heldVouchers = useRef([]);
  useEffect(() => { heldVouchers.current = vouchers.map(v => v.id); }, [vouchers]);
  useEffect(() => () => {
    if (!completedRef.current) heldVouchers.current.forEach(id => crmCall('crmVoucherRelease', { voucherId: id, ref: voucherRef.current, branchId }));
  }, [branchId]);
  // rest = วิธีจ่ายส่วนที่ขาด ('transfer' | 'card') · ไม่ส่ง = Voucher ครบยอด
  const handleVoucherPay = (rest) => {
    if (!vouchers.length) return;
    if (voucherShort <= 0) { setPendingComplete({ method: 'Voucher', details: { voucher: grand } }); setPaymentStep('success'); return; }
    const details = { voucher: voucherTotal, [rest]: voucherShort };
    setPendingComplete({ method: 'แยกจ่าย', details });
    if (rest === 'transfer') { setTransferDue(voucherShort); setPaymentStep('transfer'); } else setPaymentStep('success');
  };

  const handleConfirmPayment = (method) => {
    // เงินโอน: ยืนยันรับเงินแล้วไปหน้าใบเสร็จเลย (ไม่มีหน้าแนบสลิปแล้ว)
    setPendingComplete({ method });
    setPaymentStep('success');
  };

  const handleConfirmSplit = () => {
    if (!splitValid) return;
    const details = { transfer: splitTransferN, card: splitCardN };
    setPendingComplete({ method: 'แยกจ่าย', details });
    setPaymentStep('success');
  };

  const PAY_PART = { voucher: 'Voucher', transfer: 'โอน', card: 'บัตร', cash: 'สด' };
  const pd = pendingComplete?.details;
  const paidMethod = (pendingComplete?.method || '') + (pd && pendingComplete?.method === 'แยกจ่าย'
    ? ' (' + Object.entries(pd).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${PAY_PART[k] || k} ฿${Number(v).toLocaleString()}`).join(' + ') + ')' : '');
  const voucherCodes = pd && pd.voucher > 0 ? vouchers.map(v => v.code).join(', ') : '';
  // no = เลขที่บิล (เซิร์ฟเวอร์ออกตอนบันทึก) · abb=false = ใบเสร็จธรรมดา ใช้ตอนยังบันทึกบิลไม่สำเร็จ
  const buildReceiptHtml = (no = orderNumber, abb = true) => {
    const now = new Date().toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    // หัวใบตามสาขา (หลังบ้าน > สาขา) — มีเลขผู้เสียภาษี = ใบกำกับภาษีอย่างย่อ เหมือนที่ Print Server พิมพ์
    const esc = (v) => String(v || '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const h = getReceiptHeader() || {};
    const isAbb = abb && !!esc(h.taxId);
    const rows = (tableOrderItems || []).map(it => {
      const qty = Number(it.Quantity) || 1;
      const price = (Number(it.ItemPrice) || 0) * qty;
      // ชื่อ/ตัวเลือก/หมายเหตุมาจากที่คนพิมพ์ (รวมหมายเหตุที่ลูกค้าพิมพ์เองในหน้าสแกนสั่ง) — ต้อง escape ก่อนใส่เป็น HTML
      const name = esc(it.ItemName);
      const opt = it.Options ? `<div class="opt">${esc(it.Options)}</div>` : '';
      return `<div class="it"><div class="row"><span>${qty}× ${name}</span><span>฿${price.toLocaleString()}${isAbb ? ' V' : ''}</span></div>${opt}</div>`;
    }).join('');
    const line = (k, v, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`;
    const rate = Number(h.vatRate) > 0 ? Number(h.vatRate) : 7;
    const vatable = Math.round(grand * 100 / (100 + rate) * 100) / 100;
    const m2 = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // รายละเอียดที่แสดงตั้งได้ที่ หลังบ้าน > ใบเสร็จ · ใบกำกับภาษีอย่างย่อต้องมีชื่อผู้ขายเสมอ (ม.86/6)
    const showName = h.showName !== false || isAbb;
    const headLines = [
      ...(h.showAddress !== false ? esc(h.address).split(/\r?\n/).map(x => x.trim()).filter(Boolean) : []),
      h.phone && h.showPhone !== false ? `โทร ${esc(h.phone)}` : '',
      isAbb ? `เลขผู้เสียภาษี ${esc(h.taxId)}` : '',
      isAbb && esc(h.posId) ? `POS ID: ${esc(h.posId)}` : ''
    ].filter(Boolean).map(x => `<div class="c sm">${x}</div>`).join('');
    return `
      ${logoHtml(h)}
      ${showName ? `<div class="c xl">${esc(h.name) || 'เสน่ห์'}</div>` : ''}
      ${headLines}
      <div class="c sm">${isAbb ? 'ใบกำกับภาษีอย่างย่อ / TAX INV (ABB)' : 'ใบเสร็จรับเงิน / RECEIPT'}</div>
      <div class="hr"></div>
      ${line(isAbb ? 'เลขที่' : 'บิลเลขที่', esc(no) || '-')}
      ${tableNo ? line('โต๊ะ', esc(tableNo)) : ''}
      ${line('วันที่', now)}
      ${paidMethod ? line('ชำระโดย', esc(paidMethod)) : ''}
      ${voucherCodes ? line('Voucher', esc(voucherCodes)) : ''}
      ${member ? line('สมาชิก', esc(member.id)) : ''}
      <div class="hr"></div>
      ${rows}
      <div class="hr"></div>
      ${(hasDiscount || hasCharges) ? line('ยอดอาหาร', `฿${subtotal.toLocaleString()}`) : ''}
      ${hasDiscount ? line(`ส่วนลด ${esc(selectedDiscount?.name)}`, `-฿${discountAmount.toLocaleString()}`) : ''}
      ${sc > 0 ? line(`เซอร์วิสชาร์จ ${settings.serviceCharge.rate}%`, `+฿${sc.toLocaleString()}`) : ''}
      ${vat > 0 ? line(`VAT ${settings.vat.rate}%`, `+฿${vat.toLocaleString()}`) : ''}
      <div class="hr"></div>
      <div class="row tot"><span>รวมทั้งสิ้น</span><span>฿${m2(grand)}</span></div>
      <div class="hr"></div>
      ${isAbb ? `${line('มูลค่าสินค้าเสียภาษี (V)', m2(vatable))}${line(`ภาษีมูลค่าเพิ่ม ${rate}%`, m2(Math.round((grand - vatable) * 100) / 100))}<div class="c sm">ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT Included)</div><div class="hr"></div>` : ''}
      <div class="c sm">${esc(h.footer) || 'ขอบคุณที่ใช้บริการ'}</div>
    `;
  };

  // ── ใบเสร็จสำหรับเครื่องพิมพ์ความร้อน (Print Server) — ข้อมูลชุดเดียวกับพรีวิว ──
  const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const buildReceiptOrder = (no = orderNumber) => {
    const summary = [];
    if (hasDiscount || hasCharges) summary.push({ label: 'ยอดอาหาร', value: money2(subtotal) });
    if (hasDiscount) summary.push({ label: `ส่วนลด ${selectedDiscount?.name || ''}`.trim(), value: `-${money2(discountAmount)}` });
    if (sc > 0) summary.push({ label: `เซอร์วิสชาร์จ ${settings.serviceCharge.rate}%`, value: money2(sc) });
    if (vat > 0) summary.push({ label: `VAT ${settings.vat.rate}%`, value: money2(vat) });
    if (paidMethod) summary.push({ label: 'ชำระโดย', value: paidMethod });
    if (voucherCodes) summary.push({ label: 'Voucher', value: voucherCodes });
    if (member) summary.push({ label: 'สมาชิก', value: `${member.id}${member.phone ? ' ' + maskPhone(member.phone) : ''}` });
    return {
      id: no,
      orderNumber: no || '-',
      customerDetails: { name: tableNo ? `โต๊ะ ${tableNo}` : '' },
      items: (tableOrderItems || []).map(it => {
        const qty = Number(it.Quantity) || 1;
        return {
          isFlattened: true,
          name: qty > 1 ? `${it.ItemName} (x${qty})` : it.ItemName,
          amount: (Number(it.ItemPrice) || 0) * qty,
          subItems: it.Options ? String(it.Options).split(', ').filter(Boolean) : []
        };
      }),
      summary,
      total: money2(grand),
      paid: true
    };
  };

  // ปิดบิล — เลขที่บิล (= เลขที่ใบกำกับภาษีอย่างย่อ) ออกโดยเซิร์ฟเวอร์ตอนบันทึก หน้าหลักจึงเป็นคนพิมพ์ใบเสร็จหลังได้เลข
  // print = กดปุ่มพิมพ์ใบเสร็จ: เครื่องที่ยังไม่ได้ตั้งเครื่องพิมพ์ใช้หน้าต่างพิมพ์ของเบราว์เซอร์แทน
  const finalizeComplete = (print = false) => {
    // กดซ้ำเร็ว ๆ = บิลเดียว
    if (completedRef.current) return;
    const pc = pendingComplete || { method: 'เงินสด' };
    completedRef.current = true;
    const crmCoupon = member && selectedDiscount && selectedDiscount.crmCoupons
      ? { ids: selectedDiscount.crmCoupons.map(c => c.id), ref: couponRef.current, discount: discountAmount } : null;
    const usedVouchers = pc.details && pc.details.voucher > 0 ? { list: voucherAlloc(), ref: voucherRef.current } : null;
    // สแกน Voucher ไว้แต่สุดท้ายจ่ายวิธีอื่น → ปล่อยคืน
    if (!usedVouchers) vouchers.forEach(v => crmCall('crmVoucherRelease', { voucherId: v.id, ref: voucherRef.current, branchId }));
    onComplete(grand, pc.method, pc.details, { print, receiptOrder: buildReceiptOrder(), buildReceiptHtml, member, discountAmount, discountName: selectedDiscount ? selectedDiscount.name : '', crmCoupon, vouchers: usedVouchers });
  };

  const PriceBreakdown = ({ compact = false }) => (
    <div style={{
      background: '#f8f8f8', border: '1px solid #e4e4e4',
      borderRadius: '12px', padding: compact ? '0.85rem 1rem' : '1rem 1.25rem',
      marginBottom: compact ? '0.75rem' : '1.5rem'
    }}>
      {!compact && (
        <h4 style={{ marginBottom: '0.75rem', color: '#5a5a5a', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '700' }}>
          {lang === 'th' ? 'สรุปรายการ' : 'Order Summary'}
        </h4>
      )}
      {!compact && tableOrderItems.map((item, idx) => {
        const itemSubtotal = (Number(item.ItemPrice) || 0) * (Number(item.Quantity) || 1);
        return (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.92rem', marginBottom: '0.45rem', color: '#141414' }}>
            <div>
              <span style={{ fontWeight: '800', color: '#c8102e', marginRight: '6px' }}>{Number(item.Quantity) || 1}×</span>
              <span style={{ fontWeight: '700' }}>{lang === 'th' ? item.ItemName : (item.ItemNameEn || item.ItemName)}</span>
              {item.Options && (
                <div style={{ fontSize: '0.78rem', color: '#454545', paddingLeft: '1.5rem', fontWeight: 500 }}>{item.Options}</div>
              )}
            </div>
            <span style={{ fontWeight: '800' }}>฿{itemSubtotal.toLocaleString()}</span>
          </div>
        );
      })}

      <div style={{
        borderTop: '1px solid #d0d0d0',
        marginTop: compact ? 0 : '0.75rem', paddingTop: '0.6rem',
        display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem'
      }}>
        {(hasDiscount || hasCharges) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#454545', fontWeight: '600' }}>
            <span>{lang === 'th' ? 'ยอดอาหาร' : 'Subtotal'}</span>
            <span style={{ color: '#141414', fontWeight: '700' }}>฿{subtotal.toLocaleString()}</span>
          </div>
        )}
        {hasDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626', fontWeight: '600' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Tag size={13} /> {lang === 'th' ? `ส่วนลด: ${selectedDiscount.name}` : `Discount: ${selectedDiscount.name}`}
            </span>
            <span style={{ fontWeight: '800' }}>-฿{discountAmount.toLocaleString()}</span>
          </div>
        )}
        {sc > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a50d25', fontWeight: '600' }}>
            <span>{lang === 'th' ? `เซอร์วิชชาร์จ ${settings.serviceCharge.rate}%` : `Service Charge ${settings.serviceCharge.rate}%`}</span>
            <span style={{ fontWeight: '700' }}>+฿{sc.toLocaleString()}</span>
          </div>
        )}
        {vat > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#141414', fontWeight: '600' }}>
            <span>{lang === 'th' ? `VAT ${settings.vat.rate}%` : `VAT ${settings.vat.rate}%`}</span>
            <span style={{ fontWeight: '700' }}>+฿{vat.toLocaleString()}</span>
          </div>
        )}
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '1.15rem',
          borderTop: (hasDiscount || hasCharges) ? '1px solid #d0d0d0' : 'none',
          paddingTop: (hasDiscount || hasCharges) ? '0.45rem' : 0
        }}>
          <span style={{ color: '#141414' }}>{lang === 'th' ? 'รวมทั้งสิ้น' : 'Grand Total'}</span>
          <span style={{ color: '#c8102e', fontSize: '1.35rem', fontWeight: '900' }}>฿{grand.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );

  // แตะนอกกรอบปิดได้เฉพาะหน้าสรุปบิล — ระหว่างรับเงิน/แนบสลิป แตะพลาดแล้วหน้าหายไปพร้อมยอดที่กรอก
  return (
    <div className="modal-overlay" onClick={paymentStep === 'summary' ? onClose : undefined}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: '20px', color: '#141414', maxHeight: '92vh', overflowY: 'auto', border: '1px solid #e4e4e4', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>

        {/* ── Step 1: Summary ── */}
        {paymentStep === 'summary' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#141414', fontWeight: '800' }}>{lang === 'th' ? 'สรุปบิล' : 'Bill Summary'}</h2>
              <button className="close-btn" onClick={onClose}><X size={24} color="#141414" /></button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
              <PriceBreakdown />
            </div>
            {crmOn && <QrScanner open={scanOpen} onResult={onScan} onClose={() => setScanOpen(false)} title={member ? 'สแกน QR คูปอง' : 'สแกน QR บัตรสมาชิก / คูปอง'} />}
            {crmOn && (
              <div style={{ border: '1px solid #e4e4e4', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '1rem', background: member ? '#f0fdf4' : '#ffffff' }}>
                {member ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <UserRound size={22} color="#16a34a" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>{member.name} <span style={{ color: '#5a5a5a', fontWeight: 600 }}>· {member.id}</span></div>
                      <div style={{ fontSize: '0.85rem', color: '#454545' }}>
                        {lang === 'th' ? 'แต้มคงเหลือ' : 'Points'} {Number(member.points || 0).toLocaleString()}{member.tier ? ` · ${member.tier}` : ''}{member.phone ? ` · ${member.phone}` : ''}
                      </div>
                    </div>
                    <button type="button" onClick={removeMember} style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 700 }}>
                      {lang === 'th' ? 'เปลี่ยน' : 'Change'}
                    </button>
                  </div>
                ) : null}
                {member && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <button type="button" onClick={() => setScanOpen(true)} disabled={memberBusy}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1px dashed #7a7a7a', background: '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 700, marginBottom: '6px', cursor: 'pointer' }}>
                      <QrCode size={16} /> {memberBusy ? '…' : (lang === 'th' ? 'สแกน QR คูปอง' : 'Scan coupon QR')}
                    </button>
                    {!wallet && !walletMsg && <div style={{ fontSize: '0.85rem', color: '#5a5a5a' }}>กำลังโหลดคูปอง…</div>}
                    {walletMsg && (
                      <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                        {walletMsg} <button type="button" onClick={() => loadWallet()} style={{ border: 'none', background: 'none', color: '#141414', textDecoration: 'underline', cursor: 'pointer' }}>ลองใหม่</button>
                      </div>
                    )}
                    {wallet && (() => {
                      const applied = (selectedDiscount && selectedDiscount.crmCoupons) || [];
                      const btn = (active) => ({ border: active ? '2px solid #16a34a' : '1px solid #d0d0d0', background: active ? '#dcfce7' : '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer' });
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                          {applied.map(c => (
                            <div key={'a' + c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', border: '2px solid #16a34a', borderRadius: '10px', background: '#f0fdf4' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.title}</div>
                                <div style={{ fontSize: '0.75rem', color: '#15803d' }}>✓ ใช้อยู่ · {c.discount > 0 ? `ลด ฿${Number(c.discount).toLocaleString()}` : 'ใบรับของ (ไม่ลดเงิน)'} · {c.code}</div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <button type="button" style={btn(true)} disabled={!!couponBusy} onClick={() => removeCoupon(c)}>{couponBusy === 'x' + c.id ? '…' : 'เอาออก'}</button>
                                {c.cancel && <button type="button" style={{ ...btn(false), borderColor: '#fca5a5', color: '#b91c1c', background: '#fef2f2' }} disabled={!!couponBusy} onClick={() => cancelRedeem(c)}>{couponBusy === 'v' + c.id ? '…' : `ยกเลิกแลก คืน ${Number(c.cancel.restore).toLocaleString()} แต้ม`}</button>}
                              </div>
                            </div>
                          ))}
                          {/* หน้าพนักงาน: ใช้คูปองได้เฉพาะการสแกน QR จากบัตรสมาชิก LINE ของลูกค้า · ลูกค้าแลกแต้มเองในบัตร LINE */}
                          <div style={{ fontSize: '0.78rem', color: '#5a5a5a', lineHeight: 1.5 }}>
                            {applied.length === 0 ? 'ยังไม่ได้ใช้คูปอง · ' : ''}ใช้คูปองได้โดยสแกน QR คูปองจากบัตรสมาชิก LINE ของลูกค้า (กด "ใช้คูปอง" ในบัตร) · ลูกค้าแลกแต้มเป็นคูปองเองในบัตร LINE
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {!member && (
                  <>
                    <label htmlFor="crm-member" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '0.9rem', marginBottom: '6px' }}>
                      <UserRound size={18} /> {lang === 'th' ? 'สมาชิก (สะสมแต้ม)' : 'Member (earn points)'}
                    </label>
                    {/* หน้าพนักงาน: ใช้ได้เฉพาะสแกน QR (กล้อง หรือเครื่องยิง QR) · พิมพ์เบอร์/เลขสมาชิกไม่ได้ */}
                    <button type="button" id="crm-member" onClick={() => setScanOpen(true)} disabled={memberBusy} aria-label={lang === 'th' ? 'เปิดกล้องสแกน QR' : 'Scan QR with camera'}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', border: 0, background: '#141414', color: '#fff', borderRadius: '8px', padding: '12px', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', opacity: memberBusy ? 0.6 : 1 }}>
                      <QrCode size={18} /> {memberBusy ? '…' : (lang === 'th' ? 'สแกน QR บัตรสมาชิก / คูปอง' : 'Scan member / coupon QR')}
                    </button>
                    <div style={{ fontSize: '0.78rem', color: '#5a5a5a', marginTop: '6px' }}>
                      {lang === 'th' ? 'มีเครื่องยิง QR: ยิงได้เลยไม่ต้องกดปุ่ม · ไม่มีเครื่องยิง: กดปุ่มเพื่อใช้กล้อง · พิมพ์เบอร์โทร/เลขสมาชิกไม่ได้' : 'With a QR scanner just scan — no need to press the button · without one, press to use the camera · typing phone/member no. is not accepted'}
                    </div>
                    {memberErr && <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '6px', fontWeight: 600 }}>{memberErr}</div>}
                  </>
                )}
              </div>
            )}
            {memberOnlyInBill.length > 0 && !member && (
              <div role="alert" style={{ border: '2px solid #c8102e', background: '#fdf2f4', color: '#7a0a1c', borderRadius: '12px', padding: '0.7rem 0.9rem', marginBottom: '0.75rem', fontWeight: 700, fontSize: '0.9rem' }}>
                👑 {lang === 'th'
                  ? `บิลนี้มีเมนูเฉพาะสมาชิก (${memberOnlyInBill.join(', ')}) · ยิง QR บัตรสมาชิกก่อนชำระเงิน`
                  : `Members-only items in this bill (${memberOnlyInBill.join(', ')}) · scan the member card first`}
              </div>
            )}
            {quotaProblem && (
              <div role="alert" style={{ border: '2px solid #dc2626', background: '#fef2f2', color: '#b91c1c', borderRadius: '12px', padding: '0.7rem 0.9rem', marginBottom: '0.75rem', fontWeight: 700, fontSize: '0.9rem' }}>
                👑 {lang === 'th' ? `เกินโควตาเมนูสมาชิกวันนี้ (รวมทุกสาขา): ${quotaProblem} · ลดจำนวนในบิลก่อนชำระเงิน` : `Member menu daily limit exceeded: ${quotaProblem}`}
              </div>
            )}
            <button
              onClick={() => setPaymentStep('payment_method')}
              disabled={(memberOnlyInBill.length > 0 && !member) || !!quotaProblem}
              className="confirm-btn"
              style={{ width: '100%', background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#ffffff', fontWeight: '800', ...((memberOnlyInBill.length > 0 && !member) || quotaProblem ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
            >
              {lang === 'th' ? `ดำเนินการชำระเงิน ฿${grand.toLocaleString()}` : `Proceed to Payment ฿${grand.toLocaleString()}`}
              <ChevronRight size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '6px' }} />
            </button>
          </>
        )}

        {/* ── Step 2: Payment Method ── */}
        {paymentStep === 'payment_method' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#141414', fontWeight: '800' }}>{lang === 'th' ? 'วิธีชำระเงิน' : 'Payment Method'}</h2>
              <button className="close-btn" onClick={() => setPaymentStep('summary')}><ArrowLeft size={22} color="#141414" /></button>
            </div>

            <PriceBreakdown compact />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* เงินโอน */}
              <button
                onClick={() => { setTransferDue(null); setPaymentStep('transfer'); }}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#f5f5f5', border: '2px solid #d0d0d0', borderRadius: '14px', padding: '1rem 1.25rem', color: '#141414', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#efefef'}
                onMouseOut={e => e.currentTarget.style.background = '#f5f5f5'}
              >
                <div style={{ background: '#efefef', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <Smartphone size={28} color="#141414" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#000000' }}>{lang === 'th' ? 'เงินโอน / QR Code' : 'Transfer / QR Code'}</div>
                  <div style={{ color: '#000000', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'สแกน QR ที่เคาน์เตอร์' : 'Scan QR at the counter'}</div>
                </div>
              </button>

              {/* บัตรเครดิต */}
              <button
                onClick={() => setPaymentStep('card')}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fdf2f4', border: '2px solid #fbe0e4', borderRadius: '14px', padding: '1rem 1.25rem', color: '#141414', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#fbe0e4'}
                onMouseOut={e => e.currentTarget.style.background = '#fdf2f4'}
              >
                <div style={{ background: '#fbe0e4', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <CreditCard size={28} color="#a50d25" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#8e0b20' }}>{lang === 'th' ? 'บัตรเครดิต / เดบิต' : 'Credit / Debit Card'}</div>
                  <div style={{ color: '#a50d25', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'รูดบัตร EDC ที่เคาน์เตอร์' : 'Swipe card at the counter'}</div>
                </div>
              </button>

              {/* Voucher (ใช้แทนเงิน) — ต้องเชื่อมระบบสมาชิก */}
              {crmOn && (
                <button
                  onClick={() => { setVoucherErr(''); setPaymentStep('voucher'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fdf2f8', border: '2px solid #f5b5bf', borderRadius: '14px', padding: '1rem 1.25rem', color: '#141414', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                  onMouseOver={e => e.currentTarget.style.background = '#fdf2f4'}
                  onMouseOut={e => e.currentTarget.style.background = '#fdf2f8'}
                >
                  <div style={{ background: '#fdf2f4', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                    <Ticket size={28} color="#c8102e" />
                  </div>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#7a0a1c' }}>Voucher</div>
                    <div style={{ color: '#a50d25', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'สแกน QR หรือกรอกเลข Voucher · ขาดจ่ายเพิ่ม เกินไม่ทอน' : 'Scan or enter voucher · pay the rest, no change'}</div>
                  </div>
                </button>
              )}

              {/* แยกจ่าย */}
              <button
                onClick={() => { setSplitTransfer(''); setSplitCard(''); setPaymentStep('split'); }}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fdf2f4', border: '2px solid #d0d0d0', borderRadius: '14px', padding: '1rem 1.25rem', color: '#141414', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#f1f1f1'}
                onMouseOut={e => e.currentTarget.style.background = '#fdf2f4'}
              >
                <div style={{ background: '#f1f1f1', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <Split size={28} color="#c8102e" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#141414' }}>{lang === 'th' ? 'แยกจ่าย (หลายวิธี)' : 'Split Payment'}</div>
                  <div style={{ color: '#141414', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'ระบุจำนวนเงินแต่ละประเภท' : 'Specify amount per method'}</div>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ── Step 3v: Voucher ── */}
        {paymentStep === 'voucher' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#141414', fontWeight: '800' }}>
                <Ticket size={22} color="#c8102e" /> Voucher
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#141414" /></button>
            </div>
            <QrScanner open={vScanOpen} onResult={onVoucherScan} onClose={() => setVScanOpen(false)} title="สแกน QR Voucher" />

            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <p style={{ color: '#454545', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</p>
              <div style={{ fontSize: '2.2rem', fontWeight: '900', color: '#c8102e', lineHeight: 1 }}>฿{grand.toLocaleString()}</div>
            </div>

            <form onSubmit={e => { e.preventDefault(); addVoucher(); }} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
              <label htmlFor="voucher-code" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{lang === 'th' ? 'รหัส Voucher' : 'Voucher code'}</label>
              <input
                id="voucher-code" value={voucherCode} autoComplete="off" autoFocus
                onChange={e => { setVoucherCode(e.target.value); setVoucherErr(''); }}
                // อ่านตามตำแหน่งปุ่มแป้นอังกฤษ: เครื่องยิง QR/พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทยก็ได้รหัสถูก (รหัส Voucher เป็นอักษรอังกฤษ/ตัวเลขเท่านั้น)
                onKeyDown={e => {
                  if (e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1) return;
                  const ch = scannerChar(e);
                  if (ch && ch !== e.key) { e.preventDefault(); setVoucherCode(v => v + ch); setVoucherErr(''); }
                }}
                placeholder={lang === 'th' ? 'ยิง QR หรือพิมพ์รหัส เช่น VC-AB12-CD34' : 'Scan QR or type code e.g. VC-AB12-CD34'}
                style={{ flex: 1, minWidth: 0, border: '1px solid #d0d0d0', borderRadius: '8px', padding: '10px 12px', fontSize: '1rem' }}
              />
              <button type="button" onClick={() => setVScanOpen(true)} disabled={voucherBusy} aria-label={lang === 'th' ? 'เปิดกล้องสแกน QR' : 'Scan QR with camera'}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid #141414', background: '#fff', color: '#141414', borderRadius: '8px', padding: '0 12px', fontWeight: 800 }}>
                <QrCode size={18} />
              </button>
              <button type="submit" disabled={voucherBusy || !voucherCode.trim()}
                style={{ border: 0, background: '#141414', color: '#fff', borderRadius: '8px', padding: '0 16px', fontWeight: 800, opacity: voucherBusy || !voucherCode.trim() ? 0.5 : 1 }}>
                {voucherBusy ? '…' : (lang === 'th' ? 'เพิ่ม' : 'Add')}
              </button>
            </form>
            <div style={{ fontSize: '0.78rem', color: '#5a5a5a', marginBottom: '0.75rem' }}>
              {lang === 'th' ? 'Voucher กระดาษ: ยิง QR หรือพิมพ์รหัสบนใบ · Voucher ในบัตรสมาชิก LINE: ให้ลูกค้ากด "ใช้ Voucher" แล้วยิง QR' : 'Paper voucher: scan or type the code · LINE member voucher: customer taps "Use voucher", then scan'}
            </div>
            {voucherErr && <div role="alert" style={{ color: '#dc2626', fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>{voucherErr}</div>}

            {vouchers.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', border: '2px solid #f9a8d4', borderRadius: '10px', background: '#fdf2f8', marginBottom: '6px' }}>
                <Ticket size={20} color="#c8102e" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{v.title} <span style={{ color: '#7a0a1c' }}>฿{Number(v.value).toLocaleString()}</span></div>
                  <div style={{ fontSize: '0.78rem', color: '#5a5a5a' }}>{v.code}{v.memberName ? ` · ${v.memberName}` : ''}</div>
                </div>
                <button type="button" onClick={() => removeVoucher(v)} style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 700 }}>{lang === 'th' ? 'เอาออก' : 'Remove'}</button>
              </div>
            ))}

            {vouchers.length > 0 && (
              <div style={{ background: voucherShort <= 0 ? '#f0fdf4' : '#fdf2f4', border: `1px solid ${voucherShort <= 0 ? '#bbf7d0' : '#f5b5bf'}`, borderRadius: '12px', padding: '0.85rem 1rem', margin: '0.75rem 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#454545', fontWeight: 600 }}>
                  <span>{lang === 'th' ? `Voucher ${vouchers.length} ใบ` : `${vouchers.length} voucher(s)`}</span>
                  <span style={{ fontWeight: '800', color: '#141414' }}>฿{voucherTotal.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: '800', color: voucherShort > 0 ? '#c8102e' : '#16a34a' }}>
                  <span>{voucherShort > 0 ? (lang === 'th' ? 'ยังขาด' : 'Remaining') : voucherShort < 0 ? (lang === 'th' ? 'เกิน (ไม่ทอน)' : 'Over (no change)') : (lang === 'th' ? 'ครบพอดี ✓' : 'Exact ✓')}</span>
                  <span>฿{Math.abs(voucherShort).toLocaleString()}</span>
                </div>
              </div>
            )}

            {vouchers.length > 0 && voucherShort <= 0 && (
              <button onClick={() => handleVoucherPay()} className="confirm-btn" style={{ width: '100%', background: '#c8102e', color: '#ffffff', fontWeight: '800' }}>
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {lang === 'th' ? 'ยืนยันชำระด้วย Voucher' : 'Confirm Voucher Payment'}
              </button>
            )}
            {vouchers.length > 0 && voucherShort > 0 && (
              <>
                <p style={{ fontWeight: 800, color: '#141414', margin: '0 0 0.5rem' }}>{lang === 'th' ? `จ่ายส่วนที่เหลือ ฿${voucherShort.toLocaleString()} ด้วย` : `Pay the remaining ฿${voucherShort.toLocaleString()} by`}</p>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button onClick={() => handleVoucherPay('transfer')} className="confirm-btn" style={{ flex: 1, background: '#141414', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Smartphone size={18} /> {lang === 'th' ? 'เงินโอน / QR' : 'Transfer / QR'}
                  </button>
                  <button onClick={() => handleVoucherPay('card')} className="confirm-btn" style={{ flex: 1, background: '#a50d25', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <CreditCard size={18} /> {lang === 'th' ? 'บัตรเครดิต/เดบิต' : 'Card'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Step 3d: แยกจ่าย ── */}
        {paymentStep === 'split' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#141414', fontWeight: '800' }}>
                <Split size={22} color="#c8102e" /> {lang === 'th' ? 'แยกจ่าย' : 'Split Payment'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#141414" /></button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <p style={{ color: '#454545', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</p>
              <div style={{ fontSize: '2.2rem', fontWeight: '900', color: '#c8102e', lineHeight: 1 }}>฿{grand.toLocaleString()}</div>
            </div>

            {[
              { key: 'transfer', label: lang === 'th' ? 'เงินโอน / QR' : 'Transfer / QR', icon: <Smartphone size={20} color="#141414" />, color: '#141414', val: splitTransfer, set: setSplitTransfer },
              { key: 'card', label: lang === 'th' ? 'บัตรเครดิต' : 'Card', icon: <CreditCard size={20} color="#a50d25" />, color: '#a50d25', val: splitCard, set: setSplitCard },
            ].map(row => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '130px' }}>
                  <div style={{ background: `${row.color}15`, borderRadius: '50%', padding: '0.4rem', display: 'flex' }}>{row.icon}</div>
                  <span style={{ fontWeight: '700', fontSize: '0.92rem', color: '#141414' }}>{row.label}</span>
                </div>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#5a5a5a', fontWeight: '700' }}>฿</span>
                  <input
                    type="number" min="0" step="1" placeholder="0"
                    value={row.val} onChange={e => row.set(e.target.value)}
                    style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 1.6rem', background: '#ffffff', border: `2px solid #d0d0d0`, borderRadius: '10px', color: '#141414', fontSize: '1.15rem', fontWeight: '800', textAlign: 'right', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={() => row.set(String(Math.max(0, splitRemaining + (parseFloat(row.val) || 0))))}
                  title={lang === 'th' ? 'เติมส่วนที่เหลือ' : 'Fill remaining'}
                  style={{ background: `${row.color}15`, border: `1px solid ${row.color}44`, borderRadius: '8px', color: row.color, cursor: 'pointer', padding: '0.5rem 0.6rem', fontSize: '0.78rem', fontWeight: '800', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  {lang === 'th' ? 'ที่เหลือ' : 'Rest'}
                </button>
              </div>
            ))}

            <div style={{
              background: splitRemaining === 0 ? '#f0fdf4' : '#f8f8f8',
              border: `1px solid ${splitRemaining === 0 ? '#bbf7d0' : '#e4e4e4'}`,
              borderRadius: '12px', padding: '0.85rem 1rem', margin: '1rem 0 1.25rem',
              display: 'flex', flexDirection: 'column', gap: '0.35rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#454545', fontWeight: 600 }}>
                <span>{lang === 'th' ? 'รวมที่กรอก' : 'Entered'}</span>
                <span style={{ fontWeight: '800', color: '#141414' }}>฿{splitSum.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: '800', color: splitRemaining === 0 ? '#16a34a' : (splitRemaining < 0 ? '#dc2626' : '#c8102e') }}>
                <span>
                  {splitRemaining === 0
                    ? (lang === 'th' ? 'ครบพอดี ✓' : 'Balanced ✓')
                    : splitRemaining > 0
                      ? (lang === 'th' ? 'ยังขาด' : 'Remaining')
                      : (lang === 'th' ? 'เกิน' : 'Over')}
                </span>
                <span>{splitRemaining >= 0 ? `฿${splitRemaining.toLocaleString()}` : `-฿${Math.abs(splitRemaining).toLocaleString()}`}</span>
              </div>
            </div>

            <button
              onClick={handleConfirmSplit}
              disabled={!splitValid}
              className="confirm-btn"
              style={{ width: '100%', background: splitValid ? '#c8102e' : '#e4e4e4', color: splitValid ? '#ffffff' : '#7a7a7a', cursor: splitValid ? 'pointer' : 'not-allowed', opacity: splitValid ? 1 : 0.6, fontWeight: '800' }}
            >
              <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
              {lang === 'th' ? 'ยืนยันการแยกจ่าย' : 'Confirm Split Payment'}
            </button>
            {!splitValid && splitSum > 0 && splitRemaining === 0 && (
              <p style={{ color: '#5a5a5a', fontSize: '0.8rem', textAlign: 'center', marginTop: '0.6rem', fontWeight: 600 }}>
                {lang === 'th' ? 'ต้องระบุอย่างน้อย 2 ประเภท' : 'Select at least 2 methods'}
              </p>
            )}
          </>
        )}

        {/* ── Step 3b: เงินโอน ── */}
        {paymentStep === 'transfer' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#141414', fontWeight: '800' }}>
                <Smartphone size={22} color="#141414" /> {lang === 'th' ? 'เงินโอน / QR Code' : 'Transfer / QR'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep(transferDue !== null ? 'voucher' : 'payment_method')}><ArrowLeft size={22} color="#141414" /></button>
            </div>
            {!qrApproved ? (
              <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                <div style={{ fontSize: '2.75rem', marginBottom: '0.5rem' }}>
                  {approvalStatus === 'rejected' ? '❌' : '⏳'}
                </div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: '#141414', fontWeight: '700' }}>
                  {approvalStatus === 'rejected'
                    ? (lang === 'th' ? 'คำขอถูกปฏิเสธ' : 'Request Rejected')
                    : (lang === 'th' ? 'รอการอนุมัติ' : 'Waiting for Approval')}
                </h3>
                <p style={{ color: '#454545', fontSize: '0.85rem', margin: '0 auto 1.1rem', maxWidth: '330px', fontWeight: '500' }}>
                  {approvalStatus === 'rejected'
                    ? (lang === 'th' ? 'ผู้มีสิทธิ์ปฏิเสธคำขอนี้ กดเพื่อขออนุมัติใหม่อีกครั้ง' : 'The request was rejected. Tap to request approval again.')
                    : (lang === 'th' ? 'ได้ส่งแจ้งเตือนไปยังแอดมิน/แคชเชียร์แล้ว กรุณารอการกดยืนยัน ระบบจะสร้าง QR ให้อัตโนมัติ' : 'Notified admin/cashier. Waiting for confirmation — the QR will appear automatically.')}
                </p>

                <div style={{ background: '#f5f5f5', border: '1px solid #d0d0d0', borderRadius: '12px', padding: '1rem', maxWidth: '320px', margin: '0 auto 1.1rem' }}>
                  <div style={{ color: '#454545', fontSize: '0.8rem', marginBottom: '0.25rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</div>
                  <div style={{ color: '#c8102e', fontWeight: 900, fontSize: '1.8rem' }}>฿{qrAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ color: '#5a5a5a', fontSize: '0.78rem', marginTop: '0.35rem', fontWeight: '600' }}>
                    {lang === 'th' ? 'บิล' : 'Bill'} {orderNumber}{tableNo ? ` · ${lang === 'th' ? 'โต๊ะ' : 'Table'} ${tableNo}` : ''}
                  </div>
                </div>

                {approvalStatus === 'pending' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#141414', fontSize: '0.9rem', fontWeight: 700 }}>
                    <Clock size={18} style={{ animation: 'spin 1.5s linear infinite' }} />
                    {lang === 'th' ? 'กำลังรอผู้มีสิทธิ์กดยืนยัน...' : 'Waiting for approval...'}
                  </div>
                )}

                {approvalStatus === 'rejected' && (
                  <button
                    onClick={requestApproval}
                    className="confirm-btn"
                    style={{ width: '100%', background: '#141414', color: '#ffffff', fontWeight: '800' }}
                  >
                    {lang === 'th' ? 'ขออนุมัติใหม่' : 'Request Again'}
                  </button>
                )}
              </div>
            ) : (
            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', color: '#141414', fontWeight: '800' }}>
                {lang === 'th' ? 'สแกนเพื่อชำระเงิน' : 'Scan to Pay'}
              </h3>
              {approverName && (
                <p style={{ color: '#16a34a', fontSize: '0.8rem', margin: '0 0 0.25rem', fontWeight: '700' }}>
                  ✓ {lang === 'th' ? `อนุมัติโดย ${approverName}` : `Approved by ${approverName}`}
                </p>
              )}
              <p style={{ color: '#454545', fontSize: '0.85rem', margin: '0 0 0.85rem', fontWeight: '600' }}>
                {lang === 'th' ? 'พร้อมเพย์ (PromptPay) — รองรับทุกแอปธนาคาร' : 'PromptPay — works with any Thai banking app'}
              </p>

              {/* PromptPay QR card */}
              <div style={{ background: '#ffffff', border: '1px solid #d0d0d0', borderRadius: '16px', padding: '1rem 1rem 1.25rem', maxWidth: '320px', margin: '0 auto 1rem', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#003d6a', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '0.5px' }}>THAI QR PAYMENT</span>
                </div>
                <div style={{ background: '#003d6a', color: 'white', fontWeight: 800, fontSize: '0.9rem', borderRadius: '8px', padding: '0.35rem', marginBottom: '0.85rem' }}>
                  PromptPay
                </div>
                {qrType === 'static' ? (
                  <img src={staticQrUrl} alt="K Shop QR" style={{ width: '100%', maxWidth: '260px', display: 'block', margin: '0 auto' }} />
                ) : qrAmount <= 0 ? (
                  <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#166534', fontWeight: 800, textAlign: 'center' }}>
                    {lang === 'th' ? 'ยอด ฿0 — ไม่ต้องโอน กดยืนยันได้เลย' : 'Nothing to pay — just confirm'}
                  </div>
                ) : qrDataUrl ? (
                  <img src={qrDataUrl} alt="PromptPay QR" style={{ width: '100%', maxWidth: '260px', display: 'block', margin: '0 auto' }} />
                ) : (
                  <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                    {lang === 'th' ? 'กำลังสร้าง QR...' : 'Generating QR...'}
                  </div>
                )}
                <div style={{ color: '#003d6a', marginTop: '0.65rem' }}>
                  <div style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                    {qrType === 'static' ? (
                      (lang === 'th' ? 'สแกน QR ร้านค้าด้านบน' : 'Scan merchant QR above')
                    ) : qrType === 'kshop_dynamic' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'center', color: '#003d6a', fontWeight: '700' }}>
                        <div style={{ fontSize: '0.85rem', textTransform: 'uppercase' }}>
                          {qrShopName}
                        </div>
                        <div style={{ fontWeight: 'normal', opacity: 0.9 }}>
                          บัญชี: {qrAccountName}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 'normal', opacity: 0.7 }}>
                          เลขอ้างอิง: {parseKShopPayload(kshopRawPayload)?.ref2 || 'KPS004KB000001641684'}
                        </div>
                      </div>
                    ) : (
                      (lang === 'th' ? 'พร้อมเพย์ ID' : 'PromptPay ID') + ': ' + promptPayId
                    )}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, marginTop: '0.15rem' }}>฿{qrAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              <p style={{ color: '#454545', fontSize: '0.88rem', marginBottom: '1rem', fontWeight: '600' }}>
                {lang === 'th' ? 'บิลเลขที่:' : 'Bill No:'} <strong style={{ color: '#c8102e' }}>{orderNumber}</strong>
              </p>
              <button onClick={() => (transferDue !== null ? setPaymentStep('success') : handleConfirmPayment('เงินโอน'))} className="confirm-btn" style={{ background: '#141414', color: '#ffffff', width: '100%', fontWeight: '800' }}>
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {lang === 'th' ? 'ยืนยันรับเงินโอนแล้ว' : 'Confirm Transfer Received'}
              </button>
            </div>
            )}
          </>
        )}

        {/* ── Step 3c: บัตรเครดิต ── */}
        {paymentStep === 'card' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#141414', fontWeight: '800' }}>
                <CreditCard size={22} color="#a50d25" /> {lang === 'th' ? 'บัตรเครดิต / เดบิต' : 'Card Payment'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#141414" /></button>
            </div>
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>💳</div>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '0.75rem', color: '#141414', fontWeight: '800' }}>
                {lang === 'th' ? 'กรุณารูดบัตรที่เคาน์เตอร์' : 'Swipe Card at Counter'}
              </h3>
              <div style={{ background: '#fdf2f4', border: '1px solid #f5b5bf', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
                <p style={{ color: '#7a0a1c', fontWeight: '700', margin: '0 0 0.35rem' }}>{lang === 'th' ? '💳 เครื่อง EDC ที่เคาน์เตอร์' : '💳 EDC Machine at Counter'}</p>
                <p style={{ color: '#8e0b20', fontSize: '0.85rem', margin: 0, fontWeight: '600' }}>{lang === 'th' ? 'นำบัตรไปรูดที่พนักงานแคชเชียร์' : 'Present card to the cashier'}</p>
              </div>
              <PriceBreakdown compact />
              <p style={{ color: '#454545', fontSize: '0.88rem', marginBottom: '1.25rem', fontWeight: '600' }}>
                {lang === 'th' ? 'บิลเลขที่:' : 'Bill No:'} <strong style={{ color: '#c8102e' }}>{orderNumber}</strong>
              </p>
              <button onClick={() => handleConfirmPayment('บัตรเครดิต')} className="confirm-btn" style={{ background: '#a50d25', color: '#ffffff', width: '100%', fontWeight: '800' }}>
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {lang === 'th' ? 'ยืนยันรับชำระบัตรแล้ว' : 'Confirm Card Payment Done'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Success + พรีวิวใบเสร็จ ── */}
        {paymentStep === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle size={48} color="#16a34a" style={{ margin: '0 auto 0.5rem' }} />
            <h3 style={{ color: '#16a34a', margin: '0 0 0.25rem', fontWeight: '800' }}>{lang === 'th' ? 'ชำระเงินสำเร็จ!' : 'Payment Successful!'}</h3>
            <p style={{ color: '#454545', fontSize: '0.85rem', margin: '0 0 1rem', fontWeight: '600' }}>
              {lang === 'th' ? 'พรีวิวใบเสร็จ (80mm)' : 'Receipt preview (80mm)'}
            </p>

            <div style={{ background: 'white', borderRadius: '8px', width: '302px', maxWidth: '100%', margin: '0 auto 1.25rem', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', textAlign: 'left', overflow: 'hidden', border: '1px solid #d0d0d0' }}>
              <style>{scopedSlipCss('.slip-body')}</style>
              <div className="slip-body" dangerouslySetInnerHTML={{ __html: buildReceiptHtml('(ออกเลขเมื่อบันทึกบิล)') }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => finalizeComplete(true)}
                style={{ flex: 1, padding: '0.85rem', background: '#f5f5f5', border: '1.5px solid #d0d0d0', borderRadius: '12px', color: '#141414', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <Printer size={18} /> {lang === 'th' ? 'พิมพ์ใบเสร็จ' : 'Print'}
              </button>
              <button
                onClick={() => finalizeComplete(false)}
                className="confirm-btn"
                style={{ flex: 1.4, background: '#16a34a', color: '#ffffff', fontWeight: '800' }}
              >
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {lang === 'th' ? 'เสร็จสิ้น' : 'Done'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default CheckoutModal;
