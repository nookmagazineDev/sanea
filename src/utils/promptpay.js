// สร้าง payload มาตรฐาน PromptPay (EMVCo) สำหรับทำ QR ชำระเงิน
// รองรับเบอร์มือถือ / เลขบัตรประชาชน(13หลัก) / เลขผู้เสียภาษี และใส่ยอดเงินได้

// ฟิลด์รูปแบบ TLV: id(2) + length(2) + value
const field = (id, value) => {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
};

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — ใช้ปิดท้าย payload
const crc16 = (data) => {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

// target = เบอร์มือถือ หรือ เลขบัตร/เลขผู้เสียภาษี ; amount = ยอดเงิน (บาท, ไม่ใส่ก็ได้)
export function generatePromptPayPayload(target, amount) {
  const id = String(target || '').replace(/[^0-9]/g, '');
  const amt = Number(amount);
  const hasAmount = Number.isFinite(amt) && amt > 0;

  // 15 หลัก = e-Wallet ID (tag 29 sub-tag 03), 13 หลัก = เลขบัตรประชาชน/เลขผู้เสียภาษี (tag 29 sub-tag 02), ไม่งั้นเป็นเบอร์มือถือ (tag 29 sub-tag 01)
  let acctTarget;
  if (id.length === 15) {
    acctTarget = field('03', id);
  } else if (id.length === 13) {
    acctTarget = field('02', id);
  } else {
    acctTarget = field('01', ('0000000000000' + id.replace(/^0/, '66')).slice(-13));
  }

  const merchantAccount = field('29', field('00', 'A000000677010111') + acctTarget);

  let payload =
    field('00', '01') +                          // Payload Format Indicator
    field('01', hasAmount ? '12' : '11') +        // 12 = dynamic (มียอด), 11 = static
    merchantAccount +                             // PromptPay merchant account
    field('53', '764') +                          // สกุลเงิน THB
    (hasAmount ? field('54', amt.toFixed(2)) : '') + // ยอดเงิน
    field('58', 'TH');                            // ประเทศ

  payload += '6304'; // CRC tag + length
  return payload + crc16(payload);
}

// สร้าง Dynamic QR code จาก raw payload เดิม (เช่น K Shop QR code) โดยการแก้ไขยอดเงินและคำนวณ CRC ใหม่
export function generateDynamicQRFromRaw(rawQr, amount) {
  if (!rawQr) return '';
  
  const tags = {};
  let index = 0;
  
  // แกะข้อมูล TLV ใน raw QR String
  while (index < rawQr.length) {
    if (index + 4 > rawQr.length) break;
    const tag = rawQr.slice(index, index + 2);
    const len = parseInt(rawQr.slice(index + 2, index + 4), 10);
    if (isNaN(len)) break;
    const val = rawQr.slice(index + 4, index + 4 + len);
    tags[tag] = val;
    index += 4 + len;
  }

  // รักษาค่า tag 01 เป็น 11 (Static QR) เสมอ เพื่อให้แอปธนาคารไทยส่วนใหญ่สแกน Bill Payment ผ่านได้สำเร็จ
  tags['01'] = '11';

  // อัปเดตยอดเงินใน tag 54
  const amt = Number(amount);
  if (Number.isFinite(amt) && amt > 0) {
    tags['54'] = amt.toFixed(2);
  } else {
    delete tags['54'];
    tags['01'] = '11'; // ถ้าไม่มียอดเงินให้เป็น static
  }

  // ลบ CRC tag เก่าทิ้งเพื่อคำนวณใหม่
  delete tags['63'];

  // ประกอบข้อความใหม่ตามลำดับ tag จากน้อยไปมาก
  let payload = '';
  const sortedKeys = Object.keys(tags).sort();
  for (const key of sortedKeys) {
    payload += field(key, tags[key]);
  }

  // แนบ CRC tag + length
  payload += '6304';
  
  // คืนค่า QR payload พร้อม CRC ใหม่
  return payload + crc16(payload);
}

// ฟังก์ชันแกะข้อมูล Reference 1 และ Reference 2 จาก K Shop QR payload
export function parseKShopPayload(rawQr) {
  if (!rawQr) return null;
  const tags = {};
  let index = 0;
  try {
    while (index < rawQr.length) {
      if (index + 4 > rawQr.length) break;
      const tag = rawQr.slice(index, index + 2);
      const len = parseInt(rawQr.slice(index + 2, index + 4), 10);
      if (isNaN(len)) break;
      const val = rawQr.slice(index + 4, index + 4 + len);
      tags[tag] = val;
      index += 4 + len;
    }
    
    let ref1 = '';
    let ref2 = '';
    const tag30 = tags['30'];
    if (tag30) {
      let t30Idx = 0;
      while (t30Idx < tag30.length) {
        const subtag = tag30.slice(t30Idx, t30Idx + 2);
        const sublen = parseInt(tag30.slice(t30Idx + 2, t30Idx + 4), 10);
        if (isNaN(sublen)) break;
        const subval = tag30.slice(t30Idx + 4, t30Idx + 4 + sublen);
        if (subtag === '02') ref1 = subval;
        if (subtag === '03') ref2 = subval;
        t30Idx += 4 + sublen;
      }
    }
    return { ref1, ref2 };
  } catch (e) {
    return null;
  }
}

