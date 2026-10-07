// ==========================================
// เสน่ห์ POS - BACKEND SCRIPT (TABLE-BASED)
// ==========================================
// ⭐ ไฟล์ Backend เดียวของระบบ — ใช้ไฟล์นี้ไฟล์เดียวในการ Deploy บน Google Apps Script ⭐
// (รวมทุกอย่างแล้ว: ออเดอร์/เมนู/หมวดหมู่/ผู้ใช้ + BOM/สต็อก + กะ + รายงาน + ชำระเงิน)
// รองรับ: isAdmin, หมายเหตุอาหาร, popupConfig รายเมนู, ราคาหลายแบบ (prices), แยกจ่าย (splitDetail)
// ==========================================

var SHEET_ID = '1QSsVi6No7HJKqBcPiXcX_Xs1iMC9SRk6bydJ88dGNP4';

// ป้ายเวอร์ชันของสคริปต์ — ใช้ตรวจว่า deployment ที่แอปเรียกอยู่เป็นโค้ดล่าสุดหรือยัง
// (เปิด <URL>/exec?action=ping ในเบราว์เซอร์แล้วดูค่านี้) แก้โค้ดครั้งต่อไปให้ขยับเลขวันที่ด้วย
var SCRIPT_BUILD = '2026-10-07-sanea-humlai-features';

// โฟลเดอร์ Google Drive สำหรับเก็บรูปเมนูที่อัปโหลดจากหน้าจัดการเมนู
// https://drive.google.com/drive/folders/11aWwDOmZO_mijABBSJjpm-0pHuhLvyYp
var MENU_IMAGE_FOLDER_ID = '11aWwDOmZO_mijABBSJjpm-0pHuhLvyYp';
// โฟลเดอร์เก็บสลิปการโอนเงิน (แยกจากรูปเมนู)
var SLIP_FOLDER_ID = '1gxmLA9FZttcH3PCxlqY7TEHNXtnMMgYj';

// ลิงก์รูปที่เอาไปใส่ <img> ได้จริง — ปลายทาง /uc?export=view ถูก Google บล็อกการ hotlink
// บ่อย ๆ ส่วน /thumbnail ยังเสิร์ฟรูปตรง ๆ ให้ (sz=w1000 คือกว้างสุด 1000px พอสำหรับการ์ดเมนู)
function driveImageUrl(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
}

// ⭐ แก้อาการ "Access denied: DriveApp" ตอนอัปรูปเมนู ⭐
// Apps Script ขอสิทธิ์แค่ครั้งแรกที่กดอนุญาต แล้วจำชุดนั้นไว้
// สคริปต์นี้เดิมใช้แค่ Sheets จึงไม่มีสิทธิ์ Drive ติดมาด้วย — การ Deploy เฉย ๆ ไม่ขอสิทธิ์ใหม่
// วิธีใช้: เปิดหน้า Apps Script → เลือกฟังก์ชัน authorizeDrive ในแถบด้านบน → กด Run
//         → กด Review permissions → เลือกบัญชีร้าน → Advanced → Go to ... → Allow
//         แล้วค่อย Deploy เวอร์ชันใหม่
// ผลลัพธ์ใน Execution log:
//   "✅ ..."  = ใช้ได้แล้ว
//   "no item with the given ID" = สิทธิ์ Drive ผ่านแล้ว แต่บัญชีนี้เข้าโฟลเดอร์ไม่ได้
//                                 → ไปแชร์โฟลเดอร์ให้บัญชีนี้เป็น Editor
// แปลง error ดิบของ Drive เป็นข้อความที่บอกได้ว่าต้องไปแก้ตรงไหน
// (คนหน้าร้านเห็นข้อความนี้ผ่าน alert ตอนอัปรูปไม่สำเร็จ)
function explainDriveError(e) {
  var raw = String(e);
  if (raw.indexOf('Access denied') !== -1 || raw.indexOf('PERMISSION_DENIED') !== -1) {
    return 'สคริปต์ยังไม่ได้รับสิทธิ์เข้าถึง Google Drive — เปิด Apps Script แล้วกด Run ฟังก์ชัน authorizeDrive() หนึ่งครั้ง กดอนุญาตให้ครบ แล้ว Deploy เวอร์ชันใหม่ (' + raw + ')';
  }
  if (raw.indexOf('no item with the given ID') !== -1 || raw.indexOf('not found') !== -1) {
    return 'เข้าโฟลเดอร์รูปเมนูไม่ได้ — แชร์โฟลเดอร์ให้บัญชีที่เป็นเจ้าของ Apps Script เป็น Editor ก่อน (' + raw + ')';
  }
  return raw;
}

function authorizeDrive() {
  var folder = DriveApp.getFolderById(MENU_IMAGE_FOLDER_ID);
  var msg = '✅ เข้าถึงโฟลเดอร์รูปเมนูได้แล้ว: ' + folder.getName();
  Logger.log(msg);
  return msg;
}

// ชีตที่สร้างไว้ตั้งแต่ก่อนมีคอลัมน์ใหม่ อาจมีคอลัมน์ไม่พอให้เขียนหัวตารางชุดใหม่
// (เขียนเกินขอบเขตชีตจะ throw) จึงต้องขยายคอลัมน์ให้พอก่อน
function ensureColumns(sheet, count) {
  var max = sheet.getMaxColumns();
  if (max < count) sheet.insertColumnsAfter(max, count - max);
  return sheet;
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

function initializeSheets() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var orderSheet = getOrCreateSheet(ss, 'Orders', ['Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount', 'Status', 'OrderStartTime', 'CompletionTime', 'RecordedBy', 'Quantity']);
  if (orderSheet && orderSheet.getLastColumn() < 13) {
    orderSheet.getRange(1, 13).setValue('Quantity');
  }
  getOrCreateSheet(ss, 'Categories', ['slug', 'name', 'nameEn', 'icon', 'isActive', 'hasPopup1', 'popup1Category', 'popup1Items', 'popup1Min', 'popup1Max', 'popup1ItemsMax', 'popup1Free', 'hasPopup2', 'popup2Category', 'popup2Items', 'popup2Min', 'popup2Max', 'popup2ItemsMax', 'popup2Free', 'hasPopup3', 'popup3Category', 'popup3Items', 'popup3Min', 'popup3Max', 'popup3ItemsMax', 'popup3Free', 'hasPopup4', 'popup4Category', 'popup4Items', 'popup4Min', 'popup4Max', 'popup4ItemsMax', 'popup4Free', 'hasPopup5', 'popup5Category', 'popup5Items', 'popup5Min', 'popup5Max', 'popup5ItemsMax', 'popup5Free', 'hasPopup6', 'popup6Category', 'popup6Items', 'popup6Min', 'popup6Max', 'popup6ItemsMax', 'popup6Free', 'hasDining']);
  getOrCreateSheet(ss, 'Menu', MENU_HEADERS);
  getOrCreateSheet(ss, 'Promotions', ['id', 'name', 'nameEn', 'price', 'origPrice']);
  getOrCreateSheet(ss, 'TableOrders', ['TableNumber', 'SessionId', 'ItemName', 'ItemNameEn', 'ItemPrice', 'Quantity', 'Options', 'Timestamp', 'Status', 'RecordedBy']);
  getOrCreateSheet(ss, 'Users', ['id', 'username', 'pin', 'canCheckout', 'isAdmin', 'isCashier', 'branch']);
  getOrCreateSheet(ss, 'Discounts', ['id', 'name', 'type', 'value', 'categories']);
  getOrCreateSheet(ss, 'Settings', ['key', 'value']);
  getOrCreateSheet(ss, 'Printers', PRINTER_HEADERS);
  getOrCreateSheet(ss, 'LiquorStorage', ['timestamp', 'type', 'customerName', 'phone', 'productName', 'qty', 'note', 'staff', 'category', 'unit']);
  getOrCreateSheet(ss, 'Waste', WASTE_HEADERS);
  getOrCreateSheet(ss, 'PaymentApprovals', ['id', 'timestamp', 'tableNo', 'orderNumber', 'amount', 'requestedBy', 'status', 'approver', 'respondedAt']);
  getOrCreateSheet(ss, 'OutstandingBills', ['id', 'shiftId', 'tableNo', 'customerName', 'phone', 'total', 'items', 'createdAt', 'status']);
  getOrCreateSheet(ss, 'Shifts', ['id', 'openTime', 'closeTime', 'openStaff', 'closeStaff', 'openCash', 'closeCash', 'totalSales', 'totalCash', 'totalCard', 'totalTransfer', 'totalOrders', 'status', 'note']);
  getOrCreateSheet(ss, 'PaymentSummary', ['timestamp', 'orderNumber', 'tableNo', 'paymentMethod', 'grandTotal', 'staff', 'shiftId', 'splitDetail']);
  textSheet(ss, 'Branches', BRANCH_HEADERS);
  textSheet(ss, 'MenuBranch', MENU_BRANCH_HEADERS);
  textSheet(ss, 'KioskPayments', KIOSK_PAYMENT_HEADERS);
  textSheet(ss, 'TaxInvoices', TAX_INVOICE_HEADERS);
  textSheet(ss, 'TaxCustomers', TAX_CUSTOMER_HEADERS);
}

// ฟังก์ชันสำหรับรันครั้งแรกใน Apps Script เพื่อสร้างชีททั้งหมด (ข้อมูลพื้นฐาน + สต็อก/BOM)
function initializeAllSheetsAndBOM() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  initializeSheets();
  _setupIngredients(ss);
  _setupBOM(ss);
  _setupStockIn(ss);
  _setupStockOut(ss);
  _setupStockSummary(ss);
  SpreadsheetApp.flush();
  Logger.log("สร้างชีททั้งหมดพร้อมระบบสต็อก/BOM เรียบร้อยแล้ว!");
}

// เดิม doGet/doPost เรียก initializeSheets() ทุก request → เปิด+ตรวจ 16 ชีททุกครั้ง ช้ามาก
// ตอนนี้รันครั้งเดียวแล้วจำไว้ใน ScriptProperties (ผูกกับ SHEET_ID — เปลี่ยนชีทแล้วจะรันใหม่เอง)
// ถ้าต้องการบังคับสร้างชีทซ้ำ เรียก ?action=initSheets
function ensureSheetsReady() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('sheets_ready') === SHEET_ID) return;
  initializeSheets();
  props.setProperty('sheets_ready', SHEET_ID);
}

// ──────────────────────────────────────────────
// Cache ข้อมูล "เย็น" (เมนู/หมวดหมู่/พนักงาน/ตั้งค่า) — เก็บใน CacheService 5 นาที
// CacheService จำกัดค่าละ ~100KB จึงต้องหั่นเป็นชิ้น (ภาษาไทย 1 ตัว = 3 ไบต์ → ชิ้นละ 25,000 ตัวอักษร)
// ──────────────────────────────────────────────
var STATIC_CACHE_KEY = 'static_v1';
var STATIC_CACHE_SEC = 60;   // แก้เมนูหลังบ้านแล้วเห็นผลช้าสุด ~1 นาที (ถ้าแก้ผ่านระบบจะล้าง cache ให้ทันที)
var CACHE_CHUNK      = 25000;
var CACHE_MAX_CHUNKS = 40;

function cachePutLong(key, str) {
  var n = Math.ceil(str.length / CACHE_CHUNK);
  if (n > CACHE_MAX_CHUNKS) return; // ใหญ่เกินไป → ไม่ cache ดีกว่าเก็บครึ่ง ๆ กลาง ๆ
  var map = {};
  for (var i = 0; i < n; i++) map[key + '_' + i] = str.substr(i * CACHE_CHUNK, CACHE_CHUNK);
  var cache = CacheService.getScriptCache();
  cache.putAll(map, STATIC_CACHE_SEC);
  cache.put(key + '_n', String(n), STATIC_CACHE_SEC); // ใส่ตัวนับหลังสุด กันอ่านเจอตัวนับแต่ชิ้นยังไม่ครบ
}

function cacheGetLong(key) {
  var cache = CacheService.getScriptCache();
  var nStr = cache.get(key + '_n');
  if (!nStr) return null;
  var n = parseInt(nStr, 10);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys);
  var out = '';
  for (var j = 0; j < n; j++) {
    var part = got[key + '_' + j];
    if (part == null) return null; // ชิ้นไหนหมดอายุก่อน → ถือว่าไม่มี cache
    out += part;
  }
  return out;
}

// cache แยกตามสาขา — ล้างทุกสาขาพร้อมกันด้วยการขยับเลขรุ่น (generation) ของ key
function staticCacheKey(branchId) {
  var gen = CacheService.getScriptCache().get(STATIC_CACHE_KEY + '_gen') || '0';
  return STATIC_CACHE_KEY + '_' + gen + '_' + String(branchId || '').replace(/[^0-9A-Za-z_-]/g, '');
}

function clearStaticCache() {
  CacheService.getScriptCache().put(STATIC_CACHE_KEY + '_gen', String(Date.now()), 21600);
}

function readSettings(ss) {
  var sh = ss.getSheetByName('Settings');
  if (!sh) return null;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === 'pos_settings') {
      try { return JSON.parse(d[i][1]); } catch(err) { return null; }
    }
  }
  return null;
}

// ข้อมูลเย็น: เปลี่ยนเฉพาะตอนแอดมินแก้หลังบ้าน → อ่านจาก cache ได้
// branchId = ส่งเมนูที่ปรับตามสาขานั้นแล้ว ('' = เมนูกลาง ใช้ในหน้าหลังบ้าน)
// ไม่ส่งรหัสพนักงานออกไป — ใครก็เรียก getStatic ได้ (หน้าลูกค้าสั่งเอง) รหัสเช็กตอน action=login
function buildStaticData(ss, branchId) {
  var printers = getSheetDataAsObjects(ss, 'Printers');
  var menu = sortMenuRows(getSheetDataAsObjects(ss, 'Menu'));
  return {
    categories:    getSheetDataAsObjects(ss, 'Categories'),
    menu:          applyBranchMenu(menu, getMenuBranchRows(ss, branchId), printers, branchId),
    promotions:    getSheetDataAsObjects(ss, 'Promotions'),
    users:         getSheetDataAsObjects(ss, 'Users').map(function(u) {
                     var out = {};
                     for (var k in u) if (k !== 'pin') out[k] = u[k];
                     out.hasPin = String(u.pin == null ? '' : u.pin) !== '';
                     return out;
                   }),
    printers:      printers,
    discounts:     getSheetDataAsObjects(ss, 'Discounts'),
    settings:      readSettings(ss),
    branches:      getBranchList(ss),
    branchTables:  readSettingJson(ss, 'branch_tables', {}),
    defaultBranch: defaultBranchId(ss)
  };
}

// ──────────────────────────────────────────────
// สาขา / เมนูรายสาขา / รหัสเมนู / ลูกค้าสแกนจ่าย / ใบกำกับภาษี
// (ตรรกะเดียวกับ api/_lib ฝั่ง SQL — ให้หน้าจอชุดใหม่ใช้กับ Google Sheet ได้ครบ)
// ──────────────────────────────────────────────
var MENU_HEADERS = ['id', 'category', 'name', 'nameEn', 'description', 'descriptionEn', 'price', 'image', 'isActive', 'bundledItems', 'popupConfig', 'prices', 'categories', 'printerId', 'branches', 'sortOrder'];
var PRINTER_HEADERS = ['id', 'name', 'ip', 'type', 'printMode', 'branchId', 'categories'];
var WASTE_HEADERS = ['timestamp', 'branch', 'itemName', 'category', 'qty', 'unit', 'note', 'staff', 'kind', 'itemType'];
var BRANCH_HEADERS = ['id', 'name', 'billPrefix', 'phone', 'address', 'taxId', 'receiptFooter', 'isActive', 'posId'];
var MENU_BRANCH_HEADERS = ['menuId', 'branchId', 'isAvailable', 'priceMap', 'printerId'];
var KIOSK_PAYMENT_HEADERS = ['id', 'branchId', 'tableNo', 'dining', 'payloadJson', 'total', 'status', 'requestedAt', 'respondedAt', 'respondedBy', 'orderNumber'];
var TAX_INVOICE_HEADERS = ['invoiceNo', 'orderNumber', 'branchId', 'issuedAt', 'buyerName', 'buyerTaxId', 'buyerAddress', 'buyerBranch', 'itemsJson', 'subtotal', 'vatRate', 'vatAmount', 'total', 'sellerJson', 'issuedBy', 'cancelled', 'cancelledAt', 'cancelReason'];
var TAX_CUSTOMER_HEADERS = ['taxId', 'buyerBranch', 'name', 'address', 'phone', 'useCount', 'lastUsedAt'];
var ITEM_ID_PREFIX = 'SN';

