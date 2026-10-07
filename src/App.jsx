import React, { useState, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import OrderWizardModal from './components/OrderWizardModal';
import PosSalesScreen from './components/PosSalesScreen';
import PaymentApprovalListener from './components/PaymentApprovalListener';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import TableOrderView from './components/TableOrderView';
import LoginScreen from './components/LoginScreen';
import BranchPicker from './components/BranchPicker';
import BranchLanding from './components/BranchLanding';
import { isAllBranches } from './utils/branches';
// โหลดแบบ lazy: 2 โมดอลนี้ลากไลบรารีหนัก (html2canvas, qrcode) เปิดตอนกดเท่านั้น → bundle หน้าแรกเล็กลง
const SalesSummaryModal = lazy(() => import('./components/SalesSummaryModal'));
const TaxInvoicePage = lazy(() => import('./components/TaxInvoicePage'));
const KioskPaymentAlerts = lazy(() => import('./components/KioskPaymentAlerts'));
const CheckoutModal = lazy(() => import('./components/CheckoutModal'));
// โหลดแบบ lazy: หน้าหลังบ้าน/ครัว/เหล้า/บิลค้าง ไม่ต้องโหลดตอนเปิดหน้าร้าน → เริ่มแอปไวขึ้น
const KitchenMonitor = lazy(() => import('./components/KitchenMonitor'));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const Dashboard = lazy(() => import('./components/admin/Dashboard'));
const ManageMenu = lazy(() => import('./components/admin/ManageMenu'));
const ManagePromotions = lazy(() => import('./components/admin/ManagePromotions'));
const ManageCategories = lazy(() => import('./components/admin/ManageCategories'));
const ManageTables = lazy(() => import('./components/admin/ManageTables'));
const ManagePrinters = lazy(() => import('./components/admin/ManagePrinters'));
const ManageUsers = lazy(() => import('./components/admin/ManageUsers'));
const ManageBranches = lazy(() => import('./components/admin/ManageBranches'));
const ManageBranchMenu = lazy(() => import('./components/admin/ManageBranchMenu'));
const ManageSettings = lazy(() => import('./components/admin/ManageSettings'));
const ManageStock = lazy(() => import('./components/admin/ManageStock'));
const ManageBOM = lazy(() => import('./components/admin/ManageBOM'));
const Reports = lazy(() => import('./components/admin/Reports'));
const OutstandingBills = lazy(() => import('./components/OutstandingBills'));
const LiquorStorage = lazy(() => import('./components/LiquorStorage'));
const WasteRecord = lazy(() => import('./components/WasteRecord'));
const CustomerKiosk = lazy(() => import('./components/CustomerKiosk'));
import { resolvePopupSource, flattenPopupConfig, getPriceOptions, categoryDining, resolveNoteConfig } from './utils/popupConfig';
import { priceForSaleType, readTablesConfig } from './utils/salePricing';
import { categoryVisibleFor } from './utils/categoryVisibility';
import './index.css';
import { sendPrintJob, setReceiptHeader } from './utils/printServer';
import { print80mm } from './utils/print80mm';
import { getPrinterByType, getPrinters, mergeServerPrinters, printKitchenOrder, printPreBill } from './utils/printerRouting';
import { API_URL, setAuthToken, AUTH_REQUIRED_EVENT } from './utils/api';

const MENU_ITEMS = [];

// รหัสสาขานำหน้าเลขบิล — ตัดช่องว่าง/อักขระพิเศษ เป็นตัวพิมพ์ใหญ่ (เช่น "xum" → "XUM")
// กันเลขบิลชนกันข้ามสาขา (แต่ละสาขานับเลขของตัวเองแยกกัน)
const branchPrefix = (b) => {
  const p = String(b || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Zก-๙]/g, '');
  return p || 'POS';
};

// หน้าพนักงานต้องล็อกอินเสมอ — ยกเว้นระบบที่ยังไม่มีพนักงานคนไหนตั้งรหัสเลย (ติดตั้งใหม่)
// ซึ่งหน้าล็อกอินจะมีปุ่มเข้าแบบตั้งค่าครั้งแรกเป็น DEFAULT_ADMIN ให้ไปสร้างพนักงานก่อน
// (สวิตช์ requireLogin ในตั้งค่าร้านยังมีผลที่ฝั่ง API: ให้เซิร์ฟเวอร์ปฏิเสธคำขอที่ไม่ได้ล็อกอิน)
const hasPin = (u) => u && (u.hasPin === true || String(u.pin ?? '').trim() !== '');
const DEFAULT_ADMIN = { id: 'admin', username: 'admin', branch: 'admin', canCheckout: true, isAdmin: true };


// สร้างข้อมูลใบครัวจากแถวของชีต TableOrders
// ส่งแบบ flattened: ชื่อมี (xN) ต่อท้ายให้เครื่องอ่านจำนวนออก และยัดตัวเลือก/หมายเหตุ
// ลง subItems เพื่อให้ครัวเห็นครบ (เช่น "📝 ไม่ใส่ผัก")
// ประเภทของโต๊ะตามโซนในผังโต๊ะ → หัวใบครัว (ทานที่ร้าน / ห่อกลับบ้าน / Delivery)
const ZONE_DINING = { Takehome: 'ห่อกลับบ้าน', Delivery: 'Delivery' };
const diningForTable = (tables, tableNo) => {
  const t = (Array.isArray(tables) ? tables : []).find(x => String(x.name) === String(tableNo));
  return (t && ZONE_DINING[t.zone]) || '';
};

const buildKitchenOrder = (rows, tableNo, id, timestamp, dining = '') => ({
  id,
  dining,
  orderNumber: `โต๊ะ ${tableNo}`,
  customerDetails: { name: `โต๊ะ ${tableNo}`, address: `โต๊ะ ${tableNo}` },
  items: rows.map(row => {
    const qty = Number(row.Quantity) || 1;
    return {
      isFlattened: true,
      name: qty > 1 ? `${row.ItemName} (x${qty})` : row.ItemName,
      subItems: row.Options ? String(row.Options).split(', ').filter(Boolean) : []
    };
  }),
  total: rows.reduce((sum, r) => sum + (Number(r.ItemPrice) || 0) * (Number(r.Quantity) || 1), 0),
  status: 'pending',
  timestamp
});

