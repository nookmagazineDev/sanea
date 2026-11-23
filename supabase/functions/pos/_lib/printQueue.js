// ── คิวงานพิมพ์: มือถือ/แท็บเล็ตสั่งพิมพ์ผ่าน API ──
//
// หน้าเว็บ (https) ยิงตรงเข้า Print Server ในวงแลนไม่ได้ (เบราว์เซอร์บล็อก) เว้นแต่เปิดหน้าเว็บบนเครื่องเดียวกัน
// มือถือ/แท็บเล็ตจึงฝากงานไว้ที่นี่แทน แล้ว Print Server ของสาขามาดึงไปพิมพ์เอง:
//
//   1) หน้าเว็บ  → enqueuePrint            (status: pending)
//   2) Print Server → claimPrintJobs ทุก ~3 วิ (pending → printing) — ต้องมีกุญแจของสาขา
//   3) Print Server พิมพ์ → reportPrintJob  (printing → done / failed พร้อมขั้นตอนที่ติด)
//   4) หน้าเว็บดึง getPrintQueue?ids=… จนได้ผล แล้วขึ้นสถานะเหมือนพิมพ์ตรง
//
// งานที่ไม่มีใครมารับใน 10 นาที = หมดอายุ ไม่ให้ใบครัวเก่าพ่นออกมาทีหลังตอน Print Server เพิ่งเปิด
import crypto from 'node:crypto';
import { query } from './db.js';
import { branchForWrite, defaultBranchId } from './branch.js';
import { deriveKey } from './auth.js';
import { Buffer } from 'node:buffer';

const PENDING_TTL_MIN = 10;     // ไม่มี Print Server มารับภายในนี้ = หมดอายุ
const PRINTING_TTL_MIN = 3;     // รับไปแล้วไม่รายงานผลภายในนี้ = ถือว่าไม่สำเร็จ
const KEEP_DAYS = 3;            // เก็บประวัติไว้ดูย้อนหลังกี่วัน
const AGENT_ONLINE_SEC = 90;    // Print Server ไม่มาดึงคิวนานเกินนี้ = ออฟไลน์
const HEARTBEAT_EVERY_SEC = 20; // บันทึกเวลาที่ Print Server มาดึงคิวทุก ๆ เท่านี้ (ไม่เขียนทุกรอบ)
const MAX_PENDING = 100;        // กันคิวล้น (เช่น Print Server ปิดแล้วมีคนกดพิมพ์รัว ๆ)
const MAX_PAYLOAD = 256 * 1024;
const MAX_CLAIM = 5;
const TYPES = new Set(['receipt', 'kitchen', 'prebill', 'taxinvoice', 'closeday']);

const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Supabase: ตาราง PrintJobs / PrintAgents สร้างไว้แล้วตั้งแต่แรก
const ensureTables = async () => {};

const branchOf = async (data) => (await branchForWrite(data)) || '';
const agentKey = (branchId) => deriveKey(`print-agent:${branchId}`);

