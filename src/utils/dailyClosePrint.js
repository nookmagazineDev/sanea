// ── พิมพ์รายงานปิดยอดประจำวันออกเครื่องพิมพ์ใบเสร็จ (กระดาษม้วน) ──
// รูปแบบใบอยู่ที่ print-ticket.js (printerType 'closeday') — เครื่องนี้ยังไม่ได้ตั้งเครื่องพิมพ์ ค่อยใช้หน้าต่างพิมพ์ของเบราว์เซอร์แทน
import { getPrinters, getPrinterByType } from './printerRouting';
import { sendPrintJob } from './printServer';
import { print80mm } from './print80mm';

// เลขบิล → ตัวนำหน้า + ลำดับ (XXX-#031 → { prefix: 'XXX', seq: 31 })
const splitBillNo = (no) => {
  const m = /^(.*?)-?#?(\d+)\s*$/.exec(String(no || '').trim());
  return m ? { prefix: m[1], seq: parseInt(m[2], 10) } : { prefix: String(no || ''), seq: NaN };
};

// ใบแรก/ใบสุดท้ายแยกตามตัวนำหน้าเลขบิล (หลายสาขา หรือบิลเก่าชุด SELF ในช่วงที่เลือก) — นับทั้งบิลปกติและบิลที่ยกเลิก
// เพราะเลขที่ถูกใช้ไปแล้วทั้งคู่
export const billRanges = (numbers) => {
  const groups = new Map();
  [...new Set(numbers.filter(Boolean))].forEach(no => {
    const { prefix, seq } = splitBillNo(no);
    const g = groups.get(prefix) || [];
    g.push({ no, seq });
    groups.set(prefix, g);
  });
  return [...groups.values()].map(list => {
    list.sort((a, b) => (isNaN(a.seq) ? Infinity : a.seq) - (isNaN(b.seq) ? Infinity : b.seq));
    return { first: list[0].no, last: list[list.length - 1].no, count: list.length };
  });
};

// ยอดขายถือว่ารวม VAT แล้ว — สูตรเดียวกับใบกำกับภาษี (api/_lib/taxInvoice.js)
export const vatSplit = (total, rate) => {
  const r = Number(rate) > 0 ? Number(rate) : 7;
  const vatable = Math.round(total * 100 / (100 + r) * 100) / 100;
  return { vatRate: r, vatable, vat: Math.round((total - vatable) * 100) / 100 };
};

const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ใบเดียวกับที่ Print Server พิมพ์ สำหรับพิมพ์ผ่านเบราว์เซอร์
export const dailyCloseHtml = (r) => {
  const line = (k, v, cls = '') => `<div class="row ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
  return `
    ${r.shopName ? `<div class="c lg">${esc(r.shopName)}</div>` : ''}
    ${r.taxId ? `<div class="c sm">เลขผู้เสียภาษี ${esc(r.taxId)}</div>` : ''}
    ${r.posId ? `<div class="c sm">POS ID: ${esc(r.posId)}</div>` : ''}
    <div class="hr"></div>
    <div class="c b">รายงานปิดยอดประจำวัน</div>
    <div class="c sm">DAILY CLOSE REPORT</div>
    <div class="hr"></div>
    ${line('วันที่ขาย', r.dateLabel)}
    ${line('สาขา', r.branchLabel)}
    ${line('พิมพ์เมื่อ', r.printedAt)}
    ${r.printedBy ? line('ผู้พิมพ์', r.printedBy) : ''}
    <div class="hr"></div>
    ${line('จำนวนบิล', `${r.billCount} บิล`)}
    ${line('ยอดขายรวม', money2(r.total), 'b')}
    ${line('ส่วนลด', money2(r.discount))}
    ${r.charges ? line('ค่าบริการ/ภาษีบวกเพิ่ม', money2(r.charges)) : ''}
    ${line('มูลค่าสินค้าเสียภาษี', money2(r.vatable))}
    ${line(`ภาษีมูลค่าเพิ่ม ${r.vatRate}%`, money2(r.vat))}
    <div class="hr"></div>
    <div class="b">ช่องทางชำระเงิน</div>
    ${line('เงินสด', money2(r.cash))}
    ${line('เงินโอน / QR', money2(r.transfer))}
    ${line('บัตรเครดิต', money2(r.card))}
    <div class="hr"></div>
    <div class="b">เลขที่ใบกำกับภาษีอย่างย่อ</div>
    ${(r.ranges && r.ranges.length ? r.ranges : [{ first: '-', last: '-' }]).map(g => line('ใบแรก', g.first) + line('ใบสุดท้าย', g.last)).join('')}
    <div class="hr"></div>
    ${line(`บิลยกเลิก ${r.cancelCount} บิล`, money2(r.cancelTotal))}
    <div class="hr"></div>
    <div class="b">ยอดขายตามเมนู</div>
    ${(r.menu || []).map(m => line(`${m.qty}x ${m.name}`, money2(m.revenue))).join('')}
    <div class="hr"></div>
    <div style="margin-top:14px">ผู้ตรวจนับเงิน ________________</div>
  `;
};

// คืน { success, error }
export const printDailyClose = async (report) => {
  const printers = getPrinters();
  const printer = getPrinterByType('receipt', printers) || printers.find(p => p.ip) || null;
  if (!printer || !printer.ip) {
    print80mm(dailyCloseHtml(report));
    return { success: true };
  }
  return await sendPrintJob({ ip: printer.ip, printerType: 'closeday', orderData: { closeDay: report } });
};
