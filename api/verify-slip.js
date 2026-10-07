// ตรวจสลิปโอนเงินผ่าน SlipOK — ทำงานฝั่งเซิร์ฟเวอร์ (Vercel Function)
//
// ทำไมต้องผ่านตัวกลางนี้ ไม่ยิงจากหน้าเว็บตรง ๆ:
//   1. API KEY จะโผล่ในโค้ดหน้าเว็บ ใครสแกน QR เข้ามาก็เปิดดูและเอาไปใช้จนโควตาหมดได้
//   2. SlipOK ไม่ได้เปิด CORS ให้เบราว์เซอร์เรียกข้ามโดเมน
//
// ตั้งค่าใน Vercel (Settings → Environment Variables) เพื่อไม่ให้คีย์อยู่ในโค้ด:
//   SLIPOK_API_KEY, SLIPOK_BRANCH_ID
const SLIPOK_ENDPOINT = 'https://api.slipok.com/api/line/apikey';

export default async function handler(req, res) {
  const apiKey   = process.env.SLIPOK_API_KEY || 'SLIPOKDP6B53D';
  const branchId = process.env.SLIPOK_BRANCH_ID || '74167';

  // เปิด /api/verify-slip ในเบราว์เซอร์เพื่อเช็กว่าฟังก์ชันถูก deploy แล้วจริง
  // (ไม่เปิดเผยคีย์ บอกแค่ว่ามีคีย์อยู่หรือไม่)
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'slipok-verify',
      branchId,
      hasApiKey: !!apiKey,
      keyFrom: process.env.SLIPOK_API_KEY ? 'env' : 'fallback-in-code'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { base64, mimeType, amount } = req.body || {};
    if (!base64) {
      return res.status(400).json({ success: false, message: 'ไม่พบไฟล์สลิป' });
    }

    const bytes = Buffer.from(String(base64), 'base64');
    // สลิปปกติไม่เกินหลักร้อย KB — ถ้าเกิน 5MB แปลว่าผิดปกติ ตัดทิ้งก่อนยิงออกไป
    if (bytes.length > 5 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: 'ไฟล์สลิปใหญ่เกินไป' });
    }

    const form = new FormData();
    form.append('files', new Blob([bytes], { type: mimeType || 'image/jpeg' }), 'slip.jpg');
    // ส่งยอดไปด้วย ให้ SlipOK เทียบยอดในสลิปกับยอดที่ต้องจ่ายให้เอง (ยอดไม่ตรงจะได้ code 1013)
    if (amount !== undefined && amount !== null && amount !== '') form.append('amount', String(amount));
    form.append('log', 'true'); // เก็บประวัติไว้ในระบบ SlipOK เผื่อไล่ตรวจย้อนหลัง

    const upstream = await fetch(`${SLIPOK_ENDPOINT}/${branchId}`, {
      method: 'POST',
      headers: { 'x-authorization': apiKey },
      body: form
    });

    const text = await upstream.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { success: false, message: text || 'SlipOK ตอบกลับไม่ใช่ JSON' }; }

    // ส่งสถานะจริงกลับไป หน้าเว็บจะได้แยกออกว่าสลิปไม่ผ่าน (400) กับระบบล่ม (500) คนละกรณี
    return res.status(upstream.status).json(json);
  } catch (err) {
    console.error('verify-slip error:', err);
    return res.status(500).json({ success: false, message: 'เชื่อมต่อระบบตรวจสลิปไม่ได้: ' + (err.message || err) });
  }
}
