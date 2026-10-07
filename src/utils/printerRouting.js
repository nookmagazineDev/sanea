// ===============================================================
// จับคู่รายการอาหารกับเครื่องพิมพ์ แล้วสั่งพิมพ์แยกใบตามเครื่อง
// ---------------------------------------------------------------
// ลำดับการเลือกเครื่องพิมพ์ของแต่ละรายการ:
//   1) เมนูตั้ง printerId ไว้ (จัดการเมนู / เมนูรายสาขา)
//   2) เครื่องครัว/บาร์ที่เลือกหมวดของเมนูนี้ไว้ (ตั้งค่าเครื่องพิมพ์ > หมวดที่พิมพ์) — ตรงหลายเครื่อง = ออกทุกเครื่อง
//   3) เครื่องครัวที่ไม่ได้จำกัดหมวด → บาร์ที่ไม่จำกัดหมวด → เครื่องครัวเครื่องแรก
// ===============================================================

import { sendPrintJob } from './printServer';

const PRINTERS_KEY = 'printers_config';

// ชื่อรายการจากชีตมีจำนวนต่อท้าย เช่น "ข้าวกะเพราหมู (x2)" — ตัดออกก่อนจับคู่เมนู
export const stripQty = (name) => String(name || '').replace(/\s*\(x\d+\)\s*$/, '').trim();