// ชีตที่เก็บทุกช่องเป็นข้อความ — เลขผู้เสียภาษี 13 หลัก/เบอร์โทรขึ้นต้น 0/เวลา ISO ห้ามถูกชีตแปลงเป็นตัวเลขหรือวันที่
function textSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(headers.length, sh.getMaxColumns())).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

// เขียนหัวตารางชุดใหม่ทับ (เพิ่มคอลัมน์ต่อท้ายให้ชีตเดิม) โดยไม่แตะข้อมูล
function ensureHeaders(sheet, headers) {
  ensureColumns(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function thaiTimeISO(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss") + '+07:00';
}

function asJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function cleanText(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

function readSettingJson(ss, key, fallback) {
  var sh = ss.getSheetByName('Settings');
  if (!sh) return fallback;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === key) return asJson(d[i][1], fallback);
  }
  return fallback;
}

function writeSettingJson(ss, key, value) {
  var sh = getOrCreateSheet(ss, 'Settings', ['key', 'value']);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === key) { sh.getRange(i + 1, 2).setValue(JSON.stringify(value)); return; }
  }
  sh.appendRow([key, JSON.stringify(value)]);
}

// ── สาขา ──
function getBranchList(ss) {
  return getSheetDataAsObjects(ss, 'Branches').map(function(b) {
    return {
      id: String(b.id || '').trim(), name: String(b.name || ''), billPrefix: String(b.billPrefix || ''),
      phone: String(b.phone || ''), address: String(b.address || ''), taxId: String(b.taxId || ''),
      receiptFooter: String(b.receiptFooter || ''), posId: String(b.posId || ''),
      isActive: !(b.isActive === false || String(b.isActive).toUpperCase() === 'FALSE' || String(b.isActive) === '0')
    };
  }).filter(function(b) { return b.id; });
}

// สาขาหลัก = สาขาแรกที่เปิดใช้งาน ('' = ยังไม่ได้ตั้งสาขา)
function defaultBranchId(ss) {
  var list = getBranchList(ss).filter(function(b) { return b.isActive; });
  return list.length ? list[0].id : '';
}

// ตัวนำหน้าเลขบิลของสาขา — ไม่ได้ตั้งใช้รหัสสาขา (ตรงกับฝั่งหน้าเว็บ)
function cleanPrefix(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Zก-๙]/g, ''); }
function branchBillPrefix(ss, branchId) {
  var id = String(branchId || '');
  var b = getBranchList(ss).filter(function(x) { return x.id === id; })[0];
  return cleanPrefix(b && b.billPrefix) || cleanPrefix(id) || 'POS';
}

// ── เมนูรายสาขา ──
function getMenuBranchRows(ss, branchId) {
  if (!branchId) return [];
  return getSheetDataAsObjects(ss, 'MenuBranch').filter(function(r) {
    return String(r.branchId) === String(branchId);
  }).map(function(r) {
    var avail = r.isAvailable;
    return {
      menuId: String(r.menuId),
      isAvailable: (avail === '' || avail === null || avail === undefined) ? null : !(avail === false || String(avail) === '0' || String(avail).toUpperCase() === 'FALSE'),
      priceMap: asJson(r.priceMap, {}) || {},
      printerId: r.printerId ? String(r.printerId) : ''
    };
  });
}

function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

function applyBranchMenu(menu, rows, printers, branchId) {
  if (!branchId) return menu;
  var byMenu = {};
  rows.forEach(function(r) { byMenu[r.menuId] = r; });
  var mine = printers.filter(function(p) { return !p.branchId || String(p.branchId) === String(branchId); });
  var mineIds = {};
  mine.forEach(function(p) { mineIds[String(p.id)] = true; });
  var localPrinterFor = function(printerId) {
    var id = String(printerId || '');
    if (!id || mineIds[id]) return id;
    var source = printers.filter(function(p) { return String(p.id) === id; })[0];
    var twin = source && mine.filter(function(p) { return norm(p.name) && norm(p.name) === norm(source.name); })[0];
    return twin ? String(twin.id) : id;
  };
  var soldHere = function(item) {
    var b = item.branches;
    return !Array.isArray(b) || b.length === 0 || b.some(function(x) { return String(x) === String(branchId); });
  };
  return menu.filter(soldHere).map(function(item) {
    var out = {};
    for (var k in item) out[k] = item[k];
    out.printerId = localPrinterFor(item.printerId);
    var row = byMenu[String(item.id)];
    if (!row) return out;
    if (row.isAvailable === false) out.isActive = false;
    if (row.printerId) out.printerId = row.printerId;
    var map = row.priceMap || {};
    var has = function(key) { return Object.prototype.hasOwnProperty.call(map, key) && map[key] !== '' && map[key] !== null && isFinite(Number(map[key])); };
    if (Array.isArray(item.prices) && item.prices.length > 0) {
      out.prices = item.prices.map(function(p) {
        var name = String((p && p.name) || '');
        if (!p || !has(name)) return p;
        var q = {}; for (var kk in p) q[kk] = p[kk];
        q.price = Number(map[name]);
        return q;
      });
    }
    if (has('')) out.price = Number(map['']);
    return out;
  });
}

// เมนูเรียงตามลำดับที่จัดในหน้าจัดการเมนู — ที่ยังไม่เคยจัดต่อท้ายตามลำดับแถว
function sortMenuRows(menu) {
  return menu.map(function(m, i) { return { m: m, i: i }; }).sort(function(a, b) {
    var sa = Number(a.m.sortOrder), sb = Number(b.m.sortOrder);
    var ha = a.m.sortOrder !== '' && a.m.sortOrder != null && isFinite(sa);
    var hb = b.m.sortOrder !== '' && b.m.sortOrder != null && isFinite(sb);
    if (ha && hb && sa !== sb) return sa - sb;
    if (ha !== hb) return ha ? -1 : 1;
    return a.i - b.i;
  }).map(function(x) { return x.m; });
}

// รหัสถัดไปของเมนู/หมวดหมู่ (SN00001 …) — เมนูกับหมวดหมู่ใช้ชุดเลขเดียวกัน
function nextItemIds(ss, count) {
  var re = new RegExp('^' + ITEM_ID_PREFIX + '(\\d{5})$');
  var max = 0;
  var scan = function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var m = re.exec(String(r[0] || '').trim());
      if (m) max = Math.max(max, Number(m[1]));
    });
  };
  scan('Menu');
  scan('Categories');
  var ids = [];
  for (var i = 1; i <= count; i++) {
    var n = String(max + i);
    while (n.length < 5) n = '0' + n;
    ids.push(ITEM_ID_PREFIX + n);
  }
  return ids;
}

// แถวแรกที่ตรงเงื่อนไข → { row: เลขแถวในชีต, obj }
function findRow(sheet, headers, match) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var obj = {};
    headers.forEach(function(h, j) { obj[h] = values[i][j]; });
    if (match(obj)) return { row: i + 2, obj: obj };
  }
  return null;
}

function writeRow(sheet, headers, rowNo, obj) {
  sheet.getRange(rowNo, 1, 1, headers.length).setValues([headers.map(function(h) { return obj[h] == null ? '' : obj[h]; })]);
}

// ── ลูกค้าสแกน QR จ่ายเอง → พนักงานยืนยันยอด ──
function kioskDisplayItems(items) {
  return (Array.isArray(items) ? items : []).map(function(item) {
    var qty = Number(item.quantity) || 1;
    var unit = Number(item.food && item.food.price) || 0;
    return { name: (item.food && item.food.name) || '', qty: qty, options: itemOptionText(item), amount: unit * qty };
  });
}

function mapKioskPayment(r) {
  var payload = asJson(r.payloadJson, {}) || {};
  return {
    id: String(r.id), branchId: String(r.branchId || ''), tableNo: String(r.tableNo || ''), dining: String(r.dining || ''),
    total: Number(r.total) || 0, status: String(r.status || 'pending'), requestedAt: String(r.requestedAt || ''),
    respondedAt: String(r.respondedAt || ''), respondedBy: String(r.respondedBy || ''), orderNumber: String(r.orderNumber || ''),
    items: kioskDisplayItems(payload.items)
  };
}

function kioskPaymentRequest(ss, data) {
  var id = cleanText(data.sessionId, 60);
  var items = Array.isArray(data.items) ? data.items : [];
  var total = Math.round((Number(data.total) || 0) * 100) / 100;
  if (!id) return { success: false, error: 'ไม่มีรหัสรายการ' };
  if (items.length === 0) return { success: false, error: 'ไม่มีรายการอาหาร' };
  if (!(total > 0)) return { success: false, error: 'ยอดชำระไม่ถูกต้อง' };
  var branchId = String(data.branchId || data.branch || '').trim() || defaultBranchId(ss);
  var now = thaiTimeISO();
  var sh = textSheet(ss, 'KioskPayments', KIOSK_PAYMENT_HEADERS);
  var row = {
    id: id, branchId: branchId, tableNo: cleanText(data.tableNumber, 50), dining: cleanText(data.dining, 50),
    payloadJson: JSON.stringify({ branchId: branchId, tableNumber: cleanText(data.tableNumber, 50), items: items, total: total, timestamp: data.timestamp || now }),
    total: total, status: 'pending', requestedAt: now, respondedAt: '', respondedBy: '', orderNumber: ''
  };
  var found = findRow(sh, KIOSK_PAYMENT_HEADERS, function(o) { return String(o.id) === id; });
  if (found) {
    if (found.obj.status === 'approved') return { success: true, status: 'approved', orderNumber: String(found.obj.orderNumber || '') };
    if (found.obj.status === 'approving') return { success: true, status: 'pending' };
    writeRow(sh, KIOSK_PAYMENT_HEADERS, found.row, row);
    return { success: true, status: 'pending' };
  }
  sh.appendRow(KIOSK_PAYMENT_HEADERS.map(function(h) { return row[h]; }));
  return { success: true, status: 'pending' };
}

function getKioskPayment(ss, params) {
  var id = cleanText(params.id, 60);
  var found = findRow(ss.getSheetByName('KioskPayments'), KIOSK_PAYMENT_HEADERS, function(o) { return String(o.id) === id; });
  if (!found) return { success: false, error: 'ไม่พบรายการ' };
  var status = found.obj.status === 'approving' ? 'pending' : String(found.obj.status || 'pending');
  return { success: true, status: status, orderNumber: String(found.obj.orderNumber || ''), total: Number(found.obj.total) || 0 };
}

// รายการที่รอยืนยันของสาขานี้ — รอนานสุดขึ้นก่อน (ตัดของเก่ากว่า 6 ชม.)
function getPendingKioskPayments(ss, params) {
  var branchId = cleanText(params.branch || params.branchId, 60);
  var cutoff = thaiTimeISO(new Date(Date.now() - 6 * 3600 * 1000));
  var list = getSheetDataAsObjects(ss, 'KioskPayments').filter(function(r) {
    return String(r.status) === 'pending' && String(r.requestedAt || '') >= cutoff && (!branchId || String(r.branchId) === branchId);
  }).sort(function(a, b) { return String(a.requestedAt).localeCompare(String(b.requestedAt)); });
  return { success: true, payments: list.slice(0, 50).map(mapKioskPayment) };
}

// ยืนยัน / ปฏิเสธ — ผู้เรียกถือ LockService อยู่ ใครกดก่อนได้ คนหลังได้ข้อความว่าจัดการไปแล้ว
function respondKioskPayment(ss, data) {
  var id = cleanText(data.id, 60);
  var by = cleanText(data.by, 120);
  if (!id) return { success: false, error: 'ไม่ได้ระบุรายการ' };
  var sh = ss.getSheetByName('KioskPayments');
  var found = findRow(sh, KIOSK_PAYMENT_HEADERS, function(o) { return String(o.id) === id; });
  if (!found) return { success: false, error: 'ไม่พบรายการ' };
  var row = found.obj;
  if (row.status === 'approved' && data.approve === true) return { success: true, status: 'approved', already: true, payment: mapKioskPayment(row) };
  if (row.status !== 'pending') return { success: false, error: 'รายการนี้ถูกจัดการไปแล้ว' };

  row.respondedAt = thaiTimeISO();
  row.respondedBy = by;
  if (data.approve !== true) {
    row.status = 'rejected';
    writeRow(sh, KIOSK_PAYMENT_HEADERS, found.row, row);
    return { success: true, status: 'rejected' };
  }

  var payload = asJson(row.payloadJson, {}) || {};
  var result;
  try {
    result = kioskPaidOrderCore(ss, {
      tableNumber: payload.tableNumber, items: payload.items, total: payload.total, timestamp: payload.timestamp,
      branchId: row.branchId || payload.branchId, sessionId: id, paymentMethod: 'เงินโอน (QR พนักงานยืนยัน)'
    });
  } catch (err) {
    result = { success: false, error: String(err) };
  }
  if (!result || !result.success) return { success: false, error: (result && result.error) || 'บันทึกบิลไม่สำเร็จ' };
  row.status = 'approved';
  row.orderNumber = result.orderNumber || '';
  writeRow(sh, KIOSK_PAYMENT_HEADERS, found.row, row);
  return { success: true, status: 'approved', payment: mapKioskPayment(row) };
}

// ── ใบกำกับภาษีเต็มรูป ──
// ยอดเงิน/รายการคำนวณจากบิลจริงในชีต Orders — ไม่เชื่อตัวเลขที่หน้าเว็บส่งมา
// ราคาขายรวม VAT แล้ว → มูลค่าก่อน VAT = ยอดบิล × 100 / (100 + อัตรา)
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function mapTaxInvoice(r) {
  return {
    invoiceNo: String(r.invoiceNo), orderNumber: String(r.orderNumber), branchId: String(r.branchId || ''), issuedAt: String(r.issuedAt || ''),
    buyer: { name: String(r.buyerName || ''), taxId: String(r.buyerTaxId || ''), address: String(r.buyerAddress || ''), branch: String(r.buyerBranch || '') },
    items: asJson(r.itemsJson, []) || [], subtotal: Number(r.subtotal) || 0, vatRate: Number(r.vatRate) || 0,
    vatAmount: Number(r.vatAmount) || 0, total: Number(r.total) || 0, seller: asJson(r.sellerJson, {}) || {},
    issuedBy: String(r.issuedBy || ''), cancelled: String(r.cancelled) === '1' || r.cancelled === true || String(r.cancelled).toUpperCase() === 'TRUE',
    cancelledAt: String(r.cancelledAt || ''), cancelReason: String(r.cancelReason || '')
  };
}

function listTaxInvoices(ss) {
  return getSheetDataAsObjects(ss, 'TaxInvoices').reverse().slice(0, 5000).map(mapTaxInvoice);
}

function taxInvoiceItems(rows) {
  var items = [];
  rows.forEach(function(row) {
    var detail = String(row.ItemDetail || '').trim();
    if (!detail) return;
    if (detail.charAt(0) === '↳') {
      var last = items[items.length - 1];
      var opt = detail.replace(/^↳\s*/, '');
      if (last && opt) last.name += ' (' + opt + ')';
      return;
    }
    var qty = Number(row.Quantity) || 1;
    var amount = round2(row.Price);
    items.push({ name: detail, qty: qty, unitPrice: round2(amount / qty), amount: amount });
  });
  return items;
}

