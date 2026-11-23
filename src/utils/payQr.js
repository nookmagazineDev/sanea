// QR สแกนจ่ายท้ายใบแจ้งยอด — ใช้การตั้งค่า QR ของสาขาชุดเดียวกับหน้าชำระเงินและหน้าลูกค้าสั่งเอง (หลังบ้าน > ตั้งค่าร้าน)
//   kshop_dynamic / dynamic (พร้อมเพย์) → QR ใส่ยอดเงินให้แล้ว ลูกค้าไม่ต้องพิมพ์ยอด
//   แบบอื่น (รูป QR คงที่) → พิมพ์รูป QR เดิม ลูกค้าพิมพ์ยอดเอง
// คืนรูป PNG ขาว-ดำขนาดพอดีกระดาษ (Print Server พิมพ์ด้วย printImageBuffer แบบเดียวกับโลโก้)
import QRCode from 'qrcode';
import { generatePromptPayPayload, generateDynamicQRFromRaw } from './promptpay';
import { makePrintLogo } from './receiptStyle';

const QR_DOTS = { 80: 320, 58: 256 };
// ค่าเริ่มต้นชุดเดียวกับหน้าชำระเงิน (CheckoutModal) — ร้านที่ยังไม่ได้ตั้ง QR ในหลังบ้านใช้ QR K SHOP ของร้านตัวนี้
const DEFAULT_KSHOP = '00020101021130810016A00000067701011201150107536000315080214KB0000016416840320KPS004KB00000164168431690016A00000067701011301030040214KB0000016416840420KPS004KB00000164168453037645802TH6304A14E';
const DEFAULT_PROMPTPAY = '004000001641684';

export async function makePayQr(settings, amount, paper = 80) {
  const total = Math.round((Number(amount) || 0) * 100) / 100;
  if (!settings || !(total > 0)) return null;
  const width = QR_DOTS[Number(paper) === 58 ? 58 : 80];
  const qrType = settings.qrType || 'kshop_dynamic';
  const shop = settings.qrShopName || settings.qrAccountName || 'เสน่ห์';
  if (qrType === 'kshop_dynamic' || qrType === 'dynamic') {
    const payload = qrType === 'kshop_dynamic'
      ? generateDynamicQRFromRaw(settings.kshopRawPayload || DEFAULT_KSHOP, total)
      : generatePromptPayPayload(settings.promptPayId || DEFAULT_PROMPTPAY, total);
    if (!payload) return null;
    const image = await QRCode.toDataURL(payload, { width, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    return { image, amount: total, dynamic: true, shop };
  }
  const image = await makePrintLogo(settings.staticQrUrl || '/kshop_qr.png', width, 160);
  return { image, amount: total, dynamic: false, shop };
}