export const getPrinters = () => {
  try {
    const stored = localStorage.getItem(PRINTERS_KEY);
    if (stored) {
      const list = JSON.parse(stored);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (e) { /* ค่าเสีย ให้ตกไปใช้ค่าเก่าด้านล่าง */ }

  // รองรับเครื่องที่ตั้งค่าไว้ก่อนมีหน้าจัดการหลายเครื่องพิมพ์
  const legacy = [];
  const receiptIp = localStorage.getItem('printer_receipt_ip');
  const kitchenIp = localStorage.getItem('printer_kitchen_ip');
  if (receiptIp) legacy.push({ id: 'legacy-receipt', name: 'ใบเสร็จ', ip: receiptIp, type: 'receipt' });
  if (kitchenIp) legacy.push({ id: 'legacy-kitchen', name: 'ครัว', ip: kitchenIp, type: 'kitchen' });
  return legacy;
};

// ชีตฝั่งเซิร์ฟเวอร์เก็บเครื่องพิมพ์ไว้ไม่ครบทุกฟิลด์ (สคริปต์รุ่นเก่าเก็บแค่ id/name/ip/type)
// ถ้าเอารายการจากเซิร์ฟเวอร์เขียนทับตรง ๆ ค่าที่ตั้งเพิ่มในเครื่องนี้ เช่น printMode (แยกใบ/รวมใบ)
// จะหายไปเองตอน sync รอบถัดไป — ตั้งเสร็จดูเหมือนบันทึกได้ แล้วอยู่ ๆ ก็เด้งกลับเป็นค่าเริ่มต้น
// จึงต้องรวมของเดิมในเครื่องเข้ากับรายการจากเซิร์ฟเวอร์ก่อนบันทึกทับเสมอ
export const mergeServerPrinters = (serverPrinters = [], localPrinters = getPrinters()) => {
  if (!Array.isArray(serverPrinters)) return [];

  const findLocal = (printer) =>
    localPrinters.find(local => String(local.id) === String(printer.id)) ||
    localPrinters.find(local => local.ip && local.ip === printer.ip) ||
    null;

  return serverPrinters.map(printer => {
    const local = findLocal(printer);
    if (!local) return printer;
    // ฟิลด์ที่เซิร์ฟเวอร์ไม่มี (หรือส่งมาเป็นค่าว่าง) ให้คงค่าที่ตั้งไว้ในเครื่องนี้
    const merged = { ...local, ...printer };
    Object.keys(printer).forEach(key => {
      const value = printer[key];
      if ((value === '' || value === undefined || value === null) && local[key] !== undefined) {
        merged[key] = local[key];
      }
    });
    return merged;
  });
};

export const getPrinterByType = (type, printers = getPrinters()) =>
  printers.find(p => p.type === type && p.ip) || null;

export const getPrinterById = (id, printers = getPrinters()) => {
  if (id === undefined || id === null || id === '') return null;
  return printers.find(p => String(p.id) === String(id) && p.ip) || null;
};

// เครื่องสำรองสำหรับใบครัว: ครัว → บาร์ → เครื่องแรกที่มี IP
const fallbackKitchenPrinter = (printers) =>
  getPrinterByType('kitchen', printers) ||
  getPrinterByType('bar', printers) ||
  printers.find(p => p.ip) ||
  null;

// หมวดที่เครื่องพิมพ์เลือกไว้ ([] = ไม่จำกัด พิมพ์ได้ทุกหมวด)
export const printerCategories = (printer) =>
  (Array.isArray(printer && printer.categories) ? printer.categories : []).map(String).filter(Boolean);

const CATEGORY_PRINTER_TYPES = ['kitchen', 'bar'];

// เครื่องพิมพ์ที่รายการนี้ต้องไปออก (อาจมากกว่า 1 เครื่อง) — ดูลำดับที่หัวไฟล์
export const printersForMenuItem = (menuItem, printers = getPrinters()) => {
  const byId = getPrinterById(menuItem?.printerId, printers);
  if (byId) return [byId];

  // ใช้หมวดหลักของเมนู (หมวดเสริมมีไว้แสดงหน้าขายเท่านั้น ไม่งั้นเมนูที่อยู่หลายหมวดจะพิมพ์ซ้ำ)
  const category = String(menuItem?.category || '');
  if (category) {
    const byCategory = printers.filter(p =>
      p.ip && CATEGORY_PRINTER_TYPES.includes(p.type) && printerCategories(p).includes(category)
    );
    if (byCategory.length > 0) return byCategory;
  }

  const general =
    printers.find(p => p.ip && p.type === 'kitchen' && printerCategories(p).length === 0) ||
    printers.find(p => p.ip && p.type === 'bar' && printerCategories(p).length === 0) ||
    fallbackKitchenPrinter(printers);
  return general ? [general] : [];
};

// แบ่งรายการอาหารออกเป็นกลุ่มตามเครื่องพิมพ์ที่ต้องไป
export const groupItemsByPrinter = (items = [], allMenu = [], printers = getPrinters()) => {
  const groups = new Map();
  const unrouted = [];

  items.forEach(item => {
    const name = stripQty(item.isFlattened ? item.name : item.food?.name);
    const menuItem = allMenu.find(m => stripQty(m.name) === name || (m.nameEn && stripQty(m.nameEn) === name));
    const targets = printersForMenuItem(menuItem, printers);

    if (targets.length === 0) {
      unrouted.push(item);
      return;
    }
    targets.forEach(printer => {
      const key = String(printer.id);
      if (!groups.has(key)) groups.set(key, { printer, items: [] });
      groups.get(key).items.push(item);
    });
  });

  return { groups: Array.from(groups.values()), unrouted };
};

// เครื่องพิมพ์ครัว/บาร์ ตั้งได้ว่าจะพิมพ์รวมใบเดียว หรือแยกใบละรายการ
// (ตั้งที่ จัดการหลังบ้าน > ตั้งค่าเครื่องพิมพ์) ไม่ได้ตั้ง = รวมใบเดียวเหมือนเดิม
// เลือกได้เฉพาะครัวกับบาร์ — ใบเสร็จต้องรวมใบเดียวเสมอ ถึงจะมีค่าค้างอยู่ก็ไม่สน
const SEPARATE_ALLOWED_TYPES = ['kitchen', 'bar'];
export const printsSeparately = (printer) =>
  !!printer && printer.printMode === 'separate' && SEPARATE_ALLOWED_TYPES.includes(printer.type);

// พิมพ์ใบครัวของออเดอร์ แยกใบไปตามเครื่องพิมพ์ของแต่ละเมนู
// คืนค่า { success, printed, total, error } โดย total = จำนวน "ใบ" ที่สั่งพิมพ์
export const printKitchenOrder = async (order, allMenu = []) => {
  const printers = getPrinters();
  if (printers.length === 0) {
    return { success: false, printed: 0, total: 0, error: 'ยังไม่ได้ตั้งค่าเครื่องพิมพ์ — ไปที่ ตั้งค่าแอดมิน > ตั้งค่าเครื่องพิมพ์' };
  }

  const { groups } = groupItemsByPrinter(order.items, allMenu, printers);
  if (groups.length === 0) {
    return { success: false, printed: 0, total: 0, error: 'ไม่พบเครื่องพิมพ์ที่ใช้งานได้ (ยังไม่ได้ระบุ IP Address)' };
  }

  const results = [];
  // ยิงขนานกันได้เฉพาะข้ามเครื่อง — งานของเครื่องเดียวกันต้องส่งทีละใบรอให้จบก่อน
  // เพราะเครื่องความร้อนรับงานได้ทีละงาน ยิงพร้อมกันหลายใบมีสิทธิ์พิมพ์ปนกันหรือหล่นหาย
  await Promise.all(groups.map(async ({ printer, items }) => {
    const tickets = printsSeparately(printer) ? items.map(item => [item]) : [items];
    for (const ticketItems of tickets) {
      const res = await sendPrintJob({
        ip: printer.ip,
        printerType: printer.type === 'receipt' ? 'receipt' : 'kitchen',
        orderData: { ...order, items: ticketItems }
      });
      results.push({ printer, ...res });
    }
  }));

  const failed = results.filter(r => !r.success);
  return {
    success: failed.length === 0,
    printed: results.length - failed.length,
    total: results.length,
    error: failed.length
      ? failed.map(f => `${f.printer.name || f.printer.ip}: ${f.error}`).join(' | ')
      : null
  };
};

// ─────────────────────────────────────────────
// ใบแจ้งยอด (check bill) — ให้ลูกค้าตรวจรายการและยอดก่อนจ่าย
// ใช้เครื่องประเภทใบเสร็จเป็นหลัก ไม่มีก็ใช้เครื่องแรกที่มี IP
// printerType 'prebill' บอก Print Server ว่าอย่าเปิดลิ้นชักเก็บเงิน
// ─────────────────────────────────────────────
export const printPreBill = async (order) => {
  const printers = getPrinters();
  const printer = getPrinterByType('receipt', printers) || printers.find(p => p.ip) || null;
  if (!printer) {
    return { success: false, error: 'ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ — ไปที่ จัดการหลังบ้าน > ตั้งค่าเครื่องพิมพ์' };
  }
  return await sendPrintJob({ ip: printer.ip, printerType: 'prebill', orderData: order });
};