function issueTaxInvoice(ss, data) {
  var orderNumber = cleanText(data.orderNumber, 60);
  var buyer = data.buyer || {};
  var buyerName = cleanText(buyer.name, 300);
  var buyerTaxId = cleanText(buyer.taxId, 40).replace(/[\s-]/g, '');
  var buyerAddress = cleanText(buyer.address, 1000);
  var buyerBranch = cleanText(buyer.branch, 100) || 'สำนักงานใหญ่';
  if (!orderNumber) return { success: false, error: 'ไม่ได้ระบุเลขบิล' };
  if (!buyerName || !buyerAddress) return { success: false, error: 'กรุณากรอกชื่อและที่อยู่ผู้ซื้อ' };
  if (!/^\d{13}$/.test(buyerTaxId)) return { success: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' };

  var sh = textSheet(ss, 'TaxInvoices', TAX_INVOICE_HEADERS);
  var existing = findRow(sh, TAX_INVOICE_HEADERS, function(o) { return String(o.orderNumber) === orderNumber && !mapTaxInvoice(o).cancelled; });
  if (existing) return { success: true, existing: true, invoice: mapTaxInvoice(existing.obj) };

  var rows = getSheetDataAsObjects(ss, 'Orders').filter(function(r) { return String(r.OrderNumber) === orderNumber; });
  if (!rows.length) return { success: false, error: 'ไม่พบบิล ' + orderNumber };
  if (rows.every(function(r) { return String(r.Status || '').toLowerCase() === 'cancelled'; })) {
    return { success: false, error: 'บิลนี้ถูกยกเลิกแล้ว ออกใบกำกับภาษีไม่ได้' };
  }
  var total = round2(rows[0].TotalAmount);
  if (!(total > 0)) return { success: false, error: 'ยอดบิลเป็นศูนย์ ออกใบกำกับภาษีไม่ได้' };
  var items = taxInvoiceItems(rows);
  var diff = round2(total - items.reduce(function(s, i) { return s + i.amount; }, 0));
  if (Math.abs(diff) >= 0.01) items.push({ name: diff < 0 ? 'ส่วนลด' : 'ค่าบริการ / ภาษีที่บวกตอนชำระ', qty: 1, unitPrice: diff, amount: diff, adjustment: true });

  var settings = readSettings(ss) || {};
  var rateSetting = Number(settings.vat && settings.vat.rate);
  var vatRate = isFinite(rateSetting) && rateSetting > 0 ? rateSetting : 7;
  var subtotal = round2(total * 100 / (100 + vatRate));
  var vatAmount = round2(total - subtotal);

  // ชีต Orders ยังไม่มีคอลัมน์สาขา → ใช้สาขาหลัก
  var mainBranch = defaultBranchId(ss);
  var branchId = String(rows[0].BranchId || '').trim() || mainBranch;
  var b = getBranchList(ss).filter(function(x) { return x.id === branchId; })[0] || {};
  var seller = {
    name: String(b.name || branchId || ''), address: String(b.address || ''), phone: String(b.phone || ''), taxId: String(b.taxId || ''),
    branchLabel: !mainBranch || branchId === mainBranch ? 'สำนักงานใหญ่' : ('สาขา ' + String(b.name || branchId))
  };
  if (!/^\d{13}$/.test(seller.taxId.replace(/[\s-]/g, ''))) {
    return { success: false, error: 'ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของร้าน — ไปตั้งที่ หลังบ้าน > สาขา ก่อน' };
  }

  var now = thaiTimeISO();
  var prefix = cleanPrefix(b.billPrefix).replace(/[^A-Z0-9]/g, '');
  var base = (prefix ? prefix + '-' : '') + 'TX' + now.slice(2, 4) + now.slice(5, 7) + '-';
  var max = 0;
  getSheetDataAsObjects(ss, 'TaxInvoices').forEach(function(r) {
    var no = String(r.invoiceNo || '');
    if (no.indexOf(base) === 0) { var n = parseInt(no.slice(base.length), 10); if (!isNaN(n) && n > max) max = n; }
  });
  var seq = String(max + 1); while (seq.length < 4) seq = '0' + seq;
  var row = {
    invoiceNo: base + seq, orderNumber: orderNumber, branchId: branchId, issuedAt: now, buyerName: buyerName, buyerTaxId: buyerTaxId,
    buyerAddress: buyerAddress, buyerBranch: buyerBranch, itemsJson: JSON.stringify(items), subtotal: subtotal, vatRate: vatRate,
    vatAmount: vatAmount, total: total, sellerJson: JSON.stringify(seller), issuedBy: cleanText(data.issuedBy, 120), cancelled: '0',
    cancelledAt: '', cancelReason: ''
  };
  sh.appendRow(TAX_INVOICE_HEADERS.map(function(h) { return String(row[h]); }));
  try { upsertTaxCustomer(ss, { taxId: buyerTaxId, branch: buyerBranch, name: buyerName, address: buyerAddress, phone: cleanText(buyer.phone, 60) }, true); }
  catch (err) { Logger.log('saveTaxCustomer: ' + err); }
  return { success: true, invoice: mapTaxInvoice(row) };
}

function cancelTaxInvoice(ss, data) {
  var invoiceNo = cleanText(data.invoiceNo, 60);
  var reason = cleanText(data.reason, 500);
  if (!invoiceNo) return { success: false, error: 'ไม่ได้ระบุเลขที่ใบกำกับภาษี' };
  if (!reason) return { success: false, error: 'กรุณาระบุเหตุผลที่ยกเลิก' };
  var sh = ss.getSheetByName('TaxInvoices');
  var found = findRow(sh, TAX_INVOICE_HEADERS, function(o) { return String(o.invoiceNo) === invoiceNo && !mapTaxInvoice(o).cancelled; });
  if (!found) return { success: false, error: 'ไม่พบใบกำกับนี้ หรือถูกยกเลิกไปแล้ว' };
  found.obj.cancelled = '1'; found.obj.cancelledAt = thaiTimeISO(); found.obj.cancelReason = reason;
  writeRow(sh, TAX_INVOICE_HEADERS, found.row, found.obj);
  return { success: true };
}

// แก้ข้อมูลผู้ซื้อ = ยกเลิกใบเดิมแล้วออกเลขใหม่ ออกใบใหม่ไม่ได้ → คืนสถานะใบเดิม
function reissueTaxInvoice(ss, data) {
  var invoiceNo = cleanText(data.invoiceNo, 60);
  var buyer = data.buyer || {};
  if (!invoiceNo) return { success: false, error: 'ไม่ได้ระบุเลขที่ใบกำกับภาษี' };
  if (!cleanText(buyer.name, 300) || !cleanText(buyer.address, 1000)) return { success: false, error: 'กรุณากรอกชื่อและที่อยู่ผู้ซื้อ' };
  if (!/^\d{13}$/.test(cleanText(buyer.taxId, 40).replace(/[\s-]/g, ''))) return { success: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' };
  var sh = ss.getSheetByName('TaxInvoices');
  var found = findRow(sh, TAX_INVOICE_HEADERS, function(o) { return String(o.invoiceNo) === invoiceNo && !mapTaxInvoice(o).cancelled; });
  if (!found) return { success: false, error: 'ไม่พบใบกำกับนี้ หรือถูกยกเลิกไปแล้ว' };
  var cancelled = cancelTaxInvoice(ss, { invoiceNo: invoiceNo, reason: 'แก้ไขข้อมูลผู้ซื้อ — ออกใบใหม่แทน' });
  if (!cancelled.success) return cancelled;
  var result;
  try { result = issueTaxInvoice(ss, { orderNumber: String(found.obj.orderNumber), buyer: buyer, issuedBy: data.issuedBy }); }
  catch (err) { result = { success: false, error: String(err) }; }
  var again = findRow(sh, TAX_INVOICE_HEADERS, function(o) { return String(o.invoiceNo) === invoiceNo; });
  if (!result.success) {
    if (again) { again.obj.cancelled = '0'; again.obj.cancelledAt = ''; again.obj.cancelReason = ''; writeRow(sh, TAX_INVOICE_HEADERS, again.row, again.obj); }
    return result;
  }
  if (again) { again.obj.cancelReason = 'แก้ไขข้อมูลผู้ซื้อ — ออกใบใหม่ ' + result.invoice.invoiceNo; writeRow(sh, TAX_INVOICE_HEADERS, again.row, again.obj); }
  return { success: true, invoice: result.invoice, replaced: invoiceNo };
}

// ── ลูกค้าใบกำกับภาษี ──
function listTaxCustomers(ss) {
  return getSheetDataAsObjects(ss, 'TaxCustomers').map(function(r) {
    return { taxId: String(r.taxId), branch: String(r.buyerBranch || 'สำนักงานใหญ่'), name: String(r.name || ''), address: String(r.address || ''),
      phone: String(r.phone || ''), useCount: Number(r.useCount) || 0, lastUsedAt: String(r.lastUsedAt || '') };
  }).sort(function(a, b) { return String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)) || a.name.localeCompare(b.name); }).slice(0, 3000);
}

