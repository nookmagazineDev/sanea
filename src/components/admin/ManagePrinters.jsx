import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Printer, Save, CheckCircle, XCircle, AlertCircle, Plus, Trash2, Search, RefreshCw, Wifi, Server, Settings2, Copy } from 'lucide-react';
import {
  checkPrintServer,
  scanPrinters,
  sendPrintJob,
  getPrintServerUrl,
  getDefaultPrintServerUrl,
  setPrintServerUrl,
  isLocalhostUrl,
  LOCAL_PRINT_SERVER_URL,
  PRINT_SERVER_EVENT,
  getAutoPrint,
  saveAutoPrint,
  runAutoPrintNow,
  supportsAutoPrint,
  getReceiptHeader
} from '../../utils/printServer';
import { API_URL, apiUrlAbsolute } from '../../utils/api';

const PRINTER_TYPES = [
  { value: 'kitchen', label: 'ครัว (Kitchen)' },
  { value: 'bar', label: 'บาร์ (Bar)' },
  { value: 'receipt', label: 'ใบเสร็จ (Receipt)' },
  { value: 'other', label: 'อื่นๆ (Other)' },
];

// ครัว/บาร์บางร้านอยากได้ใบละรายการ เพื่อแปะติดจานหรือแยกให้คนทำคนละคน
const PRINT_MODES = [
  { value: 'combined', label: 'รวมใบเดียว (ทุกรายการอยู่ในใบเดียว)' },
  { value: 'separate', label: 'แยกใบ — 1 รายการต่อ 1 ใบ' },
];

// เฉพาะครัวกับบาร์ที่เลือกได้ ใบเสร็จต้องรวมใบเดียวเสมอ
const CAN_CHOOSE_PRINT_MODE = ['kitchen', 'bar'];

const DEFAULT_PRINTER = (ip = '') => ({ id: Date.now(), name: '', ip, type: 'kitchen', printMode: 'combined' });

const HEALTH_POLL_MS = 20000;

// หน้าเว็บที่เปิดผ่าน https เจอข้อจำกัดของเบราว์เซอร์เพิ่มเวลาคุยกับ Print Server ในเครื่อง
// (Chrome ขออนุญาตเข้าถึงอุปกรณ์ในเครือข่ายก่อน) จึงต้องมีคำแนะนำเพิ่มให้เฉพาะกรณีนี้
const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';

