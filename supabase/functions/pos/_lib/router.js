// ตัวกลางรับคำขอทั้งหมด — พูดภาษาเดียวกับ Apps Script เดิมเป๊ะ ๆ
//   อ่าน:  GET  ?action=getLive
//   เขียน: POST body JSON { action: 'insertOrder', ... }
// หน้าบ้านจึงเปลี่ยนแค่ URL ปลายทาง ไม่ต้องแก้ตรรกะการเรียก
import { handleGet, getStockLevels, getIngredientsList, getBomRows, generateSalesReport } from './read.js';
import * as write from './write.js';
import * as admin from './admin.js';
import { deductStock, recordStockIn, saveBOM, upsertIngredient, deleteIngredient } from './stock.js';
import { query, explainConnectError } from './db.js';
import { nextIds } from './ids.js';
import { login, authorize, clearEnforceCache } from './auth.js';
import { kioskPaymentRequest, getKioskPayment, getPendingKioskPayments, respondKioskPayment } from './kioskPayment.js';
import { memberOnlyProblem } from './memberOnly.js';
import { memberQuota, memberMenuToday, saveMemberMenuSettings, getMemberMenuSettings } from './memberMenu.js';
import { syncMenuToCrm, lookupMember, crmStatus, flushCrmQueue, memberWallet, reserveCoupon, releaseCoupon, redeemReward, cancelRedeem, sendMemberCode, checkMemberCode, joinLink, checkVoucher, releaseVoucher, verifyKioskMember } from './crm.js';
import { branchForWrite } from './branch.js';
import { enqueuePrint, getPrintQueue, cancelPrintJob, getPrintAgentKey, claimPrintJobs, reportPrintJob } from './printQueue.js';
import { issueTaxInvoice, cancelTaxInvoice, reissueTaxInvoice, listTaxInvoices, listTaxCustomers, saveTaxCustomer, deleteTaxCustomer } from './taxInvoice.js';
import { env } from './env.js';
import { Buffer } from 'node:buffer';

export const BUILD = '2026-11-23-sanea-supabase';

// ตารางคำสั่งเขียน — ชื่อ action ตรงกับของเดิมทุกตัว
// แก้เมนู/หมวดแล้วส่งเมนูล่าสุดไปให้ระบบสมาชิก
const MENU_ACTIONS = new Set(['upsertMenu', 'deleteMenu', 'saveMenu', 'upsertCategory', 'deleteCategory', 'saveCategories']);

