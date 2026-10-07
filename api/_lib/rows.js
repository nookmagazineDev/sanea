// แปลงแถวจาก SQL Server ให้หน้าตาเหมือนแถวที่เคยอ่านจาก Google Sheet
//
// ของเดิม (getSheetDataAsObjects ใน Apps Script) มีพฤติกรรมเฉพาะตัวที่หน้าบ้านพึ่งพาอยู่:
//   • ช่องว่างในชีทคืนค่าเป็น '' ไม่ใช่ null   → หน้าบ้านเช็ก `if (!row.CompletionTime)` ได้เหมือนเดิม
//   • ข้อความที่ขึ้นต้นด้วย [ หรือ { ถูก JSON.parse ให้อัตโนมัติ (prices, popupConfig, items ฯลฯ)
//   • เลขที่พิมพ์ลงชีทกลายเป็น number, TRUE/FALSE กลายเป็น boolean
// ฟังก์ชันด้านล่างทำให้ครบทั้งสามข้อ เพื่อให้ย้ายฐานข้อมูลแล้วหน้าบ้านไม่ต้องแก้

// ชนิดคอลัมน์: s=ข้อความ n=ตัวเลข b=true/false j=ข้อความ JSON i=รหัส (เป็นเลขล้วนให้คืนเป็น number)
const EMPTY = '';

export const asText = (v) => (v === null || v === undefined ? EMPTY : String(v));
export const asNum  = (v) => (v === null || v === undefined || v === '' ? EMPTY : Number(v));
export const asBool = (v) => (v === null || v === undefined ? EMPTY : Boolean(v));

// เลขในชีทถูกเก็บเป็นตัวเลขจริง ไม่ใช่ข้อความ — id ที่สร้างจาก Date.now() จึงกลับมาเป็น number
// หน้าบ้านบางจุดเทียบ id แบบ === จึงต้องคงชนิดเดิมไว้
export const asId = (v) => {
  if (v === null || v === undefined) return EMPTY;
  const s = String(v);
  if (/^-?\d{1,15}$/.test(s)) return Number(s);
  return s;
};

export const asJson = (v) => {
  if (v === null || v === undefined) return EMPTY;
  const s = String(v).trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
};

const MAPPERS = { s: asText, n: asNum, b: asBool, j: asJson, i: asId };

// สร้างฟังก์ชันแปลงแถวจากรายการคอลัมน์ เช่น rowMapper({ id: 'i', price: 'n' })
export function rowMapper(spec) {
  const entries = Object.entries(spec);
  return (row) => {
    const out = {};
    for (const [col, kind] of entries) out[col] = MAPPERS[kind](row[col]);
    return out;
  };
}

