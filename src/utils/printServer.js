// ===============================================================
// Print Server helper
// ---------------------------------------------------------------
// เครื่องพิมพ์ ESC/POS ในวงแลนคุยกันด้วย TCP port 9100 ดิบ ๆ ซึ่ง
// JavaScript ในเบราว์เซอร์เปิด socket เองไม่ได้ จึงต้องผ่าน
// Node Print Server (server.js) เป็นตัวกลางเสมอ
// ไฟล์นี้รวมการเรียก Print Server ไว้ที่เดียว เพื่อให้ทุกหน้าจอ
// ใช้ค่า URL เดียวกัน และแสดงข้อความ error แบบเดียวกัน
// ===============================================================

import { API_URL } from './api';

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

// หัวใบเสร็จของสาขาที่เครื่องนี้ทำงานอยู่ — App ตั้งให้ตามสาขาของผู้ใช้ที่ล็อกอิน
// ทุกงานพิมพ์แนบไปใน orderData.header ให้ Print Server พิมพ์ชื่อร้าน/ที่อยู่ของสาขานั้น
let receiptHeader = null;
export const setReceiptHeader = (header) => { receiptHeader = header || null; };
export const getReceiptHeader = () => receiptHeader;

// สาขาของเครื่องนี้ — App ตั้งให้ ใช้ตอนฝากงานพิมพ์เข้าคิว (Print Server ของสาขานี้เป็นคนรับไปพิมพ์)
let printBranch = '';
export const setPrintBranch = (branchId) => { printBranch = String(branchId || ''); };

// ── สถานะงานพิมพ์ทีละขั้น ──
// ติดขั้นไหนบอกได้ว่าปัญหาอยู่ตรงไหนและต้องแก้อะไร
//   พิมพ์ตรง (เครื่องที่ติดตั้ง Print Server): server → connect → ready → send → done
//   พิมพ์ผ่านคิว (มือถือ/แท็บเล็ต):          queue → agent → connect → ready → send → done
// (ขั้นของเครื่องพิมพ์ Print Server 1.5.0 ขึ้นไปส่งกลับมา)
export const PRINT_STEPS = [
  { key: 'server', label: 'หน้าเว็บ → Print Server' },
  { key: 'connect', label: 'Print Server → เครื่องพิมพ์' },
  { key: 'ready', label: 'เครื่องพิมพ์พร้อม (กระดาษ / ฝา)' },
  { key: 'send', label: 'ส่งงานพิมพ์' },
  { key: 'done', label: 'เครื่องพิมพ์ยืนยันพิมพ์เสร็จ' }
];
export const PRINT_QUEUE_STEPS = [
  { key: 'queue', label: 'ฝากงานเข้าคิวงานพิมพ์ (ผ่านอินเทอร์เน็ต)' },
  { key: 'agent', label: 'Print Server ในร้านรับงาน' },
  ...PRINT_STEPS.slice(1)
];

// วิธีแก้เมื่อติดแต่ละขั้น
export const PRINT_STAGE_TIPS = {
  server: 'เปิด start-printer.bat บนเครื่องที่ต่อวงแลนเดียวกับเครื่องพิมพ์ และตรวจที่อยู่ Print Server ในหน้า ตั้งค่าเครื่องพิมพ์',
  queue: 'เช็กอินเทอร์เน็ตของเครื่องนี้ แล้วสั่งพิมพ์ใหม่',
  agent: 'คอมที่ติดตั้ง Print Server ในร้านต้องเปิดอยู่ และเปิด “รับงานพิมพ์จากมือถือ/แท็บเล็ต” ไว้ (หน้าตั้งค่าเครื่องพิมพ์ บนคอมเครื่องนั้น)',
  connect: 'ตรวจว่าเครื่องพิมพ์เปิดอยู่ สายแลนเสียบแน่น และ IP ถูกเครื่อง (ปิดเครื่อง กด FEED ค้างแล้วเปิด จะพิมพ์ใบที่มี IP จริงออกมา)',
  ready: 'ใส่กระดาษ / ปิดฝาเครื่องพิมพ์ให้สนิท แล้วสั่งพิมพ์ใหม่',
  send: 'ปิด-เปิดเครื่องพิมพ์ แล้วสั่งพิมพ์ใหม่',
  format: 'ข้อมูลใบนี้ผิดรูปแบบ — แจ้งผู้ดูแลระบบ',
  done: 'ดูที่เครื่องพิมพ์ว่ากระดาษออกครบไหม'
};