const POST_ACTIONS = {
  // ยิงตรงจากภายนอก (หน้าลูกค้าตอนนี้ใช้ kioskPaymentRequest) — เมนูเฉพาะสมาชิกต้องล็อกอินสมาชิกเหมือนกัน
  kioskPaidOrder:          async (data) => (await memberOnlyProblem(data.items, data, await branchForWrite(data))) || write.handleKioskPaidOrder(data),
  kioskPaymentRequest,
  respondKioskPayment,
  issueTaxInvoice,
  cancelTaxInvoice,
  reissueTaxInvoice,
  saveTaxCustomer,
  deleteTaxCustomer,
  // คิวงานพิมพ์: มือถือ/แท็บเล็ตฝากงาน → Print Server ในร้านดึงไปพิมพ์ (printQueue.js)
  enqueuePrint,
  cancelPrintJob,
  getPrintAgentKey,
  claimPrintJobs,
  reportPrintJob,
  addTableOrder:           write.addTableOrder,
  // เสน่ห์: ลูกค้าสั่งก่อน จ่ายทีหลัง
  kioskOrder:              async (data) => (await memberOnlyProblem(data.items, data, await branchForWrite(data))) || write.kioskOrder(data),
  claimKioskTickets:       write.claimKioskTickets,
  releaseKioskTickets:     write.releaseKioskTickets,
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
  saveReceiptSettings:     admin.saveReceiptSettings,
  resetAllSheetData:       admin.resetAllSheetData,
  clearSalesData:          admin.clearSalesData,
  uploadImage:             admin.uploadImage,
  uploadMenuImageHost:     admin.uploadMenuImageHost,
  uploadSlip:              admin.uploadSlip,

  deductStock,
  stockIn:                 recordStockIn,
  saveBOM:                 saveBOM,
  upsertIngredient,
  deleteIngredient,

  // ระบบสมาชิก: พนักงานค้นสมาชิกตอนปิดบิล (เห็นชื่อเต็ม แต้ม) · ลูกค้าหน้า QR ใส่เลขสมาชิก (เห็นแค่ชื่อย่อ)
  crmMemberLookup:   async (data) => lookupMember({ query: data.query, branchId: await branchForWrite(data), staff: true, ip: data._ip }),
  crmKioskMember:    async (data) => lookupMember({ query: data.query, branchId: await branchForWrite(data), staff: false, ip: data._ip }),
  crmRetry:          async () => ({ success: true, sent: await flushCrmQueue(100) }),
  crmSyncMenu:       async () => syncMenuToCrm({ force: true }),
  // คูปอง/แลกแต้ม — หน้าขายของพนักงาน
  crmWallet:         async (data) => memberWallet(data, await branchForWrite(data), false),
  crmReserveCoupon:  async (data) => reserveCoupon(data, await branchForWrite(data), false),
  crmReleaseCoupon:  async (data) => releaseCoupon(data, await branchForWrite(data)),
  crmRedeem:         async (data) => redeemReward(data, await branchForWrite(data), false),
  crmCancelRedeem:   async (data) => cancelRedeem(data, await branchForWrite(data), false),
  // Voucher (ใช้แทนเงิน) — หน้าเลือกวิธีชำระของพนักงาน
  crmVoucherCheck:   async (data) => checkVoucher(data, await branchForWrite(data)),
  crmVoucherRelease: async (data) => releaseVoucher(data, await branchForWrite(data)),
  // คูปอง/แลกแต้ม — หน้าลูกค้าสั่งเอง (CRM_KIOSK_VERIFY=1 = ต้องยืนยันรหัสจากบัตรสมาชิกก่อน ระบบสมาชิกตรวจ verifyToken เอง)
  crmKioskJoinLink:  async (data) => joinLink(await branchForWrite(data)),
  // เมนูสมาชิก: สิทธิ์ที่เหลือวันนี้ · หน้าลูกค้าต้องล็อกอินสมาชิก (ตรวจ verifyToken กับระบบสมาชิก) · หน้าขายพนักงานล็อกอินแล้ว
  // หน้าลูกค้าสั่งเอง: ต้องใส่รหัส 6 หลักไหม + จำสมาชิกไว้กี่วัน
  memberMenuConfig:  async () => {
    const s = await getMemberMenuSettings();
    // จำนวนสิทธิ์ต่อวัน (ให้หน้าลูกค้าบอกกติกาได้ตั้งแต่ยังไม่ล็อกอิน) · ปิดการจำกัด = null
    const limit = s.limitEnabled && s.applyKiosk ? { total: s.totalLimit || null, perMenu: s.perMenu || {} } : null;
    return { success: true, requireCode: s.requireCode, rememberDays: s.rememberDays, limit };
  },
  memberMenuQuota:   async (data) => {
    if (!(await getMemberMenuSettings()).requireCode) {
      return /^MB-\d{7}$/.test(String(data.memberId || '')) ? memberQuota(String(data.memberId), 'kiosk') : { success: false, needLogin: true, error: 'ไม่พบเลขสมาชิก' };
    }
    const v = await verifyKioskMember({ memberId: data.memberId, verifyToken: data.verifyToken }, await branchForWrite(data));
    // ล็อกอินหลุดจริง (ระบบสมาชิกบอกว่า token ใช้ไม่ได้) เท่านั้นจึงให้ล็อกอินใหม่ · ระบบสมาชิกช้า/ปิดอยู่ชั่วคราว ไม่ลบล็อกอินที่จำไว้
    if (!v || !v.success) return v && v.verify ? { success: false, needLogin: true, error: 'ล็อกอินสมาชิกหมดเวลา กรุณาล็อกอินใหม่' } : { success: false, error: (v && v.error) || 'เชื่อมระบบสมาชิกไม่ได้ชั่วคราว' };
    return memberQuota(String(data.memberId), 'kiosk');
  },
  staffMemberQuota:  async (data) => (/^MB-\d{7}$/.test(String(data.memberId || '')) ? memberQuota(String(data.memberId), 'staff') : { success: false, error: 'ไม่พบเลขสมาชิก' }),
  getMemberMenuToday:     async () => memberMenuToday(),
  saveMemberMenuSettings: async (data) => saveMemberMenuSettings(data),
  crmKioskSendCode:  async (data) => sendMemberCode(data, await branchForWrite(data)),
  crmKioskCheckCode: async (data) => checkMemberCode(data, await branchForWrite(data)),
  crmKioskWallet:    async (data) => memberWallet(data, await branchForWrite(data), true),
  crmKioskReserve:   async (data) => reserveCoupon(data, await branchForWrite(data), true),
  crmKioskRelease:   async (data) => releaseCoupon(data, await branchForWrite(data)),
  crmKioskRedeem:    async (data) => redeemReward(data, await branchForWrite(data), true),
  crmKioskCancelRedeem: async (data) => cancelRedeem(data, await branchForWrite(data), true)
};

