// ===============================================================
// Auto Print — Print Server ดึงออเดอร์จาก Google Sheet มาพิมพ์เอง
// ---------------------------------------------------------------
// ปัญหาเดิม: ออเดอร์ที่ลูกค้าสั่งเองผ่าน QR เกิดบนมือถือลูกค้า ไม่มีทาง
// สั่งเครื่องพิมพ์ในร้านได้ ต้องรอให้มีเครื่องเปิดหน้า "ครัว" ค้างไว้และ
// เปิดสวิตช์พิมพ์อัตโนมัติ ถ้าไม่มีใครเปิด ใบครัวก็ไม่ออก
//
// ไฟล์นี้ให้ Print Server (ซึ่งรันค้างอยู่แล้วในร้าน) คอยดึงชีต Orders
// เองทุก ๆ N วินาที เจอบิลสถานะ Pending ที่ยังไม่ได้พิมพ์ก็พิมพ์เลย
// เครื่องเดียวทำหน้าที่นี้ จึงไม่มีปัญหาพิมพ์ซ้ำแบบเปิดหลายจอ
//
// หมายเหตุ: บิลที่แคชเชียร์ปิดเองถูกเขียนเป็นสถานะ Completed อยู่แล้ว
// (พิมพ์ไปตั้งแต่ตอนกดส่งครัว) แถวที่เป็น Pending ในชีต Orders จึงมี
// แต่ออเดอร์จากคีออส/QR เท่านั้น
// ===============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { printTicket } from './print-ticket.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(HERE, 'print-auto-config.json');
const STATE_FILE = path.join(HERE, 'print-auto-state.json');

const DEFAULT_CONFIG = {
  enabled: false,
  gasUrl: '',
  // หัวใบของสาขานี้ (ชื่อร้าน ที่อยู่ ...) — หน้าตั้งค่าเครื่องพิมพ์ส่งมาให้ ใช้พิมพ์บนใบครัวอัตโนมัติ
  header: null,
  pollSeconds: 20,
  printers: [],
  // พิมพ์บิลที่ค้างอยู่ก่อนเปิดสวิตช์ด้วยไหม — ปกติไม่ กันพ่นย้อนหลังทีเดียวเป็นสิบใบ
  printBacklogOnStart: false
};

const PRINTED_MAX = 500;
const MENU_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3; // พิมพ์ไม่ออกกี่รอบถึงจะเลิกลอง (กันวนพิมพ์ไม่จบเพราะเครื่องพิมพ์ดับ)

let config = { ...DEFAULT_CONFIG };
let printed = new Set();     // เลขบิลที่พิมพ์แล้ว (หรือเลิกลองแล้ว)
let attempts = new Map();    // เลขบิล -> จำนวนครั้งที่พิมพ์ไม่สำเร็จ
let baselineDone = false;    // รอบแรกหลังเปิดสวิตช์ = ถือว่าบิลที่ค้างอยู่พิมพ์ไปแล้ว
let timer = null;
let polling = false;
let menuCache = { items: [], at: 0 };
// สคริปต์ที่ deploy อยู่ยังไม่รู้จัก getKitchenQueue (เวอร์ชันเก่า) → ถอยไปใช้ getLive ตลอดทั้งรอบชีวิตโปรเซส
let legacyGas = false;

const status = {
  lastPollAt: null,
  lastPrintAt: null,
  lastError: null,
  printedCount: 0,
  pendingSeen: 0
};

// ── config / state บนดิสก์ ───────────────────────────────────
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};

const loadConfig = () => {
  config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
  const state = readJson(STATE_FILE, {});
  printed = new Set(Array.isArray(state.printed) ? state.printed.map(String) : []);
  return config;
};

const saveConfig = () => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[auto-print] บันทึกไฟล์ตั้งค่าไม่สำเร็จ:', e.message);
  }
};

const saveState = () => {
  try {
    const keep = Array.from(printed).slice(-PRINTED_MAX);
    printed = new Set(keep);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ printed: keep }, null, 2));
  } catch (e) {
    console.error('[auto-print] บันทึกสถานะไม่สำเร็จ:', e.message);
  }
};