const keyOk = async (branchId, key) => {
  const expected = await agentKey(branchId);
  if (typeof key !== 'string' || key.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
};

// ── งานบ้าน: หมดอายุ / ค้าง / ลบของเก่า ──
const housekeeping = async (branchId) => {
  await query(
    `UPDATE dbo.PrintJobs SET [Status] = 'expired', Stage = 'agent', FinishedAt = SYSUTCDATETIME(),
         Error = 'ไม่มี Print Server ในร้านมารับงานภายใน ${PENDING_TTL_MIN} นาที — ยกเลิกงานนี้แล้ว'
       WHERE BranchId = @b AND [Status] = 'pending' AND CreatedAt < SYSUTCDATETIME() - interval '${PENDING_TTL_MIN} minutes'`, { b: branchId });
  await query(
    `UPDATE dbo.PrintJobs SET [Status] = 'failed', Stage = 'agent', FinishedAt = SYSUTCDATETIME(),
         Error = 'Print Server รับงานไปแล้วแต่ไม่รายงานผล — ดูที่เครื่องพิมพ์ว่ากระดาษออกไหม'
       WHERE BranchId = @b AND [Status] = 'printing' AND ClaimedAt < SYSUTCDATETIME() - interval '${PRINTING_TTL_MIN} minutes'`, { b: branchId });
  await query(`DELETE FROM dbo.PrintJobs WHERE BranchId = @b AND CreatedAt < SYSUTCDATETIME() - interval '${KEEP_DAYS} days'`, { b: branchId });
};

const agentInfo = async (branchId) => {
  const res = await query(
    `SELECT Agent, Version, LastSeen, CAST(EXTRACT(EPOCH FROM (SYSUTCDATETIME() - LastSeen)) AS INT) AS ago FROM dbo.PrintAgents WHERE BranchId = @b`,
    { b: branchId }
  );
  const row = res.recordset[0];
  if (!row) return { online: false, lastSeen: null, secondsAgo: null, agent: '', version: '' };
  return {
    online: Number(row.ago) <= AGENT_ONLINE_SEC,
    lastSeen: row.LastSeen instanceof Date ? row.LastSeen.toISOString() : String(row.LastSeen || ''),
    secondsAgo: Number(row.ago),
    agent: row.Agent || '',
    version: row.Version || ''
  };
};

const agentOfflineText = (agent) => agent.lastSeen
  ? `Print Server ในร้านไม่ได้ออนไลน์ (ติดต่อมาล่าสุด ${Math.round(agent.secondsAgo / 60)} นาทีที่แล้ว) — เปิดคอมเครื่องที่ติดตั้ง Print Server`
  : 'ยังไม่มี Print Server ของสาขานี้เปิดรับงานพิมพ์จากมือถือ/แท็บเล็ต — เปิดที่หน้าตั้งค่าเครื่องพิมพ์ บนคอมเครื่องที่ติดตั้ง Print Server';

// ── หน้าเว็บ: ฝากงานพิมพ์ ──
export async function enqueuePrint(data) {
  await ensureTables();
  const branchId = await branchOf(data);
  const jobId = text(data.jobId, 40);
  const printerIp = text(data.printerIp, 100);
  const printerType = TYPES.has(String(data.printerType)) ? String(data.printerType) : 'receipt';
  if (!/^[A-Za-z0-9-]{8,40}$/.test(jobId)) return { success: false, stage: 'queue', error: 'รหัสงานพิมพ์ไม่ถูกต้อง' };
  if (!printerIp) return { success: false, stage: 'queue', error: 'ยังไม่ได้ระบุ IP ของเครื่องพิมพ์' };
  const payload = JSON.stringify(data.orderData && typeof data.orderData === 'object' ? data.orderData : {});
  if (payload.length > MAX_PAYLOAD) return { success: false, stage: 'queue', error: 'ข้อมูลใบพิมพ์ใหญ่เกินไป' };

  // พิมพ์ได้เฉพาะเครื่องพิมพ์ที่บันทึกไว้ของสาขานี้ — กันคนนอกสั่งให้ Print Server ยิงข้อมูลไปเครื่องอื่นในวงแลนร้าน
  const main = await defaultBranchId();
  const printer = await query(
    `SELECT name FROM dbo.Printers WHERE ip = @ip AND (BranchId = @b OR (BranchId IS NULL AND @b = @main)) LIMIT 1`,
    { ip: printerIp, b: branchId, main: main || '' }
  );
  if (!printer.recordset.length) {
    return { success: false, stage: 'queue', error: `เครื่องพิมพ์ ${printerIp} ไม่อยู่ในรายการเครื่องพิมพ์ของสาขานี้ — กด "บันทึกการตั้งค่า" ที่หน้าตั้งค่าเครื่องพิมพ์ก่อน` };
  }

  await housekeeping(branchId);
  // Print Server ไม่ออนไลน์ → บอกทันที ไม่ต้องให้หน้าเว็บรอจนหมดเวลา
  const agent = await agentInfo(branchId);
  if (!agent.online) return { success: false, stage: 'agent', error: agentOfflineText(agent), agent };

  const pending = await query(`SELECT COUNT(*) AS n FROM dbo.PrintJobs WHERE BranchId = @b AND [Status] = 'pending'`, { b: branchId });
  if (Number(pending.recordset[0].n) >= MAX_PENDING) {
    return { success: false, stage: 'agent', error: `งานพิมพ์ค้างในคิวเกิน ${MAX_PENDING} งาน — Print Server ในร้านอาจค้าง ลองรัน restart-print-server.bat` };
  }

  // ส่งซ้ำด้วยรหัสเดิม (เน็ตสะดุดแล้วกดใหม่) ไม่เกิดงานซ้ำ
  await query(
    `INSERT INTO dbo.PrintJobs (JobId, BranchId, PrinterIp, PrinterName, PrinterType, PayloadJson, Label)
       VALUES (@id, @b, @ip, @name, @type, @payload, @label) ON CONFLICT (jobid) DO NOTHING`,
    { id: jobId, b: branchId, ip: printerIp, name: text(printer.recordset[0].name, 120), type: printerType, payload, label: text(data.label, 120) }
  );
  return { success: true, jobId, status: 'pending', agent };
}

const mapJob = (r) => {
  let steps = [];
  try { steps = r.StepsJson ? JSON.parse(r.StepsJson) : []; } catch { steps = []; }
  const iso = (d) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
  return {
    id: r.JobId,
    status: r.Status,
    printerIp: r.PrinterIp,
    printerName: r.PrinterName || '',
    printerType: r.PrinterType,
    label: r.Label || '',
    stage: r.Stage || null,
    error: r.Error || null,
    warning: r.Warning || null,
    confirmed: r.Confirmed === true || r.Confirmed === 1,
    steps: Array.isArray(steps) ? steps : [],
    claimedBy: r.ClaimedBy || '',
    createdAt: iso(r.CreatedAt),
    claimedAt: iso(r.ClaimedAt),
    finishedAt: iso(r.FinishedAt)
  };
};

// ── หน้าเว็บ: ดูผลงานที่ฝากไว้ (+ สถานะ Print Server ของสาขา) ──
//   ?ids=a,b,c  (ไม่ส่ง ids = ดูสถานะ Print Server อย่างเดียว ใช้ในหน้าตั้งค่าเครื่องพิมพ์)
export async function getPrintQueue(params = {}) {
  await ensureTables();
  const branchId = await branchOf(params);
  const ids = String(params.ids || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9-]{8,40}$/.test(s)).slice(0, 20);
  let jobs = [];
  if (ids.length) {
    const args = {};
    const names = ids.map((id, i) => { args[`id${i}`] = id; return `@id${i}`; });
    const res = await query(
      `SELECT JobId, [Status], PrinterIp, PrinterName, PrinterType, Label, Stage, Error, Warning, Confirmed, StepsJson,
              ClaimedBy, CreatedAt, ClaimedAt, FinishedAt
         FROM dbo.PrintJobs WHERE JobId IN (${names.join(', ')})`,
      args
    );
    jobs = res.recordset.map(mapJob);
  }
  return { success: true, branchId, agent: await agentInfo(branchId), jobs };
}