// ค่าที่เขียนลง SQL — ฝั่งตรงข้ามของ asText/asNum
export const toText = (v) => (v === undefined || v === null || v === '' ? null : String(v));
export const toNum  = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const toBit  = (v) => (v === undefined || v === null || v === '' ? null : (v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' ? 1 : 0));
// ฟิลด์ที่ชีทเก็บเป็นข้อความ JSON — รับได้ทั้ง object และข้อความที่ stringify มาแล้ว
export const toJson = (v, fallback = null) => {
  if (v === undefined || v === null || v === '') return fallback;
  return typeof v === 'string' ? v : JSON.stringify(v);
};

// ── รายการคอลัมน์ของแต่ละตาราง (ตรงกับหัวตารางชีทเดิม) ──
export const ORDER_COLUMNS = ['Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount', 'Status', 'OrderStartTime', 'CompletionTime', 'RecordedBy', 'Quantity'];

export const mapOrder = rowMapper({
  Timestamp: 's', OrderNumber: 's', CustomerName: 's', Address: 's', ItemDetail: 's',
  DiningOption: 's', Price: 'n', TotalAmount: 'n', Status: 's', OrderStartTime: 's',
  CompletionTime: 's', RecordedBy: 's', Quantity: 'n'
});

export const mapTableOrder = rowMapper({
  TableNumber: 's', SessionId: 's', ItemName: 's', ItemNameEn: 's', ItemPrice: 'n',
  Quantity: 'n', Options: 's', Timestamp: 's', Status: 's', RecordedBy: 's'
});

export const mapMenu = rowMapper({
  id: 'i', category: 's', name: 's', nameEn: 's', description: 's', descriptionEn: 's',
  price: 'n', image: 's', isActive: 'b', bundledItems: 'j', popupConfig: 'j', prices: 'j',
  categories: 'j', printerId: 's', branches: 'j'
});

export const mapPromotion = rowMapper({ id: 'i', name: 's', nameEn: 's', price: 'n', origPrice: 'n' });

export const mapUser = rowMapper({ id: 'i', username: 's', pin: 's', canCheckout: 'b', isAdmin: 'b', isCashier: 'b', branch: 's' });

export const mapBranch = rowMapper({
  id: 's', name: 's', billPrefix: 's', phone: 's', address: 's', taxId: 's', receiptFooter: 's', posId: 's', isActive: 'b'
});

export const mapPrinter = rowMapper({ id: 's', name: 's', ip: 's', type: 's', printMode: 's', branchId: 's', categories: 'j' });

export const mapDiscount = rowMapper({ id: 's', name: 's', type: 's', value: 'n', categories: 'j' });

export const mapLiquor = rowMapper({
  timestamp: 's', type: 's', customerName: 's', phone: 's', productName: 's',
  qty: 'n', note: 's', staff: 's', category: 's', unit: 's'
});

export const mapWaste = rowMapper({
  timestamp: 's', branch: 's', itemName: 's', category: 's', qty: 'n', unit: 's', note: 's', staff: 's',
  kind: 's', itemType: 's'
});

export const mapApproval = rowMapper({
  id: 's', timestamp: 's', tableNo: 's', orderNumber: 's', amount: 'n',
  requestedBy: 's', status: 's', approver: 's', respondedAt: 's'
});

export const mapOutstanding = rowMapper({
  id: 's', shiftId: 's', tableNo: 's', customerName: 's', phone: 's',
  total: 'n', items: 'j', createdAt: 's', status: 's'
});

export const mapShift = rowMapper({
  id: 's', openTime: 's', closeTime: 's', openStaff: 's', closeStaff: 's', openCash: 'n',
  closeCash: 'n', totalSales: 'n', totalCash: 'n', totalCard: 'n', totalTransfer: 'n',
  totalOrders: 'n', status: 's', note: 's'
});

export const mapPayment = rowMapper({
  timestamp: 's', orderNumber: 's', tableNo: 's', paymentMethod: 's',
  grandTotal: 'n', staff: 's', shiftId: 's', splitDetail: 's'
});

// หมวดหมู่มีชุดป๊อปอัพ 6 ชุด ชุดละ 7 คอลัมน์ — สร้าง spec แบบวนลูปแทนการพิมพ์ซ้ำ
const categorySpec = { slug: 's', name: 's', nameEn: 's', icon: 's', isActive: 'b' };
for (let i = 1; i <= 6; i++) {
  categorySpec[`hasPopup${i}`]      = 'b';
  categorySpec[`popup${i}Category`] = 's';
  categorySpec[`popup${i}Items`]    = 'j';
  categorySpec[`popup${i}Min`]      = 'n';
  categorySpec[`popup${i}Max`]      = 'n';
  categorySpec[`popup${i}ItemsMax`] = 'j';
  categorySpec[`popup${i}Free`]     = 'b';
}
categorySpec.hasDining = 'b';
// ใครเห็นหมวดนี้: '' / 'all' = ทั้งพนักงานและลูกค้า · 'staff' = เฉพาะหน้าพนักงาน · 'customer' = เฉพาะหน้าลูกค้าสั่งเอง
categorySpec.visibility = 's';
export const CATEGORY_SPEC = categorySpec;
export const mapCategory = rowMapper(categorySpec);
