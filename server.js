import express from 'express';
import cors from 'cors';
import os from 'os';
import net from 'net';
import { printTicket } from './print-ticket.js';
import { registerAutoPrint } from './auto-print.js';

const SERVER_NAME = 'sanea-print-server';
const SERVER_VERSION = '1.3.0';
// ความสามารถที่ Print Server ตัวนี้มี — หน้าเว็บใช้เช็คว่าเครื่องนี้รันโค้ดเวอร์ชันใหม่พอไหม
// (เครื่องที่ยังรันตัวเก่าจะไม่มี features กลับมา หน้าเว็บจะได้บอกให้อัปเดตแทนที่จะฟ้อง 404 เฉย ๆ)
const SERVER_FEATURES = ['autoPrint', 'privateNetwork', 'taxInvoice'];
const DEFAULT_PRINTER_PORT = 9100;

const app = express();

// ── Chrome Private Network Access ──
// หน้าเว็บที่เปิดผ่าน https (เช่นโดเมนบน Vercel) เวลายิงมาหา 127.0.0.1 ซึ่งเป็น
// "เครือข่ายส่วนตัว" Chrome จะส่ง preflight มาก่อนเสมอ พร้อมหัวข้อ
// Access-Control-Request-Private-Network: true — ถ้าเราไม่ตอบอนุญาตกลับไป
// Chrome จะบล็อกทิ้ง หน้าเว็บจึงขึ้น "ไม่พบ Print Server" ทั้งที่ Server เปิดอยู่
// (เป็นคนละเรื่องกับ mixed content ซึ่งยกเว้น localhost ให้อยู่แล้ว)
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(cors());
app.use(express.json()); // For handling JSON payloads

// รายการ IPv4 ของทุกการ์ดแลน/ไวไฟบนเครื่องนี้ (ข้าม loopback)
const getLocalIPv4s = () => {
  const interfaces = os.networkInterfaces();
  const found = [];
  for (const name in interfaces) {
    for (const details of interfaces[name] || []) {
      if (details.family === 'IPv4' && !details.internal) {
        found.push({ name, address: details.address, netmask: details.netmask });
      }
    }
  }
  return found;
};

const toBaseIp = (ip) => `${ip.split('.').slice(0, 3).join('.')}.`;

// รับได้ทั้ง "192.168.1", "192.168.1.", "192.168.1.0" และ "192.168.1.0/24"
const normalizeSubnet = (raw) => {
  const value = String(raw || '').trim().replace(/\/\d+$/, '');
  if (!value) return null;
  const parts = value.split('.').filter(part => part !== '');
  if (parts.length < 3) return null;
  const octets = parts.slice(0, 3);
  if (!octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return `${octets.join('.')}.`;
};

const clampInt = (raw, fallback, min, max) => {
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

// Health check — ให้หน้าเว็บเช็คได้ว่า Print Server เปิดอยู่ไหม
app.get('/health', (req, res) => {
  const localIps = getLocalIPv4s();
  res.json({
    success: true,
    service: SERVER_NAME,
    version: SERVER_VERSION,
    features: SERVER_FEATURES,
    localIps,
    subnets: [...new Set(localIps.map(entry => toBaseIp(entry.address)))],
    defaultPort: DEFAULT_PRINTER_PORT
  });
});

// LAN Printer Discovery endpoint
// Query (ไม่ใส่ก็ได้): subnet=192.168.1. | from=1 | to=254 | port=9100 | timeout=600
app.get('/scan-printers', async (req, res) => {
  try {
    const localIps = getLocalIPv4s();
    const requestedSubnet = normalizeSubnet(req.query.subnet);

    if (req.query.subnet && !requestedSubnet) {
      return res.status(400).json({ success: false, error: `รูปแบบวงแลนไม่ถูกต้อง: ${req.query.subnet} (ตัวอย่างที่ถูก: 192.168.1.)` });
    }

    if (!requestedSubnet && localIps.length === 0) {
      return res.status(500).json({ success: false, error: 'หา IP วงแลนของเครื่องนี้ไม่เจอ — ตรวจสอบว่าเสียบสาย LAN หรือต่อ Wi-Fi อยู่' });
    }

    const localIp = localIps.length > 0 ? localIps[0].address : null;
    const baseIp = requestedSubnet || toBaseIp(localIp);

    const from = clampInt(req.query.from, 1, 1, 254);
    const to = clampInt(req.query.to, 254, from, 254);
    const scanPort = clampInt(req.query.port, DEFAULT_PRINTER_PORT, 1, 65535);
    const timeoutMs = clampInt(req.query.timeout, 600, 100, 5000);

    const scanHost = (targetIp) => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };

        socket.setTimeout(timeoutMs);
        socket.on('connect', () => finish({ ip: targetIp, port: scanPort }));
        socket.on('timeout', () => finish(null));
        socket.on('error', () => finish(null));
        socket.connect(scanPort, targetIp);
      });
    };

    const ips = [];
    for (let i = from; i <= to; i++) ips.push(`${baseIp}${i}`);

    const foundPrinters = [];
    const chunkSize = 50;
    for (let i = 0; i < ips.length; i += chunkSize) {
      const chunk = ips.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map(ip => scanHost(ip)));
      results.forEach(result => {
        if (result) foundPrinters.push(result);
      });
    }

    console.log(`Scanned ${baseIp}${from}-${to} on port ${scanPort} — found ${foundPrinters.length} printer(s)`);

    res.json({
      success: true,
      localIp,
      localIps,
      baseIp,
      from,
      to,
      port: scanPort,
      scanned: ips.length,
      printers: foundPrinters
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/print', async (req, res) => {
  const { ip, orderData, printerType = 'receipt' } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'Printer IP address is required' });
  }

  // ตัวพิมพ์จริงอยู่ใน print-ticket.js — ใช้ร่วมกับตัวดึงออเดอร์อัตโนมัติ (auto-print.js)
  const result = await printTicket({ ip, orderData, printerType });
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }
  res.json({ success: true });
});

// ── ดึงออเดอร์จากชีตมาพิมพ์เอง (ออเดอร์ที่ลูกค้าสั่งผ่าน QR) ──
// เพิ่ม endpoint /auto-print (GET ดูสถานะ, POST ตั้งค่า, POST /auto-print/run สั่งดึงเดี๋ยวนี้)
registerAutoPrint(app);

const PORT = 3001;
// ผูกข้อความไว้กับ event 'listening' ไม่ใช่ callback ของ app.listen
// เพราะ Express 5 เรียก callback ทันทีแม้ bind พอร์ตไม่สำเร็จ
const server = app.listen(PORT);

server.on('listening', () => {
  console.log(`[${new Date().toLocaleString('th-TH')}] Print bridge server running on http://localhost:${PORT}`);
  console.log(`Ready to print to LAN ESP/POS thermal printers`);
});

// ถ้ามี Print Server ตัวอื่นเปิดอยู่แล้ว ให้จบการทำงานเงียบ ๆ
// (ตัว daemon ที่เปิดอัตโนมัติจะได้ไม่วนเปิดซ้ำ)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} ถูกใช้งานอยู่แล้ว — มี Print Server เปิดอยู่ก่อนหน้า ปิดตัวนี้ลง`);
    process.exit(0);
  }
  console.error('Server error:', err);
  process.exit(1);
});
