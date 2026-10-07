// ===============================================================
// Print Server helper
// ---------------------------------------------------------------
// เครื่องพิมพ์ ESC/POS ในวงแลนคุยกันด้วย TCP port 9100 ดิบ ๆ ซึ่ง
// JavaScript ในเบราว์เซอร์เปิด socket เองไม่ได้ จึงต้องผ่าน
// Node Print Server (server.js) เป็นตัวกลางเสมอ
// ไฟล์นี้รวมการเรียก Print Server ไว้ที่เดียว เพื่อให้ทุกหน้าจอ
// ใช้ค่า URL เดียวกัน และแสดงข้อความ error แบบเดียวกัน
// ===============================================================

const STORAGE_KEY = 'print_server_url';
const DEFAULT_PORT = 3001;

export const PRINT_SERVER_EVENT = 'print_server_url_changed';

// แปลงค่าที่ผู้ใช้พิมพ์ (เช่น "192.168.1.10" หรือ "192.168.1.10:3001")
// ให้เป็น URL เต็มรูปแบบ คืนค่า '' ถ้าแปลงไม่ได้
export const normalizePrintServerUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.port) url.port = String(DEFAULT_PORT);
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    return '';
  }
};

export const LOCAL_PRINT_SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

// เบราว์เซอร์ถือว่า localhost / 127.x.x.x เป็นปลายทางที่ปลอดภัย (potentially trustworthy)
// จึงยกเว้นให้จากกฎ mixed content — หน้าเว็บ https ยิงไปหาได้ ต่างจาก IP วงแลนที่โดนบล็อก
export const isLocalhostUrl = (url) => {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]' || /^127\./.test(host);
  } catch (e) {
    return false;
  }
};

// หน้าเว็บที่เปิดผ่าน https (เช่นโดเมนบน Vercel) ยิงไป IP วงแลนไม่ได้
// จึงต้องคุยกับ Print Server ที่รันในเครื่องเดียวกันผ่าน 127.0.0.1 แทน
export const getDefaultPrintServerUrl = () => {
  if (window.location.protocol === 'https:' && !isLocalhostUrl(window.location.href)) {
    return LOCAL_PRINT_SERVER_URL;
  }
  return `http://${window.location.hostname || 'localhost'}:${DEFAULT_PORT}`;
};

export const getPrintServerUrl = () => {
  try {
    return normalizePrintServerUrl(localStorage.getItem(STORAGE_KEY)) || getDefaultPrintServerUrl();
  } catch (e) {
    return getDefaultPrintServerUrl();
  }
};

// ส่งค่าว่างเพื่อกลับไปใช้ค่าเริ่มต้น (hostname ของหน้าเว็บ + :3001)
export const setPrintServerUrl = (raw) => {
  const normalized = normalizePrintServerUrl(raw);
  if (normalized) {
    localStorage.setItem(STORAGE_KEY, normalized);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new Event(PRINT_SERVER_EVENT));
  return getPrintServerUrl();
};

// หน้าเว็บที่เปิดผ่าน https:// ยิง http:// ไม่ได้ (mixed content)
// ยกเว้นปลายทางที่เป็น localhost/127.0.0.1 ซึ่งเบราว์เซอร์อนุญาต
// เป็นสาเหตุที่พบบ่อยที่สุดเวลาเปิดแอปจากโดเมนจริงแล้วปริ้นไม่ออก
export const isMixedContentBlocked = (url = getPrintServerUrl()) =>
  window.location.protocol === 'https:' && url.startsWith('http://') && !isLocalhostUrl(url);

const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const PRINT_SERVER_OFFLINE_MSG =
  'ติดต่อ Print Server ไม่ได้ — เปิด start-printer.bat หรือรัน "node server.js" ในเครื่องที่ต่อวงแลนเดียวกับเครื่องพิมพ์';

export const MIXED_CONTENT_MSG =
  'หน้าเว็บนี้เปิดผ่าน https:// เบราว์เซอร์จึงบล็อกการเชื่อมต่อไปยัง IP วงแลน — ให้ตั้งที่อยู่เป็น 127.0.0.1:3001 แล้วรัน Print Server ในเครื่องเดียวกับที่เปิดหน้านี้';

// เช็คว่า Print Server ออนไลน์อยู่ไหม
// คืนค่า { online, url, blocked, info, error }
export const checkPrintServer = async (timeoutMs = 3000) => {
  const url = getPrintServerUrl();
  if (isMixedContentBlocked(url)) {
    return { online: false, url, blocked: true, info: null, error: MIXED_CONTENT_MSG };
  }
  try {
    const response = await fetchWithTimeout(`${url}/health`, {}, timeoutMs);
    if (!response.ok) {
      return { online: false, url, blocked: false, info: null, error: `Print Server ตอบกลับ HTTP ${response.status}` };
    }
    const info = await response.json();
    return { online: true, url, blocked: false, info, error: null };
  } catch (e) {
    return { online: false, url, blocked: false, info: null, error: PRINT_SERVER_OFFLINE_MSG };
  }
};

