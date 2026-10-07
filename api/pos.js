// ปลายทางเดียวของระบบ POS — แทนที่ Google Apps Script /exec เดิม
//
//   GET  /api/pos?action=getLive
//   POST /api/pos           body: { "action": "insertOrder", ... }
//
// รูปแบบคำขอ/คำตอบเหมือนของเดิมทั้งหมด เปลี่ยนแค่ปลายทางที่หน้าบ้านยิงไป
import { route } from './_lib/router.js';

// หมายเหตุ: เมื่อ deploy บน Vercel ตัว body ของคำขอถูกจำกัดไว้ที่ ~4.5MB
// รูปที่หน้าบ้านส่งมาถูกย่อเหลือด้านยาวสุด 1000px ก่อนแล้ว จึงอยู่ในเพดานนี้สบาย ๆ
export default async function handler(req, res) {
  // เปิดข้ามโดเมนไว้ เผื่อกรณีหน้าเว็บอยู่คนละที่กับ API (เช่นเว็บบน Vercel + API ที่ออฟฟิศ)
  res.setHeader('Access-Control-Allow-Origin', process.env.API_ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const params = req.query || {};
    const result = await route({ method: req.method, params, body: req.body });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[pos]', req.method, (req.query && req.query.action) || '', err);
    // ตอบเป็น JSON เสมอ — หน้าบ้านอ่าน success/error จากตัวนี้เพื่อเก็บบิลไว้ส่งซ้ำ
    return res.status(500).json({ success: false, error: String(err.message || err) });
  }
}
