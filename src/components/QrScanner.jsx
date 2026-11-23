import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { X } from 'lucide-react';

// กล่องสแกน QR ด้วยกล้อง (บัตรสมาชิก / คูปองใน LINE) · อ่านได้ครั้งเดียวแล้วปิดเอง
// ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (เร็วกว่า) ไม่มีก็ใช้ jsQR อ่านจากภาพทีละเฟรม
const QrScanner = ({ open, onResult, onClose, title = 'สแกน QR' }) => {
  const videoRef = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let stream = null;
    let timer = null;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;

    const finish = (text) => {
      if (done) return;
      done = true;
      if (navigator.vibrate) navigator.vibrate(80);
      onResult(text);
    };
    const scan = async () => {
      const v = videoRef.current;
      if (done || !v || v.readyState < 2) return;
      try {
        if (detector) {
          const found = await detector.detect(v);
          if (found.length && found[0].rawValue) return finish(found[0].rawValue);
          return;
        }
      } catch { /* เบราว์เซอร์บางตัวมี BarcodeDetector แต่อ่านไม่ได้ → ใช้ jsQR */ }
      const w = Math.min(640, v.videoWidth); const h = Math.round(v.videoHeight * w / v.videoWidth);
      if (!w || !h) return;
      canvas.width = w; canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data) finish(code.data);
    };

    setErr('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErr('เครื่องนี้เปิดกล้องจากหน้าเว็บไม่ได้ · ยิง QR ด้วยเครื่องยิงได้เลย');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (done) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play().catch(() => {}); }
        timer = setInterval(scan, 200);
      })
      .catch((e) => setErr(e && e.name === 'NotAllowedError'
        ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง กดอนุญาตกล้องในเบราว์เซอร์แล้วลองใหม่ · หรือยิงด้วยเครื่องยิง QR ได้เลย'
        : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')
          ? 'เครื่องนี้ไม่มีกล้อง · ยิง QR ด้วยเครื่องยิงได้เลยตอนนี้ (ครั้งหน้าไม่ต้องกดปุ่มสแกน ยิงได้เลย)'
          : 'เปิดกล้องไม่ได้: ' + ((e && e.message) || 'ไม่พบกล้อง') + ' · ยิงด้วยเครื่องยิง QR ได้เลย'));

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [open, onResult]);

  if (!open) return null;
  // วาดที่ body (ไม่อยู่ในกล่องชำระเงิน ที่อาจมี transform ทำให้ position: fixed เพี้ยน)
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20, 20, 20, 0.75)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '420px', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e4e4e4' }}>
          <b>{title}</b>
          <button type="button" onClick={onClose} aria-label="ปิด" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4 }}><X size={22} /></button>
        </div>
        <div style={{ position: 'relative', overflow: 'hidden', background: '#000', aspectRatio: '1 / 1' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div aria-hidden="true" style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,0.9)', borderRadius: '16px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} />
        </div>
        <div style={{ padding: '12px 16px', fontSize: '0.9rem', color: err ? '#dc2626' : '#454545', fontWeight: err ? 700 : 400 }} role={err ? 'alert' : undefined}>
          {err || 'ส่อง QR บัตรสมาชิก หรือ QR คูปองในบัตรสมาชิก LINE ให้อยู่ในกรอบ'}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QrScanner;