// ── หน้าเว็บ: ยกเลิกงานที่ยังไม่มีใครรับ (หน้าเว็บรอจนหมดเวลาแล้ว — ไม่ให้พิมพ์ออกมาทีหลัง) ──
export async function cancelPrintJob(data) {
  await ensureTables();
  const res = await query(
    `UPDATE dbo.PrintJobs SET [Status] = 'cancelled', FinishedAt = SYSUTCDATETIME() WHERE JobId = @id AND [Status] = 'pending'`,
    { id: text(data.jobId, 40) }
  );
  return { success: true, cancelled: res.rowsAffected[0] > 0 };
}

// ── หลังบ้าน (แอดมิน): กุญแจให้ Print Server ของสาขานี้ใช้ดึงคิว ──
export async function getPrintAgentKey(data) {
  await ensureTables();
  const branchId = await branchOf(data);
  return { success: true, branchId, key: await agentKey(branchId) };
}

// ── Print Server: รับงาน ──
export async function claimPrintJobs(data) {
  await ensureTables();
  const branchId = await branchOf(data);
  if (!(await keyOk(branchId, data.key))) {
    return { success: false, auth: 'key', error: 'กุญแจของ Print Server ไม่ถูกต้อง — เปิด "รับงานพิมพ์จากมือถือ/แท็บเล็ต" ใหม่ที่หน้าตั้งค่าเครื่องพิมพ์' };
  }
  const agent = text(data.agent, 120);
  // บันทึกว่ายังออนไลน์ — เขียนทุก ~20 วิ ไม่ใช่ทุกรอบที่มาดึง
  await query(
    `INSERT INTO dbo.PrintAgents (BranchId, Agent, Version, LastSeen) VALUES (@b, @agent, @ver, SYSUTCDATETIME())
     ON CONFLICT (branchid) DO UPDATE SET agent = EXCLUDED.agent, version = EXCLUDED.version, lastseen = EXCLUDED.lastseen
       WHERE dbo.printagents.lastseen < SYSUTCDATETIME() - interval '${HEARTBEAT_EVERY_SEC} seconds'
          OR ISNULL(dbo.printagents.agent, '') <> EXCLUDED.agent OR ISNULL(dbo.printagents.version, '') <> EXCLUDED.version`,
    { b: branchId, agent, ver: text(data.version, 20) }
  );
  await housekeeping(branchId);

  const max = Math.min(MAX_CLAIM, Math.max(1, Number(data.max) || MAX_CLAIM));
  // READPAST: Print Server สองเครื่องในสาขาเดียวกันมาดึงพร้อมกันก็ไม่ได้งานซ้ำ
  const res = await query(
    `UPDATE dbo.PrintJobs SET [Status] = 'printing', ClaimedAt = SYSUTCDATETIME(), ClaimedBy = @agent
      WHERE RowId IN (SELECT RowId FROM dbo.PrintJobs WHERE BranchId = @b AND [Status] = 'pending'
                       ORDER BY RowId LIMIT ${max} FOR UPDATE SKIP LOCKED)
      RETURNING RowId, JobId, PrinterIp, PrinterType, PayloadJson, Label`,
    { b: branchId, agent }
  );
  const jobs = res.recordset
    .sort((a, b) => a.RowId - b.RowId)
    .map(r => {
      let orderData = {};
      try { orderData = JSON.parse(r.PayloadJson || '{}'); } catch { orderData = {}; }
      return { id: r.JobId, printerIp: r.PrinterIp, printerType: r.PrinterType, label: r.Label || '', orderData };
    });
  return { success: true, branchId, jobs };
}

// ── Print Server: รายงานผล ──
export async function reportPrintJob(data) {
  await ensureTables();
  const branchId = await branchOf(data);
  if (!(await keyOk(branchId, data.key))) return { success: false, auth: 'key', error: 'กุญแจของ Print Server ไม่ถูกต้อง' };
  const ok = data.success === true;
  const steps = JSON.stringify(Array.isArray(data.steps) ? data.steps.slice(0, 10) : []).slice(0, 8000);
  const res = await query(
    `UPDATE dbo.PrintJobs SET [Status] = @status, Stage = @stage, Error = @error, Warning = @warning,
         Confirmed = @confirmed, StepsJson = @steps, FinishedAt = SYSUTCDATETIME()
       WHERE JobId = @id AND BranchId = @b AND [Status] = 'printing'`,
    {
      id: text(data.jobId, 40), b: branchId, status: ok ? 'done' : 'failed',
      stage: text(data.stage, 20) || null, error: ok ? null : (text(data.error, 500) || 'พิมพ์ไม่สำเร็จ'),
      warning: text(data.warning, 500) || null, confirmed: data.confirmed === true, steps
    }
  );
  return { success: true, updated: res.rowsAffected[0] > 0 };
}