export const PRINT_STEP_LABEL = Object.fromEntries([...PRINT_QUEUE_STEPS, ...PRINT_STEPS].map(s => [s.key, s.label]));
PRINT_STEP_LABEL.format = 'จัดหน้าใบพิมพ์';

// ทุกงานพิมพ์ประกาศสถานะผ่าน event นี้ — กล่องสถานะการพิมพ์ (PrintStatusToast) ฟังอยู่
export const PRINT_JOB_EVENT = 'print_job_status';
const PRINT_TYPE_LABEL = { receipt: 'ใบเสร็จ', kitchen: 'ใบครัว', prebill: 'ใบแจ้งยอด', taxinvoice: 'ใบกำกับภาษี', closeday: 'รายงานปิดยอด' };
let printJobSeq = 0;
const announce = (detail) => {
  try { window.dispatchEvent(new CustomEvent(PRINT_JOB_EVENT, { detail })); } catch (e) { /* ไม่มี window (เทส) */ }
};

// unreachable = ไปไม่ถึง Print Server เลย (ยังไม่ได้ส่งอะไรไปเครื่องพิมพ์) → ส่งผ่านคิวแทนได้โดยไม่พิมพ์ซ้ำ
const serverFailure = (error, unreachable = false) => ({
  success: false, confirmed: false, stage: 'server', error, warning: null, unreachable,
  steps: [{ key: 'server', status: 'fail', detail: error }]
});

// ต่อ Print Server ในเครื่องนี้ไม่ได้ (มือถือ/แท็บเล็ต) → จำไว้สักพัก ไม่ต้องลองตรงก่อนทุกครั้ง
const DIRECT_RETRY_MS = 60 * 1000;
let directUnreachableUntil = 0;