function upsertTaxCustomer(ss, c, used) {
  var taxId = cleanText(c.taxId, 20).replace(/[\s-]/g, '');
  var branch = cleanText(c.branch, 100) || 'สำนักงานใหญ่';
  if (!/^\d{13}$/.test(taxId)) throw new Error('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  var sh = textSheet(ss, 'TaxCustomers', TAX_CUSTOMER_HEADERS);
  var found = findRow(sh, TAX_CUSTOMER_HEADERS, function(o) { return String(o.taxId) === taxId && String(o.buyerBranch) === branch; });
  var now = thaiTimeISO();
  var row = found ? found.obj : { taxId: taxId, buyerBranch: branch, useCount: '0', lastUsedAt: '' };
  row.name = cleanText(c.name, 300); row.address = cleanText(c.address, 1000); row.phone = cleanText(c.phone, 60);
  if (used) { row.useCount = String((Number(row.useCount) || 0) + 1); row.lastUsedAt = now; }
  if (found) writeRow(sh, TAX_CUSTOMER_HEADERS, found.row, row);
  else sh.appendRow(TAX_CUSTOMER_HEADERS.map(function(h) { return String(row[h] == null ? '' : row[h]); }));
}

// ──────────────────────────────────────────────
// doGet
// ──────────────────────────────────────────────
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getAllData';

  // เช็กว่า URL /exec ที่แอปเรียกอยู่ กำลังเสิร์ฟโค้ดเวอร์ชันไหน
  // เปิดในเบราว์เซอร์: <URL ที่อยู่ในโค้ดหน้าเว็บ>?action=ping
  // ถ้า build ไม่ตรงกับที่วางไว้ล่าสุด = deployment ตัวนี้ยังเป็นโค้ดเก่า (แก้ผิดตัว/ยังไม่ได้ขึ้นเวอร์ชันใหม่)
  // วางไว้ก่อน openById เพื่อให้ตอบได้แม้สิทธิ์อื่นมีปัญหา
  if (action === 'ping') {
    return _bomJson({
      success: true,
      build: SCRIPT_BUILD,
      menuImageFolderId: MENU_IMAGE_FOLDER_ID,
      hasUploadImage: true,
      effectiveUser: Session.getEffectiveUser().getEmail()
    });
  }

  // ตรวจสิทธิ์ Drive "ในบริบทของเว็บแอปจริง ๆ" — ไม่ใช่บริบทหน้าแก้ไขซึ่งใช้สิทธิ์คนละชุด
  // เปิด <URL>/exec?action=drivetest แล้วดูผลทีละขั้น จะรู้ทันทีว่าติดที่สิทธิ์ หรือติดที่โฟลเดอร์
  if (action === 'drivetest') {
    var out = { build: SCRIPT_BUILD, folderId: MENU_IMAGE_FOLDER_ID };

    try { out.effectiveUser = Session.getEffectiveUser().getEmail(); }
    catch (e1) { out.effectiveUser = 'ERROR: ' + e1; }

    // สิทธิ์ที่ติดมากับโทเคนของเว็บแอปจริง ๆ — ถ้าไม่มี .../auth/drive ในนี้ คืออัปรูปไม่ได้แน่นอน
    try {
      var token = ScriptApp.getOAuthToken();
      var info  = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token,
                                    { muteHttpExceptions: true }).getContentText();
      var scopes = (JSON.parse(info).scope || '').split(' ');
      out.grantedScopes = scopes;
      out.hasDriveScope = scopes.indexOf('https://www.googleapis.com/auth/drive') !== -1;
    } catch (e2) { out.grantedScopes = 'ERROR: ' + e2; }

    // อ่านโฟลเดอร์ได้ไหม
    try { out.readFolder = 'OK: ' + DriveApp.getFolderById(MENU_IMAGE_FOLDER_ID).getName(); }
    catch (e3) { out.readFolder = 'ERROR: ' + e3; }

    // เขียนไฟล์ได้ไหม (สร้างไฟล์ทดสอบเล็ก ๆ แล้วย้ายลงถังขยะทันที)
    try {
      var f = DriveApp.getFolderById(MENU_IMAGE_FOLDER_ID)
                      .createFile('drivetest.txt', 'ok', MimeType.PLAIN_TEXT);
      out.writeFile = 'OK: ' + f.getId();
      f.setTrashed(true);
    } catch (e4) { out.writeFile = 'ERROR: ' + e4; }

    return _bomJson(out);
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);

  ensureSheetsReady();

  if (action === 'initSheets') {
    initializeSheets();
    PropertiesService.getScriptProperties().setProperty('sheets_ready', SHEET_ID);
    return _bomJson({ success: true, message: 'สร้าง/ตรวจสอบชีทครบแล้ว' });
  }

  // ── ข้อมูล "ร้อน" — ต้องสดเสมอ อ่านแค่ 2 ชีท ไม่ cache ──
  // หน้าบ้าน poll ตัวนี้ทุก 20 วิ
  if (action === 'getLive') {
    return _bomJson({
      tableOrders: getSheetDataAsObjects(ss, 'TableOrders'),
      // Orders ใช้แค่หาเลขบิลสูงสุด + จอครัว → 300 บิลล่าสุดพอ
      orders:      getSheetDataAsObjects(ss, 'Orders', 300),
      // บิลที่ลูกค้าจ่ายเองจากคีออสไม่ได้เกิดบนเครื่องขาย ถ้าไม่ส่งมาด้วยยอดสรุปกะจะขาดไป
      payments:    getSheetDataAsObjects(ss, 'PaymentSummary', 300)
    });
  }

  // ── คิวใบครัว — ให้ Print Server ดึงไปพิมพ์เอง ──
  // อ่านชีตเดียวและตัดเหลือเฉพาะบิลที่ยังไม่เสร็จ (ออเดอร์ที่ลูกค้าสั่งเองผ่าน QR)
  // แยกจาก getLive เพราะตัวนั้นอ่าน 3 ชีตทุกรอบ ถ้าให้ Print Server ยิงทั้งวันจะกินโควตาเวลารันของ
  // Apps Script โดยใช่เหตุ — ตัวนี้ส่งกลับเฉพาะที่ต้องใช้พิมพ์
  if (action === 'getKitchenQueue') {
    var queueRows = getSheetDataAsObjects(ss, 'Orders', 200);
    var pendingRows = [];
    var pendingNums = {};
    queueRows.forEach(function(row) {
      if (String(row.Status || '').toLowerCase() === 'pending' && row.OrderNumber) pendingNums[row.OrderNumber] = true;
    });
    queueRows.forEach(function(row) {
      if (row.OrderNumber && pendingNums[row.OrderNumber]) pendingRows.push(row);
    });
    return _bomJson({ orders: pendingRows });
  }

  // ── ข้อมูล "เย็น" — เปลี่ยนเฉพาะตอนแก้หลังบ้าน อ่านจาก cache 5 นาที ──
  // หน้าบ้านดึงตอนเปิดแอปครั้งเดียว แล้วดึงซ้ำทุก 5 นาที
  if (action === 'getStatic') {
    var staticBranch = String((e && e.parameter && (e.parameter.branch || e.parameter.branchId)) || '').trim();
    if (e && e.parameter && e.parameter.fresh === '1') clearStaticCache();
    var staticKey = staticCacheKey(staticBranch);
    var cached = cacheGetLong(staticKey);
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
    var staticJson = JSON.stringify(buildStaticData(ss, staticBranch));
    cachePutLong(staticKey, staticJson);
    return ContentService.createTextOutput(staticJson).setMimeType(ContentService.MimeType.JSON);
  }

  // getAllData — ก้อนรวมแบบเดิม ยังใช้ได้ (หน้าหลังบ้านหลายหน้าเรียกตัวนี้)
  if (action === 'getAllData') {
    var data = buildStaticData(ss, '');
    data.tableOrders = getSheetDataAsObjects(ss, 'TableOrders');
    // Orders ดึงแค่ 2000 บิลล่าสุดพอ — รายงานย้อนหลังใช้ action getReportData ซึ่งอ่านทั้งชีทอยู่แล้ว ไม่กระทบ
    data.orders      = getSheetDataAsObjects(ss, 'Orders', 2000);
    return _bomJson(data);
  }

  if (action === 'getTableOrders') {
    var tableNumber = e.parameter.tableNumber || '';
    var allRows = getSheetDataAsObjects(ss, 'TableOrders');
    var filtered = allRows.filter(function(r) {
      return String(r.TableNumber) === String(tableNumber) && r.Status !== 'paid';
    });
    return _bomJson({ success: true, orders: filtered });
  }

  if (action === 'resetAllSheetData') {
    ['Categories', 'Menu', 'Promotions'].forEach(function(name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    return _bomJson({ success: true, message: 'All data cleared' });
  }

  if (action === 'clearSalesData') {
    var sheetsToClear = ['Orders', 'TableOrders', 'PaymentSummary', 'PaymentApprovals', 'OutstandingBills', 'Shifts', 'ตัดสต็อก', 'รับวัตถุดิบ', 'LiquorStorage', 'Waste'];
    sheetsToClear.forEach(function(name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    return _bomJson({ success: true, message: 'Sales and transaction data cleared successfully' });
  }

  if (action === 'getSalesReport') {
    return _bomJson(generateSalesReport());
  }

  // ── BOM actions ──
  if (action === 'getLiquorRecords') return _bomJson({ success: true, records: getSheetDataAsObjects(ss, 'LiquorStorage') });

  // รายการทิ้งของเสีย (Waste) — คืนทั้งหมด
  // ?kind=prep → บันทึกการเตรียม / ?kind=count → บันทึกการนับสต็อก / ไม่ส่ง = บันทึกการทิ้ง (แถวเก่าที่ kind ว่าง = ทิ้ง)
  if (action === 'getWasteRecords') {
    var wKind = (e && e.parameter && (e.parameter.kind === 'prep' || e.parameter.kind === 'count')) ? e.parameter.kind : 'waste';
    var wRows = getSheetDataAsObjects(ss, 'Waste').filter(function(r) { return (String(r.kind || '') || 'waste') === wKind; });
    return _bomJson({ success: true, records: wRows.slice(-1000) });
  }

  // คำขออนุมัติ QR — คืนเฉพาะที่ยัง pending หรือเพิ่งตอบใน 10 นาทีล่าสุด
  if (action === 'getPaymentApprovals') {
    var all = getSheetDataAsObjects(ss, 'PaymentApprovals');
    var cutoff = Date.now() - 10 * 60 * 1000;
    var recent = all.filter(function(r) {
      if (r.status === 'pending') return true;
      var t = r.respondedAt ? new Date(r.respondedAt).getTime() : 0;
      return t >= cutoff;
    });
    return _bomJson({ success: true, approvals: recent });
  }

  if (action === 'getOutstandingBills') {
    return _bomJson({ success: true, bills: getSheetDataAsObjects(ss, 'OutstandingBills') });
  }
  if (action === 'getStock')         return _bomJson(getStockLevels());
  if (action === 'getIngredients')   return _bomJson(getIngredientsList());
  if (action === 'getShifts')        return _bomJson({ success: true, shifts: getSheetDataAsObjects(ss, 'Shifts') });

  if (action === 'getReportData') {
    var from = (e && e.parameter && e.parameter.from) ? e.parameter.from : '';
    var to   = (e && e.parameter && e.parameter.to)   ? e.parameter.to   : '';
    var fromDate = from ? new Date(from) : null;
    var toDate   = to   ? new Date(to + 'T23:59:59')  : null;

    var filterByDate = function(rows, tsField) {
      if (!fromDate && !toDate) return rows;
      return rows.filter(function(r) {
        if (!r[tsField]) return true;
        var d = new Date(r[tsField]);
        if (fromDate && d < fromDate) return false;
        if (toDate   && d > toDate)   return false;
        return true;
      });
    };

    var allOrders   = getSheetDataAsObjects(ss, 'Orders');
    var allPayments = getSheetDataAsObjects(ss, 'PaymentSummary');
    var allShifts   = getSheetDataAsObjects(ss, 'Shifts');
    var allWaste    = getSheetDataAsObjects(ss, 'Waste');

    return _bomJson({
      success:  true,
      orders:   filterByDate(allOrders,   'Timestamp'),
      // ส่ง payments ทั้งหมด ไม่กรองตามวันของตัวมันเอง — ฝั่ง client จับคู่ด้วยเลขบิล (orderNumber)
      // กันกรณีแก้/เพิ่ม payment ย้อนหลังคนละวันกับวันที่บิลถูกเปิด แล้วยอดไม่ตรงช่องทางจ่าย
      payments: allPayments,
      shifts:   allShifts,
      waste:    filterByDate(allWaste,    'timestamp')
    });
  }

  // ── ส่งออกข้อมูลดิบทั้งชีท (ใช้ตอนย้ายข้อมูลไป SQL Server ครั้งเดียว) ──
  // ?action=exportSheetNames                              → รายชื่อชีททั้งหมด
  // ?action=exportSheet&name=Orders&offset=0&limit=2000   → หัวตาราง + ข้อมูลดิบทีละก้อน
  // แบ่งก้อนเพราะชีทออเดอร์ใหญ่เกินกว่าจะส่งครบในคำขอเดียว (Apps Script มีเพดานเวลารัน)
  if (action === 'exportSheetNames') {
    var names = ss.getSheets().map(function(sh) { return { name: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) }; });
    return _bomJson({ success: true, sheets: names });
  }

  if (action === 'exportSheet') {
    var expName = (e && e.parameter && e.parameter.name) ? e.parameter.name : '';
    var expSheet = ss.getSheetByName(expName);
    if (!expSheet) return _bomJson({ success: false, error: 'ไม่พบชีท ' + expName });

    var expLastRow = expSheet.getLastRow();
    var expLastCol = expSheet.getLastColumn();
    if (expLastRow < 1 || expLastCol < 1) return _bomJson({ success: true, headers: [], rows: [], total: 0 });

    var expHeaders = expSheet.getRange(1, 1, 1, expLastCol).getValues()[0];
    var expTotal   = Math.max(0, expLastRow - 1);
    var expOffset  = Math.max(0, parseInt((e.parameter.offset || '0'), 10) || 0);
    var expLimit   = Math.min(5000, Math.max(1, parseInt((e.parameter.limit || '2000'), 10) || 2000));
    var expStart   = 2 + expOffset;
    if (expStart > expLastRow) return _bomJson({ success: true, headers: expHeaders, rows: [], total: expTotal });

    var expCount = Math.min(expLimit, expLastRow - expStart + 1);
    var expRows  = expSheet.getRange(expStart, 1, expCount, expLastCol).getValues();
    return _bomJson({ success: true, headers: expHeaders, rows: expRows, total: expTotal, offset: expOffset, count: expCount });
  }

  // ── ของที่เพิ่มมาพร้อมหน้าจอชุด HumLai-POS ──
  var gp = (e && e.parameter) || {};
  if (action === 'getUsers')      return _bomJson({ success: true, users: getSheetDataAsObjects(ss, 'Users') });
  if (action === 'nextId')        return _bomJson({ success: true, ids: nextItemIds(ss, Math.min(50, Math.max(1, Number(gp.count) || 1))) });
  if (action === 'getMenuBranch') return _bomJson({ success: true, rows: getMenuBranchRows(ss, String(gp.branch || gp.branchId || '').trim()) });
  if (action === 'getIngredientNames') {
    var ingList = getIngredientsList();
    var ingRows = (ingList && ingList.ingredients) || [];
    return _bomJson({ success: true, ingredients: ingRows.map(function(r) { return { id: String(r.id), name: r.name || '', unit: r.unit || '', category: r.category || '' }; }) });
  }
  if (action === 'getKioskPayment')         return _bomJson(getKioskPayment(ss, gp));
  if (action === 'getPendingKioskPayments') return _bomJson(getPendingKioskPayments(ss, gp));
  if (action === 'getTaxInvoices')          return _bomJson({ success: true, invoices: listTaxInvoices(ss) });
  if (action === 'getTaxCustomers')         return _bomJson({ success: true, customers: listTaxCustomers(ss) });

  return _bomJson({ error: 'Unknown GET action' });
}

// ──────────────────────────────────────────────
// getSheetDataAsObjects
// ──────────────────────────────────────────────
// maxRows (ไม่บังคับ) = ดึงเฉพาะ N แถวล่าสุด — กันชีทที่โตเรื่อย ๆ (เช่น Orders) ทำให้ getAllData ช้าลงทุกวัน
// รวมตัวเลือกของรายการอาหาร (ราคาแบบไหน/เผ็ดระดับไหน/ท็อปปิ้ง/โปร/หมายเหตุ) เป็นข้อความบรรทัดเดียว
// ใช้ร่วมกันระหว่างออเดอร์จากเครื่องขายและออเดอร์ที่ลูกค้าสั่งเองจากคีออส ให้ได้รูปแบบเดียวกัน
function itemOptionText(item) {
  var parts = [];
  if (item.food && item.food.priceName) parts.push(item.food.priceName);
  if (item.spice && item.spice.name) parts.push('ความเผ็ด: ' + item.spice.name);
  if (item.allPopups && item.allPopups.length > 0) item.allPopups.forEach(function(p) { parts.push(p.name); });
  if (item.promo && item.promo.id !== 'none' && item.promo.name) parts.push(item.promo.name);
  // รายการที่แยกออกมาจากป๊อปอัพ — บอกครัวว่าสั่งพ่วงมากับจานไหน
  if (item.fromPopupOf) parts.push('พ่วงกับ ' + item.fromPopupOf);
  if (item.note && String(item.note).trim()) parts.push('📝 ' + String(item.note).trim());
  return parts.join(', ');
}

// เลขบิลถัดไปของคำนำหน้าหนึ่ง ๆ (เช่น SELF-#007) — อ่านเฉพาะคอลัมน์เลขบิลของชีต Orders
// ต้องเรียกในบล็อกที่ถือ LockService อยู่ ไม่งั้นสองคำขอพร้อมกันจะได้เลขเดียวกัน
function nextOrderNumber(ss, prefix) {
  var sheet = ss.getSheetByName('Orders');
  var max = 0;
  if (sheet && sheet.getLastRow() > 1) {
    var col = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    var re = new RegExp('^' + prefix + '-#(\\d+)$');
    for (var i = 0; i < col.length; i++) {
      var m = re.exec(String(col[i][0] || '').trim());
      if (m) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
  }
  var next = String(max + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + '-#' + next;
}

// ออเดอร์คีออสที่บันทึกไปแล้วของ sessionId นี้ (ถ้ามี) — คืนเลขบิลเดิมเพื่อกันบิลซ้ำตอนยิงซ้ำ
// แถวรายการรายโต๊ะของคีออสเก็บเลขบิลไว้ท้ายช่องตัวเลือกในรูปแบบ '💳 ชำระแล้ว SELF-#001'
function findKioskOrderBySession(ss, sessionId) {
  var sheet = ss.getSheetByName('TableOrders');
  if (!sheet || sheet.getLastRow() < 2 || !sessionId) return '';
  var rows = sheet.getRange(2, 2, sheet.getLastRow() - 1, 6).getValues(); // B..G = SessionId..Options
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) !== String(sessionId)) continue;
    var m = /ชำระแล้ว\s+(\S+)/.exec(String(rows[i][5] || ''));
    if (m) return m[1];
  }
  return '';
}

// id ของกะที่เปิดค้างอยู่ — คีออสไม่รู้จักกะ จึงต้องให้ฝั่งเซิร์ฟเวอร์ผูกให้ตอนบันทึกยอด
function openShiftId(ss) {
  var sheet = ss.getSheetByName('Shifts');
  if (!sheet || sheet.getLastRow() < 2) return '';
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][12] || '').toLowerCase() === 'open') return String(rows[i][0] || '');
  }
  return '';
}

function getSheetDataAsObjects(ss, sheetName, maxRows) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var startRow = (maxRows && lastRow - 1 > maxRows) ? lastRow - maxRows + 1 : 2;
  // data[0] = แถวหัวตาราง เพื่อให้ index ด้านล่างเริ่มที่ 1 เหมือนเดิม
  var data = [headers].concat(sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues());
  if (data.length < 2) return [];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
          try { val = JSON.parse(val.trim()); } catch(e) {}
        }
        obj[headers[j]] = val;
      }
    }
    result.push(obj);
  }
  return result;
}

// บันทึกออเดอร์คีออสที่ชำระแล้ว (บิล + ยอดชำระ + รายการโต๊ะ + ตัดสต็อก)
// ผู้เรียกต้องถือ LockService อยู่ ไม่งั้นสองคำขอพร้อมกันจะได้เลขบิลเดียวกัน
function kioskPaidOrderCore(ss, postData) {
  var kTable  = String(postData.tableNumber || '');
  var kItems  = postData.items || [];
  var kTotal  = Number(postData.total) || 0;
  var kMethod = postData.paymentMethod || 'เงินโอน (QR)';
  var kTime   = postData.timestamp || new Date().toISOString();
  // เลขบิล = เลขที่ใบกำกับภาษีอย่างย่อ ต้องเรียงต่อเนื่องชุดเดียวต่อสาขา → ใช้ตัวนำหน้าเลขบิลของสาขา (หลังบ้าน > สาขา)
  var kPrefix = postData.prefix
    ? (String(postData.prefix).toUpperCase().replace(/[^0-9A-Zก-๙]/g, '') || 'SELF')
    : branchBillPrefix(ss, postData.branchId || postData.branch || defaultBranchId(ss));
  var kBy     = 'Self-Order';
  var kSessionId = String(postData.sessionId || Date.now());
  if (kItems.length === 0) return { success: false, error: 'ไม่มีรายการอาหารในออเดอร์' };

  // ยิงซ้ำเพราะเน็ตมือถือหลุดกลางทางเป็นเรื่องปกติ — ถ้า sessionId นี้บันทึกไปแล้ว
  // ให้ตอบเลขบิลเดิมกลับไป ไม่ออกบิลใหม่ซ้อน (ลูกค้าโอนเงินมาครั้งเดียว)
  var kDup = findKioskOrderBySession(ss, kSessionId);
  if (kDup) return { success: true, orderNumber: kDup, duplicate: true };

  var kOrderNo = nextOrderNumber(ss, kPrefix);
  var kName    = kTable ? ('โต๊ะ ' + kTable + ' (สั่งเอง)') : 'สั่งเอง';
  var kAddr    = kTable ? ('โต๊ะ ' + kTable) : 'สั่งเอง';

  // 1) บิลในชีต Orders — คอลัมน์เรียงตามหัวตาราง Orders เป๊ะ ๆ
  var ordersSheet = getOrCreateSheet(ss, 'Orders', ['Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount', 'Status', 'OrderStartTime', 'CompletionTime', 'RecordedBy', 'Quantity']);
  kItems.forEach(function(item) {
    var qty     = Number(item.quantity) || 1;
    var unit    = Number(item.food && item.food.price) || 0;
    var dining  = (item.dining && item.dining.name) ? item.dining.name : 'ทานที่ร้าน';
    ordersSheet.appendRow([kTime, kOrderNo, kName, kAddr, (item.food && item.food.name) || '', dining, unit * qty, kTotal, 'Pending', kTime, '', kBy, qty]);
    var opt = itemOptionText(item);
    if (opt) ordersSheet.appendRow([kTime, kOrderNo, kName, kAddr, '↳ ' + opt, dining, 0, kTotal, 'Pending', kTime, '', kBy, '']);
  });

  // 2) ยอดชำระ — ผูกกับกะที่เปิดอยู่ เพื่อให้สรุปกะและรายงานนับรวมยอดจากคีออสด้วย
  var paySh = getOrCreateSheet(ss, 'PaymentSummary', ['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']);
  paySh.appendRow([kTime, kOrderNo, kTable, kMethod, kTotal, kBy, openShiftId(ss), '']);

  // 3) รายการรายโต๊ะ สถานะ paid — โต๊ะยังโชว์ว่ามีลูกค้า แต่ไม่เข้าไปรวมในยอดที่ต้องเก็บ
  var tblSheet  = ss.getSheetByName('TableOrders');
  if (tblSheet) {
    kItems.forEach(function(item) {
      var opt = itemOptionText(item);
      var paidNote = '💳 ชำระแล้ว ' + kOrderNo;
      tblSheet.appendRow([
        kTable, kSessionId, (item.food && item.food.name) || '', (item.food && item.food.nameEn) || '',
        Number(item.food && item.food.price) || 0, Number(item.quantity) || 1,
        opt ? (opt + ' | ' + paidNote) : paidNote,
        kTime, 'paid', kBy
      ]);
    });
  }

  // 4) ตัดสต็อกตามสูตร BOM เหมือนบิลที่แคชเชียร์ปิดเอง — ถ้าร้านยังไม่ได้ตั้ง BOM จะข้ามไปเฉย ๆ
  // ห่อ try ไว้ต่างหาก เพราะบิลกับยอดเงินบันทึกไปแล้ว ห้ามล้มทั้งคำขอเพราะตัดสต็อกไม่ได้
  try {
    var kDeduct = [];
    kItems.forEach(function(item) {
      if (item.food && item.food.id) kDeduct.push({ menuId: String(item.food.id), menuName: item.food.name || '', qty: Number(item.quantity) || 1 });
    });
    if (kDeduct.length > 0) deductStock({ orderNumber: kOrderNo, tableNo: kTable, items: kDeduct });
  } catch (stockErr) {
    Logger.log('kioskPaidOrder deductStock: ' + stockErr);
  }
  return { success: true, orderNumber: kOrderNo };
}