// สแกนหาเครื่องพิมพ์ในวงแลน (ผ่าน Print Server)
// options: { subnet, from, to, port, timeout } — ไม่ส่งมาก็ได้ server จะเดาวงแลนให้เอง
export const scanPrinters = async (options = {}, timeoutMs = 120000) => {
  const url = getPrintServerUrl();
  if (isMixedContentBlocked(url)) throw new Error(MIXED_CONTENT_MSG);

  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      params.append(key, String(value).trim());
    }
  });
  const query = params.toString();

  let response;
  try {
    response = await fetchWithTimeout(`${url}/scan-printers${query ? `?${query}` : ''}`, {}, timeoutMs);
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'สแกนนานเกินไป (timeout) ลองลดช่วง IP ที่สแกนลง' : PRINT_SERVER_OFFLINE_MSG);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.success) {
    throw new Error((data && data.error) || `การสแกนล้มเหลว (HTTP ${response.status})`);
  }
  return data;
};

// สั่งพิมพ์ผ่าน Print Server — คืนค่า { success, error }
// หัวใบเสร็จของสาขาที่เครื่องนี้ทำงานอยู่ — App ตั้งให้ตามสาขาของผู้ใช้ที่ล็อกอิน
// ทุกงานพิมพ์แนบไปใน orderData.header ให้ Print Server พิมพ์ชื่อร้าน/ที่อยู่ของสาขานั้น
let receiptHeader = null;
export const setReceiptHeader = (header) => { receiptHeader = header || null; };
export const getReceiptHeader = () => receiptHeader;

export const sendPrintJob = async ({ ip, printerType = 'receipt', orderData: rawOrderData }, timeoutMs = 15000) => {
  const orderData = receiptHeader && rawOrderData && !rawOrderData.header
    ? { ...rawOrderData, header: receiptHeader }
    : rawOrderData;
  const url = getPrintServerUrl();
  if (isMixedContentBlocked(url)) return { success: false, error: MIXED_CONTENT_MSG };

  try {
    const response = await fetchWithTimeout(`${url}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, printerType, orderData })
    }, timeoutMs);
    const result = await response.json().catch(() => null);
    if (!result) return { success: false, error: `Print Server ตอบกลับ HTTP ${response.status}` };
    return { success: !!result.success, error: result.error || null };
  } catch (e) {
    return { success: false, error: PRINT_SERVER_OFFLINE_MSG };
  }
};

// ===============================================================
// Auto Print — ให้ Print Server ดึงออเดอร์จากชีตมาพิมพ์เอง
// ---------------------------------------------------------------
// ใช้กับออเดอร์ที่ลูกค้าสั่งผ่าน QR ซึ่งเกิดบนมือถือลูกค้า สั่งเครื่องพิมพ์
// ในร้านเองไม่ได้ ปกติต้องรอให้มีเครื่องเปิดหน้า "ครัว" ค้างไว้
// ย้ายหน้าที่นี้ไปให้ Print Server ที่รันค้างอยู่แล้วทำแทน
// ===============================================================

// Print Server ที่ยังรันโค้ดเวอร์ชันเก่าจะไม่มี route /auto-print → ตอบ 404
// ต้องบอกให้ชัดว่าต้องอัปเดตแล้วรีสตาร์ท ไม่ใช่ปล่อยให้เห็นแค่เลข error
export const PRINT_SERVER_OUTDATED_MSG =
  'Print Server เครื่องนี้ยังเป็นเวอร์ชันเก่า (ยังไม่มีระบบพิมพ์อัตโนมัติ) — อัปเดตโค้ดในเครื่องที่รัน Print Server (git pull) แล้วปิด-เปิด Print Server ใหม่';

// Print Server รองรับการพิมพ์อัตโนมัติไหม — ดูจาก features ที่ /health ตอบกลับมา
export const supportsAutoPrint = (healthInfo) =>
  Array.isArray(healthInfo?.features) && healthInfo.features.includes('autoPrint');

const autoPrintFetch = async (path, options = {}, timeoutMs = 10000) => {
  const url = getPrintServerUrl();
  if (isMixedContentBlocked(url)) return { success: false, error: MIXED_CONTENT_MSG };
  try {
    const response = await fetchWithTimeout(`${url}${path}`, options, timeoutMs);
    if (response.status === 404) return { success: false, error: PRINT_SERVER_OUTDATED_MSG, outdated: true };
    const data = await response.json().catch(() => null);
    if (!data) return { success: false, error: `Print Server ตอบกลับ HTTP ${response.status}` };
    return data;
  } catch (e) {
    return { success: false, error: PRINT_SERVER_OFFLINE_MSG };
  }
};

// อ่านค่าที่ Print Server เก็บไว้ + สถานะการทำงานล่าสุด
export const getAutoPrint = () => autoPrintFetch('/auto-print');

// ส่งค่าตั้งต้นไปเก็บที่ Print Server (รายการเครื่องพิมพ์ + URL ของ Apps Script)
export const saveAutoPrint = (payload) => autoPrintFetch('/auto-print', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

// สั่งให้ดึงออเดอร์เดี๋ยวนี้เลยหนึ่งรอบ ไม่ต้องรอครบเวลา
export const runAutoPrintNow = () => autoPrintFetch('/auto-print/run', { method: 'POST' }, 30000);