// ── ดึงข้อมูลจาก API ของระบบ (เดิมคือ Google Apps Script ตอนนี้เป็น /api/pos บน SQL Server) ──
const fetchGas = async (action, timeoutMs = 20000) => {
  const url = `${config.gasUrl}${config.gasUrl.includes('?') ? '&' : '?'}action=${action}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`API ตอบกลับ HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text.replace(/^\uFEFF/, ''));
};

// คิวใบครัวแบบเบา ๆ — ถ้าปลายทางที่ตั้งไว้ยังไม่มี action นี้ ให้ถอยไปใช้ getLive แบบเดิม
const fetchQueue = async () => {
  if (!legacyGas) {
    const data = await fetchGas('getKitchenQueue');
    if (!data || data.error !== 'Unknown GET action') return data;
    legacyGas = true;
    console.warn('[auto-print] ปลายทางที่ตั้งไว้ยังไม่รู้จัก getKitchenQueue — ใช้ getLive แทน (อัปเดต API เป็นเวอร์ชันใหม่จะเบากว่า)');
  }
  return await fetchGas('getLive');
};

// เมนูใช้หาว่าแต่ละรายการต้องไปออกที่เครื่องไหน (printerId) — เปลี่ยนไม่บ่อย cache ไว้ 5 นาที
const getMenu = async () => {
  if (Date.now() - menuCache.at < MENU_TTL_MS) return menuCache.items;
  try {
    const data = await fetchGas('getStatic');
    const items = Array.isArray(data && data.menu) ? data.menu : [];
    menuCache = { items, at: Date.now() };
  } catch (e) {
    console.warn('[auto-print] ดึงเมนูไม่สำเร็จ ใช้เครื่องพิมพ์ครัวเป็นค่าเริ่มต้น:', e.message);
    menuCache = { items: menuCache.items, at: Date.now() };
  }
  return menuCache.items;
};

// ── ประกอบบิลจากแถวในชีต Orders (ตรรกะเดียวกับหน้าเว็บ) ──────
// แถวที่ ItemDetail ขึ้นต้นด้วย ↳ คือตัวเลือกของรายการก่อนหน้า ไม่ใช่รายการใหม่
export const buildOrdersFromRows = (rows = []) => {
  const grouped = {};
  const order = [];
  rows.forEach(row => {
    const num = row.OrderNumber;
    if (!num) return;
    if (!grouped[num]) {
      grouped[num] = {
        id: num,
        orderNumber: num,
        customerDetails: { name: row.CustomerName, address: row.Address },
        items: [],
        total: parseFloat(row.TotalAmount) || 0,
        status: String(row.Status || 'pending').toLowerCase(),
        recordedBy: row.RecordedBy || '',
        timestamp: row.OrderStartTime || row.Timestamp
      };
      order.push(num);
    } else if (String(row.Status || '').toLowerCase() === 'pending') {
      grouped[num].status = 'pending';
    }
    const detail = typeof row.ItemDetail === 'string' ? row.ItemDetail : String(row.ItemDetail || '');
    const isSubItem = detail.trim().startsWith('↳');
    if (isSubItem && grouped[num].items.length > 0) {
      const last = grouped[num].items[grouped[num].items.length - 1];
      if (!last.subItems) last.subItems = [];
      last.subItems.push(detail);
    } else {
      const qty = Number(row.Quantity) || 1;
      grouped[num].items.push({
        isFlattened: true,
        name: qty > 1 ? `${detail} (x${qty})` : detail,
        dining: row.DiningOption
      });
    }
  });
  return order.map(num => grouped[num]);
};

// ── จับคู่รายการกับเครื่องพิมพ์ (ตรรกะเดียวกับ src/utils/printerRouting.js) ──
const stripQty = (name) => String(name || '').replace(/\s*\(x\d+\)\s*$/, '').trim();

const printersWithIp = () => (config.printers || []).filter(p => p && p.ip);

const printerByType = (type) => printersWithIp().find(p => p.type === type) || null;

const fallbackKitchenPrinter = () =>
  printerByType('kitchen') || printerByType('bar') || printersWithIp()[0] || null;

const printerCategories = (p) => (Array.isArray(p && p.categories) ? p.categories : []).map(String).filter(Boolean);