// ── ทางที่ 1: ยิงตรงเข้า Print Server (เครื่องที่ติดตั้ง Print Server / เปิดหน้าเว็บในวงแลน) ──
const sendDirect = async ({ ip, printerType, orderData }, timeoutMs) => {
  const url = getPrintServerUrl();
  if (isMixedContentBlocked(url)) return serverFailure(MIXED_CONTENT_MSG, true);
  if (Date.now() < directUnreachableUntil) return serverFailure(PRINT_SERVER_OFFLINE_MSG, true);
  let response;
  try {
    response = await fetchWithTimeout(`${url}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, printerType, orderData })
    }, timeoutMs);
  } catch (e) {
    // หมดเวลา = Print Server อาจได้งานไปแล้วแต่ตอบช้า — ห้ามส่งซ้ำผ่านคิว เดี๋ยวได้สองใบ
    if (e.name === 'AbortError') {
      return serverFailure(`Print Server ไม่ตอบภายใน ${Math.round(timeoutMs / 1000)} วินาที — เครื่องที่รัน Print Server อาจค้าง ลองปิด-เปิด Print Server`);
    }
    directUnreachableUntil = Date.now() + DIRECT_RETRY_MS;
    return serverFailure(PRINT_SERVER_OFFLINE_MSG, true);
  }
  directUnreachableUntil = 0;
  const data = await response.json().catch(() => null);
  if (!data) return serverFailure(`Print Server ตอบกลับ HTTP ${response.status}`);
  const serverOk = { key: 'server', status: 'ok', detail: `Print Server ${url} รับงานแล้ว` };
  // Print Server 1.5.0+ ส่ง steps มาเสมอ (อาจว่างถ้าพังก่อนต่อเครื่องพิมพ์ เช่น จัดหน้าใบไม่สำเร็จ)
  const steps = Array.isArray(data.steps)
    ? [serverOk, ...data.steps]
    // Print Server รุ่นเก่า (ก่อน 1.5.0) ไม่ส่งขั้นตอนกลับมา — รู้แค่สำเร็จ/ไม่สำเร็จ
    : [serverOk, data.success
      ? { key: 'send', status: 'ok', detail: 'ส่งงานแล้ว (Print Server รุ่นเก่า ตรวจสถานะเครื่องพิมพ์ไม่ได้ — อัปเดตด้วย update-printer.bat)' }
      : { key: 'connect', status: 'fail', detail: data.error || 'พิมพ์ไม่สำเร็จ' }];
  // เวอร์ชัน Print Server (1.7.1+ ส่งมากับผลพิมพ์ · รุ่นก่อนหน้าถามจาก /health เฉพาะใบแจ้งยอดที่มี QR)
  let serverVersion = data.version || '';
  if (!serverVersion && data.success && printerType === 'prebill' && orderData && orderData.payQr) {
    try { const h = await (await fetchWithTimeout(`${url}/health`, {}, 3000)).json(); serverVersion = (h && h.version) || '0'; } catch (e) { /* ไม่รู้เวอร์ชัน */ }
  }
  return {
    success: !!data.success,
    confirmed: !!data.confirmed,
    stage: data.stage || (data.success ? 'done' : 'connect'),
    error: data.error || (data.success ? null : 'พิมพ์ไม่สำเร็จ'),
    warning: data.warning || null,
    serverVersion,
    steps
  };
};

// ── ทางที่ 2: ฝากงานไว้ที่ API ให้ Print Server ในร้านมารับไปพิมพ์ (มือถือ/แท็บเล็ต) ──
const QUEUE_POLL_MS = 1500;
const QUEUE_PICKUP_MS = 20 * 1000;   // Print Server ดึงคิวทุก ~3 วิ — 20 วิแล้วยังไม่มีใครรับ = ไม่ได้เปิดอยู่
const QUEUE_FINISH_MS = 60 * 1000;   // รับไปแล้ว รอผลได้นานสุดเท่านี้

const queueFailure = (stage, error, steps = []) => ({
  success: false, confirmed: false, stage, error, warning: null, via: 'queue',
  steps: [...steps, { key: stage, status: 'fail', detail: error }]
});

const newJobId = () => {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* ด้านล่าง */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const apiPost = async (body, timeoutMs = 15000) => {
  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ branchId: printBranch, ...body })
  }, timeoutMs);
  return response.json();
};

const apiGet = async (params, timeoutMs = 10000) => {
  const query = new URLSearchParams({ ...params, ...(printBranch ? { branch: printBranch } : {}) }).toString();
  const response = await fetchWithTimeout(`${API_URL}?${query}`, {}, timeoutMs);
  return response.json();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendViaQueue = async ({ ip, printerType, orderData, label }, onQueued) => {
  const jobId = newJobId();
  let res;
  try {
    res = await apiPost({ action: 'enqueuePrint', jobId, printerIp: ip, printerType, orderData, label });
  } catch (e) {
    return queueFailure('queue', 'ติดต่อระบบไม่ได้ — เช็กอินเทอร์เน็ตของเครื่องนี้');
  }
  if (!res || res.success !== true) {
    const error = (res && res.error) || 'ฝากงานพิมพ์ไม่สำเร็จ';
    if (/Unknown action/i.test(error)) return { ...queueFailure('queue', 'API ยังไม่รองรับการพิมพ์จากมือถือ/แท็บเล็ต — ต้องอัปเดต API ก่อน'), unsupported: true };
    const stage = res && res.stage === 'agent' ? 'agent' : 'queue';
    const before = stage === 'agent' ? [{ key: 'queue', status: 'ok', detail: 'ติดต่อระบบได้' }] : [];
    return queueFailure(stage, error, before);
  }
  const queuedStep = { key: 'queue', status: 'ok', detail: 'ฝากงานไว้แล้ว รอ Print Server ในร้านมารับ' };
  if (onQueued) onQueued([queuedStep]);

  const startedAt = Date.now();
  let claimed = false;
  for (;;) {
    await sleep(QUEUE_POLL_MS);
    let job = null;
    try {
      const data = await apiGet({ action: 'getPrintQueue', ids: jobId });
      job = data && Array.isArray(data.jobs) ? data.jobs.find(j => j.id === jobId) : null;
    } catch (e) { /* เน็ตสะดุดชั่วคราว ลองรอบหน้า */ }

    if (job && (job.status === 'done' || job.status === 'failed')) {
      const agentStep = { key: 'agent', status: 'ok', detail: `Print Server ในร้าน${job.claimedBy ? ` (${job.claimedBy})` : ''} รับงานแล้ว` };
      const steps = [queuedStep, agentStep, ...(Array.isArray(job.steps) ? job.steps : [])];
      return {
        success: job.status === 'done',
        confirmed: !!job.confirmed,
        stage: job.stage || (job.status === 'done' ? 'done' : 'connect'),
        error: job.status === 'done' ? null : (job.error || 'พิมพ์ไม่สำเร็จ'),
        warning: job.warning || null,
        via: 'queue',
        serverVersion: (res.agent && res.agent.version) || '',
        steps
      };
    }
    if (job && (job.status === 'expired' || job.status === 'cancelled')) {
      return queueFailure('agent', job.error || 'ไม่มี Print Server มารับงาน — ยกเลิกงานนี้แล้ว', [queuedStep]);
    }
    if (job && job.status === 'printing') claimed = true;

    const waited = Date.now() - startedAt;
    if (!claimed && waited > QUEUE_PICKUP_MS) {
      // ยกเลิกก่อน ไม่ให้ใบนี้พ่นออกมาทีหลังตอน Print Server กลับมา — ถ้ายกเลิกไม่ทัน (เพิ่งถูกรับไป) ก็รอผลต่อ
      let cancelled = true;
      try { cancelled = !!(await apiPost({ action: 'cancelPrintJob', jobId })).cancelled; } catch (e) { cancelled = true; }
      if (cancelled) {
        return queueFailure('agent', `Print Server ในร้านไม่ได้รับงานภายใน ${QUEUE_PICKUP_MS / 1000} วินาที — ยกเลิกงานนี้แล้ว`, [queuedStep]);
      }
      claimed = true;
    }
    if (waited > QUEUE_FINISH_MS) {
      return {
        success: true, confirmed: false, stage: 'done', error: null, via: 'queue',
        warning: 'Print Server รับงานไปแล้วแต่ยังไม่รายงานผล — ดูที่เครื่องพิมพ์ว่ากระดาษออกไหม',
        steps: [queuedStep, { key: 'agent', status: 'ok', detail: 'Print Server ในร้านรับงานแล้ว' },
          { key: 'done', status: 'warn', detail: 'ยังไม่ได้รับผลการพิมพ์' }]
      };
    }
  }
};

// สั่งพิมพ์ — คืนค่า { success, confirmed, stage, error, warning, steps, via }
//   confirmed = เครื่องพิมพ์ยืนยันว่าพิมพ์เสร็จจริง · stage = ขั้นที่ติด (ดู PRINT_STEPS / PRINT_QUEUE_STEPS)
//   via = 'queue' เมื่อส่งผ่านคิว (เครื่องนี้ติดต่อ Print Server ตรง ๆ ไม่ได้ เช่นมือถือ/แท็บเล็ต)
// options.silent = ไม่ขึ้นกล่องสถานะมุมจอ (หน้าที่แสดงผลเองอยู่แล้ว เช่น ปุ่มทดสอบพิมพ์)
export const sendPrintJob = async ({ ip, printerType = 'receipt', orderData: rawOrderData, silent = false }, timeoutMs = 25000) => {
  const orderData = receiptHeader && rawOrderData && !rawOrderData.header
    ? { ...rawOrderData, header: receiptHeader }
    : rawOrderData;
  const job = {
    id: ++printJobSeq,
    ip,
    printerType,
    typeLabel: PRINT_TYPE_LABEL[printerType] || 'งานพิมพ์',
    orderNumber: rawOrderData && rawOrderData.orderNumber ? String(rawOrderData.orderNumber) : '',
    silent
  };
  announce({ ...job, phase: 'printing' });

  let result = await sendDirect({ ip, printerType, orderData }, timeoutMs);
  if (!result.success && result.unreachable) {
    const label = `${job.typeLabel}${job.orderNumber ? ` ${job.orderNumber}` : ''}`;
    const queued = await sendViaQueue({ ip, printerType, orderData, label },
      (steps) => announce({ ...job, phase: 'printing', via: 'queue', steps }));
    // API ยังไม่มีคิว → บอกปัญหาเดิม (ต่อ Print Server ไม่ได้) ซึ่งตรงกว่าสำหรับเครื่องที่ติดตั้ง Print Server เอง
    if (!queued.unsupported || isMixedContentBlocked()) result = queued;
  }
  delete result.unreachable;
  delete result.unsupported;

  announce({ ...job, ...result, phase: result.success ? (result.confirmed ? 'done' : 'sent') : 'error' });
  return result;
};

// ── หน้าตั้งค่าเครื่องพิมพ์: สถานะคิวงานพิมพ์ของสาขา ──
// คืนค่า { success, agent: { online, lastSeen, secondsAgo, agent, version } } หรือ { success:false, unsupported }
export const getPrintQueueStatus = async () => {
  try {
    const data = await apiGet({ action: 'getPrintQueue' });
    if (data && data.success) return data;
    const error = (data && data.error) || 'อ่านสถานะคิวงานพิมพ์ไม่ได้';
    return { success: false, error, unsupported: /Unknown/i.test(error) };
  } catch (e) {
    return { success: false, error: 'ติดต่อระบบไม่ได้ — เช็กอินเทอร์เน็ต' };
  }
};

// กุญแจให้ Print Server ของสาขานี้ใช้ดึงคิว (ต้องเป็นแอดมิน)
export const fetchPrintAgentKey = async () => {
  try {
    const data = await apiPost({ action: 'getPrintAgentKey' });
    if (data && data.success && data.key) return data;
    const error = (data && data.error) || 'ขอกุญแจไม่สำเร็จ';
    return { success: false, error: /Unknown action/i.test(error) ? 'API ยังไม่รองรับการพิมพ์จากมือถือ/แท็บเล็ต — ต้องอัปเดต API ก่อน' : error };
  } catch (e) {
    return { success: false, error: 'ติดต่อระบบไม่ได้ — เช็กอินเทอร์เน็ต' };
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
  'Print Server เครื่องนี้ยังเป็นเวอร์ชันเก่า (ยังไม่มีระบบพิมพ์อัตโนมัติ) — ดาวน์โหลด Print Server ตัวใหม่ในหน้าตั้งค่าเครื่องพิมพ์ แตกไฟล์ทับ แล้วรัน restart-print-server.bat';

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

// ── ตั้งค่าการรับงานจากคิวที่ Print Server (เครื่องนี้) ──
// Print Server รุ่นก่อน 1.6.0 ไม่มี /print-queue → outdated
export const getPrintQueueAgent = () => autoPrintFetch('/print-queue');
export const savePrintQueueAgent = (payload) => autoPrintFetch('/print-queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
