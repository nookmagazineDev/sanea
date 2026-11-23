import React, { useEffect, useRef, useState } from 'react';
import { PRINT_JOB_EVENT, PRINT_STEP_LABEL } from '../utils/printServer';
import { getPrinters } from '../utils/printerRouting';
import PrintSteps from './PrintSteps';

// ===============================================================
// กล่องสถานะการพิมพ์ มุมล่างขวาของจอ
// ---------------------------------------------------------------
// ทุกงานที่สั่งพิมพ์ (ใบครัว ใบเสร็จ ใบแจ้งยอด ...) ขึ้นให้เห็นว่า
//   กำลังพิมพ์ → พิมพ์เสร็จแล้ว ✓ (หายเองใน 4 วินาที)
//            → พิมพ์ไม่ออก ✕ ติดที่ขั้นไหน + วิธีแก้ (ค้างไว้จนกดปิด)
// ===============================================================

const MAX_JOBS = 4;
const AUTO_HIDE_MS = { done: 4000, sent: 8000 };

const PHASE_STYLE = {
  printing: { color: '#141414', bg: '#f5f5f5', border: '#d0d0d0', title: 'กำลังพิมพ์...' },
  done: { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', title: 'พิมพ์เสร็จแล้ว ✓' },
  sent: { color: '#8e0b20', bg: '#fdf2f4', border: '#f5b5bf', title: 'ส่งถึงเครื่องพิมพ์แล้ว — ไม่ได้รับการยืนยัน' },
  error: { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', title: 'พิมพ์ไม่ออก ✕' }
};

const printerNameOf = (ip) => {
  try {
    const p = getPrinters().find(x => x.ip === ip);
    return p && p.name ? `${p.name} (${ip})` : ip;
  } catch (e) {
    return ip;
  }
};

const PrintStatusToast = () => {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState({}); // { [id]: true } = เปิดดูขั้นตอน
  const timers = useRef({});

  useEffect(() => {
    const dismiss = (id) => {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
      setJobs(prev => prev.filter(j => j.id !== id));
    };
    const onJob = (e) => {
      const job = e.detail;
      if (!job || job.silent) return;
      setJobs(prev => {
        const rest = prev.filter(j => j.id !== job.id);
        return [...rest, { ...job, printerLabel: printerNameOf(job.ip) }].slice(-MAX_JOBS);
      });
      const hideIn = AUTO_HIDE_MS[job.phase];
      if (hideIn) {
        clearTimeout(timers.current[job.id]);
        timers.current[job.id] = setTimeout(() => dismiss(job.id), hideIn);
      }
    };
    window.addEventListener(PRINT_JOB_EVENT, onJob);
    const pending = timers.current;
    return () => {
      window.removeEventListener(PRINT_JOB_EVENT, onJob);
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  if (jobs.length === 0) return null;

  const close = (id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setJobs(prev => prev.filter(j => j.id !== id));
  };
  const toggle = (id) => {
    // เปิดดูขั้นตอนแล้วไม่ให้หายเองระหว่างอ่าน
    clearTimeout(timers.current[id]);
    setOpen(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 4900,
      display: 'flex', flexDirection: 'column', gap: 8,
      width: 'min(360px, calc(100vw - 32px))', pointerEvents: 'none'
    }}>
      {jobs.map(job => {
        const style = PHASE_STYLE[job.phase] || PHASE_STYLE.printing;
        const expanded = !!open[job.id] || job.phase === 'error';
        const summary = job.phase === 'error'
          ? `ติดที่: ${PRINT_STEP_LABEL[job.stage] || job.stage || '-'}`
          : job.phase === 'sent' ? (job.warning || 'ดูที่เครื่องพิมพ์ว่ากระดาษออกไหม') : '';
        return (
          <div key={job.id} style={{
            pointerEvents: 'auto', background: style.bg, border: `1px solid ${style.border}`,
            borderRadius: 12, padding: '0.65rem 0.8rem', boxShadow: '0 6px 20px rgba(20, 20, 20, 0.15)',
            fontFamily: 'inherit'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: style.color }}>
                  🖨️ {style.title}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#333333', marginTop: 2 }}>
                  {job.typeLabel}{job.orderNumber ? ` ${job.orderNumber}` : ''} → {job.printerLabel}
                  {job.via === 'queue' && <span style={{ color: '#5a5a5a' }}> · ผ่านคิว{job.phase === 'printing' ? ' (รอ Print Server ในร้าน)' : ''}</span>}
                </div>
                {summary && (
                  <div style={{ fontSize: '0.78rem', color: style.color, marginTop: 2, fontWeight: 600, lineHeight: 1.4 }}>{summary}</div>
                )}
              </div>
              <button type="button" onClick={() => close(job.id)} aria-label="ปิด"
                style={{ background: 'transparent', border: 'none', color: '#5a5a5a', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>
                ×
              </button>
            </div>
            {job.phase !== 'printing' && (
              <>
                {expanded && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${style.border}` }}>
                    <PrintSteps steps={job.steps} stage={job.stage} error={job.error} via={job.via} compact />
                  </div>
                )}
                {job.phase !== 'error' && (
                  <button type="button" onClick={() => toggle(job.id)}
                    style={{ marginTop: 6, background: 'transparent', border: 'none', padding: 0, color: '#454545', fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
                    {expanded ? 'ซ่อนขั้นตอน' : 'ดูขั้นตอน'}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PrintStatusToast;
