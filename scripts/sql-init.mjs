// สร้าง/อัปเดตโครงสร้างตารางบน SQL Server จากไฟล์ db/schema.sql
//
//   node --env-file=.env scripts/sql-init.mjs
//   (หรือ npm run sql:init ถ้ามีไฟล์ .env อยู่แล้ว)
//
// รันซ้ำได้ — ตารางที่มีอยู่แล้วจะถูกข้าม ไม่มีการลบข้อมูล
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, explainConnectError } from '../api/_lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

const run = async () => {
  const sqlText = fs.readFileSync(schemaPath, 'utf8');
  // GO ไม่ใช่คำสั่ง T-SQL แต่เป็นตัวคั่นชุดคำสั่งของเครื่องมือ — ต้องหั่นเองก่อนส่งให้ไดรเวอร์
  const batches = sqlText
    .split(/^\s*GO\s*$/mi)
    .map(b => b.trim())
    .filter(Boolean);

  const pool = await getPool();
  console.log(`เชื่อมต่อ ${process.env.SQL_SERVER || 'localhost'} / ${process.env.SQL_DATABASE || 'SaneaPOS'} แล้ว`);

  let done = 0;
  for (const batch of batches) {
    try {
      await pool.request().batch(batch);
      done++;
    } catch (err) {
      console.error(`\n❌ คำสั่งที่ ${done + 1} ล้มเหลว:\n${batch.slice(0, 200)}...\n${err.message}`);
      throw err;
    }
  }
  console.log(`✅ สร้าง/ตรวจสอบโครงสร้างครบ ${done} ชุดคำสั่ง`);
  await pool.close();
};

run().catch(err => { console.error('\n' + explainConnectError(err)); process.exit(1); });
