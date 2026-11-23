import React from 'react';
import { PRINT_STEPS, PRINT_QUEUE_STEPS, PRINT_STEP_LABEL, PRINT_STAGE_TIPS } from '../utils/printServer';

// รายการขั้นตอนการพิมพ์ ✓ / ⚠ / ✗ — ติดขั้นไหนเห็นทันทีพร้อมวิธีแก้
// ใช้ทั้งในกล่องสถานะการพิมพ์มุมจอ และใต้ปุ่ม "ทดสอบพิมพ์"
const ICON = {
  ok: { char: '✓', color: '#16a34a', bg: '#dcfce7' },
  warn: { char: '!', color: '#8e0b20', bg: '#fbe0e4' },
  fail: { char: '✕', color: '#dc2626', bg: '#fee2e2' },
  wait: { char: '…', color: '#141414', bg: '#efefef' },
  skip: { char: '', color: '#7a7a7a', bg: '#f1f1f1' }
};

const PrintSteps = ({ steps, stage, error, printing = false, compact = false, via }) => {
  const byKey = Object.fromEntries((steps || []).map(s => [s.key, s]));
  // ส่งผ่านคิว (มือถือ/แท็บเล็ต) มีขั้นของคิวแทนขั้น "หน้าเว็บ → Print Server"
  const queued = via === 'queue' || 'queue' in byKey || 'agent' in byKey || stage === 'queue' || stage === 'agent';
  const base = queued ? PRINT_QUEUE_STEPS : PRINT_STEPS;
  // ขั้นที่ไม่อยู่ในรายการมาตรฐาน (เช่น format = จัดหน้าใบพิมพ์ไม่สำเร็จ) แสดงต่อท้าย
  const keys = base.map(s => s.key);
  if (stage && !keys.includes(stage)) keys.push(stage);
  const failed = !printing && !!error;
  const extraFail = failed && stage && !byKey[stage] ? { key: stage, status: 'fail', detail: error } : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '0.3rem' : '0.45rem' }}>
      {keys.map((key, i) => {
        let step = byKey[key] || (extraFail && extraFail.key === key ? extraFail : null);
        // ระหว่างพิมพ์: ขั้นถัดจากขั้นล่าสุดที่ผ่านแล้วคือขั้นที่กำลังรอ
        if (!step && printing) {
          const waiting = i === keys.findIndex(k => !byKey[k]);
          step = { key, status: waiting ? 'wait' : 'skip', detail: waiting ? (key === 'agent' ? 'รอ Print Server ในร้านมารับงาน...' : 'กำลังส่งงาน...') : '' };
        }
        if (!step && !keys.slice(base.length).includes(key)) step = { key, status: 'skip', detail: '' };
        if (!step) return null;
        const status = step.status === 'pending' ? 'skip' : step.status;
        const icon = ICON[status] || ICON.skip;
        return (
          <div key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', opacity: status === 'skip' ? 0.55 : 1 }}>
            <span style={{
              flexShrink: 0, width: 18, height: 18, borderRadius: 999, marginTop: 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800, color: icon.color, background: icon.bg,
              border: status === 'skip' ? '1px dashed #d0d0d0' : 'none'
            }}>{icon.char}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: compact ? '0.78rem' : '0.82rem', fontWeight: 700, color: status === 'skip' ? '#5a5a5a' : '#141414' }}>
                {PRINT_STEP_LABEL[key] || key}
                {status === 'skip' && !printing && <span style={{ fontWeight: 500 }}> — ไม่ได้ทำ</span>}
              </div>
              {step.detail && status !== 'skip' && (
                <div style={{ fontSize: compact ? '0.74rem' : '0.78rem', color: icon.color === '#16a34a' ? '#454545' : icon.color, lineHeight: 1.45, wordBreak: 'break-word' }}>
                  {step.detail}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {failed && PRINT_STAGE_TIPS[stage] && (
        <div style={{ marginTop: '0.2rem', padding: '0.5rem 0.65rem', borderRadius: 8, background: '#fdf2f4', border: '1px solid #f5b5bf', color: '#7a0a1c', fontSize: compact ? '0.76rem' : '0.8rem', lineHeight: 1.45 }}>
          <strong>วิธีแก้:</strong> {PRINT_STAGE_TIPS[stage]}
        </div>
      )}
    </div>
  );
};

export default PrintSteps;
