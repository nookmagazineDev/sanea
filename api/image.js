// เสิร์ฟรูปเมนู/สลิปที่เก็บไว้ในตาราง Images (แทนลิงก์ Google Drive เดิม)
//   /api/image?id=menu-1757000000000-ab12cd
import { query } from './_lib/db.js';

export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || '');
  if (!id) return res.status(400).json({ success: false, error: 'ไม่ได้ระบุ id ของรูป' });

  try {
    const result = await query('SELECT mimeType, bytes FROM dbo.Images WHERE id = @id', { id });
    if (!result.recordset.length) return res.status(404).json({ success: false, error: 'ไม่พบรูปนี้' });

    const row = result.recordset[0];
    res.setHeader('Content-Type', row.mimeType || 'image/jpeg');
    // รูปหนึ่ง id ไม่เคยถูกเขียนทับ (อัปใหม่ = id ใหม่) จึงแคชยาวได้
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(Buffer.from(row.bytes));
  } catch (err) {
    console.error('[image]', id, err);
    return res.status(500).json({ success: false, error: String(err.message || err) });
  }
}
