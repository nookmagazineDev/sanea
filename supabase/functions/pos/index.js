// ปลายทางเดียวของระบบ POS เสน่ห์ บน Supabase Edge Functions
//
//   GET  https://<project>.supabase.co/functions/v1/pos?action=getLive
//   POST https://<project>.supabase.co/functions/v1/pos      body: { "action": "insertOrder", ... }
//
// รูปแบบคำขอ/คำตอบเหมือน Google Apps Script เดิมทุกอย่าง หน้าเว็บจึงเปลี่ยนแค่ที่อยู่ API
// สิทธิ์ตรวจเองด้วย token ของระบบ (ล็อกอินพนักงาน) — ฟังก์ชันนี้ deploy แบบ verify_jwt = false
import { route } from './_lib/router.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Cache-Control': 'no-store'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  try {
    const params = Object.fromEntries(url.searchParams.entries());
    const ip = String(req.headers.get('cf-connecting-ip') || String(req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
    const body = req.method === 'POST' ? await req.text() : undefined;
    const result = await route({ method: req.method, params, body, ip });
    return json(result);
  } catch (err) {
    console.error('[pos]', req.method, url.searchParams.get('action') || '', err);
    // ตอบเป็น JSON เสมอ — หน้าบ้านอ่าน success/error จากตัวนี้เพื่อเก็บบิลไว้ส่งซ้ำ
    return json({ success: false, error: String((err && err.message) || err) }, 500);
  }
});