// เมนูตั้งเครื่องไว้ → เครื่องครัว/บาร์ที่เลือกหมวดของเมนูนี้ (ทุกเครื่องที่ตรง) → เครื่องครัวที่ไม่จำกัดหมวด
const printersForItem = (item, menu) => {
  const name = stripQty(item.name);
  const menuItem = menu.find(m => stripQty(m.name) === name || (m.nameEn && stripQty(m.nameEn) === name));
  const byId = menuItem && menuItem.printerId
    ? printersWithIp().find(p => String(p.id) === String(menuItem.printerId))
    : null;
  if (byId) return [byId];

  const category = String((menuItem && menuItem.category) || '');
  if (category) {
    const byCategory = printersWithIp().filter(p =>
      ['kitchen', 'bar'].includes(p.type) && printerCategories(p).includes(category));
    if (byCategory.length > 0) return byCategory;
  }

  const general =
    printersWithIp().find(p => p.type === 'kitchen' && printerCategories(p).length === 0) ||
    printersWithIp().find(p => p.type === 'bar' && printerCategories(p).length === 0) ||
    fallbackKitchenPrinter();
  return general ? [general] : [];
};

const printsSeparately = (printer) =>
  !!printer && printer.printMode === 'separate' && ['kitchen', 'bar'].includes(printer.type);

// พิมพ์ 1 บิล แยกใบตามเครื่องพิมพ์ของแต่ละเมนู — คืน { success, printed, total, error }
const printOrder = async (order, menu) => {
  const groups = new Map();
  (order.items || []).forEach(item => {
    printersForItem(item, menu).forEach(printer => {
      const key = String(printer.id || printer.ip);
      if (!groups.has(key)) groups.set(key, { printer, items: [] });
      groups.get(key).items.push(item);
    });
  });

  if (groups.size === 0) {
    return { success: false, printed: 0, total: 0, error: 'ไม่พบเครื่องพิมพ์ที่ใช้งานได้ (ยังไม่ได้ระบุ IP)' };
  }

  const results = [];
  for (const { printer, items } of groups.values()) {
    const tickets = printsSeparately(printer) ? items.map(i => [i]) : [items];
    for (const ticketItems of tickets) {
      const res = await printTicket({
        ip: printer.ip,
        printerType: printer.type === 'receipt' ? 'receipt' : 'kitchen',
        orderData: { ...order, items: ticketItems, ...(config.header ? { header: config.header } : {}) }
      });
      results.push({ printer, ...res });
    }
  }

  const failed = results.filter(r => !r.success);
  return {
    success: failed.length === 0,
    printed: results.length - failed.length,
    total: results.length,
    error: failed.length ? failed.map(f => `${f.printer.name || f.printer.ip}: ${f.error}`).join(' | ') : null
  };
};

// ── รอบการทำงานหลัก ─────────────────────────────────────────
export const pollOnce = async ({ force = false } = {}) => {
  if (!config.enabled && !force) return { skipped: 'ปิดสวิตช์อยู่' };
  if (!config.gasUrl) return { skipped: 'ยังไม่ได้ตั้งค่า URL ของ API' };
  if (polling) return { skipped: 'รอบก่อนยังทำงานอยู่' };
  polling = true;
  try {
    const data = await fetchQueue();
    status.lastPollAt = new Date().toISOString();
    status.lastError = null;

    const orders = buildOrdersFromRows(Array.isArray(data && data.orders) ? data.orders : []);
    const pending = orders.filter(o => o.status === 'pending');
    status.pendingSeen = pending.length;

    // รอบแรกหลังเปิดเครื่อง/เปิดสวิตช์ — มาร์คของที่ค้างอยู่ว่าพิมพ์แล้ว กันพ่นย้อนหลัง
    if (!baselineDone) {
      baselineDone = true;
      if (!config.printBacklogOnStart) {
        pending.forEach(o => printed.add(String(o.orderNumber)));
        saveState();
        console.log(`[auto-print] เริ่มทำงาน — ข้ามบิลค้าง ${pending.length} ใบ (ตั้ง printBacklogOnStart=true ถ้าอยากให้พิมพ์ย้อนหลัง)`);
        return { baseline: pending.length };
      }
    }

    const fresh = pending.filter(o => !printed.has(String(o.orderNumber)));
    if (fresh.length === 0) return { printed: 0, pending: pending.length };

    const menu = await getMenu();
    let okCount = 0;
    for (const order of fresh) {
      const res = await printOrder(order, menu);
      const key = String(order.orderNumber);
      if (res.success) {
        printed.add(key);
        attempts.delete(key);
        okCount += 1;
        status.printedCount += 1;
        status.lastPrintAt = new Date().toISOString();
        console.log(`[auto-print] พิมพ์บิล ${key} แล้ว (${res.printed} ใบ)`);
      } else {
        const tries = (attempts.get(key) || 0) + 1;
        attempts.set(key, tries);
        status.lastError = `บิล ${key}: ${res.error}`;
        console.error(`[auto-print] บิล ${key} พิมพ์ไม่สำเร็จ (ครั้งที่ ${tries}): ${res.error}`);
        if (tries >= MAX_ATTEMPTS) {
          printed.add(key); // เลิกลอง ไม่งั้นจะวนพิมพ์บิลเดิมไม่จบ
          attempts.delete(key);
          console.error(`[auto-print] เลิกลองบิล ${key} แล้ว — สั่งพิมพ์ซ้ำเองได้ที่หน้าครัว`);
        }
      }
    }
    saveState();
    return { printed: okCount, pending: pending.length, tried: fresh.length };
  } catch (e) {
    status.lastError = e.message;
    console.error('[auto-print] ดึงออเดอร์ไม่สำเร็จ:', e.message);
    return { error: e.message };
  } finally {
    polling = false;
  }
};

