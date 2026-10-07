// ── พิมพ์ใบกำกับภาษีเต็มรูปออกเครื่องพิมพ์ใบเสร็จ (กระดาษม้วน) ผ่าน Print Server ──
// รูปแบบใบอยู่ที่ print-ticket.js (printerType 'taxinvoice') — หน้าเว็บส่งข้อมูลใบ + ยอดเป็นตัวอักษรไป
import { getPrinters, getPrinterByType } from './printerRouting';
import { sendPrintJob } from './printServer';


const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

// จำนวนเต็มเป็นคำอ่านไทย (รองรับเกินล้านด้วยการแบ่งทีละ 6 หลัก)
// afterMillion: หลักหน่วยที่เป็น 1 หลังคำว่า "ล้าน" อ่าน "เอ็ด" (หนึ่งล้านเอ็ด)
const readInt = (n, afterMillion = false) => {
  if (n === 0) return '';
  if (n >= 1000000) return readInt(Math.floor(n / 1000000)) + 'ล้าน' + readInt(n % 1000000, true);
  if (n === 1 && afterMillion) return 'เอ็ด';
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - i - 1;
    if (d === 0) continue;
    if (place === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else out += DIGITS[d] + PLACES[place];
  }
  return out;
};

export const bahtText = (amount) => {
  const satang = Math.round(Math.abs(Number(amount) || 0) * 100);
  const baht = Math.floor(satang / 100);
  const st = satang % 100;
  if (baht === 0 && st === 0) return 'ศูนย์บาทถ้วน';
  return (baht ? readInt(baht) + 'บาท' : '') + (st ? readInt(st) + 'สตางค์' : 'ถ้วน');
};

// คืน { success, error } — ใช้เครื่องประเภทใบเสร็จของเครื่องนี้ ไม่มีก็ใช้เครื่องแรกที่มี IP
export const printTaxInvoice = async (inv, { copy = false } = {}) => {
  const printers = getPrinters();
  const printer = getPrinterByType('receipt', printers) || printers.find(p => p.ip) || null;
  if (!printer || !printer.ip) {
    return { success: false, error: 'ยังไม่ได้ตั้งเครื่องพิมพ์ใบเสร็จในเครื่องนี้ — ไปที่ หลังบ้าน > ปริ้นเตอร์' };
  }
  return await sendPrintJob({
    ip: printer.ip,
    printerType: 'taxinvoice',
    orderData: { taxInvoice: { ...inv, amountText: bahtText(inv.total) }, copy }
  });
};
