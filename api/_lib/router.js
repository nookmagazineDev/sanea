// ตัวกลางรับคำขอทั้งหมด — พูดภาษาเดียวกับ Apps Script เดิมเป๊ะ ๆ
//   อ่าน:  GET  ?action=getLive
//   เขียน: POST body JSON { action: 'insertOrder', ... }
// หน้าบ้านจึงเปลี่ยนแค่ URL ปลายทาง ไม่ต้องแก้ตรรกะการเรียก
import { handleGet, getStockLevels, getIngredientsList, getBomRows, generateSalesReport } from './read.js';
import * as write from './write.js';
import * as admin from './admin.js';
import { deductStock, recordStockIn, saveBOM, upsertIngredient, deleteIngredient } from './stock.js';
import { getPool, query, explainConnectError } from './db.js';
import { nextIds } from './ids.js';
import { login, authorize, clearEnforceCache } from './auth.js';
import { kioskPaymentRequest, getKioskPayment, getPendingKioskPayments, respondKioskPayment } from './kioskPayment.js';
import { issueTaxInvoice, cancelTaxInvoice, reissueTaxInvoice, listTaxInvoices, listTaxCustomers, saveTaxCustomer, deleteTaxCustomer } from './taxInvoice.js';

export const BUILD = '2026-09-24-kiosk-pay-confirm';

// ตารางคำสั่งเขียน — ชื่อ action ตรงกับของเดิมทุกตัว
const POST_ACTIONS = {
  kioskPaidOrder:          write.handleKioskPaidOrder,
  kioskPaymentRequest,
  respondKioskPayment,
  issueTaxInvoice,
  cancelTaxInvoice,
  reissueTaxInvoice,
  saveTaxCustomer,
  deleteTaxCustomer,
  addTableOrder:           write.addTableOrder,
  clearAllTableOrders:     write.clearAllTableOrders,
  clearTableOrders:        write.clearTableOrders,
  deleteTableOrderItem:    write.deleteTableOrderItem,
  moveTable:               write.moveTable,
  moveTableItems:          write.moveTableItems,
  insertOrder:             write.insertOrder,
  updateStatus:            write.updateStatus,
  cancelOrder:             write.cancelOrder,
  saveOutstandingBills:    write.saveOutstandingBills,
  createPaymentApproval:   write.createPaymentApproval,
  respondPaymentApproval:  write.respondPaymentApproval,
  openShift:               write.openShift,
  closeShift:              write.closeShift,
  savePaymentRecord:       write.savePaymentRecord,
  saveLiquorRecord:        write.saveLiquorRecord,
  saveWasteRecord:         write.saveWasteRecord,
  savePrepRecord:          write.savePrepRecord,
  saveStockCount:          write.saveStockCount,

  upsertMenu:              admin.upsertMenu,
  deleteMenu:              admin.deleteMenu,
  saveMenu:                admin.saveMenu,
  upsertCategory:          admin.upsertCategory,
  deleteCategory:          admin.deleteCategory,
  saveCategories:          admin.saveCategories,
  upsertPromotion:         admin.upsertPromotion,
  deletePromotion:         admin.deletePromotion,
  savePromotions:          admin.savePromotions,
  login,
  saveUsers:               admin.saveUsers,
  saveBranches:            admin.saveBranches,
  saveBranchTables:        admin.saveBranchTables,
  saveMenuBranch:          admin.saveMenuBranch,
  saveMenuOrder:           admin.saveMenuOrder,
  savePrinters:            admin.savePrinters,
  saveDiscounts:           admin.saveDiscounts,
  saveSettings:            admin.saveSettings,
  resetAllSheetData:       admin.resetAllSheetData,
  clearSalesData:          admin.clearSalesData,
  uploadImage:             admin.uploadImage,
  uploadSlip:              admin.uploadSlip,

  deductStock,
  stockIn:                 recordStockIn,
  saveBOM:                 saveBOM,
  upsertIngredient,
  deleteIngredient
};