// ──────────────────────────────────────────────
// doPost
// ──────────────────────────────────────────────
function doPost(e) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ensureSheetsReady();

  var postData = {};
  try {
    postData = JSON.parse(e.postData.contents);
  } catch(err) {
    try { postData = JSON.parse(e.postData.getDataAsString()); } catch(err2) {
      return _bomJson({ success: false, error: 'Invalid Content' });
    }
  }

  var action = postData.action || 'insertOrder';

  // แก้ข้อมูลเย็น (เมนู/หมวดหมู่/พนักงาน/ตั้งค่า) → ล้าง cache ทันที ไม่ต้องรอครบ 5 นาที
  // ไม่รวม action ของออเดอร์/โต๊ะ/ชำระเงิน เพราะยิงถี่และไม่กระทบข้อมูลเย็น
  var STATIC_WRITE_ACTIONS = [
    'saveMenu', 'upsertMenu', 'deleteMenu',
    'saveCategories', 'upsertCategory', 'deleteCategory',
    'savePromotions', 'upsertPromotion', 'deletePromotion',
    'saveUsers', 'savePrinters', 'saveDiscounts', 'saveSettings',
    'resetAllSheetData',
    'saveBranches', 'saveBranchTables', 'saveMenuBranch', 'saveMenuOrder'
  ];
  if (STATIC_WRITE_ACTIONS.indexOf(action) !== -1) clearStaticCache();

  // ── ออเดอร์คีออส: ลูกค้าสแกน QR สั่งเอง + จ่ายผ่าน QR + สลิปผ่านการตรวจแล้ว ──
  // ทำให้ครบในคำขอเดียวและล็อกไว้ เพราะหลายโต๊ะกดจ่ายพร้อมกันได้:
  //   1) ออกเลขบิลชุดของคีออสเอง (SELF-#001, SELF-#002 ...) ไม่ปนกับเลขบิลของแคชเชียร์
  //   2) ลงชีต Orders เป็นบิลสถานะ Pending → จอครัวเห็นทันที กดเสร็จแล้วค่อยเป็น Completed
  //   3) ลง PaymentSummary → ยอดเข้ารายงานและสรุปกะ (staff = 'Self-Order')
  //   4) ลง TableOrders สถานะ 'paid' → พนักงานเห็นว่าโต๊ะนี้สั่งอะไร แต่ระบบไม่เก็บเงินซ้ำ
  if (action === 'kioskPaidOrder') {
    var kLock = LockService.getScriptLock();
    try {
      kLock.waitLock(30000);
    } catch (lockErr) {
      return _bomJson({ success: false, error: 'ระบบกำลังบันทึกออเดอร์อื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
    }
    try {
      return _bomJson(kioskPaidOrderCore(ss, postData));
    } catch (kErr) {
      return _bomJson({ success: false, error: String(kErr) });
    } finally {
      try { kLock.releaseLock(); } catch (relErr) {}
    }
  }

  // ── ของที่เพิ่มมาพร้อมหน้าจอชุด HumLai-POS ──

  // ล็อกอิน: เช็กรหัสที่นี่ หน้าเว็บไม่ได้รับรหัสพนักงานจาก getStatic แล้ว
  // (Google Sheet ไม่มีการตรวจสิทธิ์รายคำสั่งแบบฝั่ง SQL — token ใช้แค่ให้หน้าเว็บรู้ว่าล็อกอินผ่านแล้ว)
  if (action === 'login') {
    var lUserId = String(postData.userId == null ? '' : postData.userId).trim();
    var lPin = String(postData.pin == null ? '' : postData.pin);
    if (!lUserId || !lPin) return _bomJson({ success: false, error: 'กรุณาเลือกผู้ใช้และกรอกรหัส' });
    var lUser = getSheetDataAsObjects(ss, 'Users').filter(function(u) { return String(u.id) === lUserId; })[0];
    if (!lUser || String(lUser.pin == null ? '' : lUser.pin) === '' || String(lUser.pin) !== lPin) {
      return _bomJson({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    var lBool = function(v) { return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1'; };
    return _bomJson({
      success: true,
      token: Utilities.getUuid(),
      user: {
        id: /^\d{1,15}$/.test(String(lUser.id)) ? Number(lUser.id) : String(lUser.id),
        username: String(lUser.username || ''),
        branch: String(lUser.branch || '').trim(),
        canCheckout: lUser.canCheckout === '' || lUser.canCheckout == null ? true : lBool(lUser.canCheckout),
        isAdmin: lBool(lUser.isAdmin),
        isCashier: lBool(lUser.isCashier)
      }
    });
  }

  // สาขา — id ต้องไม่ซ้ำและไม่ว่าง (ผูกกับผู้ใช้/บิล/ผังโต๊ะ)
  if (action === 'saveBranches') {
    var brList = Array.isArray(postData.branches) ? postData.branches : [];
    var brSeen = {};
    for (var bi = 0; bi < brList.length; bi++) {
      var brId = String(brList[bi].id || '').trim();
      if (!brId) return _bomJson({ success: false, error: 'มีสาขาที่ยังไม่ได้ใส่รหัส' });
      if (brSeen[brId.toLowerCase()]) return _bomJson({ success: false, error: 'รหัสสาขา "' + brId + '" ซ้ำกัน' });
      brSeen[brId.toLowerCase()] = true;
    }
    var brSheet = textSheet(ss, 'Branches', BRANCH_HEADERS);
    brSheet.clearContents();
    brSheet.getRange(1, 1, 1, BRANCH_HEADERS.length).setValues([BRANCH_HEADERS]);
    if (brList.length) {
      brSheet.getRange(2, 1, brList.length, BRANCH_HEADERS.length).setNumberFormat('@').setValues(brList.map(function(b) {
        return [String(b.id).trim(), b.name || '', String(b.billPrefix || '').trim().toUpperCase(), b.phone || '', b.address || '',
                b.taxId || '', b.receiptFooter || '', b.isActive === false ? 'FALSE' : 'TRUE', b.posId || ''].map(String);
      }));
    }
    return _bomJson({ success: true });
  }

  // ผังโต๊ะของสาขาหนึ่ง — เขียนทับเฉพาะของสาขานั้น
  if (action === 'saveBranchTables') {
    if (!Array.isArray(postData.tables)) return _bomJson({ success: false, error: 'ไม่มีรายการโต๊ะ' });
    var btBranch = String(postData.branchId || postData.branch || '').trim() || defaultBranchId(ss);
    if (!btBranch) return _bomJson({ success: false, error: 'ยังไม่มีสาขาในระบบ — ตั้งค่าสาขาก่อน' });
    var btAll = readSettingJson(ss, 'branch_tables', {}) || {};
    btAll[btBranch] = postData.tables;
    writeSettingJson(ss, 'branch_tables', btAll);
    return _bomJson({ success: true, branchId: btBranch });
  }

  // เมนูรายสาขา — เขียนทับเฉพาะของสาขานั้น เก็บเฉพาะเมนูที่ปรับจริง
  if (action === 'saveMenuBranch') {
    var mbBranch = String(postData.branchId || postData.branch || '').trim() || defaultBranchId(ss);
    if (!mbBranch) return _bomJson({ success: false, error: 'ยังไม่มีสาขาในระบบ — ตั้งค่าสาขาก่อน' });
    var mbRows = (Array.isArray(postData.rows) ? postData.rows : []).map(function(r) {
      var pm = {};
      var src = (r && r.priceMap && typeof r.priceMap === 'object') ? r.priceMap : {};
      Object.keys(src).forEach(function(k) { var v = src[k]; if (v !== '' && v !== null && v !== undefined && isFinite(Number(v))) pm[k] = Number(v); });
      return {
        menuId: String(r && r.menuId != null ? r.menuId : '').trim(),
        isAvailable: r && r.isAvailable === false ? '0' : '',
        priceMap: Object.keys(pm).length ? JSON.stringify(pm) : '',
        printerId: String((r && r.printerId) || '')
      };
    }).filter(function(r) { return r.menuId && (r.isAvailable === '0' || r.priceMap || r.printerId); });
    var mbSheet = textSheet(ss, 'MenuBranch', MENU_BRANCH_HEADERS);
    var mbKeep = getSheetDataAsObjects(ss, 'MenuBranch').filter(function(r) { return String(r.branchId) !== mbBranch; }).map(function(r) {
      return [String(r.menuId), String(r.branchId), String(r.isAvailable == null ? '' : r.isAvailable),
              typeof r.priceMap === 'object' ? JSON.stringify(r.priceMap) : String(r.priceMap || ''), String(r.printerId || '')];
    });
    var mbAll = mbKeep.concat(mbRows.map(function(r) { return [r.menuId, mbBranch, r.isAvailable, r.priceMap, r.printerId]; }));
    mbSheet.clearContents();
    mbSheet.getRange(1, 1, 1, MENU_BRANCH_HEADERS.length).setValues([MENU_BRANCH_HEADERS]);
    if (mbAll.length) mbSheet.getRange(2, 1, mbAll.length, MENU_BRANCH_HEADERS.length).setNumberFormat('@').setValues(mbAll);
    return _bomJson({ success: true, saved: mbRows.length, branchId: mbBranch });
  }

  // ลำดับการแสดงเมนู — แก้เฉพาะคอลัมน์ sortOrder ค่าอื่นของเมนูไม่ถูกแตะ
  if (action === 'saveMenuOrder') {
    var moIds = Array.isArray(postData.ids) ? postData.ids.map(String).filter(Boolean) : [];
    if (!moIds.length) return _bomJson({ success: false, error: 'ไม่มีรายการเมนู' });
    var moSheet = ensureHeaders(ss.getSheetByName('Menu'), MENU_HEADERS);
    var moLast = moSheet.getLastRow();
    if (moLast < 2) return _bomJson({ success: true, saved: 0 });
    var moPos = {};
    moIds.forEach(function(id, i) { moPos[id] = i + 1; });
    var moCol = MENU_HEADERS.indexOf('sortOrder') + 1;
    var moIdVals = moSheet.getRange(2, 1, moLast - 1, 1).getValues();
    var moOld = moSheet.getRange(2, moCol, moLast - 1, 1).getValues();
    moSheet.getRange(2, moCol, moLast - 1, 1).setValues(moIdVals.map(function(r, i) {
      var p = moPos[String(r[0])];
      return [p ? p : moOld[i][0]];
    }));
    return _bomJson({ success: true, saved: moIds.length });
  }

  // บันทึกการเตรียม / การนับสต็อก — ชีต Waste เดียวกับบันทึกการทิ้ง แยกด้วยคอลัมน์ kind
  if (action === 'savePrepRecord' || action === 'saveStockCount') {
    var logSheet = ensureHeaders(getOrCreateSheet(ss, 'Waste', WASTE_HEADERS), WASTE_HEADERS);
    logSheet.appendRow([postData.timestamp || thaiTimeISO(), postData.branch || '', postData.itemName || '', postData.category || '',
      Number(postData.qty) || 0, postData.unit || '', postData.note || '', postData.staff || '',
      action === 'savePrepRecord' ? 'prep' : 'count', postData.itemType === 'ingredient' ? 'ingredient' : 'menu']);
    return _bomJson({ success: true });
  }

  // ลูกค้าสแกน QR แจ้งโอน → พนักงานยืนยัน (ล็อกไว้กันสองเครื่องกดพร้อมกันแล้วออกบิลซ้อน)
  if (action === 'kioskPaymentRequest' || action === 'respondKioskPayment' ||
      action === 'issueTaxInvoice' || action === 'reissueTaxInvoice' || action === 'cancelTaxInvoice') {
    var xLock = LockService.getScriptLock();
    try { xLock.waitLock(30000); }
    catch (xLockErr) { return _bomJson({ success: false, error: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' }); }
    try {
      if (action === 'kioskPaymentRequest') return _bomJson(kioskPaymentRequest(ss, postData));
      if (action === 'respondKioskPayment') return _bomJson(respondKioskPayment(ss, postData));
      if (action === 'issueTaxInvoice')     return _bomJson(issueTaxInvoice(ss, postData));
      if (action === 'reissueTaxInvoice')   return _bomJson(reissueTaxInvoice(ss, postData));
      return _bomJson(cancelTaxInvoice(ss, postData));
    } catch (xErr) {
      return _bomJson({ success: false, error: String(xErr) });
    } finally {
      try { xLock.releaseLock(); } catch (xRel) {}
    }
  }

  if (action === 'saveTaxCustomer') {
    var tc = postData.customer || {};
    if (!cleanText(tc.name, 300) || !cleanText(tc.address, 1000)) return _bomJson({ success: false, error: 'กรุณากรอกชื่อและที่อยู่' });
    try { upsertTaxCustomer(ss, tc, false); } catch (tcErr) { return _bomJson({ success: false, error: String(tcErr.message || tcErr) }); }
    return _bomJson({ success: true });
  }

  if (action === 'deleteTaxCustomer') {
    var dcSheet = ss.getSheetByName('TaxCustomers');
    var dcTax = cleanText(postData.taxId, 20);
    var dcBranch = cleanText(postData.branch, 100) || 'สำนักงานใหญ่';
    var dcFound = findRow(dcSheet, TAX_CUSTOMER_HEADERS, function(o) { return String(o.taxId) === dcTax && String(o.buyerBranch) === dcBranch; });
    if (dcFound) dcSheet.deleteRow(dcFound.row);
    return _bomJson({ success: true });
  }

  // ── TABLE ORDER ACTIONS ──
  if (action === 'addTableOrder') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = postData.tableNumber || '';
    var sessionId   = postData.sessionId   || String(Date.now());
    var items       = postData.items       || [];
    var timestamp   = postData.timestamp   || new Date().toISOString();
    var recordedBy  = postData.recordedBy  || '';
    items.forEach(function(item) {
      sheet.appendRow([tableNumber, sessionId, item.food.name || '', item.food.nameEn || '', Number(item.food.price) || 0, Number(item.quantity) || 1, itemOptionText(item), timestamp, 'pending', recordedBy]);
    });
    return _bomJson({ success: true, sessionId: sessionId });
  }

  // บันทึกบิลค้าง (ตอนปิดกะมีโต๊ะยังไม่ชำระ)
  if (action === 'saveOutstandingBills') {
    var sh = getOrCreateSheet(ss, 'OutstandingBills', ['id', 'shiftId', 'tableNo', 'customerName', 'phone', 'total', 'items', 'createdAt', 'status']);
    (postData.bills || []).forEach(function(b) {
      sh.appendRow([
        b.id || ('OB-' + Date.now() + '-' + b.tableNo),
        b.shiftId || '', String(b.tableNo || ''), b.customerName || '', b.phone || '',
        Number(b.total) || 0,
        typeof b.items === 'string' ? b.items : JSON.stringify(b.items || []),
        b.createdAt || new Date().toISOString(),
        b.status || 'unpaid'
      ]);
    });
    return _bomJson({ success: true });
  }

  // ล้างรายการโต๊ะทั้งหมดที่ยังไม่ชำระ (ตอนปิดกะ)
  if (action === 'clearAllTableOrders') {
    var sheetA = ss.getSheetByName('TableOrders');
    if (sheetA && sheetA.getLastRow() > 1) {
      // ล้างทุกแถวรวมรายการที่ลูกค้าจ่ายมาแล้วจากคีออสด้วย — ของพวกนั้นถูกบันทึกเป็นบิล
      // ในชีต Orders ตั้งแต่ตอนจ่ายแล้ว ถ้าปล่อยค้างไว้โต๊ะจะขึ้นว่ามีลูกค้าข้ามกะ
      sheetA.deleteRows(2, sheetA.getLastRow() - 1);
    }
    return _bomJson({ success: true });
  }

  if (action === 'clearTableOrders') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = String(postData.tableNumber || '');
    // includePaid = ปิดโต๊ะจบจริง ๆ (เก็บเงินส่วนที่ค้างครบ/ลูกค้าจ่ายเองครบ) → ล้างรายการที่จ่ายแล้วด้วย
    // ไม่ใส่ = ล้างเฉพาะรายการที่ยังไม่จ่าย เก็บของที่ลูกค้าจ่ายมาแล้วไว้ให้พนักงานเห็น
    var includePaid = postData.includePaid === true;
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) !== tableNumber) continue;
      if (includePaid || data[i][8] !== 'paid') sheet.deleteRow(i + 1);
    }
    return _bomJson({ success: true });
  }

  if (action === 'deleteTableOrderItem') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = String(postData.tableNumber || '');
    var sessionId   = String(postData.sessionId   || '');
    var itemName    = String(postData.itemName     || '');
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === tableNumber && String(data[i][1]) === sessionId && String(data[i][2]) === itemName) {
        sheet.deleteRow(i + 1);
        return _bomJson({ success: true });
      }
    }
    return _bomJson({ success: false });
  }

  if (action === 'moveTable') {
    var sheet = ss.getSheetByName('TableOrders');
    var fromTable = String(postData.fromTable || '');
    var toTable   = String(postData.toTable   || '');
    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      // ย้ายทั้งโต๊ะ = ลูกค้าย้ายที่นั่งจริง จึงต้องยกรายการที่จ่ายมาแล้วจากคีออสไปด้วย
      // ไม่งั้นโต๊ะเดิมจะค้างสถานะมีลูกค้าทั้งที่ไม่มีใครนั่งแล้ว
      if (String(data[i][0]) === fromTable) {
        sheet.getRange(i + 1, 1).setValue(toTable);
        updated = true;
      }
    }
    return _bomJson({ success: updated });
  }

  // ย้าย/แยกเฉพาะบางรายการไปอีกโต๊ะ (จับคู่ด้วย sessionId+itemName+options+price ตามจำนวนที่เลือก)
  if (action === 'moveTableItems') {
    var sheet = ss.getSheetByName('TableOrders');
    var fromTable = String(postData.fromTable || '');
    var toTable   = String(postData.toTable   || '');
    var keys = postData.keys || [];
    var need = {};
    keys.forEach(function(k) {
      var sig = String(k.sessionId || '') + '|' + String(k.itemName || '') + '|' + String(k.options || '') + '|' + String(Number(k.price) || 0);
      need[sig] = (need[sig] || 0) + 1;
    });
    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === fromTable && data[i][8] !== 'paid') {
        var sig2 = String(data[i][1]) + '|' + String(data[i][2]) + '|' + String(data[i][6]) + '|' + String(Number(data[i][4]) || 0);
        if (need[sig2] > 0) {
          sheet.getRange(i + 1, 1).setValue(toTable);
          need[sig2] -= 1;
          updated = true;
        }
      }
    }
    return _bomJson({ success: updated });
  }

  // ── ORDER ACTIONS ──
  if (action === 'insertOrder') {
    var sheet = ss.getSheetByName('Orders');
    if (postData.rows && Array.isArray(postData.rows)) {
      postData.rows.forEach(function(row) { sheet.appendRow(row); });
    }
    // บันทึกข้อมูลการชำระเงินในคำขอเดียวกัน (atomic) — กันกรณีบิลถูกบันทึกแต่ payment หาย
    if (postData.payment) {
      var pay = postData.payment;
      var paySh = getOrCreateSheet(ss, 'PaymentSummary', ['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']);
      paySh.getRange(1, 1, 1, 8).setValues([['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']]);
      paySh.appendRow([new Date().toISOString(), pay.orderNumber||'', pay.tableNo||'', pay.paymentMethod||'', Number(pay.grandTotal)||0, pay.staff||'', pay.shiftId||'', pay.splitDetail||'']);
    }
    return _bomJson({ success: true });
  }

  if (action === 'updateStatus') {
    var orderId        = postData.orderId;
    var status         = postData.status;
    var completionTime = postData.completionTime || '';
    var sheet = ss.getSheetByName('Orders');
    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] === orderId || data[i][0] == orderId || data[i][1] == orderId) {
        sheet.getRange(i + 1, 9).setValue(status);
        if (status.toLowerCase() === 'completed' && completionTime) sheet.getRange(i + 1, 11).setValue(completionTime);
        updated = true;
      }
    }
    return _bomJson({ success: updated });
  }

  // ── ADMIN ACTIONS ──
  // อัปโหลดรูปเมนูลงโฟลเดอร์รูปเมนูใน Google Drive แล้วคืนลิงก์ที่เอาไปแสดงในหน้าขายได้เลย
  if (action === 'uploadImage') {
    try {
      var folderId = postData.folderId || MENU_IMAGE_FOLDER_ID;
      var folder   = DriveApp.getFolderById(folderId);
      var blob     = Utilities.newBlob(
        Utilities.base64Decode(postData.base64),
        postData.mimeType || 'image/jpeg',
        postData.filename || ('menu-' + Date.now() + '.jpg')
      );
      var file     = folder.createFile(blob);
      // ต้องเปิดให้ "ทุกคนที่มีลิงก์ดูได้" ไม่งั้นเครื่องขายที่ไม่ได้ล็อกอินบัญชีนี้จะเห็นเป็นรูปแตก
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return _bomJson({ success: true, fileId: file.getId(), url: driveImageUrl(file.getId()) });
    } catch(e) {
      return _bomJson({ success: false, error: explainDriveError(e) });
    }
  }

  // อัปโหลดสลิปการโอน ลงโฟลเดอร์เฉพาะ ตั้งชื่อตามเลขที่บิล
  if (action === 'uploadSlip') {
    try {
      var slipFolder   = DriveApp.getFolderById(postData.folderId || SLIP_FOLDER_ID);
      var slipBlob     = Utilities.newBlob(Utilities.base64Decode(postData.base64), postData.mimeType || 'image/jpeg', postData.filename || ('slip-' + Date.now() + '.jpg'));
      var slipFile     = slipFolder.createFile(slipBlob);
      slipFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return _bomJson({ success: true, fileId: slipFile.getId(), url: driveImageUrl(slipFile.getId()) });
    } catch(e) {
      return _bomJson({ success: false, error: explainDriveError(e) });
    }
  }

  if (action === 'upsertMenu') {
    var sheet = ss.getSheetByName('Menu');
    var item = postData.item;
    if (!item || !item.id) return _bomJson({ success: false });
    // หัวตารางชุดใหม่ (เพิ่ม branches = ขายเฉพาะบางสาขา, sortOrder = ลำดับการแสดง) — ชีตเดิมได้คอลัมน์เพิ่มต่อท้าย
    ensureHeaders(sheet, MENU_HEADERS);
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == item.id) { foundIndex = i + 1; break; }
    }
    var rowData = [item.id, item.category || 'food', item.name || '', item.nameEn || '', item.description || '', item.descriptionEn || '', item.price || 0, item.image || '', item.isActive !== false, item.bundledItems ? JSON.stringify(item.bundledItems) : '[]', item.popupConfig ? JSON.stringify(item.popupConfig) : '{}', item.prices ? JSON.stringify(item.prices) : '[]', item.categories ? JSON.stringify(item.categories) : '[]', item.printerId || '',
      JSON.stringify(Array.isArray(item.branches) ? item.branches : []),
      // ลำดับการแสดงแก้ผ่าน saveMenuOrder เท่านั้น — บันทึกเมนูแถวเดิมแล้วลำดับต้องไม่หาย
      foundIndex !== -1 ? data[foundIndex - 1][MENU_HEADERS.indexOf('sortOrder')] : (item.sortOrder || '')];
    if (foundIndex !== -1) sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]);
    else sheet.appendRow(rowData);
    return _bomJson({ success: true });
  }

  if (action === 'deleteMenu') {
    var sheet = ss.getSheetByName('Menu');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == postData.id) { sheet.deleteRow(i + 1); return _bomJson({ success: true }); }
    }
    return _bomJson({ success: false, error: 'Not found' });
  }

  if (action === 'saveMenu') {
    var sheet = ss.getSheetByName('Menu');
    ensureColumns(sheet, MENU_HEADERS.length);
    sheet.clearContents();
    sheet.appendRow(MENU_HEADERS);
    (postData.items || []).forEach(function(item) {
      sheet.appendRow([item.id || Date.now(), item.category || 'food', item.name || '', item.nameEn || '', item.description || '', item.descriptionEn || '', item.price || 0, item.image || '', item.isActive !== false, item.bundledItems ? JSON.stringify(item.bundledItems) : '[]', item.popupConfig ? JSON.stringify(item.popupConfig) : '{}', item.prices ? JSON.stringify(item.prices) : '[]', item.categories ? JSON.stringify(item.categories) : '[]', item.printerId || '', JSON.stringify(Array.isArray(item.branches) ? item.branches : []), item.sortOrder || '']);
    });
    return _bomJson({ success: true });
  }

  if (action === 'upsertPromotion') {
    var sheet = ss.getSheetByName('Promotions');
    var promo = postData.item;
    if (!promo || !promo.id) return _bomJson({ success: false });
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == promo.id) { foundIndex = i + 1; break; }
    }
    var rowData = [promo.id, promo.name || '', promo.nameEn || '', promo.price || 0, promo.origPrice || ''];
    if (foundIndex !== -1) sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]);
    else sheet.appendRow(rowData);
    return _bomJson({ success: true });
  }

  if (action === 'deletePromotion') {
    var sheet = ss.getSheetByName('Promotions');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == postData.id) { sheet.deleteRow(i + 1); return _bomJson({ success: true }); }
    }
    return _bomJson({ success: false });
  }

  if (action === 'savePromotions') {
    var sheet = ss.getSheetByName('Promotions');
    sheet.clearContents();
    sheet.appendRow(['id', 'name', 'nameEn', 'price', 'origPrice']);
    (postData.promotions || []).forEach(function(promo) {
      sheet.appendRow([promo.id || Date.now(), promo.name || '', promo.nameEn || '', promo.price || 0, promo.origPrice || '']);
    });
    return _bomJson({ success: true });
  }

  if (action === 'upsertCategory') {
    var sheet = ss.getSheetByName('Categories');
    var c = postData.item;
    if (!c || !c.slug) return _bomJson({ success: false });
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == c.slug) { foundIndex = i + 1; break; }
    }
    var rowData = [
      c.slug, c.name||'', c.nameEn||'', c.icon||'📌', c.isActive!==false,
      c.hasPopup1!==false, c.popup1Category||'', c.popup1Items?JSON.stringify(c.popup1Items):'[]', c.popup1Min||0, c.popup1Max||0, c.popup1ItemsMax?JSON.stringify(c.popup1ItemsMax):'{}', c.popup1Free===true,
      c.hasPopup2===true,  c.popup2Category||'', c.popup2Items?JSON.stringify(c.popup2Items):'[]', c.popup2Min||0, c.popup2Max||0, c.popup2ItemsMax?JSON.stringify(c.popup2ItemsMax):'{}', c.popup2Free===true,
      c.hasPopup3===true,  c.popup3Category||'', c.popup3Items?JSON.stringify(c.popup3Items):'[]', c.popup3Min||0, c.popup3Max||0, c.popup3ItemsMax?JSON.stringify(c.popup3ItemsMax):'{}', c.popup3Free===true,
      c.hasPopup4===true,  c.popup4Category||'', c.popup4Items?JSON.stringify(c.popup4Items):'[]', c.popup4Min||0, c.popup4Max||0, c.popup4ItemsMax?JSON.stringify(c.popup4ItemsMax):'{}', c.popup4Free===true,
      c.hasPopup5===true,  c.popup5Category||'', c.popup5Items?JSON.stringify(c.popup5Items):'[]', c.popup5Min||0, c.popup5Max||0, c.popup5ItemsMax?JSON.stringify(c.popup5ItemsMax):'{}', c.popup5Free===true,
      c.hasPopup6===true,  c.popup6Category||'', c.popup6Items?JSON.stringify(c.popup6Items):'[]', c.popup6Min||0, c.popup6Max||0, c.popup6ItemsMax?JSON.stringify(c.popup6ItemsMax):'{}', c.popup6Free===true,
      c.hasDining!==false,
      // ใครเห็นหมวดนี้: '' = ทั้งพนักงานและลูกค้า · 'staff' = เฉพาะหน้าพนักงาน · 'customer' = เฉพาะหน้าลูกค้าสั่งเอง
      c.visibility || ''
    ];
    ensureColumns(sheet, rowData.length);
    sheet.getRange(1, rowData.length).setValue('visibility');
    if (foundIndex !== -1) sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]);
    else sheet.appendRow(rowData);
    return _bomJson({ success: true });
  }

  if (action === 'deleteCategory') {
    var sheet = ss.getSheetByName('Categories');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == postData.slug) { sheet.deleteRow(i + 1); return _bomJson({ success: true }); }
    }
    return _bomJson({ success: false });
  }

  if (action === 'saveCategories') {
    var sheet = ss.getSheetByName('Categories');
    sheet.clearContents();
    sheet.appendRow(['slug','name','nameEn','icon','isActive','hasPopup1','popup1Category','popup1Items','popup1Min','popup1Max','popup1ItemsMax','popup1Free','hasPopup2','popup2Category','popup2Items','popup2Min','popup2Max','popup2ItemsMax','popup2Free','hasPopup3','popup3Category','popup3Items','popup3Min','popup3Max','popup3ItemsMax','popup3Free','hasPopup4','popup4Category','popup4Items','popup4Min','popup4Max','popup4ItemsMax','popup4Free','hasPopup5','popup5Category','popup5Items','popup5Min','popup5Max','popup5ItemsMax','popup5Free','hasPopup6','popup6Category','popup6Items','popup6Min','popup6Max','popup6ItemsMax','popup6Free','hasDining','visibility']);
    (postData.categories || []).forEach(function(c) {
      sheet.appendRow([
        c.slug||Date.now().toString(), c.name||'', c.nameEn||'', c.icon||'📌', c.isActive!==false,
        c.hasPopup1!==false, c.popup1Category||'', c.popup1Items?JSON.stringify(c.popup1Items):'[]', c.popup1Min||0, c.popup1Max||0, c.popup1ItemsMax?JSON.stringify(c.popup1ItemsMax):'{}', c.popup1Free===true,
        c.hasPopup2===true,  c.popup2Category||'', c.popup2Items?JSON.stringify(c.popup2Items):'[]', c.popup2Min||0, c.popup2Max||0, c.popup2ItemsMax?JSON.stringify(c.popup2ItemsMax):'{}', c.popup2Free===true,
        c.hasPopup3===true,  c.popup3Category||'', c.popup3Items?JSON.stringify(c.popup3Items):'[]', c.popup3Min||0, c.popup3Max||0, c.popup3ItemsMax?JSON.stringify(c.popup3ItemsMax):'{}', c.popup3Free===true,
        c.hasPopup4===true,  c.popup4Category||'', c.popup4Items?JSON.stringify(c.popup4Items):'[]', c.popup4Min||0, c.popup4Max||0, c.popup4ItemsMax?JSON.stringify(c.popup4ItemsMax):'{}', c.popup4Free===true,
        c.hasPopup5===true,  c.popup5Category||'', c.popup5Items?JSON.stringify(c.popup5Items):'[]', c.popup5Min||0, c.popup5Max||0, c.popup5ItemsMax?JSON.stringify(c.popup5ItemsMax):'{}', c.popup5Free===true,
        c.hasPopup6===true,  c.popup6Category||'', c.popup6Items?JSON.stringify(c.popup6Items):'[]', c.popup6Min||0, c.popup6Max||0, c.popup6ItemsMax?JSON.stringify(c.popup6ItemsMax):'{}', c.popup6Free===true,
        c.hasDining!==false,
        c.visibility || ''
      ]);
    });
    return _bomJson({ success: true });
  }

  if (action === 'saveLiquorRecord') {
    var liquorHeaders = ['timestamp', 'type', 'customerName', 'phone', 'productName', 'qty', 'note', 'staff', 'category', 'unit'];
    var sh = getOrCreateSheet(ss, 'LiquorStorage', liquorHeaders);
    // migrate header for old sheets ให้รองรับ category/unit
    sh.getRange(1, 1, 1, liquorHeaders.length).setValues([liquorHeaders]);
    sh.appendRow([new Date().toISOString(), postData.type || 'ฝาก', postData.customerName || '', postData.phone || '', postData.productName || '', Number(postData.qty) || 0, postData.note || '', postData.staff || '', postData.category || 'เหล้า', postData.unit || 'ขวด']);
    return _bomJson({ success: true });
  }

  // บันทึกรายการทิ้งของเสีย (Waste)
  if (action === 'saveWasteRecord') {
    var wsh = ensureHeaders(getOrCreateSheet(ss, 'Waste', WASTE_HEADERS), WASTE_HEADERS);
    wsh.appendRow([postData.timestamp || thaiTimeISO(), postData.branch || '', postData.itemName || '', postData.category || '', Number(postData.qty) || 0, postData.unit || '', postData.note || '', postData.staff || '', 'waste', postData.itemType === 'ingredient' ? 'ingredient' : 'menu']);
    return _bomJson({ success: true });
  }

  // สร้างคำขออนุมัติ QR (สถานะ pending)
  if (action === 'createPaymentApproval') {
    var sh = getOrCreateSheet(ss, 'PaymentApprovals', ['id', 'timestamp', 'tableNo', 'orderNumber', 'amount', 'requestedBy', 'status', 'approver', 'respondedAt']);
    sh.appendRow([postData.id || ('APV-' + Date.now()), new Date().toISOString(), postData.tableNo || '', postData.orderNumber || '', Number(postData.amount) || 0, postData.requestedBy || '', 'pending', '', '']);
    return _bomJson({ success: true });
  }

  // ตอบกลับคำขออนุมัติ QR (approved / rejected)
  if (action === 'respondPaymentApproval') {
    var sh2 = ss.getSheetByName('PaymentApprovals');
    if (!sh2) return _bomJson({ success: false });
    var data2 = sh2.getDataRange().getValues();
    for (var i = 1; i < data2.length; i++) {
      if (String(data2[i][0]) === String(postData.id)) {
        sh2.getRange(i + 1, 7).setValue(postData.status || 'approved');
        sh2.getRange(i + 1, 8).setValue(postData.approver || '');
        sh2.getRange(i + 1, 9).setValue(new Date().toISOString());
        return _bomJson({ success: true });
      }
    }
    return _bomJson({ success: false, error: 'Not found' });
  }

  if (action === 'savePrinters') {
    // printMode = รวมใบเดียว/แยกใบ ต้องเก็บลงชีตด้วย ไม่งั้นตอน getLive ส่งกลับมาไม่มีค่านี้
    // แล้วเครื่องที่ sync จะทับค่าที่ตั้งไว้จนกลับไปเป็น "รวมใบเดียว" เอง
    // เขียนทับเฉพาะปริ้นเตอร์ของสาขาที่ส่งมา — สาขาอื่นไม่ถูกลบ
    // categories = หมวดอาหารที่เครื่องนี้พิมพ์ ([] = ทุกหมวด)
    var prBranch = String(postData.branchId || postData.branch || '').trim() || defaultBranchId(ss);
    var prMain = defaultBranchId(ss);
    var sheet = getOrCreateSheet(ss, 'Printers', PRINTER_HEADERS);
    var prKeep = getSheetDataAsObjects(ss, 'Printers').filter(function(p) {
      var b = String(p.branchId || '').trim();
      return b ? b !== prBranch : (prBranch && prBranch !== prMain); // แถวเก่าไม่มีสาขา = ของสาขาหลัก
    });
    var prRows = prKeep.map(function(p) {
      return [p.id || '', p.name || '', p.ip || '', p.type || '', p.printMode || 'combined', String(p.branchId || ''), JSON.stringify(Array.isArray(p.categories) ? p.categories : [])];
    }).concat((postData.printers || []).map(function(p) {
      return [p.id || '', p.name || '', p.ip || '', p.type || '', p.printMode || 'combined', prBranch, JSON.stringify(Array.isArray(p.categories) ? p.categories.map(String) : [])];
    }));
    sheet.clearContents();
    ensureHeaders(sheet, PRINTER_HEADERS);
    if (prRows.length) sheet.getRange(2, 1, prRows.length, PRINTER_HEADERS.length).setValues(prRows);
    return _bomJson({ success: true, saved: (postData.printers || []).length });
  }

  if (action === 'saveSettings') {
    var sheet = getOrCreateSheet(ss, 'Settings', ['key', 'value']);
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === 'pos_settings') {
        sheet.getRange(i + 1, 2).setValue(JSON.stringify(postData.settings || {}));
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['pos_settings', JSON.stringify(postData.settings || {})]);
    return _bomJson({ success: true });
  }

  if (action === 'saveDiscounts') {
    var sheet = getOrCreateSheet(ss, 'Discounts', ['id', 'name', 'type', 'value', 'categories']);
    sheet.clearContents();
    sheet.appendRow(['id', 'name', 'type', 'value', 'categories']);
    (postData.discounts || []).forEach(function(d) {
      sheet.appendRow([d.id || '', d.name || '', d.type || '', d.value || 0, JSON.stringify(d.categories || [])]);
    });
    return _bomJson({ success: true, saved: (postData.discounts || []).length });
  }

  if (action === 'saveUsers') {
    var sheet = ss.getSheetByName('Users');
    sheet.clearContents();
    sheet.appendRow(['id', 'username', 'pin', 'canCheckout', 'isAdmin', 'isCashier', 'branch']);
    (postData.users || []).forEach(function(u) {
      sheet.appendRow([u.id||Date.now().toString(), u.username||'', u.pin||'', u.canCheckout!==false, (u.isAdmin===true || u.isAdmin==='TRUE'), (u.isCashier===true || u.isCashier==='TRUE'), u.branch||'']);
    });
    return _bomJson({ success: true });
  }

  if (action === 'resetAllSheetData') {
    ['Categories', 'Menu', 'Promotions'].forEach(function(name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    return _bomJson({ success: true, message: 'All data cleared' });
  }

  if (action === 'clearSalesData') {
    var sheetsToClear = ['Orders', 'TableOrders', 'PaymentSummary', 'PaymentApprovals', 'OutstandingBills', 'Shifts', 'ตัดสต็อก', 'รับวัตถุดิบ', 'LiquorStorage', 'Waste'];
    sheetsToClear.forEach(function(name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    return _bomJson({ success: true, message: 'Sales and transaction data cleared successfully' });
  }

  // ── Ingredient actions ──
  if (action === 'upsertIngredient') {
    var sh = ss.getSheetByName('วัตถุดิบ');
    if (!sh) return _bomJson({ success: false, error: 'ไม่พบชีท วัตถุดิบ — กรุณารัน setupBOM() ก่อน' });
    var ing = postData.ingredient || {};
    // migration: ensure header has หน่วยซื้อ / จำนวนหน่วยใช้ต่อหน่วยซื้อ columns
    var ingHeaders = ['รหัสวัตถุดิบ','ชื่อวัตถุดิบ','ชื่อ (EN)','หน่วยใช้ (BOM)','สต็อกขั้นต่ำ','ต้นทุน/หน่วยใช้ (฿)','หมวดหมู่','หมายเหตุ','หน่วยซื้อ','จำนวนหน่วยใช้/1หน่วยซื้อ'];
    sh.getRange(1, 1, 1, ingHeaders.length).setValues([ingHeaders]);
    var data = sh.getDataRange().getValues();
    var foundIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(ing.id)) { foundIdx = i + 1; break; }
    }
    var row = [ing.id||'', ing.name||'', ing.nameEn||'', ing.unit||'', Number(ing.minStock)||0, Number(ing.costPerUnit)||0, ing.category||'', ing.note||'', ing.purchaseUnit||'', Number(ing.unitsPerPurchase)||1];
    if (foundIdx !== -1) sh.getRange(foundIdx, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return _bomJson({ success: true });
  }

  if (action === 'deleteIngredient') {
    var sh = ss.getSheetByName('วัตถุดิบ');
    if (!sh) return _bomJson({ success: false, error: 'ไม่พบชีท วัตถุดิบ — กรุณารัน setupBOM() ก่อน' });
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(postData.id)) { sh.deleteRow(i + 1); return _bomJson({ success: true }); }
    }
    return _bomJson({ success: false, error: 'ไม่พบวัตถุดิบ' });
  }

  // ── BOM actions ──
  if (action === 'deductStock') return _bomJson(deductStock(postData));
  if (action === 'stockIn')     return _bomJson(recordStockIn(postData));
  if (action === 'saveBOM')     return _bomJson(saveBOM(postData));

  // ── SHIFT actions ──
  if (action === 'openShift') {
    var sh = getOrCreateSheet(ss, 'Shifts', ['id','openTime','closeTime','openStaff','closeStaff','openCash','closeCash','totalSales','totalCash','totalCard','totalTransfer','totalOrders','status','note']);
    var shiftId = 'SHIFT-' + Date.now();
    sh.appendRow([shiftId, new Date().toISOString(), '', postData.staff||'', '', Number(postData.openCash)||0, 0, 0, 0, 0, 0, 0, 'open', '']);
    return _bomJson({ success: true, shiftId: shiftId });
  }

  if (action === 'closeShift') {
    var sh = ss.getSheetByName('Shifts');
    if (!sh) return _bomJson({ success: false, error: 'ไม่พบชีท Shifts' });
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(postData.shiftId)) {
        sh.getRange(i+1, 3).setValue(new Date().toISOString());
        sh.getRange(i+1, 5).setValue(postData.staff || '');
        sh.getRange(i+1, 7).setValue(Number(postData.closeCash) || 0);
        sh.getRange(i+1, 8).setValue(Number(postData.totalSales) || 0);
        sh.getRange(i+1, 9).setValue(Number(postData.totalCash) || 0);
        sh.getRange(i+1, 10).setValue(Number(postData.totalCard) || 0);
        sh.getRange(i+1, 11).setValue(Number(postData.totalTransfer) || 0);
        sh.getRange(i+1, 12).setValue(Number(postData.totalOrders) || 0);
        sh.getRange(i+1, 13).setValue('closed');
        sh.getRange(i+1, 14).setValue(postData.note || '');
        return _bomJson({ success: true });
      }
    }
    return _bomJson({ success: false, error: 'ไม่พบกะ' });
  }

  if (action === 'savePaymentRecord') {
    var sh = getOrCreateSheet(ss, 'PaymentSummary', ['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']);
    // migration: make sure the splitDetail header exists on older sheets
    sh.getRange(1, 1, 1, 8).setValues([['timestamp','orderNumber','tableNo','paymentMethod','grandTotal','staff','shiftId','splitDetail']]);
    // รับ timestamp ได้ (ใช้ตอน backfill บิลย้อนหลังให้ตรงวันเดิม) — ไม่ส่งมาก็ใช้เวลาปัจจุบัน
    var payTs = postData.timestamp ? String(postData.timestamp) : new Date().toISOString();
    sh.appendRow([payTs, postData.orderNumber||'', postData.tableNo||'', postData.paymentMethod||'', Number(postData.grandTotal)||0, postData.staff||'', postData.shiftId||'', postData.splitDetail||'']);
    return _bomJson({ success: true });
  }

  if (action === 'cancelOrder') {
    var sheet = ss.getSheetByName('Orders');
    if (!sheet) return _bomJson({ success: false });
    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(postData.orderNumber)) {
        sheet.getRange(i+1, 9).setValue('cancelled');
        updated = true;
      }
    }
    return _bomJson({ success: updated });
  }

  return _bomJson({ success: false, error: 'Unknown action' });
}