const restartTimer = () => {
  if (timer) clearInterval(timer);
  timer = null;
  if (!config.enabled) return;
  const seconds = Math.max(5, Number(config.pollSeconds) || 20);
  timer = setInterval(() => { pollOnce(); }, seconds * 1000);
  pollOnce();
  console.log(`[auto-print] เปิดใช้งาน — ดึงออเดอร์ทุก ${seconds} วินาที`);
};

const publicStatus = () => ({
  ...status,
  enabled: config.enabled,
  pollSeconds: config.pollSeconds,
  printerCount: printersWithIp().length,
  gasConfigured: !!config.gasUrl,
  alreadyPrinted: printed.size
});

// ผูก endpoint เข้ากับ Express app ของ Print Server
export const registerAutoPrint = (app) => {
  loadConfig();

  app.get('/auto-print', (req, res) => {
    res.json({ success: true, config: { ...config, printers: config.printers || [] }, status: publicStatus() });
  });

  // หน้าเว็บส่งค่าที่ตั้งไว้ในเบราว์เซอร์ (รายการเครื่องพิมพ์ + URL ของ API) มาเก็บไว้ที่เครื่องนี้
  // รับได้ทั้งชื่อเดิม gasUrl และชื่อใหม่ apiUrl — เครื่องที่ยังรันโค้ดเก่าจะได้ไม่พัง
  app.post('/auto-print', (req, res) => {
    const body = req.body || {};
    const wasEnabled = config.enabled;
    if (body.apiUrl !== undefined) config.gasUrl = String(body.apiUrl || '');
    if (body.gasUrl !== undefined) config.gasUrl = String(body.gasUrl || '');
    if (body.printers !== undefined) config.printers = Array.isArray(body.printers) ? body.printers : [];
    if (body.header !== undefined) config.header = body.header && typeof body.header === 'object' ? body.header : null;
    if (body.pollSeconds !== undefined) config.pollSeconds = Math.max(5, Number(body.pollSeconds) || 20);
    if (body.printBacklogOnStart !== undefined) config.printBacklogOnStart = !!body.printBacklogOnStart;
    if (body.enabled !== undefined) config.enabled = !!body.enabled;
    saveConfig();
    // เพิ่งเปิดสวิตช์ = เริ่มนับ baseline ใหม่ ไม่พ่นบิลเก่าที่ค้างอยู่
    if (!wasEnabled && config.enabled) baselineDone = false;
    restartTimer();
    res.json({ success: true, config, status: publicStatus() });
  });

  // ปุ่มทดสอบ: ดึงเดี๋ยวนี้เลยหนึ่งรอบ ไม่ต้องรอครบเวลา
  app.post('/auto-print/run', async (req, res) => {
    const result = await pollOnce({ force: true });
    res.json({ success: !result.error, result, status: publicStatus() });
  });

  restartTimer();
};
