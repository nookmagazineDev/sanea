import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, RefreshCw, Download, Calendar, TrendingUp, BarChart2, CheckCircle, Search, ArrowLeft, ChevronRight, Receipt, CreditCard, FileSpreadsheet, Printer } from 'lucide-react';
import html2canvas from 'html2canvas';
import { API_URL } from '../utils/api';
import { getReceiptHeader } from '../utils/printServer';
import { printDailyClose, billRanges, vatSplit } from '../utils/dailyClosePrint';

// Time helpers in Thai Timezone
const getThaiTodayStr = () => {
  const d = new Date();
  const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
  const p = {};
  parts.forEach(part => p[part.type] = part.value);
  return `${p.year}-${p.month}-${p.day}`;
};

const getThaiPastDateStr = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
  const p = {};
  parts.forEach(part => p[part.type] = part.value);
  return `${p.year}-${p.month}-${p.day}`;
};

const getThaiMonthStartStr = () => {
  const d = new Date();
  const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
  const p = {};
  parts.forEach(part => p[part.type] = part.value);
  return `${p.year}-${p.month}-01`;
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

// ชื่อสาขา = คอลัม A ของชีต Users (branch) — เผื่อข้อมูลเก่าใช้ id/username แทน
const branchOf = (u) => String(u?.branch || u?.id || u?.username || '').trim();

// splitDetail ถูกเก็บในชีตเป็น JSON string (JSON.stringify ตอนบันทึก) — แปลงกลับเป็น object
// ก่อนใช้ ไม่งั้นการแยกประเภทเงินสด/โอน/บัตร จะไม่ถูกดึงมาคำนวณเลย
const parseSplitDetail = (sd) => {
  if (!sd) return null;
  if (typeof sd === 'object') return sd;
  try { return JSON.parse(sd); } catch { return null; }
};

// สาขาของแถวบิล = BranchId (บันทึกถูกทุกบิล รวมบิลที่ลูกค้าสแกน QR ที่ RecordedBy เป็น 'Self-Order')
// แถวเก่ามากที่ยังไม่มี BranchId ใช้ RecordedBy แทน
const rowBranch = (r) => String(r.BranchId || (r.RecordedBy === 'Self-Order' ? '' : r.RecordedBy) || '').trim();
const sameBranch = (r, b) => rowBranch(r).toLowerCase() === String(b || '').trim().toLowerCase();

const SalesSummaryModal = ({ lang = 'th', initialMode = 'daily', allMenu = [], categories = [], isAdmin = false, branch = '', users = [], userName = '', onClose }) => {
  const todayStr = getThaiTodayStr();

  // ฟิลเตอร์สาขา: admin เลือกได้ทุกสาขา (ค่าว่าง = ทุกสาขา), สาขาทั่วไปล็อกเฉพาะของตัวเอง
  const [branchFilter, setBranchFilter] = useState(isAdmin ? '' : branch);
  
  // Date States
  const [from, setFrom] = useState(() => {
    if (initialMode === 'range') {
      return getThaiPastDateStr(6); // Default to last 7 days for range mode
    }
    return todayStr;
  });
  const [to, setTo] = useState(todayStr);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  
  // Navigation States
  const [view, setView] = useState('summary'); // 'summary' | 'bills' | 'drilldown'
  const [searchQuery, setSearchQuery] = useState('');
  const [drilldownItem, setDrilldownItem] = useState(null);

  const loadReport = useCallback(async (fromDate = from, toDate = to) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}?action=getReportData&from=${fromDate}&to=${toDate}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(lang === 'th' ? 'โหลดข้อมูลยอดขายล้มเหลว' : 'Failed to load report');
      }
    } catch (err) {
      setError(lang === 'th' ? 'เกิดข้อผิดพลาดในการเชื่อมต่อ' : 'Connection error');
    }
    setLoading(false);
  }, [from, to, lang]);

  useEffect(() => {
    loadReport();
  }, []);

  // Set up Price names to ignore from options string
  const priceNames = useMemo(() => {
    const set = new Set(['ปกติ', 'ทั่วไป', 'ราคาปกติ', 'ราคาพิเศษ', 'พนักงาน', 'จัดส่ง']);
    (allMenu || []).forEach(item => {
      if (Array.isArray(item.prices)) {
        item.prices.forEach(p => {
          if (p.name) set.add(p.name.trim());
        });
      }
    });
    return set;
  }, [allMenu]);

  // map ชื่อเมนู (และชื่ออังกฤษ) → ตัวเมนู เพื่อหาหมวดของแต่ละรายการตอน export
  const menuByName = useMemo(() => {
    const m = {};
    (allMenu || []).forEach(item => {
      if (item.name) m[String(item.name).trim().toLowerCase()] = item;
      if (item.nameEn) m[String(item.nameEn).trim().toLowerCase()] = item;
    });
    return m;
  }, [allMenu]);

  // map slug หมวด → ชื่อหมวดที่อ่านได้
  const catNameBySlug = useMemo(() => {
    const m = {};
    (categories || []).forEach(c => {
      if (c.slug) m[c.slug] = (lang === 'th' ? c.name : c.nameEn) || c.name || c.slug;
    });
    return m;
  }, [categories, lang]);

  // หาชื่อหมวดของเมนูจากชื่อรายการ — ไม่เจอคืน '—'
  const getMenuCategoryName = (name) => {
    const item = menuByName[String(name).trim().toLowerCase()];
    if (!item) return '—';
    const slug = item.category || (Array.isArray(item.categories) ? item.categories[0] : '') || '';
    return catNameBySlug[slug] || slug || '—';
  };

  // รายชื่อสาขาสำหรับฟิลเตอร์ (admin) — รวมจากชีต Users + สาขาของบิลที่พบจริง
  const branchOptions = useMemo(() => {
    const set = new Set();
    (users || []).forEach(u => { const b = branchOf(u); if (b && b !== '*') set.add(b); }); // '*' = พนักงานทุกสาขา ไม่ใช่สาขา
    (data?.orders || []).forEach(r => { const b = rowBranch(r); if (b) set.add(b); });
    return Array.from(set).sort();
  }, [users, data]);

  // Group Payments by orderNumber
  const payMap = useMemo(() => {
    const map = {};
    (data?.payments || []).forEach(p => { map[p.orderNumber] = p; });
    return map;
  }, [data]);

  // Process Bills & Group items inside bills
  const bills = useMemo(() => {
    const billMap = {};
    (data?.orders || []).forEach(r => {
      if (!r.OrderNumber || r.Status === 'cancelled') return;
      // กรองตามสาขาของบิล (BranchId) — ค่าว่าง = ทุกสาขา
      if (branchFilter && !sameBranch(r, branchFilter)) return;

      if (!billMap[r.OrderNumber]) {
        billMap[r.OrderNumber] = {
          orderNumber: r.OrderNumber,
          customerName: r.CustomerName || 'ไม่ระบุ',
          total: Number(r.TotalAmount) || 0,
          timestamp: r.Timestamp,
          status: r.Status,
          paymentMethod: payMap[r.OrderNumber]?.paymentMethod || 'ไม่ระบุ',
          splitDetail: parseSplitDetail(payMap[r.OrderNumber]?.splitDetail),
          items: []
        };
      }

      const isSubItem = typeof r.ItemDetail === 'string' && r.ItemDetail.trim().startsWith('↳');
      if (isSubItem && billMap[r.OrderNumber].items.length > 0) {
        const lastItem = billMap[r.OrderNumber].items[billMap[r.OrderNumber].items.length - 1];
        if (!lastItem.subItems) lastItem.subItems = [];
        lastItem.subItems.push(r.ItemDetail);
      } else {
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
        const cleanName = parsed.name;

        billMap[r.OrderNumber].items.push({
          name: cleanName,
          qty: qty,
          price: Number(r.Price) || 0,
          subItems: []
        });
      }
    });

    return Object.values(billMap)
      .filter(b => ['completed','Completed'].includes(b.status))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [data, payMap, branchFilter]);

  // Calculations for Summary — memoize ไว้ ไม่งั้นพิมพ์ค้นหา/สลับหน้าทีจะวนคำนวณใหม่ทั้งก้อนทุกครั้ง
  const { totalSales, totalCash, totalXfer, totalCard, totalBills } = useMemo(() => {
    let totalSales = 0, totalCash = 0, totalXfer = 0, totalCard = 0;
    bills.forEach(o => {
      totalSales += o.total;
      const sd = o.splitDetail && typeof o.splitDetail === 'object' ? o.splitDetail : null;
      if (sd) {
        totalCash += Number(sd.cash) || 0;
        totalXfer += Number(sd.transfer) || 0;
        totalCard += Number(sd.card) || 0;
      } else {
        const m = (o.paymentMethod || '').toLowerCase();
        if (m.includes('สด') || m === 'cash') totalCash += o.total;
        else if (m.includes('โอน') || m.includes('qr') || m === 'transfer') totalXfer += o.total;
        else if (m.includes('บัตร') || m === 'card') totalCard += o.total;
        else totalCash += o.total;
      }
    });
    return { totalSales, totalCash, totalXfer, totalCard, totalBills: bills.length };
  }, [bills]);

  // Calculate Menu Breakdown including sub-items/popups — เป็นลูปหนักสุด (วนทุกแถวออเดอร์ x2) จึง memoize
  const { menuRows, totalMenuRevenue } = useMemo(() => {
  const menuMap = {};
  const ordersGroupedByNum = {};
  (data?.orders || []).forEach(r => {
    if (!r.OrderNumber || r.Status === 'cancelled') return;
    if (branchFilter && !sameBranch(r, branchFilter)) return;
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

        if (!menuMap[name]) {
          menuMap[name] = { name, qty: 0, revenue: 0, isSubItem: false };
        } else {
          menuMap[name].isSubItem = false;
        }
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
          
          if (!menuMap[name]) menuMap[name] = { name, qty: 0, revenue: 0, isSubItem: true };
          menuMap[name].qty += totalSubQty;
        });
      }
    });
  });

    const menuRows = Object.values(menuMap).sort((a, b) => b.qty - a.qty);
    const totalMenuRevenue = menuRows.reduce((sum, r) => sum + (r.isSubItem ? 0 : r.revenue), 0);
    return { menuRows, totalMenuRevenue };
  }, [data, priceNames, branchFilter]);

  const menuAdjustment = totalSales - totalMenuRevenue;

  // รายการทิ้งของเสีย (Waste) ในช่วงเวลาเดียวกัน — รวมจำนวนต่อไอเทม + แยกตามสาขา
  const { wasteRows, wasteTotalQty } = useMemo(() => {
    const map = {};
    (data?.waste || []).forEach(w => {
      const name = String(w.itemName || '').trim();
      if (!name) return;
      const branch = String(w.branch || '').trim();
      if (branchFilter && branch !== branchFilter) return; // เคารพตัวกรองสาขาเหมือนรายงานส่วนอื่น
      const unit = String(w.unit || '').trim();
      const key = name + '||' + unit;
      if (!map[key]) map[key] = { name, unit, qty: 0, branches: {} };
      const q = Number(w.qty) || 0;
      map[key].qty += q;
      if (branch) map[key].branches[branch] = (map[key].branches[branch] || 0) + q;
    });
    const rows = Object.values(map)
      .map(r => ({ ...r, branchText: Object.entries(r.branches).map(([b, q]) => `${b}: ${q}`).join(', ') }))
      .sort((a, b) => b.qty - a.qty);
    return { wasteRows: rows, wasteTotalQty: rows.reduce((s, r) => s + r.qty, 0) };
  }, [data, branchFilter]);

  // Filter bills by search query
  const filteredBills = useMemo(() => {
    if (!searchQuery) return bills;
    const query = searchQuery.toLowerCase().trim();
    return bills.filter(b => 
      b.orderNumber.toLowerCase().includes(query) || 
      b.customerName.toLowerCase().includes(query) ||
      b.paymentMethod.toLowerCase().includes(query)
    );
  }, [bills, searchQuery]);

  // Filter bills for a specific menu item drilldown
  const drilldownBills = useMemo(() => {
    if (!drilldownItem) return [];
    const itemQuery = drilldownItem.toLowerCase().trim();
    
    const results = [];
    bills.forEach(bill => {
      const matchingItems = [];
      bill.items.forEach(item => {
        let isMatch = false;
        
        // 1. Check if main item name matches
        if (item.name.toLowerCase().includes(itemQuery)) {
          isMatch = true;
        }
        
        // 2. Check if any sub-item option matches
        if (item.subItems && item.subItems.length > 0) {
          item.subItems.forEach(sub => {
            const optionsText = sub.replace(/^↳/, '').trim();
            const parts = optionsText.split(',');
            parts.forEach(part => {
              const trimmed = part.trim();
              const parsed = parseItemQty(trimmed);
              if (parsed.name.toLowerCase() === itemQuery) {
                isMatch = true;
              }
            });
          });
        }
        
        if (isMatch) {
          matchingItems.push(item);
        }
      });
      
      if (matchingItems.length > 0) {
        results.push({
          ...bill,
          matchingItems
        });
      }
    });
    return results;
  }, [bills, drilldownItem]);

  const drilldownSummary = useMemo(() => {
    if (!drilldownItem) return null;
    const query = drilldownItem.toLowerCase().trim();
    
    let standalonePaidQty = 0;
    let standaloneFreeQty = 0;
    const popupMap = {}; // mainItemName -> qty
    
    drilldownBills.forEach(bill => {
      bill.matchingItems.forEach(item => {
        const itemCleanName = item.name.toLowerCase().trim();
        
        // 1. Standalone match
        if (itemCleanName === query) {
          if (item.price > 0) {
            standalonePaidQty += item.qty;
          } else {
            standaloneFreeQty += item.qty;
          }
        }
        
        // 2. Sub-items match
        if (item.subItems && item.subItems.length > 0) {
          item.subItems.forEach(sub => {
            const optionsText = sub.replace(/^↳/, '').trim();
            const parts = optionsText.split(',');
            parts.forEach(part => {
              const trimmed = part.trim();
              const parsed = parseItemQty(trimmed);
              if (parsed.name.toLowerCase().trim() === query) {
                const totalSubQty = item.qty * parsed.qty;
                if (!popupMap[item.name]) {
                  popupMap[item.name] = 0;
                }
                popupMap[item.name] += totalSubQty;
              }
            });
          });
        }
      });
    });
    
    const popupList = Object.entries(popupMap).map(([mainName, qty]) => ({
      mainName,
      qty
    })).sort((a, b) => b.qty - a.qty);
    
    return {
      standalonePaidQty,
      standaloneFreeQty,
      popupList,
      totalPopupQty: popupList.reduce((sum, p) => sum + p.qty, 0)
    };
  }, [drilldownBills, drilldownItem]);

  const handleMenuDrilldown = (itemName) => {
    setDrilldownItem(itemName);
    setView('drilldown');
  };

  // Date range presets helpers
  const applyPreset = (preset) => {
    let fStr = todayStr;
    let tStr = todayStr;

    if (preset === 'yesterday') {
      fStr = getThaiPastDateStr(1);
      tStr = getThaiPastDateStr(1);
    } else if (preset === '7days') {
      fStr = getThaiPastDateStr(6);
    } else if (preset === '30days') {
      fStr = getThaiPastDateStr(29);
    } else if (preset === 'thismonth') {
      fStr = getThaiMonthStartStr();
    }

    setFrom(fStr);
    setTo(tStr);
    loadReport(fStr, tStr);
  };

  const handleDownloadImage = () => {
    const element = document.getElementById('sales-report-card-capture');
    if (!element) return;
    
    const btn = document.getElementById('capture-btn');
    if (btn) btn.innerText = lang === 'th' ? '📸 กำลังบันทึก...' : '📸 Capturing...';

    html2canvas(element, {
      backgroundColor: '#0f0f1e',
      scale: 2,
      useCORS: true,
      logging: false
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = `sales_report_${from}_to_${to}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      if (btn) btn.innerText = lang === 'th' ? '💾 บันทึกรูปภาพสำเร็จ' : '💾 Saved Successfully';
      setTimeout(() => {
        if (btn) btn.innerText = lang === 'th' ? '💾 บันทึกภาพสรุป (PNG)' : '💾 Save as PNG';
      }, 2000);
    }).catch(err => {
      console.error(err);
      if (btn) btn.innerText = lang === 'th' ? '❌ เกิดข้อผิดพลาด' : '❌ Error';
    });
  };

  const downloadExcelCSV = (headers, rows, filename) => {
    const BOM = '\uFEFF'; // UTF-8 BOM
    const csvContent = BOM + [headers, ...rows].map(row => 
      row.map(val => {
        const s = String(val ?? '');
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\r\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadExcelMultiSheet = (sheets, filename) => {
    let xml = '<?xml version="1.0" encoding="utf-8"?>\r\n' +
      '<?mso-application progid="Excel.Sheet"?>\r\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\r\n' +
      ' xmlns:o="urn:schemas-microsoft-com:office:office"\r\n' +
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"\r\n' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\r\n' +
      ' xmlns:html="http://www.w3.org/TR/REC-html40">\r\n' +
      ' <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">\r\n' +
      '  <Author>เสน่ห์</Author>\r\n' +
      ' </DocumentProperties>\r\n' +
      ' <Styles>\r\n' +
      '  <Style ss:ID="Default" ss:Name="Normal">\r\n' +
      '   <Alignment ss:Vertical="Bottom"/>\r\n' +
      '   <Borders/>\r\n' +
      '   <Font ss:FontName="Calibri" x:CharSet="222" ss:Size="11" ss:Color="#000000"/>\r\n' +
      '   <Interior/>\r\n' +
      '   <NumberFormat/>\r\n' +
      '   <Protection/>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="Header">\r\n' +
      '   <Font ss:FontName="Calibri" ss:Bold="1" ss:Color="#000000"/>\r\n' +
      '  </Style>\r\n' +
      ' </Styles>\r\n';

    sheets.forEach(sheet => {
      xml += ` <Worksheet ss:Name="${sheet.name}">\r\n` +
        '  <Table>\r\n';
      
      // Write headers
      if (sheet.headers && sheet.headers.length > 0) {
        xml += '   <Row ss:StyleID="Header">\r\n';
        sheet.headers.forEach(h => {
          const clean = String(h ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          xml += `    <Cell><Data ss:Type="String">${clean}</Data></Cell>\r\n`;
        });
        xml += '   </Row>\r\n';
      }

      // Write rows
      sheet.rows.forEach(row => {
        xml += '   <Row>\r\n';
        row.forEach(cell => {
          const val = cell ?? '';
          const isNum = typeof val === 'number' && !isNaN(val);
          const clean = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          xml += `    <Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${clean}</Data></Cell>\r\n`;
        });
        xml += '   </Row>\r\n';
      });

      xml += '  </Table>\r\n' +
        ' </Worksheet>\r\n';
    });

    xml += '</Workbook>\r\n';

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // สถิติการขายของเมนูหนึ่งๆ (จานเดี่ยวคิดราคา/ฟรี + แยกว่าอยู่ในชุด/ป๊อปอัปไหนบ้าง) — ชุดเดียวกับการ์ด drilldown
  const computeItemStats = (itemName) => {
    const query = String(itemName).toLowerCase().trim();
    let standalonePaidQty = 0, standaloneFreeQty = 0;
    const popupMap = {};
    bills.forEach(bill => {
      bill.items.forEach(item => {
        if (item.name.toLowerCase().trim() === query) {
          if (item.price > 0) standalonePaidQty += item.qty;
          else standaloneFreeQty += item.qty;
        }
        if (item.subItems && item.subItems.length > 0) {
          item.subItems.forEach(sub => {
            sub.replace(/^↳/, '').trim().split(',').forEach(part => {
              const parsed = parseItemQty(part.trim());
              if (parsed.name.toLowerCase().trim() === query) {
                popupMap[item.name] = (popupMap[item.name] || 0) + item.qty * parsed.qty;
              }
            });
          });
        }
      });
    });
    const popupList = Object.entries(popupMap).map(([mainName, qty]) => ({ mainName, qty })).sort((a, b) => b.qty - a.qty);
    return { standalonePaidQty, standaloneFreeQty, popupList, totalPopupQty: popupList.reduce((s, p) => s + p.qty, 0) };
  };

  // แตกแถวย่อยสถิติใต้เมนู (จานเดี่ยว/ในชุด-ป๊อปอัป) — label อยู่คอลัมน์ชื่อเมนู, จำนวนอยู่คอลัมน์จำนวน
  const buildItemStatRows = (itemName) => {
    const st = computeItemStats(itemName);
    if (st.totalPopupQty === 0 && st.standaloneFreeQty === 0) return []; // ไม่มีอะไรให้แยก → ข้าม
    const rows = [['', '   • จานเดี่ยวที่คิดราคา', '', st.standalonePaidQty, '']];
    if (st.standaloneFreeQty > 0) rows.push(['', '   • จานเดี่ยวโปรโมชั่น (ฟรี)', '', st.standaloneFreeQty, '']);
    if (st.totalPopupQty > 0) {
      rows.push(['', '   • รายการที่เลือกในชุด/ป๊อปอัป', '', st.totalPopupQty, '']);
      st.popupList.forEach(p => rows.push(['', `       ↳ อยู่ใน ${p.mainName}`, '', p.qty, '']));
    }
    return rows;
  };

  const handleExportExcel = () => {
    if (view === 'summary') {
      const summaryRows = [
        ['สรุปยอดขาย เสน่ห์', ''],
        ['ช่วงวันที่เริ่มต้น', from],
        ['ช่วงวันที่สิ้นสุด', to],
        ['ยอดขายทั้งหมด (บาท)', totalSales],
        ['จำนวนบิลทั้งหมด', totalBills],
        ['ยอดเงินสด (บาท)', totalCash],
        ['ยอดเงินโอน (บาท)', totalXfer],
        ['ยอดบัตรเครดิต (บาท)', totalCard],
        [],
        ['ยอดขายสะสมรายเมนู'],
        ['อันดับ', 'ชื่อเมนู', 'หมวดหมู่', 'จำนวนที่ขายได้', 'รายได้รวม (บาท)'],
        ...menuRows.flatMap((r, i) => [
          [i + 1, r.name, getMenuCategoryName(r.name), r.qty, r.revenue],
          ...buildItemStatRows(r.name)
        ]),
        ...(menuAdjustment !== 0 ? [
          ['—', 'ส่วนต่าง (ส่วนลด / ภาษี / Service Charge)', '—', '—', menuAdjustment]
        ] : []),
        ['—', 'รวมยอดขายสุทธิ (Grand Total)', '—', '—', totalSales]
      ];

      const detailRows = [];
      filteredBills.forEach(bill => {
        let splitLabel = '';
        if (bill.splitDetail) {
          const sd = bill.splitDetail;
          const parts = [];
          if (sd.cash > 0) parts.push(`สด ฿${sd.cash}`);
          if (sd.transfer > 0) parts.push(`โอน ฿${sd.transfer}`);
          if (sd.card > 0) parts.push(`บัตร ฿${sd.card}`);
          splitLabel = parts.join(', ');
        }

        bill.items.forEach(it => {
          const subItemsText = (it.subItems && it.subItems.length > 0)
            ? it.subItems.map(sub => sub.replace(/^↳/, '').trim()).join(', ')
            : '—';
          
          detailRows.push([
            bill.orderNumber,
            bill.customerName,
            formatTimeThai(bill.timestamp),
            bill.paymentMethod,
            splitLabel || '—',
            bill.total,
            it.name,
            it.qty || 1,
            it.price || 0,
            subItemsText
          ]);
        });
      });

      // ชีตรายการทิ้ง (Waste) — สรุปต่อไอเทม + รายการดิบแยกสาขา/เวลา
      const wasteSummaryRows = [
        ['สรุปรายการทิ้ง (Waste)', '', '', ''],
        ['รวมจำนวนที่ทิ้งทั้งหมด', wasteTotalQty, '', ''],
        [],
        ['ลำดับ', 'รายการ', 'จำนวนรวม', 'แยกตามสาขา'],
        ...wasteRows.map((r, i) => [i + 1, r.name, `${r.qty}${r.unit ? ' ' + r.unit : ''}`, r.branchText || '—']),
        [],
        ['รายการทิ้งทั้งหมด (รายตัว)'],
        ['วันเวลา', 'สาขา', 'รายการ', 'หมวด', 'จำนวน', 'หน่วย', 'หมายเหตุ', 'พนักงาน'],
        ...[...(data?.waste || [])]
          .filter(w => !branchFilter || String(w.branch || '').trim() === branchFilter)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .map(w => [
            (function () { try { return new Date(w.timestamp).toLocaleString('th-TH'); } catch { return w.timestamp; } })(),
            w.branch || '—', w.itemName || '', w.category || '—',
            Number(w.qty) || 0, w.unit || '', w.note || '—', w.staff || '—'
          ]),
      ];

      downloadExcelMultiSheet([
        { name: 'หน้ารวม', headers: ['หัวข้อ', 'รายละเอียด', '', '', ''], rows: summaryRows },
        { name: 'รายละเอียดบิล', headers: ['เลขที่บิล', 'ลูกค้า/โต๊ะ', 'เวลาสั่งซื้อ', 'ช่องทางชำระเงิน', 'รายละเอียดการชำระเงิน', 'ยอดรวมบิล (บาท)', 'ชื่อรายการอาหาร', 'จำนวน', 'ราคาต่อหน่วย (บาท)', 'ตัวเลือกเสริม/ของในเซ็ต'], rows: detailRows },
        { name: 'รายการทิ้ง Waste', headers: ['', '', '', '', '', '', '', ''], rows: wasteSummaryRows }
      ], `สรุปยอดขาย_${from}_ถึง_${to}`);
    } else if (view === 'drilldown') {
      // บล็อกสรุปสถิติ (ชุดข้อมูลเดียวกับการ์ด "สรุปสถิติการสั่งซื้อ") ไว้ด้านบนไฟล์
      const s = drilldownSummary || { standalonePaidQty: 0, standaloneFreeQty: 0, popupList: [], totalPopupQty: 0 };
      const statsRows = [
        ['เมนู', drilldownItem],
        ['จานเดี่ยวที่คิดราคา', s.standalonePaidQty, 'จาน'],
        ...(s.standaloneFreeQty > 0 ? [['จานเดี่ยวโปรโมชั่น (ฟรี)', s.standaloneFreeQty, 'จาน']] : []),
        ['รายการที่เลือกในชุด/ป๊อปอัป', s.totalPopupQty, 'จาน'],
        ...s.popupList.map(p => [`   • อยู่ใน ${p.mainName}`, p.qty, 'จาน']),
      ];

      const detailHeader = ['เลขที่บิล', 'ลูกค้า/โต๊ะ', 'เวลาสั่งซื้อ', 'ช่องทางชำระเงิน', 'ยอดรวมบิล (บาท)', 'ชื่อรายการอาหาร', 'จำนวน', 'ราคาต่อหน่วย (บาท)', 'ตัวเลือกเสริม/ของในเซ็ต'];
      const detailRows = [];
      drilldownBills.forEach(bill => {
        bill.matchingItems.forEach(it => {
          const subItemsText = (it.subItems && it.subItems.length > 0)
            ? it.subItems.map(sub => sub.replace(/^↳/, '').trim()).join(', ')
            : '—';

          detailRows.push([
            bill.orderNumber,
            bill.customerName,
            formatTimeThai(bill.timestamp),
            bill.paymentMethod,
            bill.total,
            it.name,
            it.qty || 1,
            it.price || 0,
            subItemsText
          ]);
        });
      });

      downloadExcelMultiSheet([{
        name: 'ประวัติออเดอร์',
        headers: ['📊 สรุปสถิติการสั่งซื้อ'],
        rows: [
          ...statsRows,
          [],
          detailHeader,
          ...detailRows
        ]
      }], `ประวัติออเดอร์_${drilldownItem}_${from}_ถึง_${to}`);
    } else {
      const headers = ['เลขที่บิล', 'ลูกค้า/โต๊ะ', 'เวลาสั่งซื้อ', 'ช่องทางชำระเงิน', 'รายละเอียดการชำระเงิน', 'ยอดรวม (บาท)', 'รายการอาหาร'];
      const rows = filteredBills.map(bill => {
        let splitLabel = '';
        if (bill.splitDetail) {
          const sd = bill.splitDetail;
          const parts = [];
          if (sd.cash > 0) parts.push(`สด ฿${sd.cash}`);
          if (sd.transfer > 0) parts.push(`โอน ฿${sd.transfer}`);
          if (sd.card > 0) parts.push(`บัตร ฿${sd.card}`);
          splitLabel = parts.join(', ');
        }
        
        const itemsText = bill.items.map(it => {
          let text = `${it.name} (x${it.qty || 1}) - ฿${it.price}`;
          if (it.subItems && it.subItems.length > 0) {
            text += ` [ตัวเลือก: ${it.subItems.map(sub => sub.replace(/^↳/, '').trim()).join('; ')}]`;
          }
          return text;
        }).join(' | ');

        return [
          bill.orderNumber,
          bill.customerName,
          formatTimeThai(bill.timestamp),
          bill.paymentMethod,
          splitLabel || '—',
          bill.total,
          itemsText
        ];
      });
      downloadExcelCSV(headers, rows, `รายละเอียดบิล_${from}_ถึง_${to}`);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('th-TH');
  
  const formatDateThai = (dStr) => {
    if (!dStr) return '';
    try {
      return new Date(dStr).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dStr;
    }
  };

  // ── รายงานปิดยอดประจำวัน (พิมพ์ออกเครื่องใบเสร็จ) — ใช้ยอดชุดเดียวกับที่แสดงบนจอ ──
  const [closePrintStatus, setClosePrintStatus] = useState('');
  const buildDailyClose = () => {
    const h = getReceiptHeader() || {};
    // ส่วนลด / ค่าบริการที่บวกตอนชำระ = ยอดบิล − ราคารายการ (วิธีเดียวกับบรรทัดปรับยอดในใบกำกับภาษี)
    let discount = 0, charges = 0;
    bills.forEach(b => {
      const diff = Math.round((b.total - b.items.reduce((s, it) => s + it.price, 0)) * 100) / 100;
      if (diff < 0) discount += -diff; else charges += diff;
    });
    const cancelled = new Map();
    (data?.orders || []).forEach(r => {
      if (r.Status !== 'cancelled' || !r.OrderNumber || String(r.ItemDetail || '').trim().startsWith('↳')) return;
      if (branchFilter && !sameBranch(r, branchFilter)) return;
      if (!cancelled.has(r.OrderNumber)) cancelled.set(r.OrderNumber, Number(r.TotalAmount) || 0);
    });
    const ranges = billRanges([...bills.map(b => b.orderNumber), ...cancelled.keys()]);
    return {
      shopName: h.name || 'เสน่ห์',
      taxId: h.taxId || '',
      posId: h.posId || '',
      dateLabel: from === to ? formatDateThai(from) : `${formatDateThai(from)} - ${formatDateThai(to)}`,
      branchLabel: branchFilter || 'ทุกสาขา',
      printedAt: new Date().toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      printedBy: userName,
      billCount: totalBills,
      total: totalSales,
      discount,
      charges,
      ...vatSplit(totalSales, h.vatRate),
      cash: totalCash,
      transfer: totalXfer,
      card: totalCard,
      ranges,
      cancelCount: cancelled.size,
      cancelTotal: [...cancelled.values()].reduce((s, v) => s + v, 0),
      menu: menuRows.filter(r => !r.isSubItem).map(r => ({ name: r.name, qty: r.qty, revenue: r.revenue }))
    };
  };
  const handlePrintDailyClose = async () => {
    setClosePrintStatus(lang === 'th' ? 'กำลังส่งไปเครื่องพิมพ์...' : 'Printing...');
    const res = await printDailyClose(buildDailyClose());
    setClosePrintStatus(res.success
      ? (lang === 'th' ? '🖨️ ส่งรายงานปิดยอดไปที่เครื่องพิมพ์แล้ว' : '🖨️ Sent to printer')
      : `❌ ${lang === 'th' ? 'พิมพ์ไม่สำเร็จ' : 'Print failed'}: ${res.error || ''}`);
  };

  const formatTimeThai = (ts) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '—';
    }
  };

  const cardStyle = {
    background: '#16162a',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '1.2rem',
    color: 'white'
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#0f0f1e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 24, width: '100%', maxWidth: 500, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <BarChart2 size={24} /> {view === 'summary' ? (lang === 'th' ? 'สรุปยอดขายร้าน' : 'Sales Summary') : (lang === 'th' ? 'รายละเอียดบิลทั้งหมด' : 'All Bills Details')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button onClick={() => loadReport(from, to)} disabled={loading} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', color: 'white', padding: '0.45rem', cursor: 'pointer', display: 'flex', transition: 'all 0.2s' }}>
              <RefreshCw size={18} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex', padding: '0.2rem' }}>
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Branch filter bar — admin เลือกได้ทุกสาขา / สาขาทั่วไปล็อกเฉพาะของตัวเอง */}
        <div style={{ padding: '0.65rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'rgba(124,58,237,0.04)' }}>
          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 600, whiteSpace: 'nowrap' }}>🏠 สาขา</span>
          {isAdmin ? (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              style={{ flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'white', padding: '0.4rem 0.6rem', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' }}
            >
              <option value="">ทุกสาขา (All branches)</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : (
            <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 700, color: '#c084fc' }}>{branchFilter || '—'}</span>
          )}
        </div>

        {/* Date Selector and Filter Panel */}
        {view === 'summary' && (
          <div style={{ padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Range Date Fields */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>เริ่มต้น (From)</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', padding: '0.4rem 0.5rem', fontSize: '0.82rem', width: '100%', outline: 'none' }} />
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', alignSelf: 'flex-end', marginBottom: '0.5rem' }}>—</span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>สิ้นสุด (To)</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', padding: '0.4rem 0.5rem', fontSize: '0.82rem', width: '100%', outline: 'none' }} />
              </div>
              <button onClick={() => loadReport(from, to)} disabled={loading} style={{ background: '#7c3aed', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', padding: '0.45rem 0.75rem', alignSelf: 'flex-end', height: '32px', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                {lang === 'th' ? 'ดึงรายงาน' : 'Filter'}
              </button>
            </div>

            {/* Presets Row */}
            <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' }}>
              {[
                { label: 'วันนี้', value: 'today' },
                { label: 'เมื่อวาน', value: 'yesterday' },
                { label: '7 วันล่าสุด', value: '7days' },
                { label: '30 วันล่าสุด', value: '30days' },
                { label: 'เดือนนี้', value: 'thismonth' }
              ].map(preset => (
                <button
                  key={preset.value}
                  onClick={() => applyPreset(preset.value)}
                  style={{
                    padding: '0.25rem 0.6rem',
                    borderRadius: '20px',
                    border: '1.5px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'rgba(255,255,255,0.7)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit'
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'rgba(255,255,255,0.5)' }}>
              <RefreshCw size={36} style={{ animation: 'spin 1.5s linear infinite', marginBottom: '1.25rem', color: '#c084fc' }} />
              <span style={{ fontSize: '0.9rem' }}>{lang === 'th' ? 'กำลังดึงรายงานข้อมูลยอดขายล่าสุด...' : 'Fetching latest sales report...'}</span>
            </div>
          ) : error ? (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '1rem', color: '#f87171', textAlign: 'center', fontSize: '0.9rem' }}>
              {error}
            </div>
          ) : (
            <>
              {/* VIEW 1: SUMMARY DASHBOARD */}
              {view === 'summary' && (
                <div id="sales-report-card-capture" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '0.25rem' }}>
                  
                  {/* Report Title Banner */}
                  <div style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'white', letterSpacing: '0.5px' }}>เสน่ห์</div>
                    <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Calendar size={13} /> 
                      {from === to ? (
                        <>วันที่ {formatDateThai(from)}</>
                      ) : (
                        <>ระหว่างวันที่ {formatDateThai(from)} ถึง {formatDateThai(to)}</>
                      )}
                    </div>
                  </div>

                  {/* Total sales & bills */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '0.75rem' }}>
                    <div style={{ ...cardStyle, background: 'rgba(241,89,42,0.05)', border: '1px solid rgba(241,89,42,0.15)', textAlign: 'center', padding: '1.1rem' }}>
                      <div style={{ fontSize: '0.78rem', color: 'rgba(241,89,42,0.8)', fontWeight: 700, marginBottom: '4px' }}>💰 ยอดขายทั้งหมด</div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#f1592a' }}>฿{fmt(totalSales)}</div>
                    </div>
                    
                    <button 
                      onClick={() => setView('bills')}
                      style={{ ...cardStyle, background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.18)', textAlign: 'center', padding: '1.1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', outline: 'none', transition: 'all 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(192,132,252,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(192,132,252,0.06)'}
                    >
                      <div style={{ fontSize: '0.78rem', color: '#c084fc', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        🧾 จำนวนบิลทั้งหมด <ChevronRight size={12} />
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'white' }}>{totalBills} บิล</div>
                    </button>
                  </div>

                  {/* Payment Methods */}
                  <div style={cardStyle}>
                    <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.85rem', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CreditCard size={15} /> ช่องทางการชำระเงิน
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {[
                        { label: '💵 เงินสด (Cash)', value: totalCash, color: '#22c55e' },
                        { label: '📱 เงินโอน / QR (Transfer)', value: totalXfer, color: '#38bdf8' },
                        { label: '💳 บัตรเครดิต (Card)', value: totalCard, color: '#f97316' }
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', alignItems: 'center' }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)' }}>{row.label}</span>
                          <strong style={{ color: row.color, fontSize: '0.95rem' }}>฿{fmt(row.value)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Menu items sold (Includes popup/set items) */}
                  <div style={cardStyle}>
                    <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.85rem', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <BarChart2 size={15} /> ยอดขายรวมตามเมนู (รวมของในเซ็ต & ป๊อปอัป)
                    </h4>
                    {menuRows.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '1rem', fontSize: '0.85rem' }}>
                        {lang === 'th' ? 'ไม่มีรายการขายในช่วงเวลานี้' : 'No sales recorded during this range'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                        {menuRows.map((r, i) => (
                          <div 
                            key={i} 
                            onClick={() => handleMenuDrilldown(r.name)}
                            style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', alignItems: 'center', padding: '0.25rem 0.4rem', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ display: 'flex', gap: '6px', minWidth: 0, alignItems: 'center' }}>
                              <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 'bold', minWidth: '16px' }}>{i + 1}.</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.isSubItem ? 'rgba(255,255,255,0.55)' : 'white' }}>
                                {r.isSubItem && <span style={{ color: '#c084fc', marginRight: '4px', fontSize: '0.78rem' }}>↳</span>}
                                {r.name}
                                {r.isSubItem && <span style={{ fontSize: '0.72rem', color: 'rgba(192,132,252,0.4)', marginLeft: '6px' }}>[เสริม/เซ็ต]</span>}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '14px', flexShrink: 0, alignItems: 'center' }}>
                              <span style={{ color: '#f1592a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {r.qty} {lang === 'th' ? 'รายการ' : 'qty'}
                                <ChevronRight size={12} style={{ opacity: 0.5 }} />
                              </span>
                              <span style={{ color: r.revenue === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)', minWidth: '60px', textAlign: 'right', fontSize: '0.82rem' }}>
                                {r.revenue === 0 ? '—' : `฿${fmt(r.revenue)}`}
                              </span>
                            </div>
                          </div>
                        ))}
                        
                        {menuAdjustment !== 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', alignItems: 'center', padding: '0.35rem 0.4rem', borderTop: '1px dashed rgba(255,255,255,0.08)', marginTop: '4px' }}>
                            <div style={{ display: 'flex', gap: '6px', minWidth: 0, alignItems: 'center' }}>
                              <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 'bold' }}>—</span>
                              <span style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                ส่วนต่าง (ส่วนลด / ภาษี / Service Charge)
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '14px', flexShrink: 0, alignItems: 'center' }}>
                              <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: '60px', textAlign: 'right' }}>—</span>
                              <span style={{ color: menuAdjustment > 0 ? '#4ade80' : '#f87171', fontWeight: 700, minWidth: '60px', textAlign: 'right' }}>
                                {menuAdjustment > 0 ? '+' : ''}฿{fmt(menuAdjustment)}
                              </span>
                            </div>
                          </div>
                        )}
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', alignItems: 'center', padding: '0.45rem 0.4rem 0.25rem', borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '4px', fontWeight: 'bold' }}>
                          <span style={{ color: 'white' }}>รวมยอดขายสุทธิ (Grand Total)</span>
                          <span style={{ color: '#f1592a', fontSize: '0.9rem' }}>฿{fmt(totalSales)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Waste items (รายการทิ้ง) — เน้นสีแดงให้เห็นชัด */}
                  <div style={{ ...cardStyle, background: 'rgba(239,68,68,0.06)', border: '1.5px solid rgba(239,68,68,0.35)' }}>
                    <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.9rem', fontWeight: 800, borderBottom: '1px solid rgba(239,68,68,0.2)', paddingBottom: '0.5rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🗑️ {lang === 'th' ? 'รายการที่ทิ้ง (Waste)' : 'Wasted Items'}
                      <span style={{ marginLeft: 'auto', fontSize: '0.82rem', fontWeight: 800 }}>
                        {lang === 'th' ? 'รวม' : 'Total'} {wasteTotalQty}
                      </span>
                    </h4>
                    {wasteRows.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'rgba(239,68,68,0.5)', padding: '0.75rem', fontSize: '0.85rem' }}>
                        {lang === 'th' ? 'ไม่มีรายการทิ้งในช่วงเวลานี้' : 'No waste recorded during this range'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                        {wasteRows.map((r, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', fontSize: '0.88rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <span style={{ color: '#fca5a5', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span style={{ color: 'rgba(239,68,68,0.6)', fontWeight: 'bold', marginRight: '6px' }}>{i + 1}.</span>
                                {r.name}
                              </span>
                              {r.branchText && (
                                <span style={{ fontSize: '0.72rem', color: 'rgba(248,113,113,0.7)', paddingLeft: '18px' }}>
                                  🏢 {r.branchText}
                                </span>
                              )}
                            </div>
                            <span style={{ color: '#ef4444', fontWeight: 900, flexShrink: 0, whiteSpace: 'nowrap' }}>
                              {r.qty}{r.unit ? ` ${r.unit}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* VIEW 2: DETAILED BILLS LIST */}
              {view === 'bills' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  {/* Back button & Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <button 
                      onClick={() => setView('summary')}
                      style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', color: 'white', padding: '0.4rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
                    >
                      <ArrowLeft size={14} /> {lang === 'th' ? 'ย้อนกลับ' : 'Back'}
                    </button>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', marginLeft: 'auto' }}>
                      พบ {filteredBills.length} บิล
                    </span>
                  </div>

                  {/* Search input inside details view */}
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', color: 'rgba(255,255,255,0.3)' }} />
                    <input 
                      type="text" 
                      placeholder={lang === 'th' ? 'ค้นหาเลขบิล, โต๊ะ, วิธีชำระเงิน...' : 'Search bill #, table, method...'} 
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'white', padding: '0.55rem 0.75rem 0.55rem 2.2rem', fontSize: '0.85rem', outline: 'none' }}
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '0.2rem' }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Scrollable Bills list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '480px', overflowY: 'auto', paddingRight: '2px' }}>
                    {filteredBills.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '2rem', fontSize: '0.85rem' }}>
                        {lang === 'th' ? 'ไม่พบข้อมูลบิล' : 'No bills found'}
                      </div>
                    ) : (
                      filteredBills.map((bill) => {
                        const payMethodLabel = bill.paymentMethod;
                        // Format split text if present
                        let splitLabel = '';
                        if (bill.splitDetail) {
                          const sd = bill.splitDetail;
                          const parts = [];
                          if (sd.cash > 0) parts.push(`สด ฿${fmt(sd.cash)}`);
                          if (sd.transfer > 0) parts.push(`โอน ฿${fmt(sd.transfer)}`);
                          if (sd.card > 0) parts.push(`บัตร ฿${fmt(sd.card)}`);
                          splitLabel = `(${parts.join(', ')})`;
                        }

                        // Determine payment badge colors
                        const m = (bill.paymentMethod || '').toLowerCase();
                        let badgeColor = '#c084fc';
                        let badgeBg = 'rgba(192,132,252,0.1)';
                        if (m.includes('สด') || m === 'cash') {
                          badgeColor = '#4ade80';
                          badgeBg = 'rgba(74,222,128,0.1)';
                        } else if (m.includes('โอน') || m.includes('qr') || m === 'transfer') {
                          badgeColor = '#38bdf8';
                          badgeBg = 'rgba(56,189,248,0.1)';
                        } else if (m.includes('บัตร') || m === 'card') {
                          badgeColor = '#fb923c';
                          badgeBg = 'rgba(251,146,60,0.1)';
                        }

                        return (
                          <div key={bill.orderNumber} style={{ background: '#16162a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                            {/* Bill Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 800, color: '#c084fc', fontSize: '0.95rem' }}>{bill.orderNumber}</span>
                                <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.15rem 0.45rem', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                                  {bill.customerName}
                                </span>
                              </div>
                              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                                ⏰ {formatTimeThai(bill.timestamp)}
                              </span>
                            </div>

                            {/* Bill Items List */}
                            <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {bill.items.map((item, idx) => (
                                <div key={idx} style={{ fontSize: '0.8rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: 'white', fontWeight: 500 }}>
                                      {item.qty > 1 ? `${item.name} (x${item.qty})` : item.name}
                                    </span>
                                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>฿{fmt(item.price)}</span>
                                  </div>
                                  {item.subItems && item.subItems.length > 0 && (
                                    <div style={{ color: 'rgba(192,132,252,0.6)', paddingLeft: '0.75rem', fontSize: '0.75rem', marginTop: '2px', lineHeight: '1.25' }}>
                                      {item.subItems.map((sub, sidx) => (
                                        <div key={sidx}>{sub}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Bill Footer Summary */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem', marginTop: '2px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '12px', color: badgeColor, background: badgeBg, fontWeight: 700, width: 'fit-content' }}>
                                  {payMethodLabel}
                                </span>
                                {splitLabel && (
                                  <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)' }}>
                                    {splitLabel}
                                  </span>
                                )}
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginRight: '6px' }}>รวมยอด</span>
                                <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f1592a' }}>฿{fmt(bill.total)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                </div>
              )}

              {/* VIEW 3: MENU DRILLDOWN LIST */}
              {view === 'drilldown' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  {/* Back button & Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <button 
                      onClick={() => setView('summary')}
                      style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', color: 'white', padding: '0.4rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
                    >
                      <ArrowLeft size={14} /> {lang === 'th' ? 'ย้อนกลับ' : 'Back'}
                    </button>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', marginLeft: 'auto' }}>
                      ออกไปทั้งหมด {drilldownBills.reduce((acc, b) => acc + b.matchingItems.length, 0)} ครั้ง
                    </span>
                  </div>

                  {/* Title of selected menu item */}
                  <div style={{ ...cardStyle, background: 'rgba(192,132,252,0.04)', border: '1px solid rgba(192,132,252,0.15)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: 700 }}>🔍 รายละเอียดประวัติการสั่งซื้อ</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'white' }}>{drilldownItem}</span>
                  </div>

                  {/* Summary card */}
                  {drilldownSummary && (
                    <div style={{ ...cardStyle, background: 'rgba(255,255,255,0.02)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.4rem' }}>
                        📊 สรุปสถิติการสั่งซื้อ
                      </span>
                      
                      {/* Standalone Paid */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                        <span style={{ color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80' }}></span>
                          จานเดี่ยวที่คิดราคา
                        </span>
                        <strong style={{ color: '#4ade80' }}>{drilldownSummary.standalonePaidQty} จาน</strong>
                      </div>

                      {/* Standalone Free */}
                      {drilldownSummary.standaloneFreeQty > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                          <span style={{ color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.4)' }}></span>
                            จานเดี่ยวโปรโมชั่น (ฟรี)
                          </span>
                          <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{drilldownSummary.standaloneFreeQty} จาน</strong>
                        </div>
                      )}

                      {/* Sub-items in Popup/Combo */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: '0.6rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                          <span style={{ color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#c084fc' }}></span>
                            รายการที่เลือกในชุด/ป๊อปอัป
                          </span>
                          <strong style={{ color: '#c084fc' }}>{drilldownSummary.totalPopupQty} จาน</strong>
                        </div>

                        {/* Popup Breakdown */}
                        {drilldownSummary.popupList.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '14px', marginTop: '2px', fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' }}>
                            {drilldownSummary.popupList.map((item, pidx) => (
                              <div key={pidx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  • อยู่ใน {item.mainName}
                                </span>
                                <span style={{ fontWeight: 700, color: '#c084fc', flexShrink: 0 }}>
                                  {item.qty} จาน
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ paddingLeft: '14px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                            ไม่มีรายการในชุดหรือป๊อปอัพ
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Scrollable Drilldown list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '260px', overflowY: 'auto', paddingRight: '2px' }}>
                    {drilldownBills.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '2rem', fontSize: '0.85rem' }}>
                        {lang === 'th' ? 'ไม่พบข้อมูลออเดอร์' : 'No matching orders found'}
                      </div>
                    ) : (
                      drilldownBills.map((bill, bidx) => (
                        <div key={bidx} style={{ background: '#16162a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          
                          {/* Order header info */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 800, color: '#c084fc', fontSize: '0.9rem' }}>{bill.orderNumber}</span>
                              <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.15rem 0.45rem', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                                {bill.customerName}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                              ⏰ {formatTimeThai(bill.timestamp)}
                            </span>
                          </div>

                          {/* The matching main item + options (what was inside the set) */}
                          <div style={{ background: 'rgba(0,0,0,0.18)', borderRadius: '8px', padding: '0.6rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {bill.matchingItems.map((item, midx) => (
                              <div key={midx} style={{ fontSize: '0.82rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed rgba(255,255,255,0.05)', paddingBottom: '4px', marginBottom: '4px' }}>
                                  <span style={{ color: 'white', fontWeight: 600 }}>📦 {item.name}</span>
                                  <span style={{ color: '#f1592a', fontWeight: 700 }}>฿{fmt(item.price)}</span>
                                </div>
                                {item.subItems && item.subItems.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', color: 'rgba(192,132,252,0.85)', paddingLeft: '0.5rem' }}>
                                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: '2px' }}>📋 รายการประกอบข้างในเซ็ต:</div>
                                    {item.subItems.map((sub, sidx) => {
                                      const options = sub.replace(/^↳/, '').split(',').map(o => o.trim());
                                      return (
                                        <div key={sidx} style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '4px' }}>
                                          {options.map((opt, oidx) => (
                                            <div key={oidx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                              <span style={{ color: '#c084fc' }}>↳</span>
                                              <span style={{ color: opt.toLowerCase().includes(drilldownItem.toLowerCase()) ? '#f1592a' : 'rgba(255,255,255,0.7)', fontWeight: opt.toLowerCase().includes(drilldownItem.toLowerCase()) ? 700 : 400 }}>
                                                {opt}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', paddingLeft: '0.5rem' }}>
                                    (ไม่มีตัวเลือกเสริมหรือชุดย่อยย่อย)
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Payment summary footer for this order */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.4rem' }}>
                            <span>💳 ชำระผ่าน: {bill.paymentMethod}</span>
                            <span style={{ color: 'white' }}>ยอดรวมบิล: <strong>฿{fmt(bill.total)}</strong></span>
                          </div>

                        </div>
                      ))
                    )}
                  </div>

                </div>
              )}
            </>
          )}
        </div>

        {closePrintStatus && (
          <div style={{ padding: '0.5rem 1.5rem 0', fontSize: '0.85rem', color: closePrintStatus.startsWith('❌') ? '#f87171' : '#5eead4' }}>{closePrintStatus}</div>
        )}

        {/* Footer actions */}
        <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.75rem', background: 'rgba(255,255,255,0.01)' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '0.7rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', fontFamily: 'inherit', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}>
            {lang === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
          </button>
          
          {!loading && data && (
            <>
              {view === 'summary' && (
                <button id="capture-btn" onClick={handleDownloadImage} style={{ flex: 1.2, padding: '0.7rem', background: '#7c3aed', border: 'none', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontFamily: 'inherit', boxShadow: '0 4px 15px rgba(124,58,237,0.3)', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'} onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>
                  <Download size={16} /> {lang === 'th' ? 'รูปภาพ (PNG)' : 'Save as PNG'}
                </button>
              )}
              {view === 'summary' && (
                <button onClick={handlePrintDailyClose} title={closePrintStatus} style={{ flex: 1.5, padding: '0.7rem', background: '#0f766e', border: 'none', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontFamily: 'inherit', boxShadow: '0 4px 15px rgba(15,118,110,0.3)', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#115e59'} onMouseLeave={e => e.currentTarget.style.background = '#0f766e'}>
                  <Printer size={16} /> {lang === 'th' ? 'พิมพ์ปิดยอดประจำวัน' : 'Print daily close'}
                </button>
              )}
              <button onClick={handleExportExcel} style={{ flex: 1.5, padding: '0.7rem', background: '#10b981', border: 'none', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontFamily: 'inherit', boxShadow: '0 4px 15px rgba(16,185,129,0.3)', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#059669'} onMouseLeave={e => e.currentTarget.style.background = '#10b981'}>
                <FileSpreadsheet size={16} /> {lang === 'th' ? 'ส่งออก Excel' : 'Export Excel'}
              </button>
            </>
          )}
        </div>

      </div>
      
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default SalesSummaryModal;
