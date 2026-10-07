import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, CheckCircle, ArrowLeft, CreditCard, Banknote, Smartphone, Tag, ChevronRight, Split, Clock, Camera, Upload, Printer } from 'lucide-react';
import { generatePromptPayPayload, generateDynamicQRFromRaw, parseKShopPayload } from '../utils/promptpay';
import { scopedSlipCss } from '../utils/print80mm';
import { API_URL } from '../utils/api';
import { getReceiptHeader } from '../utils/printServer';

const calcCharges = (subtotal, settings = {}, discount = null) => {
  let discountAmount = 0;
  if (discount) {
    if (discount.type === 'baht') {
      discountAmount = Math.min(Number(discount.value) || 0, subtotal);
    } else if (discount.type === 'percent') {
      discountAmount = Math.round(subtotal * (Number(discount.value) || 0)) / 100;
    }
  }
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
  settings = {}, discounts = [], categories = [], initialDiscount = null
}) => {
  // ส่วนลดเก็บเป็น "รหัสหมวดหมู่" (HL#####) ซึ่งอ่านไม่รู้เรื่องถ้าโชว์ดิบ ๆ
  // แปลงเป็นชื่อหมวดให้แคชเชียร์อ่านออกก่อนแสดง
  const categoryLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug;
  const [paymentStep, setPaymentStep] = useState('summary');
  const [cashInput, setCashInput] = useState('');
  // รับส่วนลดที่เลือกมาจากหน้าขายเป็นค่าตั้งต้น พนักงานจะได้ไม่ต้องเลือกซ้ำ
  const [selectedDiscount, setSelectedDiscount] = useState(initialDiscount);

  const [qrApproved, setQrApproved] = useState(true);
  const [approverName] = useState('');
  const [approvalId] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('approved');

  const [slipPreview, setSlipPreview] = useState('');
  const [slipUploading, setSlipUploading] = useState(false);
  const [pendingComplete, setPendingComplete] = useState(null);
  const billNo = String(orderNumber || '').replace(/[^0-9A-Za-z]/g, '') || ('bill-' + Date.now());

  const fileToResizedDataUrl = (file, maxDim = 1280, quality = 0.72) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSlipFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { setSlipPreview(await fileToResizedDataUrl(file)); } catch (err) {}
  };

  const uploadSlip = async (dataUrl) => {
    const base64 = String(dataUrl).split(',')[1];
    if (!base64) return;
    await fetch(API_URL, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'uploadSlip', base64, mimeType: 'image/jpeg', filename: `${billNo}.jpg` })
    });
  };

  const finishWithSlip = async (skip = false) => {
    if (!skip && slipPreview) {
      setSlipUploading(true);
      try { await uploadSlip(slipPreview); } catch (e) {}
      setSlipUploading(false);
    }
    setPaymentStep('success');
  };

  const [splitCash, setSplitCash] = useState('');
  const [splitTransfer, setSplitTransfer] = useState('');
  const [splitCard, setSplitCard] = useState('');

  const { subtotal, discountAmount, sc, vat, grand } = calcCharges(total, settings, selectedDiscount);
  const hasCharges = sc > 0 || vat > 0;
  const hasDiscount = discountAmount > 0;

  const cashAmount = parseFloat(cashInput) || 0;
  const change = cashAmount - grand;

  const promptPayId = settings?.promptPayId || '004000001641684';
  const qrType = settings?.qrType || 'kshop_dynamic';
  const staticQrUrl = settings?.staticQrUrl || '/kshop_qr.png';
  const [qrDataUrl, setQrDataUrl] = useState('');

  const kshopRawPayload = settings?.kshopRawPayload || '00020101021130810016A00000067701011201150107536000315080214KB0000016416840320KPS004KB00000164168431690016A00000067701011301030040214KB0000016416840420KPS004KB00000164168453037645802TH6304A14E';
  const qrShopName = settings?.qrShopName || 'เสน่ห์';
  const qrAccountName = settings?.qrAccountName || 'เสน่ห์';

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
    if (!isDynamic || paymentStep !== 'transfer' || grand <= 0) { setQrDataUrl(''); return; }
    let cancelled = false;

    let payload = '';
    if (qrType === 'kshop_dynamic') {
      payload = generateDynamicQRFromRaw(kshopRawPayload, grand);
    } else {
      payload = generatePromptPayPayload(promptPayId, grand);
    }

    if (payload) {
      QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(url => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(''); });
    } else {
      setQrDataUrl('');
    }
    return () => { cancelled = true; };
  }, [paymentStep, grand, promptPayId, qrType, kshopRawPayload]);

  const splitCashN = parseFloat(splitCash) || 0;
  const splitTransferN = parseFloat(splitTransfer) || 0;
  const splitCardN = parseFloat(splitCard) || 0;
  const splitSum = Math.round((splitCashN + splitTransferN + splitCardN) * 100) / 100;
  const splitRemaining = Math.round((grand - splitSum) * 100) / 100;
  const splitValid = splitRemaining === 0 && splitSum > 0 && [splitCashN, splitTransferN, splitCardN].filter(v => v > 0).length >= 2;

  const handleConfirmPayment = (method) => {
    if (method === 'เงินโอน') {
      setPendingComplete({ method: 'เงินโอน' });
      setSlipPreview('');
      setPaymentStep('slip');
    } else {
      setPendingComplete({ method });
      setPaymentStep('success');
    }
  };

  const handleConfirmSplit = () => {
    if (!splitValid) return;
    const details = { cash: splitCashN, transfer: splitTransferN, card: splitCardN };
    setPendingComplete({ method: 'แยกจ่าย', details });
    if (splitTransferN > 0) {
      setSlipPreview('');
      setPaymentStep('slip');
    } else {
      setPaymentStep('success');
    }
  };

  const paidMethod = pendingComplete?.method || '';
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
      const name = it.ItemName || '';
      const opt = it.Options ? `<div class="opt">${it.Options}</div>` : '';
      return `<div class="it"><div class="row"><span>${qty}× ${name}</span><span>฿${price.toLocaleString()}${isAbb ? ' V' : ''}</span></div>${opt}</div>`;
    }).join('');
    const line = (k, v, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`;
    const rate = Number(h.vatRate) > 0 ? Number(h.vatRate) : 7;
    const vatable = Math.round(grand * 100 / (100 + rate) * 100) / 100;
    const m2 = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const headLines = [
      ...esc(h.address).split(/\r?\n/).map(x => x.trim()).filter(Boolean),
      h.phone ? `โทร ${esc(h.phone)}` : '',
      isAbb ? `เลขผู้เสียภาษี ${esc(h.taxId)}` : '',
      isAbb && esc(h.posId) ? `POS ID: ${esc(h.posId)}` : ''
    ].filter(Boolean).map(x => `<div class="c sm">${x}</div>`).join('');
    return `
      <div class="c xl">${esc(h.name) || 'เสน่ห์'}</div>
      ${headLines}
      <div class="c sm">${isAbb ? 'ใบกำกับภาษีอย่างย่อ / TAX INV (ABB)' : 'ใบเสร็จรับเงิน / RECEIPT'}</div>
      <div class="hr"></div>
      ${line(isAbb ? 'เลขที่' : 'บิลเลขที่', no || '-')}
      ${tableNo ? line('โต๊ะ', tableNo) : ''}
      ${line('วันที่', now)}
      ${paidMethod ? line('ชำระโดย', paidMethod) : ''}
      <div class="hr"></div>
      ${rows}
      <div class="hr"></div>
      ${(hasDiscount || hasCharges) ? line('ยอดอาหาร', `฿${subtotal.toLocaleString()}`) : ''}
      ${hasDiscount ? line(`ส่วนลด ${selectedDiscount?.name || ''}`, `-฿${discountAmount.toLocaleString()}`) : ''}
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
    const pc = pendingComplete || { method: 'เงินสด' };
    onComplete(grand, pc.method, pc.details, { print, receiptOrder: buildReceiptOrder(), buildReceiptHtml });
  };

  const PriceBreakdown = ({ compact = false }) => (
    <div style={{
      background: '#f8fafc', border: '1px solid #e2e8f0',
      borderRadius: '12px', padding: compact ? '0.85rem 1rem' : '1rem 1.25rem',
      marginBottom: compact ? '0.75rem' : '1.5rem'
    }}>
      {!compact && (
        <h4 style={{ marginBottom: '0.75rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '700' }}>
          {lang === 'th' ? 'สรุปรายการ' : 'Order Summary'}
        </h4>
      )}
      {!compact && tableOrderItems.map((item, idx) => {
        const itemSubtotal = (Number(item.ItemPrice) || 0) * (Number(item.Quantity) || 1);
        return (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.92rem', marginBottom: '0.45rem', color: '#0f172a' }}>
            <div>
              <span style={{ fontWeight: '800', color: '#ea580c', marginRight: '6px' }}>{Number(item.Quantity) || 1}×</span>
              <span style={{ fontWeight: '700' }}>{lang === 'th' ? item.ItemName : (item.ItemNameEn || item.ItemName)}</span>
              {item.Options && (
                <div style={{ fontSize: '0.78rem', color: '#475569', paddingLeft: '1.5rem', fontWeight: 500 }}>{item.Options}</div>
              )}
            </div>
            <span style={{ fontWeight: '800' }}>฿{itemSubtotal.toLocaleString()}</span>
          </div>
        );
      })}

      <div style={{
        borderTop: '1px solid #cbd5e1',
        marginTop: compact ? 0 : '0.75rem', paddingTop: '0.6rem',
        display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem'
      }}>
        {(hasDiscount || hasCharges) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontWeight: '600' }}>
            <span>{lang === 'th' ? 'ยอดอาหาร' : 'Subtotal'}</span>
            <span style={{ color: '#0f172a', fontWeight: '700' }}>฿{subtotal.toLocaleString()}</span>
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
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '1.15rem',
          borderTop: (hasDiscount || hasCharges) ? '1px solid #cbd5e1' : 'none',
          paddingTop: (hasDiscount || hasCharges) ? '0.45rem' : 0
        }}>
          <span style={{ color: '#0f172a' }}>{lang === 'th' ? 'รวมทั้งสิ้น' : 'Grand Total'}</span>
          <span style={{ color: '#ea580c', fontSize: '1.35rem', fontWeight: '900' }}>฿{grand.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={paymentStep !== 'success' ? onClose : undefined}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: '20px', color: '#0f172a', maxHeight: '92vh', overflowY: 'auto', border: '1px solid #e2e8f0', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>

        {/* ── Step 1: Summary ── */}
        {paymentStep === 'summary' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#0f172a', fontWeight: '800' }}>{lang === 'th' ? 'สรุปบิล' : 'Bill Summary'}</h2>
              <button className="close-btn" onClick={onClose}><X size={24} color="#0f172a" /></button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
              <PriceBreakdown />
            </div>
            <button
              onClick={() => setPaymentStep('discount')}
              className="confirm-btn"
              style={{ width: '100%', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#ffffff', fontWeight: '800' }}
            >
              {lang === 'th' ? `ดำเนินการชำระเงิน ฿${grand.toLocaleString()}` : `Proceed to Payment ฿${grand.toLocaleString()}`}
              <ChevronRight size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '6px' }} />
            </button>
          </>
        )}

        {/* ── Step 1.5: เลือกส่วนลด ── */}
        {paymentStep === 'discount' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <Tag size={20} color="#ea580c" />
                {lang === 'th' ? 'เลือกส่วนลด' : 'Select Discount'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('summary')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>

            {/* ยอดปัจจุบัน */}
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: '10px', padding: '0.7rem 1rem', marginBottom: '1.25rem',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span style={{ color: '#475569', fontSize: '0.9rem', fontWeight: '600' }}>
                {lang === 'th' ? 'ยอดอาหาร' : 'Subtotal'}
              </span>
              <span style={{ fontWeight: '800', fontSize: '1.2rem', color: '#0f172a' }}>
                ฿{subtotal.toLocaleString()}
              </span>
            </div>

            {/* ไม่ใช้ส่วนลด */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
              <button
                onClick={() => setSelectedDiscount(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.9rem 1.1rem', borderRadius: '12px', cursor: 'pointer',
                  border: `2px solid ${selectedDiscount === null ? '#0f172a' : '#cbd5e1'}`,
                  background: selectedDiscount === null ? '#f1f5f9' : '#ffffff',
                  color: '#0f172a', fontFamily: 'inherit', transition: 'all 0.15s', width: '100%', textAlign: 'left'
                }}
              >
                <span style={{ fontWeight: '700', fontSize: '0.95rem', color: '#0f172a' }}>
                  {lang === 'th' ? '❌ ไม่ใช้ส่วนลด' : '❌ No Discount'}
                </span>
                {selectedDiscount === null && (
                  <CheckCircle size={18} color="#16a34a" />
                )}
              </button>

              {discounts.length === 0 ? (
                <div style={{
                  textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.88rem', fontWeight: '600',
                  border: '1px dashed #cbd5e1', borderRadius: '10px', background: '#f8fafc'
                }}>
                  {lang === 'th' ? 'ยังไม่มีส่วนลด (ตั้งค่าได้ที่ Admin → ส่วนลด)' : 'No discounts configured (Admin → Discounts)'}
                </div>
              ) : (
                discounts.map(d => {
                  const isSelected = selectedDiscount?.id === d.id;
                  const previewAmount = d.type === 'baht'
                    ? Math.min(Number(d.value), subtotal)
                    : Math.round(subtotal * Number(d.value)) / 100;
                  const previewGrand = subtotal - previewAmount;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDiscount(isSelected ? null : d)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.9rem 1.1rem', borderRadius: '12px', cursor: 'pointer',
                        border: `2px solid ${isSelected ? '#ef4444' : '#cbd5e1'}`,
                        background: isSelected ? '#fef2f2' : '#ffffff',
                        color: '#0f172a', fontFamily: 'inherit', transition: 'all 0.15s', width: '100%', textAlign: 'left'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <Tag size={15} color="#ef4444" />
                          <span style={{ fontWeight: '700', fontSize: '0.97rem', color: '#0f172a' }}>{d.name}</span>
                          <span style={{
                            padding: '1px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '700',
                            background: d.type === 'baht' ? '#dcfce7' : '#dbeafe',
                            color: d.type === 'baht' ? '#15803d' : '#1d4ed8'
                          }}>
                            {d.type === 'baht' ? `-฿${Number(d.value).toLocaleString()}` : `-${d.value}%`}
                          </span>
                        </div>
                        {d.categories && d.categories.length > 0 && (
                          <div style={{ fontSize: '0.78rem', color: '#475569', paddingLeft: '23px', fontWeight: '500' }}>
                            {lang === 'th' ? 'ใช้กับ: ' : 'Applies to: '}
                            {d.categories.map(categoryLabel).join(', ')}
                          </div>
                        )}
                        <div style={{ fontSize: '0.82rem', color: '#64748b', paddingLeft: '23px', marginTop: '2px', fontWeight: '500' }}>
                          {lang === 'th' ? 'ประหยัด ' : 'Save '}
                          <strong style={{ color: '#ef4444' }}>฿{previewAmount.toLocaleString()}</strong>
                          {lang === 'th' ? '  →  ยอดสุทธิ ' : '  →  Net '}
                          <strong style={{ color: '#ea580c' }}>฿{previewGrand.toLocaleString()}</strong>
                        </div>
                      </div>
                      {isSelected && <CheckCircle size={20} color="#ef4444" style={{ flexShrink: 0, marginLeft: '0.5rem' }} />}
                    </button>
                  );
                })
              )}
            </div>

            {/* ยอดหลังลด preview */}
            {hasDiscount && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.25rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <span style={{ color: '#dc2626', fontWeight: '700', fontSize: '0.9rem' }}>
                  {lang === 'th' ? `ส่วนลด: ${selectedDiscount.name}` : `Discount: ${selectedDiscount.name}`}
                </span>
                <span style={{ color: '#dc2626', fontWeight: '800', fontSize: '1.1rem' }}>
                  -฿{discountAmount.toLocaleString()}
                </span>
              </div>
            )}

            <button
              onClick={() => setPaymentStep('payment_method')}
              className="confirm-btn"
              style={{ width: '100%', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#ffffff', fontWeight: '800' }}
            >
              {lang === 'th'
                ? `ชำระเงิน ฿${grand.toLocaleString()}`
                : `Pay ฿${grand.toLocaleString()}`}
              <ChevronRight size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '6px' }} />
            </button>
          </>
        )}

        {/* ── Step 2: Payment Method ── */}
        {paymentStep === 'payment_method' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#0f172a', fontWeight: '800' }}>{lang === 'th' ? 'วิธีชำระเงิน' : 'Payment Method'}</h2>
              <button className="close-btn" onClick={() => setPaymentStep('discount')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>

            <PriceBreakdown compact />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* เงินสด */}
              <button
                onClick={() => setPaymentStep('cash')}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#f0fdf4', border: '2px solid #bbf7d0', borderRadius: '14px', padding: '1rem 1.25rem', color: '#0f172a', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#dcfce7'}
                onMouseOut={e => e.currentTarget.style.background = '#f0fdf4'}
              >
                <div style={{ background: '#dcfce7', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <Banknote size={28} color="#16a34a" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#166534' }}>{lang === 'th' ? 'เงินสด' : 'Cash'}</div>
                  <div style={{ color: '#15803d', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'รับเงินสดและทอนเงิน' : 'Accept cash & calculate change'}</div>
                </div>
              </button>

              {/* เงินโอน */}
              <button
                onClick={() => setPaymentStep('transfer')}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#eff6ff', border: '2px solid #bfdbfe', borderRadius: '14px', padding: '1rem 1.25rem', color: '#0f172a', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#dbeafe'}
                onMouseOut={e => e.currentTarget.style.background = '#eff6ff'}
              >
                <div style={{ background: '#dbeafe', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <Smartphone size={28} color="#2563eb" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#1e40af' }}>{lang === 'th' ? 'เงินโอน / QR Code' : 'Transfer / QR Code'}</div>
                  <div style={{ color: '#1d4ed8', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'สแกน QR ที่เคาน์เตอร์' : 'Scan QR at the counter'}</div>
                </div>
              </button>

              {/* บัตรเครดิต */}
              <button
                onClick={() => setPaymentStep('card')}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fffbeb', border: '2px solid #fef3c7', borderRadius: '14px', padding: '1rem 1.25rem', color: '#0f172a', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#fef3c7'}
                onMouseOut={e => e.currentTarget.style.background = '#fffbeb'}
              >
                <div style={{ background: '#fef3c7', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <CreditCard size={28} color="#d97706" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#b45309' }}>{lang === 'th' ? 'บัตรเครดิต / เดบิต' : 'Credit / Debit Card'}</div>
                  <div style={{ color: '#d97706', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'รูดบัตร EDC ที่เคาน์เตอร์' : 'Swipe card at the counter'}</div>
                </div>
              </button>

              {/* แยกจ่าย */}
              <button
                onClick={() => { setSplitCash(''); setSplitTransfer(''); setSplitCard(''); setPaymentStep('split'); }}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#faf5ff', border: '2px solid #e9d5ff', borderRadius: '14px', padding: '1rem 1.25rem', color: '#0f172a', cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s', fontFamily: 'inherit', width: '100%' }}
                onMouseOver={e => e.currentTarget.style.background = '#f3e8ff'}
                onMouseOut={e => e.currentTarget.style.background = '#faf5ff'}
              >
                <div style={{ background: '#f3e8ff', borderRadius: '50%', padding: '0.6rem', flexShrink: 0 }}>
                  <Split size={28} color="#7c3aed" />
                </div>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '1.05rem', marginBottom: '2px', color: '#6b21a8' }}>{lang === 'th' ? 'แยกจ่าย (หลายวิธี)' : 'Split Payment'}</div>
                  <div style={{ color: '#7e22ce', fontSize: '0.85rem', fontWeight: '600' }}>{lang === 'th' ? 'ระบุจำนวนเงินแต่ละประเภท' : 'Specify amount per method'}</div>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ── Step 3d: แยกจ่าย ── */}
        {paymentStep === 'split' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <Split size={22} color="#7c3aed" /> {lang === 'th' ? 'แยกจ่าย' : 'Split Payment'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</p>
              <div style={{ fontSize: '2.2rem', fontWeight: '900', color: '#ea580c', lineHeight: 1 }}>฿{grand.toLocaleString()}</div>
            </div>

            {[
              { key: 'cash', label: lang === 'th' ? 'เงินสด' : 'Cash', icon: <Banknote size={20} color="#16a34a" />, color: '#16a34a', val: splitCash, set: setSplitCash },
              { key: 'transfer', label: lang === 'th' ? 'เงินโอน / QR' : 'Transfer / QR', icon: <Smartphone size={20} color="#2563eb" />, color: '#2563eb', val: splitTransfer, set: setSplitTransfer },
              { key: 'card', label: lang === 'th' ? 'บัตรเครดิต' : 'Card', icon: <CreditCard size={20} color="#d97706" />, color: '#d97706', val: splitCard, set: setSplitCard },
            ].map(row => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '130px' }}>
                  <div style={{ background: `${row.color}15`, borderRadius: '50%', padding: '0.4rem', display: 'flex' }}>{row.icon}</div>
                  <span style={{ fontWeight: '700', fontSize: '0.92rem', color: '#0f172a' }}>{row.label}</span>
                </div>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: '700' }}>฿</span>
                  <input
                    type="number" min="0" step="1" placeholder="0"
                    value={row.val} onChange={e => row.set(e.target.value)}
                    style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 1.6rem', background: '#ffffff', border: `2px solid #cbd5e1`, borderRadius: '10px', color: '#0f172a', fontSize: '1.15rem', fontWeight: '800', textAlign: 'right', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
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
              background: splitRemaining === 0 ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${splitRemaining === 0 ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '12px', padding: '0.85rem 1rem', margin: '1rem 0 1.25rem',
              display: 'flex', flexDirection: 'column', gap: '0.35rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#475569', fontWeight: 600 }}>
                <span>{lang === 'th' ? 'รวมที่กรอก' : 'Entered'}</span>
                <span style={{ fontWeight: '800', color: '#0f172a' }}>฿{splitSum.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: '800', color: splitRemaining === 0 ? '#16a34a' : (splitRemaining < 0 ? '#dc2626' : '#ea580c') }}>
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
              style={{ width: '100%', background: splitValid ? '#7c3aed' : '#e2e8f0', color: splitValid ? '#ffffff' : '#94a3b8', cursor: splitValid ? 'pointer' : 'not-allowed', opacity: splitValid ? 1 : 0.6, fontWeight: '800' }}
            >
              <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
              {lang === 'th' ? 'ยืนยันการแยกจ่าย' : 'Confirm Split Payment'}
            </button>
            {!splitValid && splitSum > 0 && splitRemaining === 0 && (
              <p style={{ color: '#64748b', fontSize: '0.8rem', textAlign: 'center', marginTop: '0.6rem', fontWeight: 600 }}>
                {lang === 'th' ? 'ต้องระบุอย่างน้อย 2 ประเภท' : 'Select at least 2 methods'}
              </p>
            )}
          </>
        )}

        {/* ── Step 3a: เงินสด ── */}
        {paymentStep === 'cash' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <Banknote size={22} color="#16a34a" /> {lang === 'th' ? 'ชำระด้วยเงินสด' : 'Cash Payment'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</p>
              <div style={{ fontSize: '2.5rem', fontWeight: '900', color: '#ea580c', lineHeight: 1 }}>฿{grand.toLocaleString()}</div>
              {(hasCharges || hasDiscount) && (
                <p style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.3rem', fontWeight: '500' }}>
                  {lang === 'th' ? '(รวมส่วนลดและค่าบริการแล้ว)' : '(incl. discount & charges)'}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ color: '#334155', fontSize: '0.88rem', display: 'block', marginBottom: '0.5rem', fontWeight: '700' }}>
                {lang === 'th' ? 'รับเงินมา (บาท)' : 'Cash Received (THB)'}
              </label>
              <input
                type="number" min={grand} step="1" placeholder={`฿${Math.ceil(grand)}`}
                value={cashInput} onChange={e => setCashInput(e.target.value)} autoFocus
                style={{ width: '100%', padding: '0.85rem 1rem', background: '#ffffff', border: '2px solid #22c55e', borderRadius: '12px', color: '#0f172a', fontSize: '1.5rem', fontWeight: '800', textAlign: 'center', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              {[20, 50, 100, 500, 1000].filter(v => v >= grand || v === Math.ceil(grand / 100) * 100).slice(0, 5).concat(
                [Math.ceil(grand / 100) * 100, Math.ceil(grand / 500) * 500, Math.ceil(grand / 1000) * 1000]
              ).filter((v, i, a) => v >= grand && a.indexOf(v) === i).sort((a, b) => a - b).slice(0, 5).map(amt => (
                <button key={amt} onClick={() => setCashInput(String(amt))}
                  style={{ flex: 1, minWidth: '60px', padding: '0.55rem', background: cashAmount === amt ? '#dcfce7' : '#f1f5f9', border: `2px solid ${cashAmount === amt ? '#22c55e' : '#cbd5e1'}`, borderRadius: '10px', color: '#0f172a', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem', fontFamily: 'inherit' }}>
                  ฿{amt.toLocaleString()}
                </button>
              ))}
            </div>

            {cashInput && (
              <div style={{ background: change >= 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${change >= 0 ? '#bbf7d0' : '#fecaca'}`, borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '700', color: change >= 0 ? '#166534' : '#dc2626' }}>
                  {lang === 'th' ? (change >= 0 ? 'เงินทอน' : 'ไม่พอ!') : (change >= 0 ? 'Change' : 'Insufficient!')}
                </span>
                <span style={{ fontSize: '1.5rem', fontWeight: '900', color: change >= 0 ? '#15803d' : '#dc2626' }}>
                  {change >= 0 ? `฿${change.toLocaleString()}` : `-฿${Math.abs(change).toLocaleString()}`}
                </span>
              </div>
            )}

            <button
              onClick={() => handleConfirmPayment('เงินสด')}
              disabled={cashAmount < grand}
              className="confirm-btn"
              style={{ width: '100%', background: cashAmount >= grand ? '#16a34a' : '#e2e8f0', color: cashAmount >= grand ? '#ffffff' : '#94a3b8', cursor: cashAmount >= grand ? 'pointer' : 'not-allowed', opacity: cashAmount >= grand ? 1 : 0.6, fontWeight: '800' }}
            >
              <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
              {lang === 'th' ? 'ยืนยันรับเงิน' : 'Confirm Cash Received'}
            </button>
          </>
        )}

        {/* ── Step 3b: เงินโอน ── */}
        {paymentStep === 'transfer' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <Smartphone size={22} color="#2563eb" /> {lang === 'th' ? 'เงินโอน / QR Code' : 'Transfer / QR'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>
            {!qrApproved ? (
              <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                <div style={{ fontSize: '2.75rem', marginBottom: '0.5rem' }}>
                  {approvalStatus === 'rejected' ? '❌' : '⏳'}
                </div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: '#0f172a', fontWeight: '700' }}>
                  {approvalStatus === 'rejected'
                    ? (lang === 'th' ? 'คำขอถูกปฏิเสธ' : 'Request Rejected')
                    : (lang === 'th' ? 'รอการอนุมัติ' : 'Waiting for Approval')}
                </h3>
                <p style={{ color: '#475569', fontSize: '0.85rem', margin: '0 auto 1.1rem', maxWidth: '330px', fontWeight: '500' }}>
                  {approvalStatus === 'rejected'
                    ? (lang === 'th' ? 'ผู้มีสิทธิ์ปฏิเสธคำขอนี้ กดเพื่อขออนุมัติใหม่อีกครั้ง' : 'The request was rejected. Tap to request approval again.')
                    : (lang === 'th' ? 'ได้ส่งแจ้งเตือนไปยังแอดมิน/แคชเชียร์แล้ว กรุณารอการกดยืนยัน ระบบจะสร้าง QR ให้อัตโนมัติ' : 'Notified admin/cashier. Waiting for confirmation — the QR will appear automatically.')}
                </p>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '1rem', maxWidth: '320px', margin: '0 auto 1.1rem' }}>
                  <div style={{ color: '#475569', fontSize: '0.8rem', marginBottom: '0.25rem', fontWeight: '600' }}>{lang === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}</div>
                  <div style={{ color: '#ea580c', fontWeight: 900, fontSize: '1.8rem' }}>฿{grand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.35rem', fontWeight: '600' }}>
                    {lang === 'th' ? 'บิล' : 'Bill'} {orderNumber}{tableNo ? ` · ${lang === 'th' ? 'โต๊ะ' : 'Table'} ${tableNo}` : ''}
                  </div>
                </div>

                {approvalStatus === 'pending' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#2563eb', fontSize: '0.9rem', fontWeight: 700 }}>
                    <Clock size={18} style={{ animation: 'spin 1.5s linear infinite' }} />
                    {lang === 'th' ? 'กำลังรอผู้มีสิทธิ์กดยืนยัน...' : 'Waiting for approval...'}
                  </div>
                )}

                {approvalStatus === 'rejected' && (
                  <button
                    onClick={requestApproval}
                    className="confirm-btn"
                    style={{ width: '100%', background: '#2563eb', color: '#ffffff', fontWeight: '800' }}
                  >
                    {lang === 'th' ? 'ขออนุมัติใหม่' : 'Request Again'}
                  </button>
                )}
              </div>
            ) : (
            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', color: '#0f172a', fontWeight: '800' }}>
                {lang === 'th' ? 'สแกนเพื่อชำระเงิน' : 'Scan to Pay'}
              </h3>
              {approverName && (
                <p style={{ color: '#16a34a', fontSize: '0.8rem', margin: '0 0 0.25rem', fontWeight: '700' }}>
                  ✓ {lang === 'th' ? `อนุมัติโดย ${approverName}` : `Approved by ${approverName}`}
                </p>
              )}
              <p style={{ color: '#475569', fontSize: '0.85rem', margin: '0 0 0.85rem', fontWeight: '600' }}>
                {lang === 'th' ? 'พร้อมเพย์ (PromptPay) — รองรับทุกแอปธนาคาร' : 'PromptPay — works with any Thai banking app'}
              </p>

              {/* PromptPay QR card */}
              <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '16px', padding: '1rem 1rem 1.25rem', maxWidth: '320px', margin: '0 auto 1rem', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#003d6a', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '0.5px' }}>THAI QR PAYMENT</span>
                </div>
                <div style={{ background: '#003d6a', color: 'white', fontWeight: 800, fontSize: '0.9rem', borderRadius: '8px', padding: '0.35rem', marginBottom: '0.85rem' }}>
                  PromptPay
                </div>
                {qrType === 'static' ? (
                  <img src={staticQrUrl} alt="K Shop QR" style={{ width: '100%', maxWidth: '260px', display: 'block', margin: '0 auto' }} />
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
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, marginTop: '0.15rem' }}>฿{grand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              <p style={{ color: '#475569', fontSize: '0.88rem', marginBottom: '1rem', fontWeight: '600' }}>
                {lang === 'th' ? 'บิลเลขที่:' : 'Bill No:'} <strong style={{ color: '#ea580c' }}>{orderNumber}</strong>
              </p>
              <button onClick={() => handleConfirmPayment('เงินโอน')} className="confirm-btn" style={{ background: '#2563eb', color: '#ffffff', width: '100%', fontWeight: '800' }}>
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
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <CreditCard size={22} color="#d97706" /> {lang === 'th' ? 'บัตรเครดิต / เดบิต' : 'Card Payment'}
              </h2>
              <button className="close-btn" onClick={() => setPaymentStep('payment_method')}><ArrowLeft size={22} color="#0f172a" /></button>
            </div>
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>💳</div>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '0.75rem', color: '#0f172a', fontWeight: '800' }}>
                {lang === 'th' ? 'กรุณารูดบัตรที่เคาน์เตอร์' : 'Swipe Card at Counter'}
              </h3>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
                <p style={{ color: '#92400e', fontWeight: '700', margin: '0 0 0.35rem' }}>{lang === 'th' ? '💳 เครื่อง EDC ที่เคาน์เตอร์' : '💳 EDC Machine at Counter'}</p>
                <p style={{ color: '#b45309', fontSize: '0.85rem', margin: 0, fontWeight: '600' }}>{lang === 'th' ? 'นำบัตรไปรูดที่พนักงานแคชเชียร์' : 'Present card to the cashier'}</p>
              </div>
              <PriceBreakdown compact />
              <p style={{ color: '#475569', fontSize: '0.88rem', marginBottom: '1.25rem', fontWeight: '600' }}>
                {lang === 'th' ? 'บิลเลขที่:' : 'Bill No:'} <strong style={{ color: '#ea580c' }}>{orderNumber}</strong>
              </p>
              <button onClick={() => handleConfirmPayment('บัตรเครดิต')} className="confirm-btn" style={{ background: '#d97706', color: '#ffffff', width: '100%', fontWeight: '800' }}>
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {lang === 'th' ? 'ยืนยันรับชำระบัตรแล้ว' : 'Confirm Card Payment Done'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3e: แนบสลิปการโอน ── */}
        {paymentStep === 'slip' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontWeight: '800' }}>
                <Camera size={22} color="#2563eb" /> {lang === 'th' ? 'แนบสลิปการโอน' : 'Attach Transfer Slip'}
              </h2>
              <button className="close-btn" onClick={onClose}><X size={24} color="#0f172a" /></button>
            </div>

            <div style={{ textAlign: 'center', padding: '0.25rem 0' }}>
              <p style={{ color: '#475569', fontSize: '0.88rem', margin: '0 0 0.25rem', fontWeight: '600' }}>
                {lang === 'th' ? 'ถ่ายรูปหรืออัปโหลดสลิป แล้วบันทึก' : 'Take a photo or upload the slip, then save'}
              </p>
              <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: '600' }}>
                {lang === 'th' ? 'บิลเลขที่:' : 'Bill No:'} <strong style={{ color: '#ea580c' }}>{orderNumber}</strong>
                {' · '}<span style={{ color: '#ea580c', fontWeight: 800 }}>฿{grand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>

              {slipPreview ? (
                <div style={{ marginBottom: '1rem' }}>
                  <img src={slipPreview} alt="slip" style={{ maxWidth: '100%', maxHeight: '320px', borderRadius: '12px', border: '1px solid #cbd5e1' }} />
                </div>
              ) : (
                <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '2rem 1rem', marginBottom: '1rem', color: '#64748b', fontSize: '0.9rem', fontWeight: '600' }}>
                  {lang === 'th' ? 'ยังไม่ได้เลือกรูปสลิป' : 'No slip selected yet'}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem', background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '12px', color: '#2563eb', fontWeight: 800, cursor: 'pointer' }}>
                  <Camera size={18} /> {lang === 'th' ? 'ถ่ายรูป' : 'Camera'}
                  <input type="file" accept="image/*" capture="environment" onChange={handleSlipFile} style={{ display: 'none' }} />
                </label>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem', background: '#f1f5f9', border: '1.5px solid #cbd5e1', borderRadius: '12px', color: '#0f172a', fontWeight: 800, cursor: 'pointer' }}>
                  <Upload size={18} /> {lang === 'th' ? 'อัปโหลดไฟล์' : 'Upload'}
                  <input type="file" accept="image/*" onChange={handleSlipFile} style={{ display: 'none' }} />
                </label>
              </div>

              <button
                onClick={() => finishWithSlip(false)}
                disabled={!slipPreview || slipUploading}
                className="confirm-btn"
                style={{ width: '100%', background: (slipPreview && !slipUploading) ? '#16a34a' : '#e2e8f0', color: (slipPreview && !slipUploading) ? '#ffffff' : '#94a3b8', cursor: (slipPreview && !slipUploading) ? 'pointer' : 'not-allowed', opacity: (slipPreview && !slipUploading) ? 1 : 0.6, fontWeight: '800' }}
              >
                <CheckCircle size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {slipUploading ? (lang === 'th' ? 'กำลังอัปโหลด...' : 'Uploading...') : (lang === 'th' ? 'บันทึกสลิปและเสร็จสิ้น' : 'Save Slip & Finish')}
              </button>
              <button
                onClick={() => finishWithSlip(true)}
                disabled={slipUploading}
                style={{ width: '100%', marginTop: '0.6rem', padding: '0.6rem', background: 'none', border: 'none', color: '#64748b', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontWeight: '600' }}
              >
                {lang === 'th' ? 'ข้ามไปก่อน (ไม่แนบสลิป)' : 'Skip (no slip)'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Success + พรีวิวใบเสร็จ ── */}
        {paymentStep === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle size={48} color="#16a34a" style={{ margin: '0 auto 0.5rem' }} />
            <h3 style={{ color: '#16a34a', margin: '0 0 0.25rem', fontWeight: '800' }}>{lang === 'th' ? 'ชำระเงินสำเร็จ!' : 'Payment Successful!'}</h3>
            <p style={{ color: '#475569', fontSize: '0.85rem', margin: '0 0 1rem', fontWeight: '600' }}>
              {lang === 'th' ? 'พรีวิวใบเสร็จ (80mm)' : 'Receipt preview (80mm)'}
            </p>

            <div style={{ background: 'white', borderRadius: '8px', width: '302px', maxWidth: '100%', margin: '0 auto 1.25rem', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', textAlign: 'left', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
              <style>{scopedSlipCss('.slip-body')}</style>
              <div className="slip-body" dangerouslySetInnerHTML={{ __html: buildReceiptHtml('(ออกเลขเมื่อบันทึกบิล)') }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => finalizeComplete(true)}
                style={{ flex: 1, padding: '0.85rem', background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '12px', color: '#2563eb', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
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
