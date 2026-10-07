import React, { useState, useCallback } from 'react';
import { BarChart2, TrendingUp, Receipt, XCircle, Clock, RefreshCw, Download, FileText, List } from 'lucide-react';
import { API_URL } from '../../utils/api';
import TaxInvoiceModal from './TaxInvoiceModal';
import { getReceiptHeader } from '../../utils/printServer';
import { vatSplit } from '../../utils/dailyClosePrint';

const TABS = [
  { key: 'daily',   label: 'สรุปประจำวัน',       icon: <TrendingUp size={15} /> },
  { key: 'history', label: 'รายงานยอดขาย',       icon: <Receipt   size={15} /> },
  { key: 'vat',     label: 'รายงานภาษีขาย',      icon: <FileText  size={15} /> },
  { key: 'detail',  label: 'รายละเอียดการขาย',   icon: <List      size={15} /> },
  { key: 'income',  label: 'รายรับ-รายจ่าย',   icon: <TrendingUp size={15} /> },
  { key: 'menu',    label: 'ยอดขายตามเมนู',      icon: <BarChart2  size={15} /> },
  { key: 'cancel',  label: 'ประวัติการยกเลิก',    icon: <XCircle   size={15} /> },
  { key: 'shift',   label: 'รายงานปิดกะ',         icon: <Clock     size={15} /> },
];

// splitDetail ถูกเก็บในชีตเป็น JSON string — แปลงกลับเป็น object ก่อนใช้แยกประเภทเงิน
const parseSplitDetail = (sd) => {
  if (!sd) return null;
  if (typeof sd === 'object') return sd;
  try { return JSON.parse(sd); } catch { return null; }
};

const TODAY = new Date().toISOString().slice(0, 10);
const D7    = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

const PRESETS = [
  { label: 'วันนี้',  from: TODAY, to: TODAY },
  { label: '7 วัน',   from: D7,    to: TODAY },
  { label: '30 วัน',  from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: TODAY },
  { label: 'เดือนนี้', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: TODAY },
];

const fmt  = (n) => (Number(n) || 0).toLocaleString('th-TH');
const fmtD = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(ts); }
};
const dayStr = (ts) => {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return String(ts); }
};

const parseItemQty = (detail) => {
  const s = String(detail).trim();
  let qty = 1;
  let name = s;
  
  const match = s.match(/(.*?)\s*[([]\s*x?\s*(\d+)\s*[)\]]$/i) ||
                s.match(/(.*?)\s*[xX*×]\s*(\d+)$/);
                
  if (match) {
    name = match[1].trim();
    qty = parseInt(match[2], 10) || 1;
  }
  return { name, qty };
};