// ==========================================
// BOM SYSTEM — ฟังก์ชันด้านล่างนี้ทั้งหมด
// เกี่ยวกับระบบ BOM / สต็อกวัตถุดิบ
// ==========================================

// Helper: ส่ง JSON response
function _bomJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// รัน 1 ครั้งเพื่อสร้าง 5 ชีท BOM
function setupBOM() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  _setupIngredients(ss);
  _setupBOM(ss);
  _setupStockIn(ss);
  _setupStockOut(ss);
  _setupStockSummary(ss);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ ตั้งค่าระบบ BOM เสร็จแล้ว! ทั้ง 5 ชีทพร้อมใช้งาน');
}

// GET ?action=getStock
function getStockLevels() {
  var ss       = SpreadsheetApp.openById(SHEET_ID);
  var ingSheet = ss.getSheetByName('วัตถุดิบ');
  var inSheet  = ss.getSheetByName('รับวัตถุดิบ');
  var outSheet = ss.getSheetByName('ตัดสต็อก');
  if (!ingSheet || !inSheet || !outSheet) {
    return { success: false, error: 'ไม่พบชีท — กรุณารัน setupBOM() ก่อน' };
  }
  var ingData = ingSheet.getDataRange().getValues().slice(1);
  var inData  = inSheet.getDataRange().getValues().slice(1);
  var outData = outSheet.getDataRange().getValues().slice(1);
  var stock = ingData.filter(function(r) { return r[0]; }).map(function(row) {
    var id = String(row[0]);
    var totalIn  = inData.filter(function(r)  { return String(r[1]) === id; }).reduce(function(s, r) { return s + (Number(r[3]) || 0); }, 0);
    var totalOut = outData.filter(function(r) { return String(r[6]) === id; }).reduce(function(s, r) { return s + (Number(r[8]) || 0); }, 0);
    var current = totalIn - totalOut;
    var minQty  = Number(row[4]) || 0;
    return {
      id: id, name: row[1]||'', nameEn: row[2]||'', unit: row[3]||'',
      current: Math.round(current * 100) / 100,
      minimum: minQty, price: Number(row[5]) || 0,
      purchaseUnit: row[8]||'', unitsPerPurchase: Number(row[9])||1,
      status: current <= 0 ? 'OUT' : current <= minQty ? 'LOW' : 'OK'
    };
  });
  return { success: true, stock: stock, lowItems: stock.filter(function(s) { return s.status !== 'OK'; }) };
}