// คำสั่งอ่านที่ไม่ได้อยู่ใน read.handleGet (ของเบ็ดเตล็ด/ของที่ใช้ตรวจระบบ)
async function handleExtraGet(action, params = {}) {
  switch (action) {
    case 'getBOM':            return await getBomRows();
    // รหัสถัดไปสำหรับเมนู/หมวดหมู่ที่กำลังจะสร้าง (SN00001, SN00002, …)
    // หน้าหลังบ้านเรียกตอนกดเพิ่มรายการใหม่ เพื่อให้รหัสเดินต่อจากของเดิมเสมอ
    case 'nextId':            return { success: true, ids: await nextIds(query, Math.min(50, Math.max(1, Number(params.count) || 1))) };
    case 'getSalesReport':    return await generateSalesReport();
    case 'getKioskPayment':         return await getKioskPayment(params);
    case 'getPendingKioskPayments': return await getPendingKioskPayments(params);
    case 'getTaxInvoices':    return { success: true, invoices: await listTaxInvoices() };
    case 'getTaxCustomers':   return { success: true, customers: await listTaxCustomers() };
    case 'getStock':          return await getStockLevels(String(params.branch || '').trim());
    case 'getIngredients':    return await getIngredientsList();
    case 'resetAllSheetData': return await admin.resetAllSheetData();
    case 'clearSalesData':    return await admin.clearSalesData();
    // ของเดิมมี initSheets ไว้สร้างชีทที่ขาด — ตอนนี้โครงตารางสร้างด้วย db/schema.sql
    case 'initSheets':        return { success: true, message: 'โครงสร้างตารางสร้างด้วย db/schema.sql (npm run sql:init)' };
    default: return null;
  }
}

// เช็กว่า API ที่หน้าเว็บเรียกอยู่เป็นโค้ดตัวไหน และต่อฐานข้อมูลได้จริงไหม
// เปิด <URL>?action=ping ในเบราว์เซอร์แล้วดูผลได้เลย
async function ping() {
  const out = { success: true, build: BUILD, backend: 'sqlserver', database: process.env.SQL_DATABASE || '', server: process.env.SQL_SERVER || '' };
  try {
    const pool = await getPool();
    const res = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Menu');
    out.db = 'connected';
    out.menuRows = res.recordset[0].n;
  } catch (err) {
    out.success = false;
    out.db = 'error';
    out.error = explainConnectError(err);
  }
  return out;
}

// body อาจมาเป็น object (เมื่อ Content-Type: application/json) หรือข้อความดิบ
// (หน้าบ้านส่ง text/plain มาตั้งแต่ยุค GAS เพื่อเลี่ยง preflight — ต้องรับได้ทั้งคู่)
export function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); }
  catch { return null; }
}

export async function route({ method, params = {}, body }) {
  if (method === 'GET') {
    params = { ...params };
    const token = params.token; delete params.token;
    const action = params.action || 'getAllData';
    const auth = await authorize(action, token, null, params);
    if (!auth.ok) return auth.response;
    if (action === 'ping') return await ping();
    const fromRead = await handleGet(action, params);
    if (fromRead) return fromRead;
    const extra = await handleExtraGet(action, params);
    if (extra) return extra;
    return { error: 'Unknown GET action' };
  }

  if (method === 'POST') {
    const data = parseBody(body);
    if (data === null) return { success: false, error: 'Invalid Content' };
    const action = data.action || 'insertOrder';
    const handler = POST_ACTIONS[action];
    if (!handler) return { success: false, error: 'Unknown action' };
    const token = data._token; delete data._token;
    const auth = await authorize(action, token, data, null);
    if (!auth.ok) return auth.response;
    const result = await handler(data);
    if (action === 'saveSettings') clearEnforceCache(); // เปิด/ปิดบังคับล็อกอินมีผลทันที
    return result;
  }

  return { success: false, error: 'Method not allowed' };
}
