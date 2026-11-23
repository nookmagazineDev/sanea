import React, { useEffect, useState } from 'react';
import { Download, BookOpen, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

// ===============================================================
// ดาวน์โหลด Print Server + คู่มือ — อยู่ในหน้า "ตั้งค่าเครื่องพิมพ์"
// ---------------------------------------------------------------
// ไฟล์ zip / คู่มือ / เลขเวอร์ชันล่าสุด สร้างตอน build เว็บ
// (scripts/build-print-server-package.mjs → public/downloads/)
// เทียบเลขเวอร์ชันกับ Print Server ที่ร้านรันอยู่ ถ้าเก่ากว่าขึ้นแถบให้อัปเดต
// ===============================================================

const BASE = '/downloads/';
const MANIFEST_URL = `${BASE}print-server.json`;

// "1.10.0" > "1.9.2" — เทียบทีละหลัก
export const compareVersions = (a, b) => {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
};

const STEPS = [
  <>ติดตั้ง <b>Node.js</b> รุ่น LTS จาก <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a> (ครั้งเดียว กด Next จนจบ)</>,
  <>กด <b>ดาวน์โหลด Print Server</b> ด้านบน แล้วคลิกขวาไฟล์ zip → <b>Extract All…</b> ไปที่ <code>C:\</code> จะได้ <code>C:\Sanea-Print-Server</code></>,
  <>ดับเบิลคลิก <code>install-autostart.bat</code> ในโฟลเดอร์นั้น (ครั้งแรก 1–3 นาที ต้องต่อเน็ต) — จากนี้เปิดเองทุกครั้งที่เปิดเครื่อง</>,
  <>กลับมาหน้านี้ กด <b>ตรวจสอบอีกครั้ง</b> กล่อง Print Server ต้องเป็นสีเขียว (ถ้าขึ้น “ถูกเบราว์เซอร์บล็อก” กดใช้ 127.0.0.1)</>,
  <>กด <b>ค้นหาเครื่องพิมพ์ในวงแลน</b> → เพิ่มเครื่อง → <b>ทดสอบพิมพ์</b> → <b>บันทึกการตั้งค่า</b></>
];

const PrintServerDownload = ({ health }) => {
  const [manifest, setManifest] = useState(null);
  const [missing, setMissing] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return;
        if (data && data.version && data.file) setManifest(data);
        else setMissing(true);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, []);

  const offline = health.status === 'offline' && !health.blocked;
  const runningVersion = health.status === 'online' ? health.info?.version : null;
  const outdated = !!(manifest && health.status === 'online' &&
    (!runningVersion || compareVersions(runningVersion, manifest.version) < 0));
  // ยังไม่มี Print Server → กางวิธีติดตั้งให้เลย
  const stepsOpen = showSteps || offline;

  const zipUrl = manifest ? `${BASE}${manifest.file}` : null;
  const guideUrl = `${BASE}${manifest?.guide || 'print-server-guide.html'}`;

  const btn = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px',
    padding: '0.55rem 1rem', fontWeight: 800, fontSize: '0.88rem', textDecoration: 'none', cursor: 'pointer'
  };

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: '14px', padding: '1rem', marginBottom: '1.25rem' }}>
      {outdated && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', background: '#fdf2f4', border: '1px solid #f5b5bf', borderRadius: '10px', padding: '0.7rem 0.85rem', marginBottom: '0.85rem', color: '#7a0a1c', fontSize: '0.86rem', lineHeight: 1.6 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>มี Print Server เวอร์ชันใหม่ v{manifest.version}</strong> — เครื่องในร้านยังเป็น v{runningVersion || 'เก่า (ไม่ทราบเลข)'}<br />
            วิธีอัปเดต: ดาวน์โหลดไฟล์ด้านล่าง → แตกไฟล์ทับโฟลเดอร์เดิม (<code>C:\Sanea-Print-Server</code> กด Replace)
            → ดับเบิลคลิก <code>restart-print-server.bat</code> → กลับมากด “ตรวจสอบอีกครั้ง”
            <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: '#7a0a1c' }}>
              เครื่องที่เคยติดตั้งด้วย Git ใช้ <code>update-printer.bat</code> เหมือนเดิมก็ได้
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: '#141414', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Download size={18} style={{ color: '#c8102e' }} /> ดาวน์โหลด Print Server
            {manifest && (
              <span style={{ background: '#f1f1f1', color: '#454545', fontWeight: 700, fontSize: '0.74rem', padding: '0.1rem 0.5rem', borderRadius: '999px' }}>
                v{manifest.version} · {Math.max(1, Math.round(manifest.size / 1024))} KB
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#454545', marginTop: '0.2rem', lineHeight: 1.55 }}>
            โปรแกรมตัวกลางสำหรับคอมพิวเตอร์ Windows ในร้าน (สาขาละ 1 เครื่อง) — ต้องมีถึงจะสั่งพิมพ์ออกเครื่องพิมพ์ในวงแลนได้
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {zipUrl ? (
            <a href={zipUrl} download style={{ ...btn, background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#ffffff', border: 'none' }}>
              <Download size={16} /> ดาวน์โหลด Print Server (.zip)
            </a>
          ) : (
            <span style={{ ...btn, background: '#e4e4e4', color: '#5a5a5a', cursor: 'not-allowed' }}>
              <Download size={16} /> {missing ? 'ยังไม่มีไฟล์ให้ดาวน์โหลด' : 'กำลังโหลด...'}
            </span>
          )}
          <a href={guideUrl} target="_blank" rel="noreferrer" style={{ ...btn, background: '#ffffff', color: '#333333', border: '1px solid #d0d0d0' }}>
            <BookOpen size={16} /> คู่มือติดตั้ง
          </a>
        </div>
      </div>

      {missing && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: '#8e0b20' }}>
          เว็บรุ่นนี้ยังไม่ได้แพ็กไฟล์ Print Server — ให้ผู้ดูแลระบบ build/deploy หน้าเว็บใหม่
        </div>
      )}

      <button type="button" onClick={() => setShowSteps(v => !v)} disabled={offline}
        style={{ marginTop: '0.75rem', background: 'transparent', border: 'none', padding: 0, color: '#141414', fontWeight: 700, fontSize: '0.84rem', cursor: offline ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit' }}>
        {stepsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />} วิธีติดตั้งแบบย่อ (5 ขั้น)
      </button>
      {stepsOpen && (
        <ol style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, fontSize: '0.85rem', color: '#333333', lineHeight: 1.75 }}>
          {STEPS.map((s, i) => <li key={i}>{s}</li>)}
          <li style={{ listStyle: 'none', marginLeft: '-1.25rem', marginTop: '0.3rem', color: '#5a5a5a', fontSize: '0.8rem' }}>
            ติดขัดตรงไหน เปิด <a href={guideUrl} target="_blank" rel="noreferrer">คู่มือติดตั้งฉบับเต็ม</a> (มีหัวข้อแก้ปัญหา) หรือดับเบิลคลิก <code>check-printer.bat</code>
          </li>
        </ol>
      )}
    </div>
  );
};

export default PrintServerDownload;