// ─── CSV export helper (ไม่ต้องใช้ library — Excel เปิดได้) ─
const esc = (v) => {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCSV = (headers, rows, filename) => {
  const BOM = '﻿'; // UTF-8 BOM — ทำให้ Excel แสดงภาษาไทยถูกต้อง
  const csv = BOM + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename + '.csv'; a.click();
  URL.revokeObjectURL(url);
};

// Export หลาย sheet → หลายไฟล์ CSV (zip ไม่ใช้ library จึง export แยกทีละไฟล์)
const exportXLSX = (sheets, filenameBase) => {
  if (sheets.length === 1) {
    downloadCSV(sheets[0].headers, sheets[0].rows, filenameBase + '_' + sheets[0].name);
    return;
  }
  // Export ทีละ sheet
  sheets.forEach(({ name, headers, rows }) => {
    downloadCSV(headers, rows, filenameBase + '_' + name);
  });
};

// ─── Styles ─────────────────────────────────────────────────
const card   = { background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem 1.25rem' };
const th_    = { padding: '0.65rem 0.9rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem', borderBottom: '1px solid rgba(0,0,0,0.08)', whiteSpace: 'nowrap' };
const td_    = { padding: '0.65rem 0.9rem', fontSize: '0.875rem', borderBottom: '1px solid rgba(0,0,0,0.04)' };

const branchOf = (u) => String(u?.branch || u?.id || u?.username || '').trim();

// สาขาของแถวบิล = BranchId (บันทึกถูกทุกบิล รวมบิลที่ลูกค้าสแกน QR ที่ RecordedBy เป็น 'Self-Order')
// แถวเก่ามากที่ยังไม่มี BranchId ใช้ RecordedBy แทน
const rowBranch = (r) => String(r.BranchId || (r.RecordedBy === 'Self-Order' ? '' : r.RecordedBy) || '').trim();
const sameBranch = (r, b) => rowBranch(r).toLowerCase() === String(b || '').trim().toLowerCase();

export default function Reports({ allMenu = [], isAdmin = false, branch = '', users = [], userName = '' }) {
  const [tab,     setTab]     = useState('daily');
  const [from,    setFrom]    = useState(TODAY);
  const [to,      setTo]      = useState(TODAY);
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  // ใบกำกับภาษีที่ออกไปแล้ว (โหลดแยก — API รุ่นเก่ายังไม่มี ก็แค่ว่าง) / บิลที่กำลังเปิดหน้าต่างใบกำกับ
  const [invoices, setInvoices] = useState([]);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [detailSearch, setDetailSearch] = useState('');
  // ฟิลเตอร์สาขา: admin เลือกได้ทุกสาขา (ค่าว่าง=ทุกสาขา), ไม่ใช่ admin ล็อกเฉพาะสาขาตัวเอง
  const [branchFilter, setBranchFilter] = useState(isAdmin ? '' : branch);
  const inBranch = (r) => !branchFilter || sameBranch(r, branchFilter);
  const branchOptions = (() => {
    const set = new Set();
    (users || []).forEach(u => { const b = branchOf(u); if (b && b !== '*') set.add(b); }); // '*' = พนักงานทุกสาขา ไม่ใช่สาขา
    (data?.orders || []).forEach(r => { const b = rowBranch(r); if (b) set.add(b); });
    return Array.from(set).sort();
  })();
  // กรองรอบกะตามสาขา (เทียบกับพนักงานเปิด/ปิดกะ) — ค่าว่าง=ทุกสาขา
  const filteredShifts = (data?.shifts || []).filter(s =>
    !branchFilter || String(s.openStaff || '').trim() === branchFilter || String(s.closeStaff || '').trim() === branchFilter
  );

  const load = useCallback(async (f, t) => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_URL}?action=getReportData&from=${f}&to=${t}`);
      const json = await res.json();
      if (json.success) setData(json); else setError('โหลดข้อมูลไม่สำเร็จ');
    } catch { setError('เชื่อมต่อ GAS ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ'); }
    try {
      const res  = await fetch(`${API_URL}?action=getTaxInvoices`);
      const json = await res.json();
      setInvoices(json && json.success && Array.isArray(json.invoices) ? json.invoices : []);
    } catch { setInvoices([]); }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load(from, to);
  }, [load, from, to]);

  // ─── Derived ────────────────────────────────────────────────
  const payMap = {};
  (data?.payments || []).forEach(p => { payMap[p.orderNumber] = p; });

  const orderMap = {};
  (data?.orders || []).forEach(r => {
    if (!r.OrderNumber || r.Status === 'cancelled') return;
    if (!inBranch(r)) return;
    if (!orderMap[r.OrderNumber]) {
      orderMap[r.OrderNumber] = {
        orderNumber: r.OrderNumber, customerName: r.CustomerName,
        total: Number(r.TotalAmount) || 0, timestamp: r.Timestamp,
        status: r.Status, paymentMethod: payMap[r.OrderNumber]?.paymentMethod || '—', splitDetail: parseSplitDetail(payMap[r.OrderNumber]?.splitDetail), staff: r.RecordedBy || '',
      };
    }
  });
  const completedOrders = Object.values(orderMap).filter(o => ['completed','Completed'].includes(o.status))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // ใบกำกับของแต่ละบิล: ใบที่ยังใช้อยู่ก่อน ไม่มีค่อยใช้ใบล่าสุดที่ยกเลิกแล้ว (รายการจากเซิร์ฟเวอร์เรียงใหม่ → เก่า)
  const invoiceByOrder = {};
  invoices.forEach(inv => {
    const cur = invoiceByOrder[inv.orderNumber];
    if (!cur || (cur.cancelled && !inv.cancelled)) invoiceByOrder[inv.orderNumber] = inv;
  });
  const salesTotal = completedOrders.reduce((sum, o) => sum + o.total, 0);
  const invoicedCount = completedOrders.filter(o => invoiceByOrder[o.orderNumber] && !invoiceByOrder[o.orderNumber].cancelled).length;
  // รายงานภาษีขาย: บิลที่ขายสำเร็จเรียงตามเวลา — ยอดบิลถือว่ารวม VAT แล้ว (สูตรเดียวกับใบกำกับภาษี)
  // บิลที่ออกใบกำกับเต็มรูปแล้ว ใช้ชื่อ/เลขผู้เสียภาษีผู้ซื้อและยอดที่บันทึกในใบนั้น
  const vatRateSetting = (getReceiptHeader() || {}).vatRate;
  const vatRows = [...completedOrders].reverse().map(o => {
    const inv = invoiceByOrder[o.orderNumber];
    const active = inv && !inv.cancelled ? inv : null;
    const split = active ? { vatable: active.subtotal, vat: active.vatAmount } : vatSplit(o.total, vatRateSetting);
    return {
      timestamp: o.timestamp, abbNo: o.orderNumber, invoiceNo: active ? active.invoiceNo : '',
      buyerName: active ? active.buyer?.name || '' : '', buyerTaxId: active ? active.buyer?.taxId || '' : '',
      buyerBranch: active ? active.buyer?.branch || '' : '',
      vatable: split.vatable, vat: split.vat, total: o.total
    };
  });
  const vatTotals = vatRows.reduce((t, r) => ({ vatable: t.vatable + r.vatable, vat: t.vat + r.vat, total: t.total + r.total }), { vatable: 0, vat: 0, total: 0 });
  const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const updateInvoice = (inv) => setInvoices(prev => [inv, ...prev.filter(x => x.invoiceNo !== inv.invoiceNo)]);

  // รายละเอียดการขาย: ทุกรายการอาหารของบิลที่ขายสำเร็จ (ตัวเลือก ↳ ต่อท้ายรายการก่อนหน้า)
  const completedSet = new Set(completedOrders.map(o => o.orderNumber));
  const orderInfo = Object.fromEntries(completedOrders.map(o => [o.orderNumber, o]));
  const detailRows = [];
  (data?.orders || []).forEach(r => {
    if (!completedSet.has(r.OrderNumber) || !inBranch(r)) return;
    const detail = String(r.ItemDetail || '').trim();
    if (!detail) return;
    if (detail.startsWith('↳')) {
      const last = detailRows[detailRows.length - 1];
      if (last && last.orderNumber === r.OrderNumber) last.options.push(detail.replace(/^↳\s*/, ''));
      return;
    }
    const o = orderInfo[r.OrderNumber];
    detailRows.push({
      timestamp: r.Timestamp, orderNumber: r.OrderNumber, customerName: r.CustomerName,
      name: detail, options: [], dining: r.DiningOption || '', qty: Number(r.Quantity) || 1,
      amount: Number(r.Price) || 0, paymentMethod: o ? o.paymentMethod : '—'
    });
  });
  detailRows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const detailQ = detailSearch.trim().toLowerCase();
  const detailShown = detailQ
    ? detailRows.filter(d => [d.name, d.orderNumber, d.customerName, d.options.join(' ')].some(v => String(v || '').toLowerCase().includes(detailQ)))
    : detailRows;
  const detailQty = detailShown.reduce((s, d) => s + d.qty, 0);
  const detailAmount = detailShown.reduce((s, d) => s + d.amount, 0);

  const cancelledOrders = [];
  const seen = new Set();
  (data?.orders || []).forEach(r => {
    if (!inBranch(r)) return;
    if (r.Status === 'cancelled' && r.OrderNumber && !String(r.ItemDetail || '').startsWith('↳') && !seen.has(r.OrderNumber)) {
      seen.add(r.OrderNumber);
      cancelledOrders.push({ ...r, paymentMethod: payMap[r.OrderNumber]?.paymentMethod || '—' });
    }
  });

  // Tab: income
  const incomeByDay = {};
  completedOrders.forEach(o => {
    const day = dayStr(o.timestamp);
    if (!incomeByDay[day]) incomeByDay[day] = { day, total: 0, cash: 0, transfer: 0, card: 0, other: 0, count: 0 };
    incomeByDay[day].total += o.total; incomeByDay[day].count++;
    const sd = o.splitDetail && typeof o.splitDetail === 'object' ? o.splitDetail : null;
    if (sd) {
      // แยกจ่าย — กระจายตามจำนวนเงินแต่ละประเภท
      incomeByDay[day].cash     += Number(sd.cash)     || 0;
      incomeByDay[day].transfer += Number(sd.transfer) || 0;
      incomeByDay[day].card     += Number(sd.card)     || 0;
    } else {
      const m = (o.paymentMethod || '').toLowerCase();
      if (m.includes('สด') || m === 'cash')                                   incomeByDay[day].cash     += o.total;
      else if (m.includes('โอน') || m.includes('qr') || m === 'transfer')     incomeByDay[day].transfer += o.total;
      else if (m.includes('บัตร') || m === 'card')                            incomeByDay[day].card     += o.total;
      else                                                                      incomeByDay[day].other    += o.total;
    }
  });
  const incomeRows  = Object.values(incomeByDay).sort((a, b) => b.day.localeCompare(a.day));
  const totalSales  = incomeRows.reduce((s, r) => s + r.total, 0);
  const totalCash   = incomeRows.reduce((s, r) => s + r.cash, 0);
  const totalXfer   = incomeRows.reduce((s, r) => s + r.transfer, 0);
  const totalCard   = incomeRows.reduce((s, r) => s + r.card, 0);
  const totalBills  = incomeRows.reduce((s, r) => s + r.count, 0);

  // Tab: menu
  const menuMap = {};
  const priceNames = new Set(['ปกติ', 'ทั่วไป', 'ราคาปกติ', 'ราคาพิเศษ', 'พนักงาน', 'จัดส่ง']);
  (allMenu || []).forEach(item => {
    if (Array.isArray(item.prices)) {
      item.prices.forEach(p => {
        if (p.name) priceNames.add(p.name.trim());
      });
    }
  });

  const ordersGroupedByNum = {};
  (data?.orders || []).forEach(r => {
    if (!r.OrderNumber || r.Status === 'cancelled') return;
    if (!inBranch(r)) return;
    if (!ordersGroupedByNum[r.OrderNumber]) ordersGroupedByNum[r.OrderNumber] = [];
    ordersGroupedByNum[r.OrderNumber].push(r);
  });

  Object.values(ordersGroupedByNum).forEach(orderRows => {
    let lastMainItemQty = 1;
    orderRows.forEach(r => {
      const isSub = String(r.ItemDetail || '').trim().startsWith('↳');
      if (!isSub) {
        // Main item
        const detail = String(r.ItemDetail).trim();
        let qty = 1;
        
        // 1. Check from r.Quantity
        if (r.Quantity !== undefined && r.Quantity !== null && String(r.Quantity).trim() !== '') {
          const parsedQty = parseInt(r.Quantity, 10);
          if (!isNaN(parsedQty) && parsedQty > 0) {
            qty = parsedQty;
          }
        }
        
        // 2. Parse from detail string for legacy
        const parsed = parseItemQty(detail);
        if (qty === 1 && parsed.qty > 1) {
          qty = parsed.qty;
        }
        const name = parsed.name;
        
        lastMainItemQty = qty;

        if (!menuMap[name]) menuMap[name] = { name: name, qty: 0, revenue: 0 };
        menuMap[name].qty += qty;
        menuMap[name].revenue += Number(r.Price) || 0;
      } else {
        // Option/Popup sub-item
        const optionsText = String(r.ItemDetail).replace(/^↳/, '').trim();
        const parts = optionsText.split(',');
        parts.forEach(part => {
          const trimmed = part.trim();
          if (!trimmed) return;
          
          // Ignore non-food text
          if (trimmed.startsWith('ลูกค้า:') || trimmed.startsWith('ความเผ็ด:') || trimmed.includes('📝') || trimmed.startsWith('โต๊ะ')) return;
          if (['ทานที่ร้าน', 'กลับบ้าน', 'delivery', 'เดลิเวอรี่', 'dine-in', 'takeaway', 'dine in', 'take away'].includes(trimmed.toLowerCase())) return;
          if (priceNames.has(trimmed)) return;
          
          // Parse name and quantity from subitem part using parseItemQty
          const parsed = parseItemQty(trimmed);
          const name = parsed.name;
          const subQty = parsed.qty;
          
          const totalSubQty = lastMainItemQty * subQty;
          
          if (!menuMap[name]) menuMap[name] = { name: name, qty: 0, revenue: 0 };
          menuMap[name].qty += totalSubQty;
        });
      }
    });
  });

  const menuRows = Object.values(menuMap).sort((a, b) => b.qty - a.qty);
  const totalMenuRevenue = menuRows.reduce((sum, r) => sum + (r.revenue || 0), 0);
  const menuAdjustment = totalSales - totalMenuRevenue;

  // ─── Export handlers ─────────────────────────────────────
  const exportIncome = () => {
    const rows = incomeRows.map(r => [r.day, r.total, r.cash, r.transfer, r.card, r.other, r.count]);
    exportXLSX([{ name: 'รายรับ-รายจ่าย', headers: ['วันที่','รายรับรวม','เงินสด','โอน/QR','บัตร','อื่นๆ','จำนวนบิล'], rows }], `รายรับ-รายจ่าย_${from}_${to}`);
  };
  const exportMenu = () => {
    const rows = menuRows.map((r, i) => [i + 1, r.name, r.qty, r.revenue]);
    if (menuAdjustment !== 0) {
      rows.push(['—', 'ส่วนต่าง (ส่วนลด / ภาษี / Service Charge)', '—', menuAdjustment]);
    }
    rows.push(['—', 'รวมยอดขายสุทธิ (Grand Total)', '—', totalSales]);
    exportXLSX([{ name: 'ยอดขายตามเมนู', headers: ['อันดับ','ชื่อเมนู','จำนวน (ครั้ง)','รายได้รวม (บาท)'], rows }], `ยอดขายตามเมนู_${from}_${to}`);
  };
  const exportHistory = () => {
    const rows = completedOrders.map(o => {
      const inv = invoiceByOrder[o.orderNumber];
      return [fmtD(o.timestamp), o.orderNumber, o.customerName, o.total, o.paymentMethod, o.staff, inv && !inv.cancelled ? inv.invoiceNo : ''];
    });
    exportXLSX([{ name: 'รายงานยอดขาย', headers: ['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','ชำระด้วย','พนักงาน','ใบกำกับภาษี'], rows }], `รายงานยอดขาย_${from}_${to}`);
  };
  const exportVat = () => {
    const rows = vatRows.map((r, i) => [i + 1, dayStr(r.timestamp), r.abbNo, r.invoiceNo, r.buyerName, r.buyerTaxId, r.buyerBranch, r.vatable.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2)]);
    rows.push(['', '', '', '', 'รวม', '', '', vatTotals.vatable.toFixed(2), vatTotals.vat.toFixed(2), vatTotals.total.toFixed(2)]);
    exportXLSX([{ name: 'รายงานภาษีขาย', headers: ['ลำดับ','วันที่','เลขที่ใบกำกับภาษีอย่างย่อ','เลขที่ใบกำกับภาษีเต็มรูป','ชื่อผู้ซื้อ','เลขผู้เสียภาษีผู้ซื้อ','สถานประกอบการ','มูลค่าสินค้า/บริการ','จำนวนเงินภาษี','รวม'], rows }], `รายงานภาษีขาย_${from}_${to}`);
  };
  const exportDetail = () => {
    const rows = detailShown.map(d => [fmtD(d.timestamp), d.orderNumber, d.customerName, d.name, d.options.join(', '), d.dining, d.qty, d.amount, d.paymentMethod]);
    exportXLSX([{ name: 'รายละเอียดการขาย', headers: ['วันเวลา','เลขบิล','โต๊ะ','รายการ','ตัวเลือก','ประเภท','จำนวน','ยอดเงิน','ชำระด้วย'], rows }], `รายละเอียดการขาย_${from}_${to}`);
  };
  const exportCancel = () => {
    const rows = cancelledOrders.map(o => [fmtD(o.Timestamp), o.OrderNumber, o.CustomerName, o.TotalAmount, o.RecordedBy || '—']);
    exportXLSX([{ name: 'ประวัติยกเลิก', headers: ['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','พนักงาน'], rows }], `ประวัติยกเลิก_${from}_${to}`);
  };
  const exportShift = () => {
    const rows = filteredShifts.map(s => {
      const diff = s.status === 'closed' ? (Number(s.closeCash) || 0) - (Number(s.openCash) || 0) - (Number(s.totalCash) || 0) : '';
      return [s.id, s.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว', fmtD(s.openTime), s.openStaff, fmtD(s.closeTime), s.closeStaff, s.openCash, s.closeCash, s.totalSales, s.totalCash, s.totalTransfer, s.totalCard, s.totalOrders, diff, s.note || ''];
    });
    exportXLSX([{ name: 'รายงานปิดกะ', headers: ['รหัสกะ','สถานะ','เวลาเปิด','พนักงานเปิด','เวลาปิด','พนักงานปิด','เงินเปิดกะ','เงินปิดกะ','ยอดขายรวม','เงินสด','โอน/QR','บัตร','จำนวนบิล','ส่วนต่างเงินสด','หมายเหตุ'], rows }], `รายงานปิดกะ_${from}_${to}`);
  };

  const exportAll = () => {
    exportXLSX([
      { name: 'รายรับ-รายจ่าย',  headers: ['วันที่','รายรับรวม','เงินสด','โอน/QR','บัตร','อื่นๆ','จำนวนบิล'],            rows: incomeRows.map(r => [r.day, r.total, r.cash, r.transfer, r.card, r.other, r.count]) },
      { name: 'ยอดขายตามเมนู',    headers: ['อันดับ','ชื่อเมนู','จำนวน (ครั้ง)','รายได้รวม (บาท)'],                        rows: [
        ...menuRows.map((r, i) => [i + 1, r.name, r.qty, r.revenue]),
        ...(menuAdjustment !== 0 ? [['—', 'ส่วนต่าง (ส่วนลด / ภาษี / Service Charge)', '—', menuAdjustment]] : []),
        ['—', 'รวมยอดขายสุทธิ (Grand Total)', '—', totalSales]
      ] },
      { name: 'ประวัติการขาย',     headers: ['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','ชำระด้วย','พนักงาน'],                      rows: completedOrders.map(o => [fmtD(o.timestamp), o.orderNumber, o.customerName, o.total, o.paymentMethod, o.staff]) },
      { name: 'ประวัติยกเลิก',     headers: ['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','พนักงาน'],                                 rows: cancelledOrders.map(o => [fmtD(o.Timestamp), o.OrderNumber, o.CustomerName, o.TotalAmount, o.RecordedBy || '—']) },
      { name: 'รายงานปิดกะ',       headers: ['รหัสกะ','สถานะ','เวลาเปิด','พนักงานเปิด','เวลาปิด','พนักงานปิด','เงินเปิดกะ','เงินปิดกะ','ยอดขายรวม','เงินสด','โอน/QR','บัตร','จำนวนบิล','ส่วนต่างเงินสด','หมายเหตุ'],
        rows: filteredShifts.map(s => { const d = s.status==='closed'?(Number(s.closeCash)||0)-(Number(s.openCash)||0)-(Number(s.totalCash)||0):''; return [s.id, s.status==='open'?'เปิดอยู่':'ปิดแล้ว', fmtD(s.openTime), s.openStaff, fmtD(s.closeTime), s.closeStaff, s.openCash, s.closeCash, s.totalSales, s.totalCash, s.totalTransfer, s.totalCard, s.totalOrders, d, s.note||'']; }) },
    ], `รายงานทั้งหมด_${from}_${to}`);
  };

  const TAB_EXPORT = { daily: exportAll, income: exportIncome, menu: exportMenu, history: exportHistory, vat: exportVat, detail: exportDetail, cancel: exportCancel, shift: exportShift };

  return (
    <div style={{ color: 'var(--text-main)', fontFamily: 'inherit' }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BarChart2 size={26} color="var(--accent-hover)" /> รายงาน
          </h1>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>วิเคราะห์ยอดขายและกิจกรรมร้าน</p>
        </div>
        {data && (
          <button onClick={exportAll} style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 10, color: '#22c55e', cursor: 'pointer', padding: '0.6rem 1.1rem', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={16} /> Export ทั้งหมด (.csv)
          </button>
        )}
      </div>

      {/* Date filter */}
      <div style={{ ...card, marginBottom: '1.25rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }} style={{ padding: '0.35rem 0.8rem', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit', background: from === p.from && to === p.to ? 'rgba(234,179,8,0.18)' : 'rgba(0,0,0,0.02)', borderColor: from === p.from && to === p.to ? 'var(--accent)' : 'rgba(0,0,0,0.12)', color: from === p.from && to === p.to ? 'var(--text-main)' : 'var(--text-muted)' }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', padding: '0.4rem 0.65rem', fontFamily: 'inherit', fontSize: '0.85rem', outline: 'none' }} />
          <span style={{ color: 'var(--text-muted)' }}>—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', padding: '0.4rem 0.65rem', fontFamily: 'inherit', fontSize: '0.85rem', outline: 'none' }} />
          <button onClick={() => load(from, to)} disabled={loading} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: 'black', cursor: loading ? 'not-allowed' : 'pointer', padding: '0.45rem 1rem', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'กำลังโหลด...' : 'โหลดข้อมูล'}
          </button>
        </div>
      </div>

      {/* Branch filter — admin เลือกได้ทุกสาขา / ไม่ใช่ admin ล็อกเฉพาะของตัวเอง */}
      <div style={{ ...card, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>🏠 สาขา</span>
        {isAdmin ? (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', padding: '0.4rem 0.75rem', fontFamily: 'inherit', fontSize: '0.85rem', outline: 'none', minWidth: 200 }}>
            <option value="">ทุกสาขา (All branches)</option>
            {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 8, padding: '0.3rem 0.85rem' }}>{branchFilter || '—'}</span>
        )}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '0.75rem 1rem', color: '#ef4444', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '0.45rem 1rem', borderRadius: 20, border: '1.5px solid', cursor: 'pointer', fontSize: '0.85rem', fontWeight: tab === t.key ? 700 : 400, fontFamily: 'inherit', background: tab === t.key ? 'rgba(234,179,8,0.18)' : 'rgba(0,0,0,0.02)', borderColor: tab === t.key ? 'var(--accent)' : 'rgba(0,0,0,0.08)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {!data && !loading && (
        <div style={{ ...card, textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <BarChart2 size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <p style={{ margin: 0 }}>กด <strong style={{ color: 'var(--text-main)' }}>โหลดข้อมูล</strong> เพื่อดูรายงาน</p>
        </div>
      )}

      {data && (
        <>
          {/* Export button per tab */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
            <button onClick={TAB_EXPORT[tab]} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: '#22c55e', cursor: 'pointer', padding: '0.4rem 0.9rem', fontWeight: 600, fontSize: '0.8rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Download size={14} /> Export แท็บนี้ (.csv)
            </button>
          </div>

          {/* ── Tab: สรุปยอดขายประจำวัน ── */}
          {tab === 'daily' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* ยอดขายและจำนวนบิล */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>💰 ยอดขายทั้งหมด</span>
                  <span style={{ color: 'var(--accent-hover)', fontWeight: 900, fontSize: '2rem' }}>฿{fmt(totalSales)}</span>
                </div>
                <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>🧾 จำนวนบิลทั้งหมด</span>
                  <span style={{ color: 'var(--text-main)', fontWeight: 900, fontSize: '2rem' }}>{totalBills} บิล</span>
                </div>
              </div>

              {/* แยกตามประเภทการชำระเงิน */}
              <div style={card}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-main)', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: '0.5rem' }}>
                  💳 แยกตามช่องทางการชำระเงิน
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                  {[
                    { label: '💵 เงินสด', value: `฿${fmt(totalCash)}`, color: '#22c55e' },
                    { label: '📱 เงินโอน / QR', value: `฿${fmt(totalXfer)}`, color: '#38bdf8' },
                    { label: '💳 บัตรเครดิต', value: `฿${fmt(totalCard)}`, color: '#f97316' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 4 }}>{label}</div>
                      <div style={{ color, fontWeight: 700, fontSize: '1.1rem' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ยอดขายแยกรายเมนู (ไม่รวมแอดออน/ป๊อปอัพ) */}
              <div style={card}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-main)', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: '0.5rem' }}>
                  🍲 ยอดขายแยกรายเมนู (ไม่รวมแอดออน/ป๊อปอัพ)
                </h3>
                <TableWrap empty={menuRows.length === 0} headers={['อันดับ','ชื่อเมนู','จำนวนที่ขายได้','ยอดรวมยอดขาย']}>
                  {menuRows.map((r, i) => (
                    <tr key={i}>
                      <Td center color={i < 3 ? 'var(--accent-hover)' : undefined} bold={i < 3}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                      </Td>
                      <Td bold>{r.name}</Td>
                      <Td center bold style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{r.qty} จาน</Td>
                      <Td bold color="var(--text-main)">฿{fmt(r.revenue)}</Td>
                    </tr>
                  ))}
                </TableWrap>
              </div>
            </div>
          )}

          {/* ── Tab: รายรับ-รายจ่าย ── */}
          {tab === 'income' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[
                  { label: 'รายรับรวม',  value: `฿${fmt(totalSales)}`,  color: 'var(--text-main)' },
                  { label: 'เงินสด',      value: `฿${fmt(totalCash)}`,   color: '#22c55e' },
                  { label: 'โอน / QR',    value: `฿${fmt(totalXfer)}`,   color: '#38bdf8' },
                  { label: 'บัตรเครดิต', value: `฿${fmt(totalCard)}`,   color: '#f97316' },
                  { label: 'จำนวนบิล',   value: `${totalBills} บิล`,    color: 'var(--text-main)'   },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ ...card, textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 6 }}>{label}</div>
                    <div style={{ color, fontWeight: 800, fontSize: '1.3rem' }}>{value}</div>
                  </div>
                ))}
              </div>
              <TableWrap empty={incomeRows.length === 0} headers={['วันที่','รายรับรวม','เงินสด','โอน/QR','บัตร','อื่นๆ','จำนวนบิล']}>
                {incomeRows.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.day}</Td>
                    <Td bold color="var(--text-main)">฿{fmt(r.total)}</Td>
                    <Td color="#22c55e">฿{fmt(r.cash)}</Td>
                    <Td color="#38bdf8">฿{fmt(r.transfer)}</Td>
                    <Td color="#f97316">฿{fmt(r.card)}</Td>
                    <Td muted>{r.other > 0 ? `฿${fmt(r.other)}` : '—'}</Td>
                    <Td center>{r.count}</Td>
                  </tr>
                ))}
              </TableWrap>
            </div>
          )}

          {/* ── Tab: ยอดขายตามเมนู ── */}
          {tab === 'menu' && (
            <TableWrap empty={menuRows.length === 0} headers={['อันดับ','ชื่อเมนู','จำนวน (ครั้ง)','รายได้รวม']}>
              {menuRows.map((r, i) => (
                <tr key={i}>
                  <Td center color={i < 3 ? 'var(--accent-hover)' : undefined} bold={i < 3}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </Td>
                  <Td bold>{r.name}</Td>
                  <Td center>{r.qty}</Td>
                  <Td bold color="var(--text-main)">฿{fmt(r.revenue)}</Td>
                </tr>
              ))}
              {menuAdjustment !== 0 && (
                <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                  <Td center muted>—</Td>
                  <Td muted><em>ส่วนต่าง (ส่วนลด / ภาษี / Service Charge)</em></Td>
                  <Td center muted>—</Td>
                  <Td bold color={menuAdjustment > 0 ? '#22c55e' : '#dc2626'}>
                    {menuAdjustment > 0 ? '+' : ''}฿{fmt(menuAdjustment)}
                  </Td>
                </tr>
              )}
              <tr style={{ background: 'rgba(234,179,8,0.12)', fontWeight: 'bold' }}>
                <Td center>—</Td>
                <Td color="var(--text-main)">รวมยอดขายสุทธิ (Grand Total)</Td>
                <Td center>—</Td>
                <Td color="var(--text-main)">฿{fmt(totalSales)}</Td>
              </tr>
            </TableWrap>
          )}

          {/* ── Tab: รายงานยอดขาย (รายการบิล + ใบกำกับภาษี) ── */}
          {tab === 'history' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                {[
                  ['จำนวนบิล', fmt(completedOrders.length)],
                  ['ยอดขายรวม', `฿${fmt(salesTotal)}`],
                  ['เฉลี่ยต่อบิล', `฿${fmt(completedOrders.length ? Math.round(salesTotal / completedOrders.length) : 0)}`],
                  ['ออกใบกำกับภาษีแล้ว', `${fmt(invoicedCount)} บิล`],
                ].map(([k, v]) => (
                  <div key={k} style={card}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{k}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
              <TableWrap empty={completedOrders.length === 0} headers={['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','ชำระด้วย','พนักงาน','ใบกำกับภาษี']}>
                {completedOrders.map((o, i) => {
                  const inv = invoiceByOrder[o.orderNumber];
                  const active = inv && !inv.cancelled;
                  return (
                    <tr key={i}>
                      <Td muted nowrap>{fmtD(o.timestamp)}</Td>
                      <Td bold color="var(--text-main)">{o.orderNumber}</Td>
                      <Td>{o.customerName}</Td>
                      <Td bold>฿{fmt(o.total)}</Td>
                      <td style={td_}><PayBadge method={o.paymentMethod} /></td>
                      <Td muted>{o.staff || '—'}</Td>
                      <td style={td_}>
                        <button onClick={() => setInvoiceOrder(o)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.3rem 0.7rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
                            border: `1px solid ${active ? 'rgba(34,197,94,0.4)' : 'rgba(0,0,0,0.15)'}`, background: active ? 'rgba(34,197,94,0.1)' : '#fff', color: active ? '#15803d' : 'var(--text-main)' }}>
                          <FileText size={13} /> {active ? inv.invoiceNo : 'ออกใบกำกับภาษี'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </TableWrap>
            </>
          )}

          {/* ── Tab: รายงานภาษีขาย ── */}
          {tab === 'vat' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                {[
                  ['จำนวนใบ', fmt(vatRows.length)],
                  ['มูลค่าสินค้า/บริการ', `฿${money2(vatTotals.vatable)}`],
                  ['ภาษีขาย', `฿${money2(vatTotals.vat)}`],
                  ['รวม', `฿${money2(vatTotals.total)}`],
                ].map(([k, v]) => (
                  <div key={k} style={card}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{k}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
              <TableWrap empty={vatRows.length === 0} headers={['ลำดับ','วันที่','ใบกำกับอย่างย่อ','ใบกำกับเต็มรูป','ชื่อผู้ซื้อ','เลขผู้เสียภาษีผู้ซื้อ','สถานประกอบการ','มูลค่าสินค้า','ภาษี','รวม']}>
                {vatRows.map((r, i) => (
                  <tr key={r.abbNo}>
                    <Td muted>{i + 1}</Td>
                    <Td muted nowrap>{dayStr(r.timestamp)}</Td>
                    <Td bold color="var(--text-main)">{r.abbNo}</Td>
                    <Td>{r.invoiceNo || '—'}</Td>
                    <Td>{r.buyerName || '—'}</Td>
                    <Td muted>{r.buyerTaxId || '—'}</Td>
                    <Td muted>{r.buyerBranch || '—'}</Td>
                    <Td nowrap>{money2(r.vatable)}</Td>
                    <Td nowrap>{money2(r.vat)}</Td>
                    <Td bold nowrap>{money2(r.total)}</Td>
                  </tr>
                ))}
                {vatRows.length > 0 && (
                  <tr>
                    <Td bold>รวม</Td><Td /><Td /><Td /><Td /><Td /><Td />
                    <Td bold nowrap>{money2(vatTotals.vatable)}</Td>
                    <Td bold nowrap>{money2(vatTotals.vat)}</Td>
                    <Td bold nowrap>{money2(vatTotals.total)}</Td>
                  </tr>
                )}
              </TableWrap>
            </>
          )}

          {/* ── Tab: รายละเอียดการขาย (ทุกรายการอาหาร) ── */}
          {tab === 'detail' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <input value={detailSearch} onChange={e => setDetailSearch(e.target.value)} placeholder="ค้นหาเมนู / เลขบิล / โต๊ะ"
                  style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, padding: '0.45rem 0.75rem', fontFamily: 'inherit', fontSize: '0.85rem', minWidth: 240 }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {fmt(detailShown.length)} รายการ · จำนวนรวม {fmt(detailQty)} · ยอดรวม ฿{fmt(detailAmount)}
                </span>
              </div>
              <TableWrap empty={detailShown.length === 0} headers={['วันเวลา','เลขบิล','โต๊ะ','รายการ','ประเภท','จำนวน','ยอดเงิน','ชำระด้วย']}>
                {detailShown.map((d, i) => (
                  <tr key={i}>
                    <Td muted nowrap>{fmtD(d.timestamp)}</Td>
                    <Td bold color="var(--text-main)">{d.orderNumber}</Td>
                    <Td>{d.customerName}</Td>
                    <td style={td_}>
                      <div style={{ fontWeight: 600 }}>{d.name}</div>
                      {d.options.length > 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{d.options.join(', ')}</div>}
                    </td>
                    <Td muted>{d.dining || '—'}</Td>
                    <Td center>{d.qty}</Td>
                    <Td bold>฿{fmt(d.amount)}</Td>
                    <td style={td_}><PayBadge method={d.paymentMethod} /></td>
                  </tr>
                ))}
              </TableWrap>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                ยอดเงินรายการเป็นราคาก่อนส่วนลด/ค่าบริการท้ายบิล — ยอดขายสุทธิดูที่แท็บรายงานยอดขาย
              </p>
            </>
          )}

          {/* ── Tab: ประวัติการยกเลิก ── */}
          {tab === 'cancel' && (
            <>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>พบ {cancelledOrders.length} รายการ</div>
              <TableWrap empty={cancelledOrders.length === 0} emptyMsg="ไม่มีรายการยกเลิกในช่วงเวลานี้" headers={['วันเวลา','เลขบิล','โต๊ะ','ยอดรวม','พนักงาน']}>
                {cancelledOrders.map((o, i) => (
                  <tr key={i}>
                    <Td muted nowrap>{fmtD(o.Timestamp)}</Td>
                    <Td bold color="#ef4444">{o.OrderNumber}</Td>
                    <Td>{o.CustomerName}</Td>
                    <Td bold>฿{fmt(o.TotalAmount)}</Td>
                    <Td muted>{o.RecordedBy || '—'}</Td>
                  </tr>
                ))}
              </TableWrap>
            </>
          )}

          {/* ── Tab: รายงานปิดกะ ── */}
          {tab === 'shift' && (
            filteredShifts.length === 0
              ? <div style={{ ...card, textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>ยังไม่มีประวัติการเปิด-ปิดกะ</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {[...filteredShifts].reverse().map((s, i) => {
                    const openCash_  = Number(s.openCash)  || 0;
                    const closeCash_ = Number(s.closeCash) || 0;
                    const totalCsh   = Number(s.totalCash) || 0;
                    const diff       = s.status === 'closed' ? closeCash_ - openCash_ - totalCsh : null;
                    return (
                      <div key={i} style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <span style={{ background: s.status === 'open' ? 'rgba(34,197,94,0.15)' : 'rgba(0,0,0,0.05)', color: s.status === 'open' ? '#22c55e' : 'var(--text-muted)', border: `1px solid ${s.status === 'open' ? 'rgba(34,197,94,0.3)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.78rem', fontWeight: 700 }}>
                              {s.status === 'open' ? '🟢 เปิดอยู่' : '⚫ ปิดแล้ว'}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{s.id}</span>
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                            เปิด {fmtD(s.openTime)} โดย <strong style={{ color: '#22c55e' }}>{s.openStaff}</strong>
                            {s.closeTime && <> &nbsp;•&nbsp; ปิด {fmtD(s.closeTime)} โดย <strong style={{ color: '#ef4444' }}>{s.closeStaff}</strong></>}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: '0.5rem' }}>
                          {[
                            { label: 'ยอดขายรวม',  value: `฿${fmt(s.totalSales)}`,   color: 'var(--text-main)' },
                            { label: 'จำนวนบิล',   value: `${s.totalOrders || 0} บิล`, color: 'var(--text-main)' },
                            { label: 'เงินสด',      value: `฿${fmt(s.totalCash)}`,    color: '#22c55e' },
                            { label: 'โอน / QR',    value: `฿${fmt(s.totalTransfer)}`,color: '#38bdf8' },
                            { label: 'บัตรเครดิต', value: `฿${fmt(s.totalCard)}`,    color: '#f97316' },
                            { label: 'เงินเปิดกะ', value: `฿${fmt(s.openCash)}`,     color: 'var(--text-muted)' },
                            ...(s.status === 'closed' ? [
                              { label: 'เงินปิดกะ',       value: `฿${fmt(s.closeCash)}`, color: 'var(--text-muted)' },
                              { label: 'ส่วนต่างเงินสด',  value: `${diff >= 0 ? '+' : ''}฿${fmt(diff)}${Math.abs(diff) < 1 ? ' ✓' : diff > 0 ? ' เกิน' : ' ขาด'}`, color: Math.abs(diff) < 1 ? '#22c55e' : '#ef4444' },
                            ] : []),
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '0.55rem 0.75rem' }}>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: 2 }}>{label}</div>
                              <div style={{ color, fontWeight: 700, fontSize: '0.95rem' }}>{value}</div>
                            </div>
                          ))}
                        </div>
                        {s.note && <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>หมายเหตุ: {s.note}</div>}
                      </div>
                    );
                  })}
                </div>
          )}
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {invoiceOrder && (
        <TaxInvoiceModal
          order={invoiceOrder}
          invoice={invoiceByOrder[invoiceOrder.orderNumber] || null}
          canCancel={isAdmin}
          userName={userName}
          onChanged={updateInvoice}
          onClose={() => setInvoiceOrder(null)}
        />
      )}
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────
function TableWrap({ headers, children, empty, emptyMsg = 'ไม่มีข้อมูลในช่วงเวลานี้' }) {
  if (empty) return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>{emptyMsg}</div>
  );
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: 'rgba(0,0,0,0.02)' }}>{headers.map(h => <th key={h} style={th_}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, color, bold, muted, center, nowrap }) {
  return (
    <td style={{ ...td_, color: color || (muted ? 'var(--text-muted)' : 'inherit'), fontWeight: bold ? 700 : undefined, textAlign: center ? 'center' : undefined, whiteSpace: nowrap ? 'nowrap' : undefined }}>
      {children}
    </td>
  );
}

function PayBadge({ method }) {
  if (!method || method === '—') return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const m = method.toLowerCase();
  let c = 'var(--text-main)', bg = 'rgba(234,179,8,0.15)', b = 'rgba(234,179,8,0.3)';
  if (m.includes('สด') || m === 'cash')                               { c = '#22c55e'; bg = 'rgba(34,197,94,0.12)';  b = 'rgba(34,197,94,0.3)'; }
  else if (m.includes('โอน') || m.includes('qr') || m === 'transfer') { c = '#38bdf8'; bg = 'rgba(56,189,248,0.12)'; b = 'rgba(56,189,248,0.3)'; }
  else if (m.includes('บัตร') || m === 'card')                        { c = '#f97316'; bg = 'rgba(249,115,22,0.12)'; b = 'rgba(249,115,22,0.3)'; }
  return <span style={{ padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, background: bg, color: c, border: `1px solid ${b}` }}>{method}</span>;
}