// branchId = สาขาที่เครื่องนี้ทำงานอยู่ — ปริ้นเตอร์และ Print Server เป็นของร้านสาขานั้น
const ManagePrinters = ({ branchId = '', branches = [] }) => {
  const branchName = (() => {
    const b = branches.find(x => String(x.id) === String(branchId));
    return b ? (b.name || b.id) : branchId;
  })();
  // Print Server ของสาขานี้ดึงเฉพาะออเดอร์ของสาขานี้ — ใส่ ?branch= ไว้ใน URL เลย
  // (Print Server รุ่นเก่าต่อ &action= ท้าย URL ที่มี ? อยู่แล้วได้ ไม่ต้องอัปเดตเครื่องพิมพ์ก่อนก็ใช้ได้)
  const autoPrintApiUrl = branchId ? `${apiUrlAbsolute()}?branch=${encodeURIComponent(branchId)}` : apiUrlAbsolute();
  const [saveError, setSaveError] = useState('');
  // หมวดอาหารสำหรับเลือกว่าเครื่องครัว/บาร์เครื่องไหนพิมพ์หมวดอะไร
  const [menuCategories, setMenuCategories] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
      return Array.isArray(d.categories) ? d.categories.filter(c => c && c.slug) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (menuCategories.length > 0) return;
    fetch(`${API_URL}?action=getStatic`).then(r => r.json()).then(d => {
      if (d && Array.isArray(d.categories)) setMenuCategories(d.categories.filter(c => c && c.slug));
    }).catch(() => {});
  }, [menuCategories.length]);

  const togglePrinterCategory = (printer, slug) => {
    const current = Array.isArray(printer.categories) ? printer.categories.map(String) : [];
    const next = current.includes(slug) ? current.filter(s => s !== slug) : [...current, slug];
    updatePrinter(printer.id, 'categories', next);
  };
  const [printers, setPrinters] = useState([]);
  const [testStatus, setTestStatus] = useState({}); // { [id]: { status, msg } }
  const [saved, setSaved] = useState(false);

  // Print Server connection states
  const [health, setHealth] = useState({ status: 'checking', url: getPrintServerUrl(), info: null, error: null, blocked: false });
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(getPrintServerUrl());
  const [copied, setCopied] = useState(false);

  // LAN Scanning states
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { localIp, baseIp, from, to, port, scanned, printers }
  const [scanError, setScanError] = useState(null);
  const [showScanOptions, setShowScanOptions] = useState(false);
  const [scanOptions, setScanOptions] = useState({ subnet: '', from: '1', to: '254', port: '9100' });

  // Auto print (Print Server ดึงออเดอร์ QR มาพิมพ์เอง)
  const [autoPrint, setAutoPrint] = useState(null);   // { config, status } จาก Print Server
  const [autoPrintBusy, setAutoPrintBusy] = useState(false);
  const [autoPrintMsg, setAutoPrintMsg] = useState(null); // { ok, text }

  const isScanningRef = useRef(false);
  isScanningRef.current = isScanning;

  useEffect(() => {
    const stored = localStorage.getItem('printers_config');
    if (stored) {
      try { setPrinters(JSON.parse(stored)); } catch (e) {}
    } else {
      // Migrate old single-printer settings
      const oldKitchen = localStorage.getItem('printer_kitchen_ip');
      const oldReceipt = localStorage.getItem('printer_receipt_ip');
      const migrated = [];
      if (oldReceipt) migrated.push({ id: 1, name: 'ใบเสร็จ', ip: oldReceipt, type: 'receipt' });
      if (oldKitchen) migrated.push({ id: 2, name: 'ครัว', ip: oldKitchen, type: 'kitchen' });
      if (migrated.length > 0) setPrinters(migrated);
    }
  }, []);

  // ---------- Print Server health ----------
  const runHealthCheck = useCallback(async () => {
    setHealth(prev => ({ ...prev, status: 'checking', url: getPrintServerUrl() }));
    const result = await checkPrintServer();
    setHealth({
      status: result.online ? 'online' : 'offline',
      url: result.url,
      info: result.info,
      error: result.error,
      blocked: result.blocked
    });
    // เติมวงแลนที่ Print Server เห็นให้อัตโนมัติ ผู้ใช้จะได้ไม่ต้องพิมพ์เอง
    if (result.online && result.info?.subnets?.length) {
      setScanOptions(prev => prev.subnet ? prev : { ...prev, subnet: result.info.subnets[0] });
    }
    return result;
  }, []);

  useEffect(() => {
    runHealthCheck();
    const timer = setInterval(() => {
      if (!isScanningRef.current) runHealthCheck();
    }, HEALTH_POLL_MS);
    const onUrlChange = () => runHealthCheck();
    window.addEventListener(PRINT_SERVER_EVENT, onUrlChange);
    return () => {
      clearInterval(timer);
      window.removeEventListener(PRINT_SERVER_EVENT, onUrlChange);
    };
  }, [runHealthCheck]);

  const handleSaveServerUrl = () => {
    const applied = setPrintServerUrl(serverUrlDraft);
    setServerUrlDraft(applied);
    setShowServerSettings(false);
  };

  const handleResetServerUrl = () => {
    const applied = setPrintServerUrl('');
    setServerUrlDraft(applied);
  };

  // ทางลัดแก้เคส https บล็อก IP วงแลน — ชี้ไป Print Server ในเครื่องเดียวกัน
  const handleUseLocalhost = () => {
    const applied = setPrintServerUrl(LOCAL_PRINT_SERVER_URL);
    setServerUrlDraft(applied);
    setShowServerSettings(false);
  };

  const copyStartCommand = async () => {
    try {
      await navigator.clipboard.writeText('node server.js');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  // ---------- Auto print (Print Server ดึงออเดอร์เอง) ----------
  const refreshAutoPrint = useCallback(async () => {
    const res = await getAutoPrint();
    setAutoPrint(res && res.success ? res : null);
    return res;
  }, []);

  // เครื่องที่รันโค้ดเก่าไม่มี route /auto-print — อย่าไปยิงให้ได้ 404 เปล่า ๆ
  const autoPrintReady = health.status === 'online' && supportsAutoPrint(health.info);

  useEffect(() => {
    if (autoPrintReady) refreshAutoPrint();
    else setAutoPrint(null);
  }, [autoPrintReady, refreshAutoPrint]);

  // ส่งค่าที่ตั้งไว้ในหน้านี้ (รายการเครื่องพิมพ์ + URL ของ Apps Script) ไปเก็บที่ Print Server
  // Print Server จะได้ดึงออเดอร์และจับคู่เครื่องพิมพ์ได้เองแม้ไม่มีใครเปิดหน้าเว็บ
  const pushAutoPrint = async (patch = {}) => {
    setAutoPrintBusy(true);
    setAutoPrintMsg(null);
    // Print Server อยู่คนละเครื่องกับหน้าเว็บ จึงต้องส่ง URL แบบเต็ม ไม่ใช่ path สั้น ๆ
    const res = await saveAutoPrint({ gasUrl: autoPrintApiUrl, printers, header: getReceiptHeader(), ...patch });
    setAutoPrintBusy(false);
    if (res && res.success) {
      setAutoPrint(res);
      setAutoPrintMsg({ ok: true, text: res.config.enabled ? 'บันทึกแล้ว — Print Server กำลังเฝ้าออเดอร์ให้' : 'ปิดการพิมพ์อัตโนมัติแล้ว' });
    } else {
      setAutoPrintMsg({ ok: false, text: (res && res.error) || 'ตั้งค่าไม่สำเร็จ' });
    }
    setTimeout(() => setAutoPrintMsg(null), 5000);
  };

  const runAutoPrintOnce = async () => {
    setAutoPrintBusy(true);
    setAutoPrintMsg(null);
    const res = await runAutoPrintNow();
    setAutoPrintBusy(false);
    if (res && res.success) {
      const r = res.result || {};
      const text = r.skipped
        ? `ข้ามรอบนี้ — ${r.skipped}`
        : r.baseline !== undefined
          ? `เริ่มเฝ้าออเดอร์แล้ว (ข้ามบิลค้าง ${r.baseline} ใบ)`
          : `ตรวจแล้ว — พิมพ์ ${r.printed || 0} บิล (บิลรอครัวทั้งหมด ${r.pending || 0} บิล)`;
      setAutoPrintMsg({ ok: true, text });
      refreshAutoPrint();
    } else {
      setAutoPrintMsg({ ok: false, text: (res && (res.error || (res.result && res.result.error))) || 'ดึงออเดอร์ไม่สำเร็จ' });
    }
    setTimeout(() => setAutoPrintMsg(null), 6000);
  };

  // ---------- Printer list ----------
  const handleSave = async () => {
    localStorage.setItem('printers_config', JSON.stringify(printers));
    window.dispatchEvent(new Event('printers_changed'));
    // เปิดพิมพ์อัตโนมัติไว้ = Print Server ถือรายการเครื่องพิมพ์ชุดของตัวเอง ต้องอัปเดตตามด้วย
    if (autoPrint?.config?.enabled) pushAutoPrint();
    setSaveError('');
    try {
      // บันทึกเฉพาะปริ้นเตอร์ของสาขานี้ — ของสาขาอื่นบนเซิร์ฟเวอร์ไม่ถูกแตะ
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'savePrinters', branchId, printers })
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
    } catch (e) {
      setSaveError(`บันทึกลงเครื่องนี้แล้ว แต่ส่งขึ้นระบบไม่สำเร็จ (${e.message || e}) — เครื่องอื่นในสาขาจะยังเห็นรายการเดิม`);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const addPrinter = (ip = '') => {
    setPrinters(prev => [...prev, DEFAULT_PRINTER(ip)]);
    setSaved(false);
  };

  const removePrinter = (id) => {
    setPrinters(prev => prev.filter(p => p.id !== id));
    setSaved(false);
  };

  const updatePrinter = (id, field, value) => {
    setPrinters(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    setSaved(false);
  };

  const applyDiscoveredIp = (ip) => {
    // If an existing printer has an empty IP, use that first
    const emptyIndex = printers.findIndex(p => !p.ip);
    if (emptyIndex !== -1) {
      updatePrinter(printers[emptyIndex].id, 'ip', ip);
    } else {
      addPrinter(ip);
    }
  };

  const isIpInUse = (ip) => printers.some(p => p.ip === ip);

  // ---------- LAN scan ----------
  const handleScanLan = async () => {
    setIsScanning(true);
    setScanError(null);
    setScanResult(null);

    try {
      const data = await scanPrinters({
        subnet: scanOptions.subnet,
        from: scanOptions.from,
        to: scanOptions.to,
        port: scanOptions.port
      });
      setScanResult(data);
      setHealth(prev => ({ ...prev, status: 'online', error: null }));
      if (data.baseIp) setScanOptions(prev => ({ ...prev, subnet: data.baseIp }));
    } catch (e) {
      setScanError(e.message);
      runHealthCheck();
    } finally {
      setIsScanning(false);
    }
  };

  const handleTestPrint = async (printer) => {
    if (!printer.ip) {
      setTestStatus(prev => ({ ...prev, [printer.id]: { status: 'error', msg: 'กรุณาระบุ IP Address' } }));
      return;
    }
    setTestStatus(prev => ({ ...prev, [printer.id]: { status: 'loading', msg: 'กำลังทดสอบ...' } }));
    const result = await sendPrintJob({
      ip: printer.ip,
      printerType: printer.type === 'receipt' ? 'receipt' : 'kitchen',
      orderData: {
        orderNumber: 'TEST-001',
        total: 0,
        items: [{ name: `ทดสอบ: ${printer.name || printer.ip}`, quantity: 1, isFlattened: true }]
      }
    });
    setTestStatus(prev => ({
      ...prev,
      [printer.id]: result.success
        ? { status: 'success', msg: 'พิมพ์ทดสอบสำเร็จ!' }
        : { status: 'error', msg: result.error || 'Failed' }
    }));
    if (!result.success) runHealthCheck();
  };

  const serverOnline = health.status === 'online';
  const statusStyles = {
    checking: { bg: '#fefce8', border: '#fde68a', color: '#a16207', label: 'กำลังตรวจสอบ...' },
    online: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', label: 'เชื่อมต่อแล้ว' },
    offline: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', label: health.blocked ? 'ถูกเบราว์เซอร์บล็อก' : 'ไม่พบ Print Server' },
  }[health.status] || {};

  const inputStyle = { background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1' };

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1><Printer size={28} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> ตั้งค่าเครื่องพิมพ์</h1>
          <p>จัดการเครื่องพิมพ์ทั้งหมดในระบบ — เพิ่มได้ไม่จำกัด หรือค้นหาอัตโนมัติในวงแลน (Port 9100)</p>
          {branchId && (
            <p style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '0.35rem' }}>
              🏠 ปริ้นเตอร์ของสาขา: {branchName} — ตั้งค่าหน้านี้จากเครื่องที่อยู่ในร้านสาขานี้
            </p>
          )}
          {saveError && <p style={{ color: '#b91c1c', marginTop: '0.35rem' }}>⚠️ {saveError}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className="admin-btn secondary"
            onClick={handleScanLan}
            disabled={isScanning || !serverOnline}
            title={serverOnline ? 'สแกนหาเครื่องพิมพ์ในวงแลน' : 'ต้องเชื่อมต่อ Print Server ก่อน'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: serverOnline ? '#0284c7' : '#94a3b8', color: 'white', border: 'none',
              padding: '0.6rem 1.25rem', borderRadius: '10px', fontWeight: '700',
              cursor: isScanning ? 'wait' : serverOnline ? 'pointer' : 'not-allowed'
            }}
          >
            {isScanning ? (
              <>
                <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span>กำลังค้นหาในวงแลน...</span>
              </>
            ) : (
              <>
                <Search size={18} />
                <span>🔍 ค้นหาเครื่องพิมพ์ในวงแลน</span>
              </>
            )}
          </button>
          <button className="admin-btn" onClick={() => addPrinter()}>
            <Plus size={20} /> เพิ่มเครื่องพิมพ์
          </button>
        </div>
      </div>

      <div className="admin-card">
        {/* ---------- Print Server status ---------- */}
        <div style={{
          background: statusStyles.bg,
          border: `1px solid ${statusStyles.border}`,
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Server size={20} color={statusStyles.color} />
            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.98rem' }}>Print Server</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              background: '#ffffff', border: `1px solid ${statusStyles.border}`, color: statusStyles.color,
              borderRadius: '999px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: 800
            }}>
              {health.status === 'checking' && <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {health.status === 'online' && <CheckCircle size={13} />}
              {health.status === 'offline' && <XCircle size={13} />}
              {statusStyles.label}
            </span>
            <code style={{ fontSize: '0.8rem', color: '#475569', background: '#ffffff', padding: '2px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              {health.url}
            </code>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={runHealthCheck}
                disabled={health.status === 'checking'}
                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '8px', padding: '0.35rem 0.75rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <RefreshCw size={14} /> ตรวจสอบอีกครั้ง
              </button>
              <button
                onClick={() => { setServerUrlDraft(getPrintServerUrl()); setShowServerSettings(v => !v); }}
                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '8px', padding: '0.35rem 0.75rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Settings2 size={14} /> ตั้งค่าที่อยู่
              </button>
            </div>
          </div>

          {serverOnline && health.info && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.84rem', color: '#166534' }}>
              พร้อมสั่งพิมพ์ — วงแลนที่ตรวจพบ: <strong>{(health.info.subnets || []).map(s => `${s}x`).join(', ') || '-'}</strong>
              {health.info.version && <span style={{ color: '#64748b' }}> (v{health.info.version})</span>}
              {isLocalhostUrl(health.url) && (
                <div style={{ color: '#475569', marginTop: '0.25rem' }}>
                  กำลังใช้ Print Server ในเครื่องนี้ — การค้นหาและสั่งพิมพ์ไปยังเครื่องพิมพ์ในวงแลนยังทำได้ตามปกติ เพราะ Print Server เป็นผู้ติดต่อเครื่องพิมพ์ให้
                </div>
              )}
            </div>
          )}

          {health.status === 'offline' && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.86rem', color: '#7f1d1d' }}>
              <div style={{ marginBottom: '0.5rem' }}>{health.error}</div>

              {health.blocked && (
                <div style={{ background: '#ffffff', border: '1px dashed #fecaca', borderRadius: '10px', padding: '0.85rem 1rem', color: '#475569' }}>
                  <strong style={{ color: '#0f172a' }}>วิธีแก้:</strong>
                  <p style={{ margin: '0.5rem 0', lineHeight: 1.7 }}>
                    เบราว์เซอร์ยอมให้หน้า https ติดต่อ <code>127.0.0.1</code> ได้ (แต่ห้าม IP วงแลนอย่าง 192.168.x.x)
                    ดังนั้นถ้ารัน Print Server อยู่ใน<strong>เครื่องเดียวกับที่เปิดหน้านี้</strong> ให้เปลี่ยนที่อยู่เป็น <code>127.0.0.1:3001</code> ก็ใช้งานได้เลย
                  </p>
                  <button
                    onClick={handleUseLocalhost}
                    style={{ background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Server size={15} /> ใช้ {LOCAL_PRINT_SERVER_URL} แทน
                  </button>
                  <ul style={{ margin: '0.75rem 0 0 1.2rem', padding: 0, lineHeight: 1.7, fontSize: '0.83rem' }}>
                    <li>เครื่องที่เปิดหน้านี้ต้องรัน <code>start-printer.bat</code> หรือ <code>node server.js</code> ด้วย</li>
                    <li>ถ้าใช้แท็บเล็ต/มือถือที่รัน Print Server ไม่ได้ ต้องเปิดแอปผ่าน <code>http://</code> ในวงแลนแทน</li>
                    <li>Chrome รุ่นใหม่อาจถามสิทธิ์เข้าถึงอุปกรณ์ในเครือข่ายครั้งแรก ให้กดอนุญาต</li>
                  </ul>
                </div>
              )}

              {!health.blocked && (
                <div style={{ background: '#ffffff', border: '1px dashed #fecaca', borderRadius: '10px', padding: '0.85rem 1rem', color: '#475569' }}>
                  <strong style={{ color: '#0f172a' }}>วิธีเปิด Print Server:</strong>
                  <ol style={{ margin: '0.5rem 0 0 1.2rem', padding: 0, lineHeight: 1.7 }}>
                    <li>
                      <strong style={{ color: '#0f172a' }}>แนะนำ — ตั้งครั้งเดียวจบ:</strong> ดับเบิลคลิก <code>install-autostart.bat</code> ครั้งเดียว
                      จากนั้น Print Server จะเปิดเองทุกครั้งที่เปิดเครื่อง (ทำงานเบื้องหลัง ไม่มีหน้าต่างแสดง)
                      และถ้าดับเองก็จะเปิดใหม่ให้อัตโนมัติ ไม่ต้องเปิด <code>start-printer.bat</code> อีก
                    </li>
                    <li>หรือเปิดครั้งเดียวเฉพาะตอนนี้ ให้ดับเบิลคลิก <code>start-printer.bat</code></li>
                    <li>
                      หรือเปิด Command Prompt ในโฟลเดอร์โปรเจกต์แล้วพิมพ์
                      <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '5px', margin: '0 0.35rem' }}>node server.js</code>
                      <button
                        onClick={copyStartCommand}
                        style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '1px 7px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <Copy size={12} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                      </button>
                    </li>
                    <li>ถ้า Print Server อยู่คนละเครื่องกับที่เปิดหน้าเว็บนี้ ให้กด “ตั้งค่าที่อยู่” แล้วใส่ IP ของเครื่องนั้น</li>
                    <li>
                      เปิดแล้วยังไม่เขียว ให้ดับเบิลคลิก <code>check-printer.bat</code> — จะบอกเองว่าติดตรงไหน
                      (ยังไม่ได้ลง Node.js / ยังไม่ได้ <code>npm install</code> / พอร์ต 3001 ยังไม่เปิด)
                      และดูข้อความล่าสุดได้ที่ <code>logs\print-server.log</code>
                    </li>
                  </ol>
                  {isHttpsPage && (
                    <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px dashed #e2e8f0', fontSize: '0.83rem', lineHeight: 1.7 }}>
                      <strong style={{ color: '#0f172a' }}>เปิด Print Server แล้วแต่ยังแดงอยู่?</strong> หน้านี้เปิดผ่าน https
                      Chrome จึงขออนุญาตก่อนติดต่ออุปกรณ์ในเครือข่าย — ถ้ามีป๊อปอัพถามให้กด “อนุญาต”
                      และเครื่องที่รัน Print Server ต้องเป็นเวอร์ชัน 1.3.0 ขึ้นไป (เวอร์ชันเก่าจะถูก Chrome บล็อกเงียบ ๆ)
                      ให้ <code>git pull</code> แล้วเปิด Print Server ใหม่
                    </div>
                  )}
                  <div style={{ marginTop: '0.6rem', fontSize: '0.82rem' }}>
                    หน้านี้จะตรวจสอบให้อัตโนมัติทุก {HEALTH_POLL_MS / 1000} วินาที เมื่อเปิด Server แล้วสถานะจะเปลี่ยนเป็นสีเขียวเอง
                  </div>
                </div>
              )}
            </div>
          )}

          {showServerSettings && (
            <div style={{ marginTop: '0.85rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem 1rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                ที่อยู่ Print Server (เว้นว่างเพื่อใช้ค่าเริ่มต้น {getDefaultPrintServerUrl()})
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={serverUrlDraft}
                  onChange={e => setServerUrlDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveServerUrl(); }}
                  placeholder="เช่น 192.168.1.10:3001"
                  style={{ ...inputStyle, flex: 1, minWidth: '220px', borderRadius: '8px', padding: '0.5rem 0.75rem' }}
                />
                <button
                  onClick={handleSaveServerUrl}
                  style={{ background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  บันทึก
                </button>
                <button
                  onClick={handleUseLocalhost}
                  style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ใช้ 127.0.0.1
                </button>
                <button
                  onClick={handleResetServerUrl}
                  style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ค่าเริ่มต้น
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---------- Auto print: Print Server ดึงออเดอร์ QR มาพิมพ์เอง ---------- */}
        <div style={{
          background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px',
          padding: '1rem', marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <Printer size={18} style={{ color: '#ea580c' }} />
            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.98rem' }}>พิมพ์ออเดอร์ลูกค้าสั่งเอง (QR) อัตโนมัติ</span>
            {autoPrint?.config?.enabled && (
              <span style={{ background: '#dcfce7', color: '#166534', fontWeight: 800, fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                กำลังทำงาน
              </span>
            )}
          </div>

          <div style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 600, lineHeight: 1.55, marginBottom: '0.75rem' }}>
            ออเดอร์ที่ลูกค้าสแกน QR สั่งเอง เกิดบนมือถือลูกค้า จึงสั่งเครื่องพิมพ์ในร้านเองไม่ได้ —
            เปิดสวิตช์นี้แล้ว Print Server เครื่องนี้จะคอยดึงออเดอร์จากระบบมาพิมพ์เข้าครัวให้เอง
            โดยไม่ต้องเปิดหน้า “ครัว” ค้างไว้ (ควรเปิดที่เครื่องเดียวพอ ไม่งั้นใบจะออกซ้ำ)
          </div>

          {health.status !== 'online' ? (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '10px', padding: '0.7rem 0.85rem', fontSize: '0.82rem', fontWeight: 700 }}>
              ต้องเชื่อมต่อ Print Server ให้ได้ก่อน จึงจะตั้งค่าส่วนนี้ได้
            </div>
          ) : !autoPrintReady ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '10px', padding: '0.8rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.6 }}>
              <div style={{ marginBottom: '0.4rem' }}>
                ⚠️ Print Server เครื่องนี้ยังเป็นเวอร์ชันเก่า (v{health.info?.version || 'ไม่ทราบ'}) ยังไม่มีระบบพิมพ์อัตโนมัติ
              </div>
              <div style={{ fontWeight: 600 }}>
                ที่<strong>เครื่องที่รัน Print Server</strong> ให้ทำตามนี้แล้วค่อยกลับมาหน้านี้:
                <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                  <li>ปิด Print Server ที่เปิดค้างอยู่ (ปิดหน้าต่าง start-printer หรือจบ process node)</li>
                  <li>อัปเดตโค้ดในโฟลเดอร์โปรเจกต์ — <code>git pull</code> (หรือคัดลอกไฟล์ชุดใหม่ทับ ต้องมี <code>server.js</code>, <code>print-ticket.js</code>, <code>auto-print.js</code> ครบ)</li>
                  <li>เปิดใหม่ด้วย <code>start-printer.bat</code> หรือ <code>node server.js</code></li>
                </ol>
              </div>
            </div>
          ) : (
            <>
              {/* Print Server เก็บที่อยู่ API ไว้เองในเครื่อง ย้ายปลายทางเมื่อไหร่ค่านี้จะค้างของเก่า
                  แล้วใบครัวจะเงียบไปเฉย ๆ โดยไม่มีอะไรฟ้อง — เทียบให้เห็นตรงนี้เลย */}
              {(() => {
                const want = autoPrintApiUrl;
                const have = String(autoPrint?.config?.gasUrl || '');
                const norm = (u) => u.replace(/\/+$/, '').toLowerCase();
                if (!autoPrint || norm(have) === norm(want)) return null;
                return (
                  <div style={{
                    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px',
                    padding: '0.75rem 0.85rem', marginBottom: '0.65rem',
                    display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.25rem' }}>
                        ⚠️ Print Server ยังชี้ไปที่อยู่เดิม — ใบครัวจะไม่ออก
                      </div>
                      <div style={{ wordBreak: 'break-all' }}>
                        ตอนนี้ตั้งไว้: <code>{have || '(ยังไม่ได้ตั้ง)'}</code>
                      </div>
                      <div style={{ wordBreak: 'break-all' }}>
                        ต้องเป็น: <code>{want}</code>
                      </div>
                    </div>
                    <button
                      onClick={() => pushAutoPrint()}
                      disabled={autoPrintBusy}
                      style={{
                        flexShrink: 0, background: '#d97706', color: '#fff', border: 'none', borderRadius: '10px',
                        padding: '0.55rem 1rem', fontWeight: 800, fontSize: '0.85rem',
                        cursor: autoPrintBusy ? 'wait' : 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      อัปเดตให้ตรงกันเดี๋ยวนี้
                    </button>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
                <button
                  onClick={() => pushAutoPrint({ enabled: !autoPrint?.config?.enabled })}
                  disabled={autoPrintBusy}
                  style={{
                    background: autoPrint?.config?.enabled ? '#dc2626' : '#16a34a',
                    color: '#fff', border: 'none', borderRadius: '10px',
                    padding: '0.55rem 1rem', fontWeight: 800, fontSize: '0.85rem',
                    cursor: autoPrintBusy ? 'wait' : 'pointer', fontFamily: 'inherit'
                  }}
                >
                  {autoPrint?.config?.enabled ? 'ปิดการพิมพ์อัตโนมัติ' : 'เปิดการพิมพ์อัตโนมัติ'}
                </button>
                <button
                  onClick={() => pushAutoPrint()}
                  disabled={autoPrintBusy}
                  style={{
                    background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px',
                    padding: '0.55rem 1rem', fontWeight: 700, fontSize: '0.85rem',
                    cursor: autoPrintBusy ? 'wait' : 'pointer', fontFamily: 'inherit'
                  }}
                >
                  ส่งรายการเครื่องพิมพ์ล่าสุดไปให้ Print Server
                </button>
                <button
                  onClick={runAutoPrintOnce}
                  disabled={autoPrintBusy}
                  style={{
                    background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px',
                    padding: '0.55rem 1rem', fontWeight: 700, fontSize: '0.85rem',
                    cursor: autoPrintBusy ? 'wait' : 'pointer', fontFamily: 'inherit'
                  }}
                >
                  ตรวจออเดอร์เดี๋ยวนี้
                </button>
              </div>

              {autoPrintMsg && (
                <div style={{
                  background: autoPrintMsg.ok ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${autoPrintMsg.ok ? '#bbf7d0' : '#fecaca'}`,
                  color: autoPrintMsg.ok ? '#166534' : '#b91c1c',
                  borderRadius: '10px', padding: '0.6rem 0.8rem', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.65rem'
                }}>
                  {autoPrintMsg.ok ? '✅' : '❌'} {autoPrintMsg.text}
                </div>
              )}

              {autoPrint?.status && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                  <div>รอบตรวจ: ทุก {autoPrint.status.pollSeconds} วินาที</div>
                  <div>เครื่องพิมพ์ที่ส่งไปแล้ว: {autoPrint.status.printerCount} เครื่อง</div>
                  <div>พิมพ์ไปแล้วรอบนี้: {autoPrint.status.printedCount} บิล</div>
                  <div>ตรวจล่าสุด: {autoPrint.status.lastPollAt ? new Date(autoPrint.status.lastPollAt).toLocaleTimeString('th-TH') : '—'}</div>
                  {autoPrint.status.lastError && (
                    <div style={{ gridColumn: '1 / -1', color: '#b91c1c' }}>ผิดพลาดล่าสุด: {autoPrint.status.lastError}</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ---------- Scan options ---------- */}
        <div style={{ marginBottom: '1.25rem' }}>
          <button
            onClick={() => setShowScanOptions(v => !v)}
            style={{ background: 'transparent', border: 'none', color: '#0284c7', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Settings2 size={15} /> {showScanOptions ? 'ซ่อนตัวเลือกการค้นหา' : 'ตัวเลือกการค้นหา (ระบุวงแลน / ช่วง IP / พอร์ตเอง)'}
          </button>

          {showScanOptions && (
            <div style={{ marginTop: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.75rem' }}>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>วงแลน (subnet)</label>
                <input
                  value={scanOptions.subnet}
                  onChange={e => setScanOptions(prev => ({ ...prev, subnet: e.target.value }))}
                  placeholder="192.168.1."
                  style={inputStyle}
                />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>IP เริ่ม</label>
                <input type="number" min="1" max="254" value={scanOptions.from} onChange={e => setScanOptions(prev => ({ ...prev, from: e.target.value }))} style={inputStyle} />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>IP สิ้นสุด</label>
                <input type="number" min="1" max="254" value={scanOptions.to} onChange={e => setScanOptions(prev => ({ ...prev, to: e.target.value }))} style={inputStyle} />
              </div>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>พอร์ต</label>
                <input type="number" min="1" max="65535" value={scanOptions.port} onChange={e => setScanOptions(prev => ({ ...prev, port: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: '#64748b' }}>
                เว้นว่างช่อง “วงแลน” เพื่อให้ Print Server เดาวงแลนจาก IP ของตัวเองอัตโนมัติ
                {health.info?.subnets?.length > 1 && (
                  <span> — เครื่องนี้มีหลายวง: {health.info.subnets.map(s => (
                    <button
                      key={s}
                      onClick={() => setScanOptions(prev => ({ ...prev, subnet: s }))}
                      style={{ background: '#e0f2fe', border: '1px solid #bae6fd', color: '#0369a1', borderRadius: '6px', padding: '1px 7px', margin: '0 0.2rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                    >{s}x</button>
                  ))}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ---------- Results of LAN Scan ---------- */}
        {(isScanning || scanResult || scanError) && (
          <div style={{
            background: 'rgba(2,132,199,0.06)',
            border: '1px solid rgba(2,132,199,0.3)',
            borderRadius: '12px',
            padding: '1.25rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <Wifi size={20} color="#0284c7" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a', fontWeight: '700' }}>
                ผลการค้นหาเครื่องพิมพ์ในวง LAN (Port {scanResult?.port || scanOptions.port || 9100})
              </h3>
            </div>

            {isScanning && (
              <p style={{ color: '#0284c7', fontSize: '0.9rem', margin: '0.5rem 0 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                ระบบกำลังสแกนหา IP Addresses ({scanOptions.from}..{scanOptions.to}) ในวงแลนของคุณ... โปรดรอสักครู่
              </p>
            )}

            {scanError && (
              <div style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <XCircle size={16} />
                <span>{scanError}</span>
              </div>
            )}

            {scanResult && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '0.75rem' }}>
                  IP เครื่องของคุณ: <strong style={{ color: '#0f172a' }}>{scanResult.localIp || '-'}</strong> (สแกน {scanResult.baseIp}{scanResult.from}-{scanResult.to} รวม {scanResult.scanned} IP)
                </div>

                {scanResult.printers.length === 0 ? (
                  <div style={{
                    background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '10px',
                    padding: '1rem', color: '#64748b', fontSize: '0.88rem'
                  }}>
                    ⚠️ <strong>ไม่พบเครื่องพิมพ์ที่เปิดพอร์ต {scanResult.port} ในวงแลน</strong>
                    <ul style={{ margin: '0.5rem 0 0 1.2rem', padding: 0 }}>
                      <li>ตรวจสอบว่าเครื่องพิมพ์เปิดใช้งาน และเสียบสาย LAN / ต่อ Wi-Fi เดียวกัน</li>
                      <li>ตรวจสอบว่า IP ของเครื่องพิมพ์อยู่ในวง subnet เดียวกัน ({scanResult.baseIp}x) — ถ้าคนละวง กด “ตัวเลือกการค้นหา” แล้วระบุวงแลนเอง</li>
                      <li>หากทราบ IP แน่นอน สามารถกรอกลงในช่อง IP Address โดยตรงได้เลยครับ</li>
                    </ul>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#059669' }}>
                      พบเครื่องพิมพ์ {scanResult.printers.length} เครื่อง:
                    </div>
                    {scanResult.printers.map((p, idx) => {
                      const added = isIpInUse(p.ip);
                      return (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px',
                          padding: '0.65rem 1rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <Printer size={18} color="#059669" />
                            <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
                              IP: {p.ip}
                            </span>
                            <span style={{ fontSize: '0.78rem', background: '#d1fae5', color: '#047857', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                              Port {p.port} Active
                            </span>
                          </div>
                          <button
                            onClick={() => applyDiscoveredIp(p.ip)}
                            disabled={added}
                            style={{
                              background: added ? '#e2e8f0' : '#059669', color: added ? '#64748b' : 'white', border: 'none',
                              borderRadius: '8px', padding: '0.4rem 0.85rem', fontSize: '0.85rem',
                              fontWeight: 700, cursor: added ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem'
                            }}
                          >
                            {added ? <><CheckCircle size={15} /> เพิ่มแล้ว</> : <><Plus size={15} /> นำ IP นี้ไปใช้</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {printers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <Printer size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
            <p>ยังไม่มีเครื่องพิมพ์ กด "🔍 ค้นหาเครื่องพิมพ์ในวงแลน" หรือ "เพิ่มเครื่องพิมพ์" เพื่อเริ่มต้น</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {printers.map((printer, idx) => {
              const ts = testStatus[printer.id];
              return (
                <div key={printer.id} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Printer size={18} style={{ color: '#ea580c' }} />
                    <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.95rem' }}>
                      เครื่องพิมพ์ที่ {idx + 1}
                    </span>
                    <button
                      onClick={() => removePrinter(printer.id)}
                      style={{ marginLeft: 'auto', background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '8px', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      <Trash2 size={14} /> ลบ
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div className="admin-form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>ชื่อเครื่องพิมพ์</label>
                      <input
                        value={printer.name}
                        onChange={e => updatePrinter(printer.id, 'name', e.target.value)}
                        placeholder="เช่น ครัวใหญ่, บาร์, ใบเสร็จ"
                        style={inputStyle}
                      />
                    </div>
                    <div className="admin-form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>IP Address</label>
                      <input
                        value={printer.ip}
                        onChange={e => updatePrinter(printer.id, 'ip', e.target.value)}
                        placeholder="192.168.x.x"
                        style={inputStyle}
                      />
                    </div>
                    <div className="admin-form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>ประเภท</label>
                      <select value={printer.type} onChange={e => updatePrinter(printer.id, 'type', e.target.value)} style={inputStyle}>
                        {PRINTER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {CAN_CHOOSE_PRINT_MODE.includes(printer.type) && (
                    <div className="admin-form-group" style={{ margin: '0 0 0.75rem 0' }}>
                      <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>รูปแบบการพิมพ์</label>
                      <select
                        value={printer.printMode || 'combined'}
                        onChange={e => updatePrinter(printer.id, 'printMode', e.target.value)}
                        style={inputStyle}
                      >
                        {PRINT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.3rem', lineHeight: 1.45 }}>
                        {(printer.printMode || 'combined') === 'separate'
                          ? 'ออเดอร์ 3 รายการ = พิมพ์ 3 ใบ เหมาะกับครัวที่แบ่งกันทำคนละอย่าง หรือแปะใบติดจาน (ใช้กระดาษมากกว่า)'
                          : 'ออเดอร์ 3 รายการ = พิมพ์ 1 ใบ เห็นทั้งโต๊ะในใบเดียว'}
                      </div>
                    </div>
                  )}

                  {CAN_CHOOSE_PRINT_MODE.includes(printer.type) && (() => {
                    const chosen = Array.isArray(printer.categories) ? printer.categories.map(String) : [];
                    return (
                      <div className="admin-form-group" style={{ margin: '0 0 0.75rem 0' }}>
                        <label style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>
                          หมวดอาหารที่เครื่องนี้พิมพ์ {chosen.length === 0 && <span style={{ color: '#16a34a' }}>— ทุกหมวด</span>}
                        </label>
                        {menuCategories.length === 0 ? (
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>ยังไม่มีหมวดหมู่ — สร้างที่หน้า "หมวดหมู่" ก่อน</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
                            {menuCategories.map(c => {
                              const on = chosen.includes(String(c.slug));
                              return (
                                <button key={c.slug} type="button" onClick={() => togglePrinterCategory(printer, String(c.slug))}
                                  style={{ padding: '0.3rem 0.7rem', borderRadius: 999, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
                                    background: on ? '#fff7ed' : '#ffffff', borderColor: on ? '#ea580c' : '#e2e8f0', color: on ? '#c2410c' : '#475569' }}>
                                  {on ? '✓ ' : ''}{c.icon ? `${c.icon} ` : ''}{c.name || c.slug}
                                </button>
                              );
                            })}
                            {chosen.length > 0 && (
                              <button type="button" onClick={() => updatePrinter(printer.id, 'categories', [])}
                                style={{ padding: '0.3rem 0.7rem', borderRadius: 999, border: '1px dashed #cbd5e1', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', color: '#64748b' }}>
                                ล้าง (พิมพ์ทุกหมวด)
                              </button>
                            )}
                          </div>
                        )}
                        <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.3rem', lineHeight: 1.45 }}>
                          {chosen.length === 0
                            ? 'ไม่เลือก = เครื่องหลักของครัว รับทุกเมนูที่ไม่มีเครื่องไหนเลือกหมวดไว้'
                            : 'พิมพ์เฉพาะเมนูในหมวดที่เลือก (ดูจากหมวดหลักของเมนู) — ถ้าเมนูตั้งเครื่องพิมพ์ไว้เองในหน้าจัดการเมนู จะออกเครื่องนั้นแทน'}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                      className="admin-btn secondary"
                      onClick={() => handleTestPrint(printer)}
                      disabled={!printer.ip}
                      style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem', fontWeight: 700 }}
                    >
                      ทดสอบพิมพ์
                    </button>
                    {ts && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', color: ts.status === 'success' ? '#16a34a' : ts.status === 'error' ? '#dc2626' : '#d97706' }}>
                        {ts.status === 'success' && <CheckCircle size={15} />}
                        {ts.status === 'error' && <XCircle size={15} />}
                        {ts.status === 'loading' && <AlertCircle size={15} />}
                        {ts.msg}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            className="admin-btn"
            onClick={handleSave}
            style={{ padding: '0.85rem 2rem', background: saved ? '#16a34a' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', transition: 'background 0.3s', fontWeight: '800' }}
          >
            <Save size={18} /> {saved ? 'บันทึกแล้ว ✓' : 'บันทึกการตั้งค่า'}
          </button>
        </div>

        <div style={{ marginTop: '1.25rem', background: '#fff7ed', border: '1px solid #ffedd5', padding: '1rem', borderRadius: '10px', color: '#c2410c', fontSize: '0.88rem' }}>
          <strong>หมายเหตุ:</strong> เครื่องพิมพ์ ESC/POS ในวงแลนคุยกันด้วย TCP port 9100 ซึ่งเบราว์เซอร์เปิด socket เองไม่ได้
          การสแกนค้นหาและสั่งพิมพ์จึงต้องผ่าน Node Print Server (<code>node server.js</code>) ที่เปิดในวงแลนเดียวกันเสมอ
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ManagePrinters;