// GET ?action=getIngredients
function getIngredientsList() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('วัตถุดิบ');
  if (!sh) return { success: false, error: 'ไม่พบชีท วัตถุดิบ — กรุณารัน setupBOM() ก่อน' };
  var ingredients = sh.getDataRange().getValues().slice(1).filter(function(r) { return r[0]; }).map(function(r) {
    return { id: String(r[0]), name: r[1]||'', nameEn: r[2]||'', unit: r[3]||'', minStock: Number(r[4])||0, costPerUnit: Number(r[5])||0, category: r[6]||'', note: r[7]||'', purchaseUnit: r[8]||'', unitsPerPurchase: Number(r[9])||1 };
  });
  return { success: true, ingredients: ingredients };
}

// POST action=deductStock
function deductStock(data) {
  var ss       = SpreadsheetApp.openById(SHEET_ID);
  var bomSheet = ss.getSheetByName('BOM');
  var outSheet = ss.getSheetByName('ตัดสต็อก');
  var ingSheet = ss.getSheetByName('วัตถุดิบ');
  if (!bomSheet || !outSheet || !ingSheet) return { success: false, error: 'ไม่พบชีท — กรุณารัน setupBOM() ก่อน' };
  var bomData = bomSheet.getDataRange().getValues().slice(1);
  var ingData = ingSheet.getDataRange().getValues().slice(1);
  var now = new Date();
  var rows = [];
  (data.items || []).forEach(function(ordered) {
    bomData.filter(function(row) { return String(row[0]) === String(ordered.menuId); }).forEach(function(line) {
      var ingId    = String(line[3]);
      var totalAmt = (Number(line[5]) || 0) * (Number(ordered.qty) || 1);
      var ingRow   = ingData.filter(function(r) { return String(r[0]) === ingId; })[0];
      var cost     = ingRow ? (Number(ingRow[5]) || 0) * totalAmt : 0;
      rows.push([now, data.orderNumber||'', data.tableNo||'', ordered.menuId, ordered.menuName||'', Number(ordered.qty)||1, ingId, line[4], totalAmt, line[6], cost]);
    });
  });
  if (rows.length > 0) {
    var lastRow = outSheet.getLastRow() + 1;
    outSheet.getRange(lastRow, 1, rows.length, 11).setValues(rows);
    outSheet.getRange(lastRow, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  }
  return { success: true, deducted: rows.length };
}

// POST action=stockIn
function recordStockIn(data) {
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var inSheet = ss.getSheetByName('รับวัตถุดิบ');
  var ingSheet= ss.getSheetByName('วัตถุดิบ');
  if (!inSheet || !ingSheet) return { success: false, error: 'ไม่พบชีท — กรุณารัน setupBOM() ก่อน' };
  var allIng = ingSheet.getDataRange().getValues();         // incl. header (for row index)
  var ingData = allIng.slice(1);
  // migration: ensure รับวัตถุดิบ header includes purchase columns
  var inHeaders = ['วันที่','รหัส','ชื่อวัตถุดิบ','จำนวน (หน่วยใช้)','หน่วยใช้','ต้นทุน/หน่วยใช้ (฿)','รวมราคา (฿)','ผู้บันทึก','หมายเหตุ','จำนวนซื้อ','หน่วยซื้อ','ราคา/หน่วยซื้อ (฿)'];
  inSheet.getRange(1, 1, 1, inHeaders.length).setValues([inHeaders]);
  var now = new Date();
  var rows = [];
  (data.items || []).forEach(function(item) {
    var ingIdx = -1;
    for (var k = 0; k < ingData.length; k++) { if (String(ingData[k][0]) === String(item.ingId)) { ingIdx = k; break; } }
    if (ingIdx === -1) return;
    var ingRow = ingData[ingIdx];
    var factor = Number(ingRow[9]) || 1;                    // หน่วยใช้ ต่อ 1 หน่วยซื้อ
    var qtyPurchase = Number(item.qty) || 0;                // จำนวนที่ซื้อ (หน่วยซื้อ)
    // ราคาที่กรอกคือราคาต่อ "หน่วยซื้อ"; ถ้าไม่กรอกใช้ต้นทุนเดิม×factor
    var pricePerPurchase = (item.pricePerUnit !== undefined && item.pricePerUnit !== '' && item.pricePerUnit !== null)
      ? Number(item.pricePerUnit)
      : (Number(ingRow[5]) || 0) * factor;
    var usageQty  = qtyPurchase * factor;                   // แปลงเป็นหน่วยใช้เพื่อเก็บสต็อก
    var usageCost = factor > 0 ? pricePerPurchase / factor : pricePerPurchase; // ต้นทุนต่อหน่วยใช้
    var total     = qtyPurchase * pricePerPurchase;
    rows.push([now, item.ingId, ingRow[1], usageQty, ingRow[3], usageCost, total, item.staff||'admin', item.note||'', qtyPurchase, ingRow[8]||'', pricePerPurchase]);
    // อัปเดตต้นทุน/หน่วยใช้ ล่าสุดในชีทวัตถุดิบ เพื่อให้ BOM คำนวณด้วยราคาล่าสุด
    ingSheet.getRange(ingIdx + 2, 6).setValue(Math.round(usageCost * 10000) / 10000);
  });
  if (rows.length > 0) {
    var lastRow = inSheet.getLastRow() + 1;
    inSheet.getRange(lastRow, 1, rows.length, 12).setValues(rows);
    inSheet.getRange(lastRow, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  }
  return { success: true, recorded: rows.length };
}

// POST action=saveBOM
function saveBOM(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('BOM');
  if (!sh) return { success: false, error: 'ไม่พบชีท BOM — กรุณารัน setupBOM() ก่อน' };
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  var rows = (data.rows || []);
  if (rows.length === 0) return { success: true, saved: 0 };
  var values = rows.map(function(r) {
    return [r.menuId||'', r.menuName||'', r.menuNameEn||'', r.ingId||'', r.ingName||'', Number(r.qty)||0, r.unit||'', Number(r.costPerUnit)||0, r.note||''];
  });
  sh.getRange(2, 1, values.length, 9).setValues(values);
  return { success: true, saved: values.length };
}

// ── Sheet setup helpers (ใช้โดย setupBOM) ──
function _setupIngredients(ss) {
  var sh = ss.getSheetByName('วัตถุดิบ') || ss.insertSheet('วัตถุดิบ');
  sh.clearContents(); sh.clearFormats();
  var h = ['รหัสวัตถุดิบ','ชื่อวัตถุดิบ','ชื่อ (EN)','หน่วยใช้ (BOM)','สต็อกขั้นต่ำ','ต้นทุน/หน่วยใช้ (฿)','หมวดหมู่','หมายเหตุ','หน่วยซื้อ','จำนวนหน่วยใช้/1หน่วยซื้อ'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _bomStyleHeader(sh.getRange(1,1,1,h.length), '#1a3a5c');
  var d = [
    ['ING-001','หมูสามชั้น','Pork Belly','กรัม',500,0.08,'เนื้อสัตว์','','กก.',1000],
    ['ING-002','ไก่','Chicken','กรัม',500,0.06,'เนื้อสัตว์','','กก.',1000],
    ['ING-003','กุ้งสด','Shrimp','กรัม',300,0.20,'อาหารทะเล','','กก.',1000],
    ['ING-004','ปลาหมึก','Squid','กรัม',300,0.15,'อาหารทะเล','','กก.',1000],
    ['ING-005','ข้าวสวย','Steamed Rice','กรัม',2000,0.01,'แป้ง/ข้าว','','กก.',1000],
    ['ING-006','น้ำมันพืช','Vegetable Oil','มล',500,0.03,'เครื่องปรุง','','ลิตร',1000],
    ['ING-007','น้ำปลา','Fish Sauce','มล',200,0.05,'เครื่องปรุง','','ขวด',700],
    ['ING-008','ซีอิ๊วขาว','Soy Sauce','มล',200,0.04,'เครื่องปรุง','','ขวด',700],
    ['ING-009','กระเทียม','Garlic','กรัม',100,0.10,'ผัก','','กก.',1000],
    ['ING-010','หอมแดง','Shallot','กรัม',100,0.08,'ผัก','','กก.',1000],
    ['ING-011','พริกขี้หนู','Bird Chili','กรัม',50,0.30,'ผัก','','กก.',1000],
    ['ING-012','มะนาว','Lime','ลูก',20,2.00,'ผัก','','กก.',12],
    ['ING-013','ผักชี','Cilantro','กรัม',50,0.15,'ผัก','','กก.',1000],
    ['ING-014','ไข่ไก่','Egg','ฟอง',20,4.00,'โปรตีน','','แผง',30],
    ['ING-015','เส้นก๋วยเตี๋ยว','Noodles','กรัม',500,0.05,'แป้ง/ข้าว','','กก.',1000],
  ];
  sh.getRange(2,1,d.length,h.length).setValues(d);
  sh.setFrozenRows(1);
}

function _setupBOM(ss) {
  var sh = ss.getSheetByName('BOM') || ss.insertSheet('BOM');
  sh.clearContents(); sh.clearFormats();
  var h = ['รหัสเมนู','ชื่อเมนู (TH)','ชื่อเมนู (EN)','รหัสวัตถุดิบ','ชื่อวัตถุดิบ','ปริมาณ/จาน','หน่วย','ราคา/หน่วย (฿)','หมายเหตุ'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _bomStyleHeader(sh.getRange(1,1,1,h.length), '#2d4a22');
  sh.setFrozenRows(1);
}

function _setupStockIn(ss) {
  var sh = ss.getSheetByName('รับวัตถุดิบ') || ss.insertSheet('รับวัตถุดิบ');
  sh.clearContents(); sh.clearFormats();
  var h = ['วันที่','รหัส','ชื่อวัตถุดิบ','จำนวน (หน่วยใช้)','หน่วยใช้','ต้นทุน/หน่วยใช้ (฿)','รวมราคา (฿)','ผู้บันทึก','หมายเหตุ','จำนวนซื้อ','หน่วยซื้อ','ราคา/หน่วยซื้อ (฿)'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _bomStyleHeader(sh.getRange(1,1,1,h.length), '#7b3f00');
  var today = new Date();
  var sample = [
    [today,'ING-001','หมูสามชั้น',2000,'กรัม',0.08,160,'admin','ข้อมูลตัวอย่าง',2,'กก.',80],
    [today,'ING-003','กุ้งสด',1000,'กรัม',0.20,200,'admin','ข้อมูลตัวอย่าง',1,'กก.',200],
    [today,'ING-005','ข้าวสวย',5000,'กรัม',0.01,50,'admin','ข้อมูลตัวอย่าง',5,'กก.',10],
    [today,'ING-006','น้ำมันพืช',2000,'มล',0.03,60,'admin','ข้อมูลตัวอย่าง',2,'ลิตร',30],
    [today,'ING-009','กระเทียม',500,'กรัม',0.10,50,'admin','ข้อมูลตัวอย่าง',0.5,'กก.',100],
    [today,'ING-014','ไข่ไก่',30,'ฟอง',4.00,120,'admin','ข้อมูลตัวอย่าง',1,'แผง',120],
  ];
  sh.getRange(2,1,sample.length,h.length).setValues(sample);
  sh.setFrozenRows(1);
}

function _setupStockOut(ss) {
  var sh = ss.getSheetByName('ตัดสต็อก') || ss.insertSheet('ตัดสต็อก');
  sh.clearContents(); sh.clearFormats();
  var h = ['วันที่-เวลา','เลขออเดอร์','โต๊ะ','รหัสเมนู','ชื่อเมนู','จำนวนจาน','รหัสวัตถุดิบ','ชื่อวัตถุดิบ','ปริมาณตัด','หน่วย','ต้นทุน (฿)'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _bomStyleHeader(sh.getRange(1,1,1,h.length), '#4a0000');
  sh.setFrozenRows(1);
}

function _setupStockSummary(ss) {
  var sh = ss.getSheetByName('สรุปสต็อก') || ss.insertSheet('สรุปสต็อก');
  sh.clearContents(); sh.clearFormats();
  sh.getRange(1,1,1,8).merge();
  sh.getRange(1,1).setValue('📊 รายงานสต็อกวัตถุดิบ (คำนวณจาก รับเข้า − ตัดสต็อก)')
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground('#1a1a2e').setFontColor('#ffffff');
  var h = ['รหัส','ชื่อวัตถุดิบ','หน่วย','รับเข้าทั้งหมด','ใช้ไปทั้งหมด','คงเหลือ','ขั้นต่ำ','สถานะ'];
  sh.getRange(2,1,1,h.length).setValues([h]);
  _bomStyleHeader(sh.getRange(2,1,1,h.length), '#16213e');
  sh.setFrozenRows(2);
  for (var r = 3; r <= 17; r++) {
    var i = r - 1;
    sh.getRange(r,1).setFormula('=IFERROR(วัตถุดิบ!A'+i+',"")');
    sh.getRange(r,2).setFormula('=IFERROR(วัตถุดิบ!B'+i+',"")');
    sh.getRange(r,3).setFormula('=IFERROR(วัตถุดิบ!D'+i+',"")');
    sh.getRange(r,4).setFormula('=IFERROR(SUMIF(รับวัตถุดิบ!B:B,A'+r+',รับวัตถุดิบ!D:D),0)');
    sh.getRange(r,5).setFormula('=IFERROR(SUMIF(ตัดสต็อก!G:G,A'+r+',ตัดสต็อก!I:I),0)');
    sh.getRange(r,6).setFormula('=D'+r+'-E'+r);
    sh.getRange(r,7).setFormula('=IFERROR(วัตถุดิบ!E'+i+',0)');
    sh.getRange(r,8).setFormula('=IF(A'+r+'="","",IF(F'+r+'<=0,"🔴 หมดแล้ว!",IF(F'+r+'<=G'+r+',"🟡 ใกล้หมด","🟢 ปกติ")))');
  }
}

function _bomStyleHeader(range, bgColor) {
  range.setBackground(bgColor).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(true,true,true,true,true,true,'#ffffff', SpreadsheetApp.BorderStyle.SOLID);
}

// ฟังก์ชันสำหรับรันใน Google Apps Script Editor เพื่อล้างข้อมูลการขายและธุรกรรมทั้งหมด
// โดยจะคงเหลือไว้เฉพาะข้อมูลตั้งค่าระบบ เมนู หมวดหมู่ บัญชีผู้ใช้ เครื่องพิมพ์ และสูตรอาหาร (วัตถุดิบ/BOM)
function clearSalesAndTransactionsData() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheetsToClear = [
    'Orders',
    'TableOrders',
    'PaymentSummary',
    'PaymentApprovals',
    'OutstandingBills',
    'Shifts',
    'ตัดสต็อก',
    'รับวัตถุดิบ',
    'LiquorStorage',
    'Waste'
  ];

  sheetsToClear.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) {
      sh.deleteRows(2, sh.getLastRow() - 1);
    }
  });
  
  Logger.log("ล้างข้อมูลการขาย ธุรกรรม และประวัติสต็อกทั้งหมดเรียบร้อยแล้ว คงเหลือไว้เฉพาะเมนูและหมวดอาหาร!");
}

// ฟังก์ชันสรุปยอดขายทั้งหมด (ยอดขายรวม, แยกประเภทชำระเงิน, จำนวนบิล, และจำนวนขายแต่ละเมนูที่ไม่รวมแอดออน/ป๊อปอัพ)
function generateSalesReport() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  
  // 1. คำนวณข้อมูลการเงินและประเภทชำระจากชีท PaymentSummary
  var payments = getSheetDataAsObjects(ss, 'PaymentSummary');
  var totalSales = 0;
  var totalBills = 0;
  var paymentBreakdown = {
    'เงินสด': 0,
    'เงินโอน / QR': 0,
    'บัตรเครดิต': 0
  };
  var uniqueBills = {};
  
  payments.forEach(function(p) {
    var billNo = p.orderNumber;
    if (!billNo) return;
    
    if (!uniqueBills[billNo]) {
      uniqueBills[billNo] = true;
      totalBills++;
    }
    
    var grandTotal = Number(p.grandTotal) || 0;
    totalSales += grandTotal;
    
    var method = String(p.paymentMethod || '');
    if (method.indexOf('แยกจ่าย') !== -1 || p.splitDetail) {
      var split = null;
      try {
        split = typeof p.splitDetail === 'string' ? JSON.parse(p.splitDetail) : p.splitDetail;
      } catch(e) {}
      if (split) {
        paymentBreakdown['เงินสด'] += Number(split.cash || 0);
        paymentBreakdown['เงินโอน / QR'] += Number(split.transfer || 0);
        paymentBreakdown['บัตรเครดิต'] += Number(split.card || 0);
      }
    } else {
      if (method.indexOf('สด') !== -1 || method.toLowerCase() === 'cash') {
        paymentBreakdown['เงินสด'] += grandTotal;
      } else if (method.indexOf('โอน') !== -1 || method.indexOf('QR') !== -1 || method.toLowerCase() === 'transfer') {
        paymentBreakdown['เงินโอน / QR'] += grandTotal;
      } else if (method.indexOf('บัตร') !== -1 || method.toLowerCase() === 'card') {
        paymentBreakdown['บัตรเครดิต'] += grandTotal;
      } else {
        paymentBreakdown['เงินสด'] += grandTotal; // default fallback
      }
    }
  });
  
  // 2. คำนวณหาจำนวนเมนูที่ขายไปได้ โดยไม่นับแอดออน/ป๊อปอัพ จากชีท Orders
  var orders = getSheetDataAsObjects(ss, 'Orders');
  var menuSales = {};
  
  orders.forEach(function(o) {
    var status = String(o.Status || '').toLowerCase();
    if (status === 'cancelled') return;
    
    var detail = String(o.ItemDetail || '').trim();
    if (!detail) return;
    
    // ข้ามแอดออน/ป๊อปอัพ (ขึ้นต้นด้วย ↳ หรือเป็นตัวเลือกอื่น)
    if (detail.indexOf('↳') === 0 || detail.indexOf('ความเผ็ด') === 0 || detail.indexOf('ลูกค้า:') === 0) {
      return;
    }
    
    var qty = 1;
    var name = detail;
    var match = detail.match(/(.*?)\s*\(x(\d+)\)$/);
    if (match) {
      name = match[1].trim();
      qty = parseInt(match[2], 10) || 1;
    }
    
    if (!menuSales[name]) {
      menuSales[name] = { qty: 0, revenue: 0 };
    }
    menuSales[name].qty += qty;
    menuSales[name].revenue += (Number(o.Price) || 0);
  });
  
  // 3. แสดงผลลง Logger
  Logger.log("==================================================");
  Logger.log("📊 รายงานสรุปยอดขายทั้งหมด (Sales Summary Report)");
  Logger.log("==================================================");
  Logger.log("💰 ยอดขายทั้งหมด: ฿" + totalSales.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  Logger.log("🧾 จำนวนบิลทั้งหมด: " + totalBills + " บิล");
  Logger.log("--------------------------------------------------");
  Logger.log("💳 แยกตามช่องทางการชำระเงิน:");
  Logger.log("💵 เงินสด: ฿" + paymentBreakdown['เงินสด'].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  Logger.log("📱 เงินโอน / QR: ฿" + paymentBreakdown['เงินโอน / QR'].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  Logger.log("💳 บัตรเครดิต: ฿" + paymentBreakdown['บัตรเครดิต'].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  Logger.log("--------------------------------------------------");
  Logger.log("🍲 ยอดขายแยกรายเมนู (ไม่รวมแอดออน/ป๊อปอัพ):");
  
  var sortedMenus = Object.keys(menuSales).sort(function(a, b) {
    return menuSales[b].qty - menuSales[a].qty;
  });
  
  sortedMenus.forEach(function(mname) {
    var data = menuSales[mname];
    Logger.log(" - " + mname + ": ขายได้ " + data.qty + " จาน (ยอดขายรวม: ฿" + data.revenue.toLocaleString() + ")");
  });
  Logger.log("==================================================");
  
  return {
    success: true,
    totalSales: totalSales,
    totalBills: totalBills,
    paymentBreakdown: paymentBreakdown,
    menuSales: menuSales
  };
}
