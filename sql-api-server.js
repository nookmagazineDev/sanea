// รัน API ของ POS เป็นเซิร์ฟเวอร์ของตัวเอง — สำหรับกรณีที่ไม่ได้ deploy บน Vercel
// เช่นตั้งไว้ที่เครื่องออฟฟิศเครื่องเดียวกับ SQL Server แล้วให้หน้าเว็บชี้มาที่นี่
//
//   node --env-file=.env sql-api-server.js
//   (หรือ npm run api:serve)
//
// จากนั้น build หน้าเว็บด้วย VITE_API_URL=http://<ip เครื่องนี้>:8081/api/pos
import express from 'express';
import cors from 'cors';
import { route } from './api/_lib/router.js';
import { query } from './api/_lib/db.js';

const app = express();
const PORT = Number(process.env.API_PORT || 8081);

// เปิดออกอินเทอร์เน็ตผ่าน Tunnel = ใครก็ยิงมาได้ จำกัดโดเมนที่เบราว์เซอร์เรียกได้ด้วย API_ALLOW_ORIGIN
// (ไม่ตั้ง = อนุญาตทุกโดเมนเหมือนเดิม — Print Server กับเครื่องในร้านยังเรียกได้ตามปกติ)
const allowOrigin = String(process.env.API_ALLOW_ORIGIN || '').trim();
app.use(cors(allowOrigin ? { origin: allowOrigin.split(',').map(s => s.trim()).filter(Boolean) } : {}));
// หน้าบ้านส่ง Content-Type: text/plain มาตั้งแต่ยุค GAS — ต้องรับทั้งสองแบบ
app.use(express.json({ limit: '12mb' }));
app.use(express.text({ type: 'text/*', limit: '12mb' }));

app.all('/api/pos', async (req, res) => {
  try {
    const result = await route({ method: req.method, params: req.query, body: req.body });
    res.set('Cache-Control', 'no-store').json(result);
  } catch (err) {
    console.error('[pos]', req.method, req.query.action || '', err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

app.get('/api/image', async (req, res) => {
  try {
    const result = await query('SELECT mimeType, bytes FROM dbo.Images WHERE id = @id', { id: String(req.query.id || '') });
    if (!result.recordset.length) return res.status(404).json({ success: false, error: 'ไม่พบรูปนี้' });
    res.set('Content-Type', result.recordset[0].mimeType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(result.recordset[0].bytes));
  } catch (err) {
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`POS API พร้อมใช้งานที่ http://localhost:${PORT}/api/pos`);
  console.log(`ทดสอบการต่อฐานข้อมูล: http://localhost:${PORT}/api/pos?action=ping`);
});