// คำสั่งอ่านที่ไม่ได้อยู่ใน read.handleGet (ของเบ็ดเตล็ด/ของที่ใช้ตรวจระบบ)
async function handleExtraGet(action, params = {}) {
  switch (action) {
    case 'getBOM':            return await getBomRows();
    // รหัสถัดไปสำหรับเมนู/หมวดหมู่ที่กำลังจะสร้าง (HL00001, HL00002, …)
    // หน้าหลังบ้านเรียกตอนกดเพิ่มรายการใหม่ เพื่อให้รหัสเดินต่อจากของเดิมเสมอ
    case 'nextId':            return { success: true, ids: await nextIds(query, Math.min(50, Math.max(1, Number(params.count) || 1))) };
    case 'getSalesReport':    return await generateSalesReport();
    case 'getKioskPayment':         return await getKioskPayment(params);
    case 'getPendingKioskPayments': return await getPendingKioskPayments(params);
    case 'getPrintQueue':     return await getPrintQueue(params);
    case 'getCrmStatus':      return { success: true, ...(await crmStatus()) };
    case 'getTaxInvoices':    return { success: true, invoices: await listTaxInvoices() };
    case 'getTaxCustomers':   return { success: true, customers: await listTaxCustomers() };
    case 'getStock':          return await getStockLevels(String(params.branch || '').trim());
    case 'getIngredients':    return await getIngredientsList();
    case 'resetAllSheetData': return await admin.resetAllSheetData();
    case 'clearSalesData':    return await admin.clearSalesData();
    // ของเดิมมี initSheets ไว้สร้างชีทที่ขาด — ตอนนี้โครงตารางสร้างด้วย db/schema.sql
    case 'initSheets':        return { success: true, message: 'ตารางอยู่ใน Supabase แล้ว (schema dbo)' };
    default: return null;
  }
}

// เช็กว่า API ที่หน้าเว็บเรียกอยู่เป็นโค้ดตัวไหน และต่อฐานข้อมูลได้จริงไหม
// เปิด <URL>?action=ping ในเบราว์เซอร์แล้วดูผลได้เลย
async function ping() {
  const out = { success: true, build: BUILD, backend: 'supabase', crm: !!env('CRM_URL') };
  try {
    const res = await query('SELECT COUNT(*) AS n FROM dbo.Menu');
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

// ip = เครื่องที่ส่งคำขอมา (ใช้นับจำนวนครั้งค้นหาสมาชิกต่อเครื่อง) — ส่งมาจาก server ไม่รับจาก body
export async function route({ method, params = {}, body, ip = '' }) {
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
    data._ip = String(ip || '').slice(0, 64);
    const auth = await authorize(action, token, data, null);
    if (!auth.ok) return auth.response;
    const result = await handler(data);
    if (MENU_ACTIONS.has(action) && result && result.success !== false) syncMenuToCrm().catch(() => {});   // CRM ใช้เลือกของฟรี/เงื่อนไขสินค้าในคูปอง
    if (action === 'saveSettings') clearEnforceCache(); // เปิด/ปิดบังคับล็อกอินมีผลทันที
    return result;
  }

  return { success: false, error: 'Method not allowed' };
}