// ส่งบิลขึ้นระบบ — ถ้าไม่สำเร็จจะโยน Error ที่ message เป็นสาเหตุภาษาคนอ่านรู้เรื่อง
// (ใช้ทั้งตอนชำระเงินและตอนส่งบิลค้างซ้ำ เพื่อให้แถบแจ้งเตือนบอกได้ว่าพังที่เน็ตหรือที่ฐานข้อมูล)
async function postOrderPayload(payload) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('ส่งไม่ถึงเซิร์ฟเวอร์ — เน็ตหลุด หรือ API ไม่ทำงาน');
  }
  const json = await res.json().catch(() => null);
  if (json && json.success === true) return json;
  if (!json) throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${res.status})`);
  const raw = String(json.error || 'เซิร์ฟเวอร์ไม่ตอบ success');
  if (/ต่อ SQL Server|Failed to connect|ETIMEOUT|ESOCKET|ECONNREFUSED/i.test(raw)) {
    throw new Error('เซิร์ฟเวอร์ต่อฐานข้อมูล SQL Server ไม่ได้');
  }
  // ข้อความจากเซิร์ฟเวอร์อาจยาวหลายบรรทัด (มีวิธีแก้ต่อท้าย) — เอาแค่บรรทัดแรกพอ
  const firstLine = raw.split('\n')[0];
  throw new Error(firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine);
}

// ส่งบิลค้างซ้ำเองทุก ๆ เท่านี้ — กรณีเน็ตเครื่องปกติแต่ API/ฐานข้อมูลล่ม จะไม่มี event 'online' มาปลุก
const PENDING_RETRY_MS = 90 * 1000;

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('food');
  const [lang, setLang] = useState('th');
  // ประเภทลูกค้าที่เลือกอยู่ (กำหนดราคาของทุกเมนู) — '' = ราคาปกติ
  const [customerType, setCustomerType] = useState('');
  // ชื่อลูกค้า (ไม่บังคับกรอก)
  const [customerName, setCustomerName] = useState('');
  // เริ่มต้นด้วยค่าว่างเพื่อให้ระบบบังคับให้ผู้ใช้เลือกโต๊ะก่อนสั่งอาหาร
  const [tableNumber, setTableNumber] = useState('');

  // Users & Auth — seed from cache so login shows immediately without waiting for the API
  const [users, setUsers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cached_users') || '[]'); } catch { return []; }
  });
  // ให้ล็อกอินใหม่ทุกครั้งที่เปิดโปรแกรม — ไม่กู้สถานะล็อกอินเดิมจาก localStorage
  // (ยังไม่เปิดบังคับล็อกอิน → ข้ามหน้าล็อกอิน เข้าเป็นแอดมินทันที)
  const [currentUser, setCurrentUser] = useState(null);
  // ล้าง key เก่าที่เคยจำล็อกอินไว้ (เผื่อเครื่องที่อัปเดตมาจากเวอร์ชันก่อน)
  React.useEffect(() => {
    try { localStorage.removeItem('current_user'); } catch {}
  }, []);

  // สิทธิ์แอดมิน: รองรับ flag isAdmin จากชีต และเผื่อ user ชื่อ admin
  const isAdmin = !!(currentUser && (currentUser.isAdmin === true || currentUser.isAdmin === 'TRUE' || String(currentUser.username || '').toLowerCase() === 'admin'));
  // สิทธิ์แคชเชียร์: เข้าหลังบ้านได้บางหน้า (ไม่เห็นราคาต้นทุน)
  const isCashier = !isAdmin && !!(currentUser && (currentUser.isCashier === true || currentUser.isCashier === 'TRUE'));
  // สาขาของเครื่องนี้ — เลือกที่หน้าแรก (เลือกสาขา → หน้าพนักงาน/หน้าลูกค้า) เครื่องจำไว้
  const [deviceBranch, setDeviceBranchState] = useState(() => {
    try { return localStorage.getItem('device_branch') || ''; } catch { return ''; }
  });
  const setDeviceBranch = (id) => {
    setDeviceBranchState(id || '');
    try { if (id) localStorage.setItem('device_branch', id); else localStorage.removeItem('device_branch'); } catch {}
  };
  // สาขาของผู้ใช้ปัจจุบัน = คอลัม A ของชีต Users (branch) — ใช้บันทึกลง Orders.RecordedBy และกรองรายงาน
  // ยังไม่บังคับล็อกอิน (เข้าเป็นแอดมินอัตโนมัติ) → ใช้สาขาที่เลือกไว้ที่หน้าแรกของเครื่องนี้
  const userBranch = String(currentUser?.branch || currentUser?.id || currentUser?.username || '').trim();
  const branch = currentUser === DEFAULT_ADMIN && deviceBranch ? deviceBranch : userBranch;
  const isLandingPath = location.pathname === '/';
  // สาขาที่หน้าจอนี้ทำงานอยู่ — หน้าลูกค้าสั่งเอง (QR โต๊ะ) ใช้ ?b= จากลิงก์ ส่วนหน้าร้านใช้สาขาของผู้ใช้ที่ล็อกอิน
  const isKioskPath = location.pathname.includes('/kiosk') || location.pathname.includes('/self-order');
  const kioskBranchParam = isKioskPath ? (new URLSearchParams(location.search).get('b') || '').trim() : '';
  const activeBranch = kioskBranchParam || branch;

  // แจ้งเตือนเมื่อบันทึกบิล/การชำระเงินขึ้น Google Sheet ไม่สำเร็จ (เน็ตหลุด/แบ็กเอนด์ error)
  // — กันเคส payment หายเงียบ ๆ แบบช่วงบิล #233–#296 ที่ผ่านมา
  // ค่า: null | { type: 'error' | 'success', msg: string }
  const [saveAlert, setSaveAlert] = useState(null);

  // เวลาที่ล็อกอินเข้าระบบ — ใช้เช็ก auto-logout เมื่อครบ 8 ชั่วโมง
  const loginAtRef = React.useRef(null);

  const handleLogin = (user) => {
    setCurrentUser(user);
    loginAtRef.current = Date.now();
    // ไม่บันทึกลง localStorage — ปิด/รีเฟรชโปรแกรมแล้วต้องล็อกอินใหม่เสมอ
    // เข้าสู่ระบบใหม่ → ไปที่หน้าสั่งอาหารทันที
    setTableNumber('');
    navigate('/index', { replace: true });
  };

  const handleLogout = () => {
    setAuthToken('');
    setCurrentUser(null);
    loginAtRef.current = null;
    try { localStorage.removeItem('current_user'); } catch {}
    setTableNumber('');
    navigate('/', { replace: true });
  };

  // อยู่ในระบบเกิน 8 ชั่วโมง → ล็อกเอาต์อัตโนมัติ
  // เช็กทุก 1 นาที + เช็กซ้ำตอนแท็บกลับมาโฟกัส (กัน browser หน่วง timer ตอนพับจอ)
  React.useEffect(() => {
    if (!currentUser) return;
    const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
    const check = () => {
      if (loginAtRef.current && Date.now() - loginAtRef.current >= SESSION_MAX_MS) {
        handleLogout();
        setSaveAlert({ type: 'error', msg: '⏰ อยู่ในระบบครบ 8 ชั่วโมงแล้ว ระบบล็อกเอาต์อัตโนมัติ — กรุณาล็อกอินใหม่' });
      }
    };
    const id = setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [currentUser]);



  React.useEffect(() => {
    if (tableNumber) localStorage.setItem('table_number', tableNumber);
    else localStorage.removeItem('table_number');
  }, [tableNumber]);

  // ── Retry บิลที่ค้างใน localStorage (pending_orders) ──
  // เรียกตอนเปิดแอปและเมื่อเน็ตกลับมา — ส่งซ้ำเฉพาะที่ backend ยังไม่ตอบ success
  const flushingRef = React.useRef(false);
  const flushPendingOrders = React.useCallback(async () => {
    if (flushingRef.current) return; // กันรันซ้อน (mount + online event)
    let pending;
    try { pending = JSON.parse(localStorage.getItem('pending_orders') || '[]'); } catch { pending = []; }
    if (!Array.isArray(pending) || pending.length === 0) return;

    flushingRef.current = true;
    const stillPending = [];
    let lastReason = '';
    for (const entry of pending) {
      try {
        const json = await postOrderPayload(entry.payload);
        // บิลที่ตอนชำระบันทึกไม่ได้ ลูกค้าได้ใบเสร็จธรรมดาไปก่อน — ได้เลขแล้วพิมพ์ใบกำกับภาษีอย่างย่อตามให้
        const receiptPrinter = entry.receiptOrder ? getPrinterByType('receipt') : null;
        if (receiptPrinter && json && json.orderNumber && !json.duplicate) {
          sendPrintJob({ ip: receiptPrinter.ip, printerType: 'receipt', orderData: { ...entry.receiptOrder, id: json.orderNumber, orderNumber: json.orderNumber, paid: true, noDrawer: true } })
            .catch(err => console.error('Late receipt print failed:', err));
        }
      } catch (err) {
        lastReason = err.message;
        stillPending.push({ ...entry, error: err.message }); // ยังส่งไม่ได้ เก็บไว้รอบหน้า
      }
    }
    // ระหว่างส่งอาจมีบิลใหม่ที่พังเพิ่มเข้ามา — อ่านซ้ำแล้วเก็บตัวที่ไม่ได้อยู่ในรอบนี้ไว้ด้วย
    let added = [];
    try {
      const latest = JSON.parse(localStorage.getItem('pending_orders') || '[]');
      if (Array.isArray(latest)) added = latest.slice(pending.length);
    } catch {}
    localStorage.setItem('pending_orders', JSON.stringify([...stillPending, ...added]));
    flushingRef.current = false;

    const sent = pending.length - stillPending.length;
    if (sent > 0) {
      if (stillPending.length === 0) {
        setSaveAlert({ type: 'success', msg: `✅ ส่งบิลที่ค้าง ${sent} รายการขึ้นระบบสำเร็จแล้ว` });
        setTimeout(() => setSaveAlert(cur => (cur && cur.type === 'success' ? null : cur)), 5000);
      } else {
        setSaveAlert({ type: 'error', msg: `⚠️ ส่งบิลค้างได้ ${sent} รายการ เหลืออีก ${stillPending.length} รายการที่ยังส่งไม่ได้ — สาเหตุ: ${lastReason}` });
      }
    }
  }, []);

  React.useEffect(() => {
    flushPendingOrders();
    window.addEventListener('online', flushPendingOrders);
    const timer = setInterval(flushPendingOrders, PENDING_RETRY_MS);
    return () => {
      window.removeEventListener('online', flushPendingOrders);
      clearInterval(timer);
    };
  }, [flushPendingOrders]);

  const [orders, setOrders] = useState([]);
  // เลขบิลล่าสุดแยกตามสาขา (RecordedBy) — { [สาขา]: เลขสูงสุด } เพื่อให้แต่ละสาขานับต่อของตัวเอง
  const [branchMaxMap, setBranchMaxMap] = useState({});
  // ข้อมูลสาขาจากหลังบ้าน (ตาราง Branches) — อ่านจาก cache ก่อน เพื่อให้เลขบิลใช้ตัวนำหน้าที่ถูกตั้งแต่เปิดแอป
  const [branches, setBranches] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}'); return Array.isArray(d.branches) ? d.branches : []; } catch { return []; }
  });
  // ตัวนำหน้าเลขบิลของสาขานี้ — ตั้งไว้ในหน้าตั้งค่าสาขา ถ้าไม่ได้ตั้งใช้รหัสสาขาแบบเดิม
  // (เลขที่นับต่อยังแยกตาม RecordedBy เหมือนเดิม เปลี่ยนตัวนำหน้าแล้วเลขไม่เริ่มใหม่)
  const billPrefix = React.useMemo(() => {
    const key = branch.toLowerCase();
    const info = branches.find(b => String(b.id || '').trim().toLowerCase() === key);
    return branchPrefix(info && info.billPrefix ? info.billPrefix : branch);
  }, [branches, branch]);
  // รหัสสาขาที่ส่งไปกับคำขอ — ต้องตรงกับรายการในหน้าตั้งค่าสาขา
  // ไม่ตรง/ยังโหลดรายการสาขาไม่ได้ → '' ให้เซิร์ฟเวอร์ลงสาขาหลัก และอ่านได้ทุกโต๊ะเหมือนเดิม
  const branchKey = React.useMemo(() => {
    const key = activeBranch.toLowerCase();
    const info = branches.find(b => String(b.id || '').trim().toLowerCase() === key);
    return info ? String(info.id).trim() : '';
  }, [branches, activeBranch]);
  // สาขาหลักจากเซิร์ฟเวอร์ (สาขาแรกที่เปิดใช้งาน) + ผังโต๊ะของทุกสาขา
  const [defaultBranch, setDefaultBranch] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem('gas_all_data') || '{}').defaultBranch || ''); } catch { return ''; }
  });
  const [branchTables, setBranchTables] = useState(null);
  // ปริ้นเตอร์จากเซิร์ฟเวอร์ (ทุกสาขา) — ใช้เฉพาะของสาขานี้ ดูเอฟเฟกต์ด้านล่าง
  const [serverPrinters, setServerPrinters] = useState(null);
  // สาขาที่ใช้เลือกผังโต๊ะและลิงก์ QR — ผู้ใช้ไม่ได้อยู่สาขาที่มีในรายการ ให้ถือเป็นสาขาหลัก
  const tablesBranch = branchKey || defaultBranch;
  const kioskPathRef = React.useRef(isKioskPath);
  kioskPathRef.current = isKioskPath;
  // ผังโต๊ะของสาขาสำหรับหน้าลูกค้า (เข้าจากหน้าแรกโดยไม่มีเลขโต๊ะ → ลูกค้าเลือกโต๊ะเอง)
  const kioskTables = (branchTables && Array.isArray(branchTables[tablesBranch]) && branchTables[tablesBranch]) || readTablesConfig();
  // ตัวดึงข้อมูลถูกเรียกจาก setInterval ที่ผูกไว้ตั้งแต่เปิดแอป — ต้องอ่านสาขาปัจจุบันผ่าน ref
  const branchKeyRef = React.useRef(branchKey);
  branchKeyRef.current = branchKey;
  const [liveMenu, setLiveMenu] = useState([...MENU_ITEMS]);
  const [categories, setCategories] = useState([
    { slug: 'food', name: 'อาหาร', nameEn: 'Food', icon: '🍲' },
    { slug: 'drink', name: 'เครื่องดื่ม', nameEn: 'Drinks', icon: '🥤' }
  ]);
  const [allCategories, setAllCategories] = useState([]);
  const [allMenu, setAllMenu] = useState([...MENU_ITEMS]);

  // POS Settings (service charge, VAT)
  const [posSettings, setPosSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pos_settings') || '{}'); } catch { return {}; }
  });

  React.useEffect(() => {
    const handler = () => {
      try { setPosSettings(JSON.parse(localStorage.getItem('pos_settings') || '{}')); } catch {}
    };
    window.addEventListener('pos_settings_changed', handler);
    return () => window.removeEventListener('pos_settings_changed', handler);
  }, []);

  // เซิร์ฟเวอร์ตอบว่า token หมดอายุ/ไม่มี (เปิดบังคับล็อกอินอยู่) → กลับหน้าล็อกอิน
  React.useEffect(() => {
    const onAuthRequired = () => {
      if (kioskPathRef.current) return;
      setAuthToken('');
      setCurrentUser(null);
      setSaveAlert({ type: 'error', msg: '🔒 หมดเวลาใช้งาน หรือยังไม่ได้ล็อกอิน — กรุณาล็อกอินใหม่' });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  // พนักงานทุกสาขา + มีสาขาที่เปิดใช้งานอยู่สาขาเดียว → เลือกให้เลย ไม่ต้องกด
  React.useEffect(() => {
    if (!currentUser || !isAllBranches(currentUser.branch)) return;
    const active = branches.filter(b => b.isActive !== false);
    // หรือเลือกสาขาของเครื่องนี้ไว้แล้วที่หน้าแรก → ใช้สาขานั้นเลย
    const pick = active.length === 1 ? active[0] : active.find(b => String(b.id) === String(deviceBranch));
    if (pick) setCurrentUser(u => ({ ...u, branch: String(pick.id), allBranches: true }));
  }, [currentUser, branches, deviceBranch]);

  // โหลดรายการสาขาจากเซิร์ฟเวอร์ครั้งแรกเสร็จหรือยัง (หน้าแรกรอก่อนแสดง) — เซิร์ฟเวอร์ไม่ตอบ 8 วิ ก็ไปต่อ
  const [staticLoaded, setStaticLoaded] = useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setStaticLoaded(true), 8000);
    return () => clearTimeout(t);
  }, []);

  // เปลี่ยนสาขา (ล็อกอินคนละสาขา / เพิ่งโหลดรายการสาขาเสร็จ) → ดึงโต๊ะของสาขาใหม่ทันที ไม่รอรอบ 20 วิ
  const branchFetchReadyRef = React.useRef(false);
  React.useEffect(() => {
    if (!branchFetchReadyRef.current) { branchFetchReadyRef.current = true; return; }
    lastRawRef.current = null;
    fetchOrdersFromSheet();
    fetchStaticFromSheet(); // เมนู/ราคาของสาขาใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey]);

  // ปริ้นเตอร์ของสาขานี้เท่านั้น → ที่เดิม (printers_config) ที่หน้าขาย/หน้าครัวใช้พิมพ์
  // แถวที่ไม่มีสาขา (API รุ่นเก่า) ถือว่าเป็นของทุกสาขาเหมือนเดิม
  React.useEffect(() => {
    if (!serverPrinters || !tablesBranch) return;
    const mine = serverPrinters.filter(p => !p.branchId || String(p.branchId) === String(tablesBranch));
    // รวมกับค่าที่ตั้งไว้ในเครื่องก่อน ไม่งั้นค่าที่เซิร์ฟเวอร์ไม่มีคอลัมน์ให้ (เช่น แยกใบ/รวมใบ) จะถูกล้างทิ้ง
    const json = JSON.stringify(mergeServerPrinters(mine));
    try {
      if (localStorage.getItem('printers_config') !== json) {
        localStorage.setItem('printers_config', json);
        window.dispatchEvent(new Event('printers_changed'));
      }
    } catch {}
  }, [serverPrinters, tablesBranch]);

  // หัวใบเสร็จของสาขานี้ — แนบไปกับทุกงานพิมพ์
  React.useEffect(() => {
    const b = branches.find(x => String(x.id) === String(tablesBranch));
    setReceiptHeader(b ? {
      name: b.name || b.id, address: b.address || '', phone: b.phone || '',
      taxId: b.taxId || '', posId: b.posId || '', footer: b.receiptFooter || '',
      // อัตรา VAT สำหรับแยกยอดในใบกำกับภาษีอย่างย่อ — ใช้ค่าเดียวกับใบกำกับเต็มรูป (ไม่ได้ตั้ง = 7)
      vatRate: Number(posSettings?.vat?.rate) > 0 ? Number(posSettings.vat.rate) : 7
    } : null);
  }, [branches, tablesBranch, posSettings]);

  // ผังโต๊ะของสาขานี้จากเซิร์ฟเวอร์ → เขียนลงที่เดิม (pos_tables_config) ที่หน้าขายอ่านอยู่แล้ว
  // สาขาที่ยังไม่เคยบันทึกผังขึ้นระบบ → ใช้ผังเดิมในเครื่องไปก่อน
  React.useEffect(() => {
    if (!branchTables || !tablesBranch) return;
    const list = branchTables[tablesBranch];
    if (!Array.isArray(list) || list.length === 0) return;
    const json = JSON.stringify(list);
    try {
      if (localStorage.getItem('pos_tables_config') !== json) localStorage.setItem('pos_tables_config', json);
    } catch {}
  }, [branchTables, tablesBranch]);

  // settings ที่ใช้จริงตอนเช็คบิล = ค่ากลาง + ทับด้วย QR เฉพาะสาขาที่ล็อกอินอยู่ (ถ้ามีตั้งไว้)
  // เก็บใน posSettings.branchQR[ชื่อสาขา] — ไม่มีของสาขานั้น จะ fallback ใช้ QR กลาง
  const checkoutSettings = React.useMemo(() => {
    const map = posSettings?.branchQR;
    const bq = map && typeof map === 'object' ? map[activeBranch] : null;
    if (!bq) return posSettings;
    const override = {};
    ['qrType', 'kshopRawPayload', 'promptPayId', 'staticQrUrl'].forEach(k => {
      if (bq[k] !== undefined && bq[k] !== '') override[k] = bq[k];
    });
    // ชื่อร้าน/บัญชีของสาขานี้ — ถ้าสาขาไม่ได้กรอกชื่อร้าน ให้โชว์ชื่อสาขาแทน
    // (กันไม่ให้ fallback ไปโชว์ชื่อร้านกลางที่เป็นของอีกสาขา)
    override.qrShopName = bq.qrShopName || activeBranch;
    if (bq.qrAccountName) override.qrAccountName = bq.qrAccountName;
    return { ...posSettings, ...override };
  }, [posSettings, activeBranch]);

  // POS Discounts
  const [posDiscounts, setPosDiscounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pos_discounts') || '[]'); } catch { return []; }
  });

  React.useEffect(() => {
    const handler = () => {
      try { setPosDiscounts(JSON.parse(localStorage.getItem('pos_discounts') || '[]')); } catch {}
    };
    window.addEventListener('pos_discounts_changed', handler);
    return () => window.removeEventListener('pos_discounts_changed', handler);
  }, []);

  // TABLE ORDERS STATE
  const [tableOrders, setTableOrders] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // CHECKOUT (from table view)
  const [checkoutItems, setCheckoutItems] = useState([]);
  const [checkoutTotal, setCheckoutTotal] = useState(0);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutDiscount, setCheckoutDiscount] = useState(null);
  const [showSalesSummaryModal, setShowSalesSummaryModal] = useState(false);
  const [showTaxInvoicePage, setShowTaxInvoicePage] = useState(false);
  const [salesSummaryMode, setSalesSummaryMode] = useState('daily'); // 'daily' | 'range'

  // เก็บ JSON ของแต่ละส่วนที่ apply ไปแล้ว → อัปเดต state เฉพาะส่วนที่เปลี่ยนจริง (กัน re-render ทั้งแอปทุก 10 วิ)
  const appliedRef = React.useRef({});
  const lastRawRef = React.useRef('');
  const lastStaticRef = React.useRef('');
  // กันยิงซ้อน: เซิร์ฟเวอร์ตอบช้า แต่ poll เป็นรอบ — ถ้ารอบก่อนยังไม่เสร็จให้ข้ามรอบนี้ไป
  const inFlightRef = React.useRef(false);
  const staticInFlightRef = React.useRef(false);
  // ถ้า Apps Script ที่ deploy อยู่ยังเป็นเวอร์ชันเก่า (ไม่รู้จัก getLive/getStatic)
  // ให้ถอยกลับไปใช้ getAllData แบบเดิม เพื่อไม่ให้ร้านใช้งานไม่ได้ระหว่างรอ deploy
  const legacyGasRef = React.useRef(false);
  const changed = (key, value) => {
    const json = JSON.stringify(value);
    if (appliedRef.current[key] === json) return false;
    appliedRef.current[key] = json;
    return true;
  };

  const processAppGASData = (data) => {
    if (data.categories && Array.isArray(data.categories) && changed('categories', data.categories)) {
      setAllCategories(data.categories);
      setCategories(data.categories.filter(c => c.isActive !== false));
    }
    if (data.orders && Array.isArray(data.orders) && changed('orders', data.orders)) {
      const groupedOrders = {};
      data.orders.forEach(row => {
        const num = row.OrderNumber;
        if (!num) return;
        if (!groupedOrders[num]) {
          groupedOrders[num] = {
            id: num,
            orderNumber: num,
            customerDetails: { name: row.CustomerName, address: row.Address },
            items: [],
            total: parseFloat(row.TotalAmount) || 0,
            status: (row.Status || 'pending').toLowerCase(),
            timestamp: row.OrderStartTime || row.Timestamp
          };
        } else if ((row.Status || '').toLowerCase() === 'pending') {
          groupedOrders[num].status = 'pending';
        }
        const isSubItem = typeof row.ItemDetail === 'string' && row.ItemDetail.trim().startsWith('↳');
        if (isSubItem && groupedOrders[num].items.length > 0) {
          const lastItem = groupedOrders[num].items[groupedOrders[num].items.length - 1];
          if (!lastItem.subItems) lastItem.subItems = [];
          lastItem.subItems.push(row.ItemDetail);
        } else {
          groupedOrders[num].items.push({ isFlattened: true, name: row.ItemDetail, dining: row.DiningOption });
        }
      });
      const sortedOrders = Object.values(groupedOrders).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setOrders(sortedOrders);
      // หาเลขบิลสูงสุดแยกตามสาขา (RecordedBy) — บิลเก่าที่ไม่มี RecordedBy รวมเป็นสาขาว่าง
      const branchMaxes = {};
      data.orders.forEach(row => {
        if (!row.OrderNumber) return;
        const by = String(row.RecordedBy || '').trim();
        // เลขลำดับท้ายเลขบิลเท่านั้น (XXX-#031 → 31) — ตัวนำหน้าที่มีตัวเลขไม่ทำให้เลขกระโดด
        const val = parseInt((/#(\d+)\s*$/.exec(String(row.OrderNumber)) || [])[1], 10);
        if (!isNaN(val)) branchMaxes[by] = Math.max(branchMaxes[by] || 0, val);
      });
      setBranchMaxMap(prev => {
        const merged = { ...prev };
        Object.keys(branchMaxes).forEach(k => { merged[k] = Math.max(merged[k] || 0, branchMaxes[k]); });
        return merged;
      });
    }
    if (data.menu && Array.isArray(data.menu) && changed('menu', data.menu)) {
      // flatten per-item popupConfig JSON onto each menu item for the wizard
      const flatMenu = data.menu.map(flattenPopupConfig);
      setAllMenu(flatMenu);
      setLiveMenu(flatMenu.filter(m => m.isActive !== false));
    }
    if (data.tableOrders && Array.isArray(data.tableOrders)) {
      // โต๊ะเป็นข้อมูลที่เปลี่ยนบ่อยและต้องตรงเสมอ → อัปเดตทุกครั้งที่ payload เปลี่ยน
      setTableOrders(data.tableOrders);
    }
    if (Array.isArray(data.branches)) setStaticLoaded(true);
    if (data.branches && Array.isArray(data.branches) && changed('branches', data.branches)) {
      setBranches(data.branches);
    }
    if (typeof data.defaultBranch === 'string') setDefaultBranch(data.defaultBranch);
    if (data.branchTables && typeof data.branchTables === 'object' && changed('branchTables', data.branchTables)) {
      setBranchTables(data.branchTables);
    }
    if (data.users && Array.isArray(data.users) && changed('users', data.users)) {
      localStorage.setItem('cached_users', JSON.stringify(data.users));
      setUsers(data.users);
    }
    if (data.settings && typeof data.settings === 'object' && changed('settings', data.settings)) {
      localStorage.setItem('pos_settings', JSON.stringify(data.settings));
      setPosSettings(data.settings);
    }
    if (data.printers && Array.isArray(data.printers) && data.printers.length > 0 && changed('printers', data.printers)) {
      setServerPrinters(data.printers);
    }
    if (data.discounts && Array.isArray(data.discounts) && data.discounts.length > 0 && changed('discounts', data.discounts)) {
      localStorage.setItem('pos_discounts', JSON.stringify(data.discounts));
      setPosDiscounts(data.discounts);
    }
  };

  // เขียนทับเฉพาะส่วนที่ดึงมา ลงก้อน cache รวม 'gas_all_data'
  // (ชื่อคีย์ยังใช้ของเดิม เพราะหน้าหลังบ้านหลายหน้าอ่าน/แก้ก้อนนี้อยู่ และเครื่องที่ใช้งานอยู่มีข้อมูลค้างในคีย์นี้)
  const mergeIntoCache = (partial) => {
    try {
      const base = JSON.parse(localStorage.getItem('gas_all_data') || '{}') || {};
      const merged = { ...base, ...partial };
      delete merged.error; // กันข้อความ error จากเซิร์ฟเวอร์ค้างอยู่ในก้อน cache
      localStorage.setItem('gas_all_data', JSON.stringify(merged));
    } catch {}
  };

  // ยิง action ใหม่ก่อน ถ้าปลายทางเป็นเวอร์ชันเก่าจะตอบ {"error":"Unknown GET action"}
  // → จำไว้แล้วถอยไปใช้ getAllData ตลอดทั้ง session
  const fetchAction = async (action, signal) => {
    if (legacyGasRef.current) return await (await fetch(API_URL + '?action=getAllData', { signal })).text();
    // getLive ของแต่ละสาขา = โต๊ะและบิลของร้านตัวเองเท่านั้น / getStatic = เมนูที่ปรับตามสาขาแล้ว
    const branchQs = (action === 'getLive' || action === 'getStatic') && branchKeyRef.current
      ? '&branch=' + encodeURIComponent(branchKeyRef.current) : '';
    const text = await (await fetch(API_URL + '?action=' + action + branchQs, { signal })).text();
    if (text.indexOf('Unknown GET action') !== -1) {
      legacyGasRef.current = true;
      console.warn(`API ยังไม่รองรับ ?action=${action} — ใช้ getAllData แทน (ต้องอัปเดต API เป็นเวอร์ชันใหม่)`);
      return await (await fetch(API_URL + '?action=getAllData', { signal })).text();
    }
    return text;
  };

  // ข้อมูล "เย็น" — เมนู/หมวดหมู่/โปรโมชั่น/พนักงาน/ปริ้นเตอร์/ส่วนลด/ตั้งค่า
  // เปลี่ยนเฉพาะตอนแก้หลังบ้าน → ดึงนาทีละครั้งพอ
  const fetchStaticFromSheet = async () => {
    if (staticInFlightRef.current) return;
    staticInFlightRef.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const text = await fetchAction('getStatic', controller.signal);
      if (text === lastStaticRef.current) return; // เหมือนเดิมเป๊ะ → ไม่ต้องทำอะไรต่อ
      lastStaticRef.current = text;
      const data = JSON.parse(text);
      if (data) {
        mergeIntoCache(data);
        processAppGASData(data);
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error fetching static from API:', e);
    } finally {
      clearTimeout(timer);
      staticInFlightRef.current = false;
    }
  };

  // ข้อมูล "ร้อน" — รายการอาหารรายโต๊ะ + ออเดอร์ล่าสุด ต้องสดเสมอ (อ่านแค่ 2 ชีท)
  const fetchOrdersFromSheet = async () => {
    if (kioskPathRef.current) return; // หน้าลูกค้าสั่งเองไม่ใช้ข้อมูลโต๊ะ/บิล (และไม่มีสิทธิ์อ่านเมื่อบังคับล็อกอิน)
    if (inFlightRef.current) return; // รอบก่อนยังค้างอยู่ → ข้าม กันคำขอกองซ้อนกัน
    inFlightRef.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000); // timeout 20 วิ
    try {
      const text = await fetchAction('getLive', controller.signal);
      clearTimeout(timer);
      // ถ้าข้อมูลเหมือนเดิมเป๊ะ → ข้ามทั้งหมด (ไม่ parse/ไม่เซ็ต state/ไม่เขียน localStorage)
      if (text === lastRawRef.current) return;
      lastRawRef.current = text;
      const data = JSON.parse(text);
      if (data) {
        // ต้อง merge ไม่ใช่เขียนทับ — ไม่งั้นเมนู/หมวดหมู่ที่ดึงมาจาก getStatic จะหายไปจาก cache
        mergeIntoCache(data);
        processAppGASData(data);
      }
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== 'AbortError') console.error('Error fetching from API:', e);
      // ถ้า cache มีอยู่แล้ว ให้ใช้ cache แสดงแทน
      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try { processAppGASData(JSON.parse(cached)); } catch {}
      }
    } finally {
      clearTimeout(timer);
      inFlightRef.current = false;
    }
  };

  // ปุ่มรีเฟรช = กดเอง จึงดึงทั้งของสดและเมนู/ตั้งค่าใหม่ทั้งคู่
  const refreshTableOrders = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchOrdersFromSheet(), fetchStaticFromSheet()]);
    setIsRefreshing(false);
  };

  React.useEffect(() => {
    // แสดงเมนู/หมวดหมู่จาก cache ในเครื่องทันที ไม่ต้องรอเซิร์ฟเวอร์ตอบ
    // ของจริงจะ sync ทับเบื้องหลัง — changed() กันไม่ให้ re-render ซ้ำถ้าข้อมูลเหมือนเดิม
    const cached = localStorage.getItem('gas_all_data');
    if (cached) {
      try { processAppGASData(JSON.parse(cached)); } catch {}
    }
    fetchStaticFromSheet();
    fetchOrdersFromSheet();
    // แยกจังหวะ: ข้อมูลโต๊ะต้องสด → ทุก 20 วิ (อ่านแค่ 2 ชีท เร็ว)
    //            เมนู/พนักงาน/ตั้งค่า เปลี่ยนนาน ๆ ที → ทุก 1 นาที
    // หยุด poll เมื่อแท็บถูกซ่อน (พับจอ/สลับแอป) แล้วดึงทันทีตอนกลับมา
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrdersFromSheet();
    }, 20000);
    const staticInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchStaticFromSheet();
    }, 60000);
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fetchOrdersFromSheet();
      fetchStaticFromSheet();
    };
    document.addEventListener('visibilitychange', handleVisible);
    const handleLocalUpdate = () => {
      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed) processAppGASData(parsed);
        } catch (e) { }
      }
    };
    window.addEventListener('appDataChanged', handleLocalUpdate);
    return () => {
      clearInterval(interval);
      clearInterval(staticInterval);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('appDataChanged', handleLocalUpdate);
    };
  }, []);

  // เมนู 1 รายการอยู่ได้หลายหมวด: เช็คทั้งหมวดหลัก (category) และหมวดเพิ่มเติม (categories[])
  const itemInCategory = (item, slug) => {
    const primary = item.category || 'food';
    const extra = Array.isArray(item.categories) ? item.categories : [];
    return primary === slug || extra.includes(slug);
  };

  React.useEffect(() => {
    const visibleCats = categories.filter(cat => categoryVisibleFor(cat, 'staff') && liveMenu.some(i => itemInCategory(i, cat.slug)));
    if (visibleCats.length > 0 && !visibleCats.find(c => c.slug === activeCategory)) {
      setActiveCategory(visibleCats[0].slug);
    }
  }, [categories, liveMenu]);

  const [selectedFood, setSelectedFood] = useState(null);
  const [cart, setCart] = useState([]);

  React.useEffect(() => {
    setCart([]);
  }, [tableNumber]);

  // ราคาที่เมนูตั้งไว้สำหรับ "ประเภทลูกค้า/ช่องทาง" ที่เลือกอยู่ — ไม่ได้ตั้งไว้คืน null
  const priceForCustomerType = (food) => priceForSaleType(getPriceOptions(food), customerType);

  // เมนูนี้ขายในประเภทที่เลือกอยู่ได้ไหม
  // ขายปกติ/ทานที่ร้านก็ต้องเช็คเหมือนกัน — เมนูที่ตั้งไว้แต่ราคา Takehome/Deli
  // (เช่นของทานเล่น TD, โปรเฉพาะ Delivery) ยังขายหน้าร้านไม่ได้
  const hasPriceForCustomerType = (food) => !!priceForCustomerType(food);

  // ราคาตาม "ประเภทลูกค้า/ช่องทาง" ที่เลือก — ไม่มีของประเภทนั้นก็ตกไปใช้ราคาแรกไว้โชว์
  // (หน้าขายปิดไม่ให้กดสั่งเมนูพวกนี้อยู่แล้ว ตัวเลขนี้แค่กันพังตอนเรนเดอร์)
  const resolvePrice = (food) => {
    const opts = getPriceOptions(food);
    return priceForSaleType(opts, customerType) || opts[0];
  };

  // ถามเรื่อง "ทานที่ร้าน / ห่อกลับบ้าน" เฉพาะตอนขายแบบทานที่ร้าน
  // (ถ้าหัวตะกร้าเลือก Takehome/Deli ไว้แล้ว ถือว่ารู้ชุดราคาแน่นอน ไม่ต้องถามซ้ำ)
  const askDining = customerType === '';

  // รายการหมายเหตุที่ร้านตั้งไว้ ใช้ในป๊อปอัพหน้าขาย
  const posNoteConfig = React.useMemo(() => resolveNoteConfig(posSettings), [posSettings]);

  const handleOrderClick = (food) => {
    const cats = allCategories.length > 0 ? allCategories : categories;
    const cfg = resolvePopupSource(food, cats);
    const hasPopups = [1, 2, 3, 4, 5, 6].some(i => cfg[`hasPopup${i}`] === true);
    // เมนูที่หมวดไม่ได้ปิดคำถามไว้ ต้องเปิด popup เพื่อถามการรับประทาน
    // (หมวดเครื่องดื่มตั้ง hasDining = false ไว้ จึงข้ามคำถามนี้ไปเหมือนเดิม)
    const needsDining = askDining && cfg.hasDining !== false;

    if (hasPopups || needsDining) {
      setSelectedFood(food);
    } else {
      // ไม่มี popup → เพิ่มลงตะกร้าทันทีตามราคาของ "ประเภทลูกค้า/ช่องทาง" ที่เลือกไว้ที่หัวโต๊ะ (ปกติ / Takehome / Deli)
      handleConfirmOrder(food, {
        allPopups: [],
        dining: customerType === 'Takehome'
          ? { id: 'takeaway', name: 'ห่อกลับบ้าน', nameEn: 'Takeaway' }
          : (cfg.hasDining === false
            ? categoryDining(food, cats)
            : { id: 'dine_in', name: 'ทานที่ร้าน', nameEn: 'Dine-in' })
      });
    }
  };

  // เพิ่ม 1 รายการลงตะกร้า — ถ้ามีรายการเหมือนกันเป๊ะอยู่แล้ว (เมนู/ราคา/ตัวเลือก/ชื่อลูกค้า/การรับประทาน)
  // ให้บวกจำนวนแทนการเพิ่มบรรทัดใหม่
  const mergeIntoCart = (list, { food, popups = [], customerName: name = '', spice, promo, dining, fromPopupOf, note = '' }) => {
    const popupsIds = popups.map(p => p.id).sort().join('-') || 'no_popups';
    // หมายเหตุคนละแบบ = คนละบรรทัด ไม่งั้น "ไม่เผ็ด" กับ "เผ็ดมาก" จะถูกรวมเป็นจานเดียวกัน
    const cartItemId = `${food.id}_${food.priceName || ''}_${name}_${popupsIds}_${spice?.id}_${promo?.id}_${dining?.id}_${fromPopupOf || ''}_${note}`;
    const existingIndex = list.findIndex(item => item.cartItemId === cartItemId);
    if (existingIndex >= 0) {
      const next = [...list];
      next[existingIndex] = { ...next[existingIndex], quantity: next[existingIndex].quantity + 1 };
      return next;
    }
    return [...list, {
      cartId: Date.now() + Math.random(),
      cartItemId,
      food,
      quantity: 1,
      customerName: name,
      allPopups: popups,
      note,
      spice,
      promo,
      dining,
      // มาจากป๊อปอัพของเมนูไหน — ใช้โชว์ในตะกร้าว่าสั่งพ่วงมากับจานไหน
      fromPopupOf: fromPopupOf || null
    }];
  };

  const handleConfirmOrder = (rawFood, orderDetails) => {
    // ราคาฐานมาจากราคาที่เลือกจาก popup (ถ้าเลือกไว้) หรือจาก "ประเภทลูกค้า" (fallback = ราคาปกติ)
    const chosen = orderDetails?.selectedPrice || resolvePrice(rawFood);
    const baseFood = chosen
      ? { ...rawFood, price: Number(chosen.price) || 0, priceName: chosen.name || '' }
      : rawFood;
    // เมนูที่เพิ่มอัตโนมัติเมื่อสั่ง (Bundled Items) = เมนูจริงที่แถมไปกับจานนี้
    // ลงตะกร้าเป็นรายการของตัวเองราคา ฿0 ครัวจะได้เห็นเป็นคนละรายการ และวิ่งไปเครื่องพิมพ์ของเมนูนั้นเอง
    const bundledFoods = [];
    if (baseFood.bundledItems && baseFood.bundledItems.length > 0) {
      baseFood.bundledItems.forEach(bundledId => {
        const bundledFood = liveMenu.find(m => String(m.id) === String(bundledId));
        if (bundledFood) {
          bundledFoods.push({ ...bundledFood, price: 0, priceName: '', isBundled: true });
        }
      });
    }
    const orderCustomerName = customerName.trim();

    let newCart = mergeIntoCart(cart, {
      food: baseFood,
      popups: orderDetails.allPopups || [],
      customerName: orderCustomerName,
      spice: orderDetails.spice,
      promo: orderDetails.promo,
      note: orderDetails.note || '',
      dining: orderDetails.dining
    });

    // ป๊อปอัพที่ตั้งให้ "แยกเป็นรายการต่างหาก" — ลงตะกร้าเป็นรายการของตัวเอง
    // จะได้ขึ้นเป็นคนละบรรทัดในบิล/ใบครัว และวิ่งไปเครื่องพิมพ์ของเมนูตัวเองได้
    (orderDetails.separateItems || []).forEach(row => {
      newCart = mergeIntoCart(newCart, {
        food: row.food,
        popups: row.options || [],
        customerName: orderCustomerName,
        dining: orderDetails.dining,
        fromPopupOf: baseFood.name
      });
    });

    // เมนูแถม — รายการของตัวเองราคา ฿0 (ซ้ำ id เดิมหลายครั้ง = จำนวนหลายชิ้น จะถูกรวมเป็นจำนวนให้เอง)
    bundledFoods.forEach(bundledFood => {
      newCart = mergeIntoCart(newCart, {
        food: bundledFood,
        popups: [],
        customerName: orderCustomerName,
        dining: orderDetails.dining,
        fromPopupOf: baseFood.name
      });
    });

    setCart(newCart);
    setSelectedFood(null);
  };

  const handleUpdateQuantity = (cartId, delta) => {
    setCart(cart.map(item => {
      if (item.cartId === cartId) {
        const newQty = (item.quantity || 1) + delta;
        return { ...item, quantity: Math.max(1, newQty) };
      }
      return item;
    }));
  };

  const handleRemoveFromCart = (cartId) => {
    setCart(cart.filter(item => item.cartId !== cartId));
  };

  // หมายเหตุอาหารต่อรายการ
  const handleUpdateCartNote = (cartId, note) => {
    setCart(cart.map(item => item.cartId === cartId ? { ...item, note } : item));
  };

  const handleDecreaseQuantity = (food) => {
    const cartItems = cart.filter(c => c.food.id === food.id);
    if (cartItems.length > 0) {
      const lastItem = cartItems[cartItems.length - 1];
      if (lastItem.quantity > 1) handleUpdateQuantity(lastItem.cartId, -1);
      else handleRemoveFromCart(lastItem.cartId);
    }
  };

  const getThaiTimeISO = () => {
    const d = new Date();
    const thaiTzOptions = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const parts = new Intl.DateTimeFormat('en-GB', thaiTzOptions).formatToParts(d);
    const p = {};
    parts.forEach(part => p[part.type] = part.value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+07:00`;
  };

  // =============================================
  // NEW: Send cart items to TableOrders sheet
  // =============================================
  const handleSendOrderToTable = async () => {
    if (cart.length === 0) return;

    const sessionId = String(Date.now());
    const timestamp = getThaiTimeISO();

    // Optimistic update: add to local tableOrders immediately
    const newLocalItems = cart.map(item => {
      const parts = [];
      if (item.food.priceName) parts.push(item.food.priceName);
      if (item.customerName) parts.push('ลูกค้า: ' + item.customerName);
      if (item.spice && item.spice.name) parts.push('ความเผ็ด: ' + item.spice.name);
      if (item.allPopups && item.allPopups.length > 0) {
        // รวมตัวเลือกที่ซ้ำกันเป็นจำนวน เช่น "Leoขวด ×12"
        const grouped = [];
        item.allPopups.forEach(p => {
          const found = grouped.find(g => g.name === p.name);
          if (found) found.count += 1;
          else grouped.push({ name: p.name, count: 1 });
        });
        grouped.forEach(g => parts.push(g.count > 1 ? `${g.name} ×${g.count}` : g.name));
      }
      if (item.promo && item.promo.id !== 'none' && item.promo.name) parts.push(item.promo.name);
      // รายการที่แยกออกมาจากป๊อปอัพ — บอกครัวว่าสั่งพ่วงมากับจานไหน
      if (item.fromPopupOf) parts.push('พ่วงกับ ' + item.fromPopupOf);
      if (item.note && item.note.trim()) parts.push('📝 ' + item.note.trim());

      let unitPrice = Number(item.food.price) || 0;
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(p => { unitPrice += Number(p.price || 0); });
      }
      if (item.promo && item.promo.price) {
        unitPrice += Number(item.promo.price) || 0;
      }

      return {
        TableNumber: tableNumber,
        SessionId: sessionId,
        ItemName: item.food.name,
        ItemNameEn: item.food.nameEn || item.food.name,
        ItemPrice: unitPrice,
        Quantity: Number(item.quantity) || 1,
        Options: parts.join(', '),
        Timestamp: timestamp,
        Status: 'pending',
        RecordedBy: branch
      };
    });

    const cartForServer = cart.map(item => {
      let unitPrice = Number(item.food.price) || 0;
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(p => { unitPrice += Number(p.price || 0); });
      }
      if (item.promo && item.promo.price) {
        unitPrice += Number(item.promo.price) || 0;
      }
      return {
        ...item,
        food: {
          ...item.food,
          price: unitPrice
        }
      };
    });

    setTableOrders(prev => [...prev, ...newLocalItems]);
    setCart([]);

    // ── พิมพ์ใบครัวทันทีที่กดส่ง ──
    // แยกใบไปตามเครื่องพิมพ์ที่ตั้งไว้ในแต่ละเมนู (printerId) ไม่ได้ตั้งก็ตกไปเครื่องประเภทครัว
    // ไม่ await เพื่อไม่ให้การบันทึกลงชีตต้องรอเครื่องพิมพ์ตอบ
    if (getPrinters().length > 0) {
      printKitchenOrder(buildKitchenOrder(newLocalItems, tableNumber, sessionId, timestamp, diningForTable(kioskTables, tableNumber)), allMenu)
        .then(res => {
          // เงียบตอนสำเร็จ แต่ต้องบอกให้รู้ตอนพิมพ์ไม่ออก ไม่งั้นครัวไม่ได้ใบแล้วไม่มีใครรู้
          if (!res.success) {
            setSaveAlert({ type: 'error', msg: `⚠️ ส่งรายการเข้าบิลแล้ว แต่พิมพ์ใบครัวไม่สำเร็จ: ${res.error || 'ไม่ทราบสาเหตุ'}` });
          }
        })
        .catch(err => {
          setSaveAlert({ type: 'error', msg: `⚠️ ส่งรายการเข้าบิลแล้ว แต่พิมพ์ใบครัวไม่สำเร็จ: ${err.message || err}` });
        });
    }

    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'addTableOrder',
          branchId: branchKey,
          tableNumber: String(tableNumber),
          sessionId,
          items: cartForServer,
          timestamp,
          recordedBy: branch
        })
      });
      // Refresh after saving
      setTimeout(() => fetchOrdersFromSheet(), 2000);
    } catch (error) {
      console.error('Error saving table order:', error);
    }
  };

  // ใบเสร็จของรายการที่ลูกค้าสแกน QR จ่ายเองแล้ว — แยกใบตามเลขบิล (ในหมายเหตุ "💳 ชำระแล้ว SELF-#008")
  // จ่ายด้วยการโอน จึงไม่เปิดลิ้นชักเก็บเงิน (noDrawer)
  const printSettledReceipts = async (tbl) => {
    const receiptPrinter = getPrinterByType('receipt');
    if (!receiptPrinter || !receiptPrinter.ip) return { success: false, error: 'ยังไม่ได้ตั้งเครื่องพิมพ์ใบเสร็จ' };
    const rows = tableOrders.filter(o => String(o.TableNumber) === tbl && o.Status === 'paid');
    const bills = new Map();
    rows.forEach(o => {
      const opts = String(o.Options || '');
      const m = /ชำระแล้ว\s+(\S+)/.exec(opts);
      const billNo = m ? m[1] : `โต๊ะ ${tbl}`;
      if (!bills.has(billNo)) bills.set(billNo, []);
      bills.get(billNo).push(o);
    });
    const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let failed = '';
    for (const [billNo, items] of bills) {
      const total = items.reduce((s, o) => s + (Number(o.ItemPrice) || 0) * (Number(o.Quantity) || 1), 0);
      const orderData = {
        id: billNo,
        orderNumber: billNo,
        noDrawer: true,
        paid: true,
        customerDetails: { name: `โต๊ะ ${tbl}` },
        items: items.map(o => {
          const qty = Number(o.Quantity) || 1;
          const opt = String(o.Options || '').split('|')[0].replace(/💳.*$/, '').trim();
          return {
            isFlattened: true,
            name: qty > 1 ? `${o.ItemName} (x${qty})` : o.ItemName,
            amount: (Number(o.ItemPrice) || 0) * qty,
            subItems: opt ? opt.split(', ').filter(Boolean) : []
          };
        }),
        summary: [{ label: 'ชำระโดย', value: 'เงินโอน (QR)' }],
        total: money2(total)
      };
      const res = await sendPrintJob({ ip: receiptPrinter.ip, printerType: 'receipt', orderData }).catch(e => ({ success: false, error: e.message }));
      if (!res || !res.success) failed = (res && res.error) || 'พิมพ์ไม่สำเร็จ';
    }
    return failed ? { success: false, error: failed } : { success: true };
  };

  // ปิดโต๊ะที่ลูกค้าสั่งเองและจ่ายครบแล้ว — ไม่ต้องออกบิลใหม่ (บิลถูกออกตอนพนักงานยืนยันการโอน)
  // พิมพ์ใบเสร็จให้ลูกค้า แล้วล้างรายการของโต๊ะให้กลับมาว่างสำหรับลูกค้าคนถัดไป
  const handleCloseSettledTable = async (targetTable) => {
    const tbl = String(targetTable || tableNumber);
    // พิมพ์ใบเสร็จก่อนล้างโต๊ะ (ข้อมูลรายการอยู่ในโต๊ะนี้) — พิมพ์ไม่ออกก็ยังคืนโต๊ะได้ แต่แจ้งให้รู้
    printSettledReceipts(tbl).then(res => {
      if (!res.success) setSaveAlert({ type: 'error', msg: `⚠️ คืนโต๊ะ ${tbl} แล้ว แต่พิมพ์ใบเสร็จไม่สำเร็จ: ${res.error}` });
    });
    setTableOrders(prev => prev.filter(o => String(o.TableNumber) !== tbl));
    localStorage.removeItem('customer_count_' + tbl);
    setTableNumber('');
    navigate('/index');
    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'clearTableOrders', branchId: branchKey, tableNumber: tbl, includePaid: true })
      });
      setTimeout(() => fetchOrdersFromSheet(), 1500);
    } catch (e) {
      console.error('Error clearing settled table:', e);
    }
  };

  // พิมพ์ใบครัวซ้ำสำหรับรายการที่ส่งไปแล้ว — ใช้ตอนกระดาษติดหรือใบหาย
  const handlePrintKitchenAgain = async (rows) => {
    if (!rows || rows.length === 0) return;
    if (getPrinters().length === 0) {
      setSaveAlert({ type: 'error', msg: '⚠️ ยังไม่ได้ตั้งค่าเครื่องพิมพ์ — ไปที่ จัดการหลังบ้าน > ตั้งค่าเครื่องพิมพ์' });
      return;
    }
    const res = await printKitchenOrder(
      buildKitchenOrder(rows, tableNumber, 'reprint-' + Date.now(), getThaiTimeISO(), diningForTable(kioskTables, tableNumber)),
      allMenu
    );
    if (res.success) {
      setSaveAlert({ type: 'success', msg: `🖨️ ส่งใบครัวไปที่เครื่องพิมพ์แล้ว (${res.printed}/${res.total} ใบ)` });
      setTimeout(() => setSaveAlert(cur => (cur && cur.type === 'success' ? null : cur)), 4000);
    } else {
      setSaveAlert({ type: 'error', msg: `⚠️ พิมพ์ใบครัวไม่สำเร็จ: ${res.error || 'ไม่ทราบสาเหตุ'}` });
    }
  };

  // =============================================
  // NEW: Open checkout from table view
  // =============================================
  const handleOpenCheckoutFromTable = (items, total, discount = null) => {
    setCheckoutItems(items);
    setCheckoutTotal(total);
    setCheckoutDiscount(discount);
    setIsCheckoutOpen(true);
  };

  // พิมพ์ใบแจ้งยอดให้ลูกค้าตรวจก่อนชำระเงิน (ไม่เปิดลิ้นชักเก็บเงิน)
  const handlePrintPreBill = async (order) => {
    const res = await printPreBill(order);
    if (res.success) {
      setSaveAlert({ type: 'success', msg: '🧾 พิมพ์ใบแจ้งยอดให้ลูกค้าแล้ว' });
      setTimeout(() => setSaveAlert(cur => (cur && cur.type === 'success' ? null : cur)), 4000);
    } else {
      setSaveAlert({ type: 'error', msg: `⚠️ พิมพ์ใบแจ้งยอดไม่สำเร็จ: ${res.error || 'ไม่ทราบสาเหตุ'}` });
    }
  };

  // =============================================
  // NEW: Complete payment - save to Orders, clear TableOrders
  // =============================================
  const handleCheckoutComplete = async (grandTotal, paymentMethod, paymentDetails, printInfo = {}) => {
    const finalTotal = grandTotal || checkoutTotal;

    const nextNum = (branchMaxMap[branch] || 0) + 1;
    setBranchMaxMap(prev => ({ ...prev, [branch]: nextNum }));
    const newOrderNumber = `${billPrefix}-#${String(nextNum).padStart(3, '0')}`;
    const timestamp = getThaiTimeISO();

    const count = localStorage.getItem('customer_count_' + tableNumber) || '';
    const countText = count ? ` (${count} ท่าน)` : '';
    const customerName = tableNumber ? `โต๊ะ ${tableNumber}${countText}` : 'ไม่ระบุ';
    const address = tableNumber ? `โต๊ะ ${tableNumber}` : 'ไม่ได้กรอกพิกัด';

    const rowsToSend = [];
    checkoutItems.forEach(item => {
      const qty = Number(item.Quantity) || 1;
      const price = (Number(item.ItemPrice) || 0) * qty;
      rowsToSend.push([
        timestamp, newOrderNumber, customerName, address,
        item.ItemName, 'ทานที่ร้าน', price,
        finalTotal, 'Completed', timestamp, timestamp, branch,
        qty
      ]);
      if (item.Options) {
        rowsToSend.push([
          timestamp, newOrderNumber, customerName, address,
          `↳ ${item.Options}`, 'ทานที่ร้าน', 0,
          finalTotal, 'Completed', timestamp, timestamp, branch,
          ""
        ]);
      }
    });

    const newOrder = {
      id: newOrderNumber,
      orderNumber: newOrderNumber,
      customerDetails: { name: customerName, address },
      items: checkoutItems.map(i => ({ isFlattened: true, name: i.ItemName, dining: 'ทานที่ร้าน' })),
      total: finalTotal,
      status: 'completed',
      timestamp
    };

    // Optimistic clear table orders
    setTableOrders(prev => prev.filter(o => String(o.TableNumber) !== String(tableNumber)));
    setOrders(prev => [...prev, newOrder]);
    setCheckoutItems([]);
    setIsCheckoutOpen(false);
    localStorage.removeItem('customer_count_' + tableNumber);
    setTableNumber('');
    navigate('/index');

    // Save to Orders sheet + payment record ในคำขอเดียว (atomic) — กันบิลขึ้นแต่ payment หาย
    // ใช้ fetch แบบอ่าน response ได้ (ไม่ใช้ no-cors) เพื่อ "ตรวจจับ" ว่าบันทึกสำเร็จจริงหรือไม่
    // เซิร์ฟเวอร์เป็นคนออกเลขบิล (assignNumber) — เลขที่ใบกำกับภาษีอย่างย่อเรียงต่อเนื่องชุดเดียวต่อสาขา
    // แม้สาขามีหลายเครื่อง · clientRef กันบิลซ้ำเมื่อส่งซ้ำ · newOrderNumber เป็นแค่เลขชั่วคราวบนจอ
    const clientRef = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const orderPayload = {
      action: 'insertOrder',
      assignNumber: true,
      clientRef,
      branchId: branchKey,
      rows: rowsToSend,
      payment: {
        orderNumber: newOrderNumber,
        tableNo: String(tableNumber),
        paymentMethod,
        grandTotal: finalTotal,
        staff: currentUser?.username || '',
        shiftId: '', // เลิกใช้ระบบกะแล้ว เก็บช่องไว้ให้โครงสร้างข้อมูลเดิมไม่เปลี่ยน
        splitDetail: paymentDetails ? JSON.stringify(paymentDetails) : ''
      }
    };
    let finalNo = '';
    try {
      const json = await postOrderPayload(orderPayload);
      finalNo = (json && json.orderNumber) || newOrderNumber;
    } catch (error) {
      console.error('Error saving order:', error);
      // เก็บบิลที่บันทึกไม่สำเร็จไว้ในเครื่อง เพื่อไม่ให้ข้อมูลหาย + ให้ retry/ตรวจสอบภายหลังได้
      try {
        const pending = JSON.parse(localStorage.getItem('pending_orders') || '[]');
        pending.push({ payload: orderPayload, receiptOrder: printInfo.receiptOrder || null, at: new Date().toISOString(), error: String(error.message || error) });
        localStorage.setItem('pending_orders', JSON.stringify(pending));
      } catch {}
      setSaveAlert({ type: 'error', msg: `⚠️ บันทึกบิลโต๊ะ ${tableNumber || '-'} (${paymentMethod}) ขึ้นระบบไม่สำเร็จ! สาเหตุ: ${error.message} — ข้อมูลถูกสำรองไว้ในเครื่องแล้ว ระบบจะลองส่งซ้ำเองทุก ${PENDING_RETRY_MS / 60000} นาที และพิมพ์ใบกำกับภาษีอย่างย่อตามให้เมื่อบันทึกได้` });
    }

    // เลขจริงจากเซิร์ฟเวอร์ → แก้เลขชั่วคราวบนจอ
    if (finalNo && finalNo !== newOrderNumber) {
      setOrders(prev => prev.map(o => (o.id === newOrderNumber ? { ...o, id: finalNo, orderNumber: finalNo } : o)));
      const seq = parseInt((/#(\d+)\s*$/.exec(finalNo) || [])[1], 10);
      if (!isNaN(seq)) setBranchMaxMap(prev => ({ ...prev, [branch]: Math.max(prev[branch] || 0, seq) }));
    }

    // ── พิมพ์ใบเสร็จหลังได้เลขบิลจากเซิร์ฟเวอร์ ──
    // ได้เลขแล้ว = ใบกำกับภาษีอย่างย่อ · บันทึกไม่สำเร็จ = ใบเสร็จรับเงินธรรมดา (ยังไม่มีเลขที่ใบกำกับ) ใบกำกับพิมพ์ตามเมื่อส่งซ้ำสำเร็จ
    try {
      const receiptPrinter = getPrinterByType('receipt');
      const receiptNo = finalNo || 'รอบันทึกบิล';
      const base = printInfo.receiptOrder
        ? { ...printInfo.receiptOrder, id: receiptNo, orderNumber: receiptNo }
        : { ...newOrder, id: receiptNo, orderNumber: receiptNo };
      if (receiptPrinter) {
        sendPrintJob({ ip: receiptPrinter.ip, printerType: 'receipt', orderData: { ...base, paid: !!finalNo } })
          .then(result => { if (!result.success) console.error('Silent print failed:', result.error); })
          .catch(err => console.error('Silent print failed:', err));
      } else if (printInfo.print && printInfo.buildReceiptHtml) {
        print80mm(printInfo.buildReceiptHtml(receiptNo, !!finalNo));
      }
    } catch (e) { console.error('Receipt print failed:', e); }

    // ล้างโต๊ะกับตัดสต็อกไม่ขึ้นต่อกัน ยิงพร้อมกันได้ ไม่ต้องรอทีละรอบ
    // (ยังต้องยิงหลังบันทึกบิลสำเร็จ ไม่งั้นบิลพังแล้วรายการในโต๊ะหายไปด้วย)
    const deductItems = checkoutItems
      .map(item => {
        const menuItem = allMenu.find(m => m.name === item.ItemName || m.nameEn === item.ItemNameEn);
        return menuItem ? { menuId: String(menuItem.id), menuName: item.ItemName, qty: Number(item.Quantity) || 1 } : null;
      })
      .filter(Boolean);

    const backgroundJobs = [
      // ปิดบิลแล้ว = โต๊ะจบ ล้างรวมรายการที่ลูกค้าจ่ายเองมาก่อนหน้าด้วย
      fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'clearTableOrders', branchId: branchKey, tableNumber: String(tableNumber), includePaid: true })
      }).catch(error => console.error('Error clearing table orders:', error))
    ];

    if (deductItems.length > 0) {
      // Deduct stock based on BOM
      backgroundJobs.push(
        fetch(API_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'deductStock', branchId: branchKey, orderNumber: finalNo || newOrderNumber, tableNo: String(tableNumber), items: deductItems })
        }).catch(error => console.error('Error deducting stock:', error))
      );
    }

    await Promise.all(backgroundJobs);

  };

  // =============================================
  // NEW: Move or Merge Table
  // =============================================
  // ลายเซ็นของแต่ละบรรทัดในตาราง ใช้จับคู่ตอนย้าย/แยกบางรายการ
  const tableRowSig = (o) => `${o.SessionId}|${o.ItemName}|${o.Options || ''}|${o.ItemPrice}`;

  // items = บรรทัดที่เลือก (ถ้า isAll = true จะย้ายทั้งโต๊ะ)
  const handleMoveMergeTable = async (fromTable, toTable, isMerge, items = null, isAll = true) => {
    const moveAll = isAll || !items || items.length === 0;

    // นับจำนวนต่อ signature สำหรับการย้ายบางรายการ
    const need = {};
    if (!moveAll) items.forEach(it => { const s = tableRowSig(it); need[s] = (need[s] || 0) + 1; });

    // Optimistic update
    setTableOrders(prev => prev.map(o => {
      if (String(o.TableNumber) !== String(fromTable)) return o;
      // ย้ายทั้งโต๊ะให้ยกรายการที่ลูกค้าจ่ายเองมาแล้วไปด้วย ส่วนการย้ายบางรายการเลือกได้เฉพาะที่ยังไม่จ่าย
      if (moveAll) return { ...o, TableNumber: toTable };
      if (o.Status === 'paid') return o;
      const s = tableRowSig(o);
      if (need[s] > 0) { need[s] -= 1; return { ...o, TableNumber: toTable }; }
      return o;
    }));

    // ย้ายจำนวนลูกค้าเฉพาะเมื่อย้ายทั้งโต๊ะ
    if (moveAll) {
      const count = localStorage.getItem('customer_count_' + fromTable);
      if (count) {
        if (isMerge) {
          const toCount = localStorage.getItem('customer_count_' + toTable);
          if (!toCount) localStorage.setItem('customer_count_' + toTable, count);
        } else {
          localStorage.setItem('customer_count_' + toTable, count);
        }
        localStorage.removeItem('customer_count_' + fromTable);
      }
    }

    setTableNumber(toTable);
    navigate('/table-orders');

    try {
      const body = moveAll
        ? { action: 'moveTable', branchId: branchKey, fromTable: String(fromTable), toTable: String(toTable) }
        : {
            action: 'moveTableItems',
            branchId: branchKey,
            fromTable: String(fromTable),
            toTable: String(toTable),
            keys: items.map(it => ({
              sessionId: String(it.SessionId ?? ''),
              itemName: String(it.ItemName ?? ''),
              options: String(it.Options ?? ''),
              price: Number(it.ItemPrice) || 0
            }))
          };
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body)
      });
      setTimeout(() => fetchOrdersFromSheet(), 2000);
    } catch (e) {
      console.error('Error moving table:', e);
    }
  };

  // =============================================
  // Delete a single item from table orders
  // =============================================
  const handleDeleteTableItem = async (item) => {
    // Optimistic remove
    setTableOrders(prev => {
      const idx = prev.findIndex(o =>
        String(o.TableNumber) === String(item.TableNumber) &&
        String(o.SessionId) === String(item.SessionId) &&
        String(o.ItemName) === String(item.ItemName)
      );
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });

    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'deleteTableOrderItem',
          branchId: branchKey,
          tableNumber: String(item.TableNumber),
          sessionId: String(item.SessionId),
          itemName: String(item.ItemName)
        })
      });
    } catch (e) {
      console.error('Error deleting table item:', e);
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'updateStatus',
          orderId,
          status: newStatus,
          completionTime: newStatus.toLowerCase() === 'completed' ? getThaiTimeISO() : ''
        })
      });
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const getCartTotal = () => {
    return cart.reduce((sum, item) => {
      let itemTotal = Number(item.food.price);
      if (item.allPopups && item.allPopups.length > 0) item.allPopups.forEach(p => { itemTotal += Number(p.price || 0); });
      if (item.promo && item.promo.price) itemTotal += Number(item.promo.price);
      return sum + (itemTotal * item.quantity);
    }, 0);
  };

  // ── ลูกค้าแจ้งโอน (หน้าคีออส) → รอพนักงานหน้าขายกดยืนยัน ──
  // ส่งออเดอร์ทั้งก้อนไปเก็บไว้ก่อน บิลจริงออกตอนพนักงานกด "ได้รับเงินแล้ว" (respondKioskPayment)
  const handleKioskPaymentRequest = async (targetTableNo, cartItems, total, paySessionId, diningLabel) => {
    const cartForServer = cartItems.map(item => {
      let unitPrice = Number(item.food.price) || 0;
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(p => { unitPrice += Number(p.price || 0); });
      }
      return { ...item, food: { ...item.food, price: unitPrice } };
    });
    const payload = {
      action: 'kioskPaymentRequest',
      branchId: branchKey,
      tableNumber: String(targetTableNo || ''),
      dining: diningLabel || '',
      sessionId: String(paySessionId),
      items: cartForServer,
      total: Number(total) || 0,
      timestamp: getThaiTimeISO()
    };
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
        const json = await res.json().catch(() => null);
        if (json && json.success) return { success: true, status: json.status || 'pending', orderNumber: json.orderNumber || '' };
        lastError = (json && json.error) || 'ส่งไม่สำเร็จ';
        if (/Unknown action/i.test(lastError)) break;
      } catch (e) {
        lastError = String(e.message || e);
      }
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
    return { success: false, error: lastError };
  };

  const checkKioskPayment = async (paySessionId) => {
    try {
      const res = await fetch(`${API_URL}?action=getKioskPayment&id=${encodeURIComponent(paySessionId)}`);
      const json = await res.json();
      return json && json.success ? json : null;
    } catch { return null; }
  };

  // ออเดอร์จากคีออส — ลูกค้าโอนเงินและสลิปผ่านการตรวจมาแล้ว จึงต้องบันทึกเป็น "บิลที่จ่ายแล้ว"
  // ไม่ใช่แค่รายการรายโต๊ะ ไม่งั้นยอดไม่เข้ารายงาน/สรุปกะ และพนักงานอาจเก็บเงินซ้ำตอนปิดโต๊ะ
  // ฝั่งเซิร์ฟเวอร์ (action kioskPaidOrder) ออกเลขบิล + ลง Orders/PaymentSummary/TableOrders + ตัดสต็อก
  // ให้ครบในคำขอเดียวโดยมีล็อกกันหลายโต๊ะกดจ่ายพร้อมกัน
  const handleKioskSendOrder = async (targetTableNo, cartItems, total, paymentMethod, paySessionId) => {
    // sessionId มาจากหน้าคีออส และคงค่าเดิมทุกครั้งที่กดส่งซ้ำ → หลังบ้านใช้กันบิลซ้ำ
    const sessionId = String(paySessionId || (String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)));
    const timestamp = getThaiTimeISO();

    const cartForServer = cartItems.map(item => {
      let unitPrice = Number(item.food.price) || 0;
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(p => { unitPrice += Number(p.price || 0); });
      }
      return {
        ...item,
        food: { ...item.food, price: unitPrice }
      };
    });

    const payload = {
      action: 'kioskPaidOrder',
      branchId: branchKey,
      tableNumber: String(targetTableNo),
      sessionId,
      items: cartForServer,
      total: Number(total) || 0,
      paymentMethod: paymentMethod || 'เงินโอน (QR)',
      timestamp
    };

    // ลูกค้าจ่ายเงินไปแล้ว ห้ามเงียบหาย — ยิงซ้ำได้ 3 ครั้ง (เน็ตมือถือหลุดง่าย)
    // ยิงซ้ำแล้วบิลไม่ซ้ำ เพราะฝั่งเซิร์ฟเวอร์เช็ก sessionId เดิมแล้วคืนเลขบิลเดิมกลับมา
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => null);
        if (json && json.success) {
          setTimeout(() => fetchOrdersFromSheet(), 1500);
          return { success: true, orderNumber: json.orderNumber || '' };
        }
        lastError = (json && json.error) || 'บันทึกไม่สำเร็จ';
      } catch (e) {
        lastError = String(e.message || e);
      }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    // แบ็กเอนด์ยังเป็นสคริปต์เวอร์ชันเก่า (ยังไม่ได้ deploy ตัวใหม่) — ห้ามทิ้งออเดอร์ที่จ่ายเงินมาแล้ว
    // ถอยไปใช้วิธีเดิมคือส่งเข้ารายการโต๊ะ พร้อมทำเครื่องหมายว่าชำระแล้วไว้ในรายการให้พนักงานเห็น
    if (lastError.indexOf('Unknown action') !== -1) {
      try {
        const marked = cartForServer.map(item => ({
          ...item,
          note: `${item.note ? item.note + ' ' : ''}💳 ชำระผ่าน QR แล้ว (${paymentMethod || ''})`
        }));
        await fetch(API_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'addTableOrder',
            branchId: branchKey,
            tableNumber: String(targetTableNo),
            sessionId,
            items: marked,
            timestamp,
            recordedBy: 'Self-Order'
          })
        });
        setTimeout(() => fetchOrdersFromSheet(), 1500);
        return { success: true, orderNumber: '', needStaff: true };
      } catch (e) {
        lastError = String(e.message || e);
      }
    }

    console.error('Error saving kiosk order:', lastError);
    return { success: false, error: lastError };
  };

  // มีหลายสาขาแต่เครื่องนี้ยังไม่ได้เลือกสาขา → กลับไปหน้าแรกให้เลือกก่อน
  const activeBranchList = branches.filter(b => b.isActive !== false);
  if (!isKioskPath && !isLandingPath && activeBranchList.length > 1 &&
      !activeBranchList.some(b => String(b.id) === String(deviceBranch))) {
    return <Navigate to="/" replace />;
  }

  if (!currentUser && !isKioskPath && !isLandingPath) {
    return (
      <LoginScreen
        users={users}
        onLogin={handleLogin}
        lang={lang}
        isOfflineMode={users.length === 0}
        onRetry={fetchStaticFromSheet}
        branches={branches}
        deviceBranch={deviceBranch}
        onChangeBranch={() => navigate('/')}
        setupMode={users.length > 0 && !users.some(hasPin)}
        onSetupLogin={() => handleLogin(DEFAULT_ADMIN)}
      />
    );
  }

  // พนักงาน "ทุกสาขา" ต้องเลือกก่อนว่าจะทำงานที่สาขาไหน — หน้าขายต้องรู้ว่าบิลเป็นของสาขาใด
  if (currentUser && isAllBranches(currentUser.branch) && !isKioskPath && !isLandingPath) {
    return (
      <BranchPicker
        user={currentUser}
        branches={branches}
        lang={lang}
        onPick={(id) => setCurrentUser(u => ({ ...u, branch: id, allBranches: true }))}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="app-container">
      {saveAlert && (
        <div
          onClick={() => setSaveAlert(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5000,
            background: saveAlert.type === 'success' ? '#16a34a' : '#dc2626',
            color: 'white', padding: '0.85rem 1.25rem',
            fontSize: '0.9rem', fontWeight: 700, textAlign: 'center', cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)', lineHeight: 1.4
          }}
        >
          {saveAlert.msg}
          <div style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85, marginTop: '2px' }}>
            (แตะเพื่อปิด)
          </div>
        </div>
      )}
      {/* key = เส้นทางปัจจุบัน — เปลี่ยนหน้าแล้วกล่องดักพังรีเซ็ตตัวเอง ไม่ค้างจอ error ข้ามหน้า */}
      <ChunkErrorBoundary lang={lang} key={location.pathname}>
      <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>{lang === 'th' ? 'กำลังโหลด...' : 'Loading...'}</div>}>
      <Routes>
        <Route path="/" element={
          <BranchLanding
            branches={branches}
            deviceBranch={deviceBranch}
            loaded={staticLoaded}
            lang={lang}
            onStaff={(id) => { setDeviceBranch(id); navigate('/index'); }}
            onCustomer={(id) => {
              setDeviceBranch(id);
              navigate(`/kiosk?b=${encodeURIComponent(id)}`);
            }}
          />
        } />
        <Route path="/kiosk" element={<CustomerKiosk liveMenu={liveMenu} categories={categories} settings={checkoutSettings} onSendOrder={handleKioskSendOrder} onRequestPayment={handleKioskPaymentRequest} onCheckPayment={checkKioskPayment} lang={lang} tables={kioskTables} />} />
        <Route path="/self-order" element={<CustomerKiosk liveMenu={liveMenu} categories={categories} settings={checkoutSettings} onSendOrder={handleKioskSendOrder} onRequestPayment={handleKioskPaymentRequest} onCheckPayment={checkKioskPayment} lang={lang} tables={kioskTables} />} />

        <Route path="/table-orders" element={
          !tableNumber ? <Navigate to="/index" replace /> :
            <TableOrderView
              tableNumber={tableNumber}
              tableOrders={tableOrders}
              lang={lang}
              currentUser={currentUser}
              settings={posSettings}
              onAddMore={() => navigate('/index')}
              onCheckout={handleOpenCheckoutFromTable}
              onCloseTable={handleCloseSettledTable}
              onDeleteItem={handleDeleteTableItem}
              onBack={() => {
                navigate('/index');
              }}
              onRefresh={refreshTableOrders}
              isRefreshing={isRefreshing}
              onMoveMerge={handleMoveMergeTable}
              customerType={customerType}
              setCustomerType={setCustomerType}
              customerName={customerName}
              setCustomerName={setCustomerName}
              onSelectTable={() => setTableNumber('')}
            />
        } />

        <Route path="/index" element={
          <PosSalesScreen
              lang={lang}
              setLang={setLang}
              tableNumber={tableNumber}
              onSelectTable={setTableNumber}
              tableOrders={tableOrders}
              liveMenu={liveMenu}
              categories={categories}
              itemInCategory={itemInCategory}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              cart={cart}
              onOrderClick={handleOrderClick}
              onDecreaseQuantity={handleDecreaseQuantity}
              onUpdateQuantity={handleUpdateQuantity}
              onRemoveFromCart={handleRemoveFromCart}
              onUpdateNote={handleUpdateCartNote}
              onClearCart={() => setCart([])}
              onSendOrder={handleSendOrderToTable}
              onCheckout={handleOpenCheckoutFromTable}
              onDeleteTableItem={handleDeleteTableItem}
              onPrintKitchen={handlePrintKitchenAgain}
              onPrintPreBill={handlePrintPreBill}
              onCloseTable={handleCloseSettledTable}
              discounts={posDiscounts}
              resolvePrice={resolvePrice}
              hasPriceForCustomerType={hasPriceForCustomerType}
              customerType={customerType}
              setCustomerType={setCustomerType}
              customerName={customerName}
              setCustomerName={setCustomerName}
              settings={posSettings}
              isAdmin={isAdmin}
              isCashier={isCashier}
              branch={branch}
              currentUser={currentUser}
              onLogout={handleLogout}
              onRefresh={refreshTableOrders}
              isRefreshing={isRefreshing}
              onOpenBill={() => navigate('/table-orders')}
              onOpenAdmin={() => navigate('/admin')}
              onOpenWaste={() => navigate('/waste')}
              onOpenPrep={() => navigate('/prep')}
              onOpenStockCount={() => navigate('/stock-count')}
              onOpenSummary={(mode) => { setSalesSummaryMode(mode); setShowSalesSummaryModal(true); }}
              onOpenTaxInvoice={() => setShowTaxInvoicePage(true)}
            onOpenKiosk={() => window.open(`/kiosk?table=${tableNumber}`, '_blank')}
          />
        } />

        <Route path="/kitchen" element={
          <KitchenMonitor
            orders={orders.filter(o => o.status && o.status.toLowerCase() === 'pending')}
            onUpdateOrderStatus={handleUpdateOrderStatus}
            onNewOrder={() => navigate('/index')}
            allMenu={allMenu.length > 0 ? allMenu : liveMenu}
          />
        } />

        <Route path="/outstanding" element={
          <OutstandingBills lang={lang} onBack={() => navigate('/index')} />
        } />

        <Route path="/liquor" element={
          <LiquorStorage
            currentUser={currentUser}
            lang={lang}
            onBack={() => navigate('/index')}
            menu={allMenu.length > 0 ? allMenu : liveMenu}
            categories={allCategories.length > 0 ? allCategories : categories}
          />
        } />

        <Route path="/waste" element={
          <WasteRecord
            key="waste"
            mode="waste"
            currentUser={currentUser}
            lang={lang}
            branch={branch}
            onBack={() => navigate('/index')}
            menu={allMenu.length > 0 ? allMenu : liveMenu}
            categories={allCategories.length > 0 ? allCategories : categories}
          />
        } />

        <Route path="/stock-count" element={
          <WasteRecord
            key="count"
            mode="count"
            currentUser={currentUser}
            lang={lang}
            branch={branch}
            onBack={() => navigate('/index')}
            menu={allMenu.length > 0 ? allMenu : liveMenu}
            categories={allCategories.length > 0 ? allCategories : categories}
          />
        } />

        <Route path="/prep" element={
          <WasteRecord
            key="prep"
            mode="prep"
            currentUser={currentUser}
            lang={lang}
            branch={branch}
            onBack={() => navigate('/index')}
            menu={allMenu.length > 0 ? allMenu : liveMenu}
            categories={allCategories.length > 0 ? allCategories : categories}
          />
        } />

        <Route path="/admin" element={(isAdmin || isCashier) ? <AdminLayout lang={lang} setLang={setLang} onLogout={handleLogout} isCashier={isCashier} /> : <Navigate to="/index" replace />}>
          <Route index element={<Dashboard />} />
          <Route path="menu" element={<ManageMenu />} />
          <Route path="categories" element={<ManageCategories />} />
          <Route path="tables" element={<ManageTables branchId={tablesBranch} branches={branches} />} />
          <Route path="users" element={isAdmin ? <ManageUsers /> : <Navigate to="/admin" replace />} />
          <Route path="branches" element={isAdmin ? <ManageBranches /> : <Navigate to="/admin" replace />} />
          <Route path="branch-menu" element={isAdmin ? <ManageBranchMenu branchId={tablesBranch} branches={branches} /> : <Navigate to="/admin" replace />} />
          <Route path="promotions" element={<ManagePromotions />} />
          <Route path="printers" element={isAdmin ? <ManagePrinters branchId={tablesBranch} branches={branches} /> : <Navigate to="/admin" replace />} />
          <Route path="settings" element={isAdmin ? <ManageSettings users={users} /> : <Navigate to="/admin" replace />} />
          <Route path="bom" element={isAdmin ? <ManageBOM /> : <Navigate to="/admin" replace />} />
          <Route path="stock" element={<ManageStock branchId={tablesBranch} branches={branches} canPickBranch={isAdmin} />} />
          <Route path="reports" element={(isAdmin || isCashier) ? <Reports allMenu={allMenu} isAdmin={isAdmin} branch={branch} users={users} userName={currentUser?.username || ''} /> : <Navigate to="/admin" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/index" replace />} />
      </Routes>
      </Suspense>
      </ChunkErrorBoundary>

      {selectedFood && (
        <OrderWizardModal
          food={selectedFood}
          lang={lang}
          liveMenu={allMenu.length > 0 ? allMenu : liveMenu}
          categories={allCategories.length > 0 ? allCategories : categories}
          basePrice={Number(resolvePrice(selectedFood)?.price) || 0}
          askDining={askDining}
          hasPriceForCustomerType={hasPriceForCustomerType}
          noteOptions={posNoteConfig.options}
          allowCustomNote={posNoteConfig.allowCustom}
          onClose={() => setSelectedFood(null)}
          onConfirm={handleConfirmOrder}
        />
      )}

      {/* ลูกค้าสแกน QR แจ้งโอน → เด้งให้พนักงานสาขานี้ยืนยันยอด (ทุกหน้าของพนักงาน ยกเว้นหน้าลูกค้า/หน้าแรก) */}
      {currentUser && !isKioskPath && !isLandingPath && (
        <Suspense fallback={null}>
          <KioskPaymentAlerts
            branchId={branchKey}
            userName={currentUser?.username || ''}
            allMenu={allMenu.length > 0 ? allMenu : liveMenu}
            onApproved={() => { refreshTableOrders(); fetchOrdersFromSheet(); }}
          />
        </Suspense>
      )}

      {showTaxInvoicePage && (
        <Suspense fallback={null}>
          <TaxInvoicePage
            isAdmin={isAdmin}
            userName={currentUser?.username || ''}
            branchId={branchKey}
            onClose={() => setShowTaxInvoicePage(false)}
          />
        </Suspense>
      )}

      {showSalesSummaryModal && (
        <Suspense fallback={null}>
          <SalesSummaryModal
            lang={lang}
            initialMode={salesSummaryMode}
            allMenu={allMenu}
            categories={allCategories.length > 0 ? allCategories : categories}
            isAdmin={isAdmin}
            branch={branch}
            users={users}
            userName={currentUser?.username || ''}
            onClose={() => setShowSalesSummaryModal(false)}
          />
        </Suspense>
      )}

      {isCheckoutOpen && (
        <Suspense fallback={null}>
          <CheckoutModal
            tableOrderItems={checkoutItems}
            total={checkoutTotal}
            lang={lang}
            orderNumber={`${billPrefix}-#${String((branchMaxMap[branch] || 0) + 1).padStart(3, '0')}`}
            onClose={() => setIsCheckoutOpen(false)}
            onComplete={handleCheckoutComplete}
            settings={checkoutSettings}
            discounts={posDiscounts}
            categories={allCategories.length > 0 ? allCategories : categories}
            initialDiscount={checkoutDiscount}
            users={users}
            currentUser={currentUser}
            tableNo={tableNumber}
          />
        </Suspense>
      )}

      {/* แจ้งเตือนคำขออนุมัติ QR — เฉพาะแอดมิน/แคชเชียร์ */}
      {(isAdmin || isCashier) && (
        <PaymentApprovalListener currentUser={currentUser} lang={lang} />
      )}
    </div>
  );
}

export default App;
