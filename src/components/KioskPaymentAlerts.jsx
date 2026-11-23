import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../utils/api';
import { printKitchenOrder } from '../utils/printerRouting';
import { runAutoPrintNow } from '../utils/printServer';

// ── ลูกค้าสแกน QR แจ้งโอนเงิน → เด้งการ์ดที่หน้าขายของสาขานั้น ──
// หลายโต๊ะพร้อมกัน = การ์ดซ้อนกัน รอนานสุดอยู่บน · การ์ดเต็ม 2 ใบแรก ที่เหลือย่อเป็นแถบ (กดเพื่อขยาย)
// ทุกเครื่องหน้าขายของสาขาเดียวกันเห็นชุดเดียวกัน ใครกดก่อน เครื่องอื่นหายเองในรอบดึงถัดไป
// เสียงเตือนดังต่อเนื่องจนกว่าจะไม่เหลือรายการรอยืนยัน

const POLL_MS = 5000;
// เสียงหนึ่งชุดยาว ~1 วินาที → เริ่มชุดใหม่ทุก 1.25 วินาที = ดังต่อเนื่อง
const RING_EVERY_MS = 1250;
const FULL_CARDS = 2;

const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minutesAgo = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  return m <= 0 ? 'เมื่อสักครู่' : `รอมา ${m} นาที`;
};
const clock = (iso) => {
  try { return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) + ' น.'; }
  catch { return ''; }
};
const tableLabel = (p) => {
  const t = String(p.tableNo || '').trim();
  if (!t || t === p.dining || /^(takehome|ทานที่ร้าน|ห่อกลับบ้าน)$/i.test(t)) return p.dining || 'สั่งเอง';
  return /^\d+$/.test(t) ? `โต๊ะ ${t}` : t;
};

// ── เสียงเตือน (สร้างจากเบราว์เซอร์ ไม่ต้องมีไฟล์เสียง) ──
// "ติ๊ง-ต่อง-ติ๊ง" 2 รอบ เสียงแหลมช่วง 1–2 kHz ที่ลำโพงแท็บเล็ต/มือถือเล่นได้ดังที่สุด
// ผ่านตัวบีบเสียง (compressor) ให้ดังเต็มที่โดยไม่แตก
let audioCtx = null;
let master = null;
const getCtx = () => {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    master = audioCtx.createGain();
    master.gain.value = 1;
    // ชดเชยความดังหลังบีบเสียง ให้ยอดเสียงเกือบเต็มสเกล (~0.9) แต่ไม่แตก
    const boost = audioCtx.createGain();
    boost.gain.value = 1.7;
    master.connect(comp).connect(boost).connect(audioCtx.destination);
  }
  return audioCtx;
};
// เบราว์เซอร์ไม่ให้เล่นเสียงจนกว่าจะมีคนแตะจอสักครั้ง — แตะตรงไหนก็ได้ = ปลดล็อก
const unlockAudio = () => {
  const ctx = getCtx();
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
};
const soundReady = () => !!audioCtx && audioCtx.state === 'running';

const NOTES = [1568, 1175, 1568]; // G6 – D6 – G6
const tone = (ctx, freq, at, len) => {
  // 2 เสียงซ้อน (square + triangle คู่แปด) = ชัดและแหลมกว่า sine เดิมมาก
  [['square', freq, 0.22], ['triangle', freq * 2, 0.35]].forEach(([type, f, vol]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.setValueAtTime(vol, at + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + len + 0.02);
  });
};
const alarm = () => {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.05;
    [0, 0.85].forEach(round => NOTES.forEach((f, i) => tone(ctx, f, t0 + round + i * 0.22, 0.18)));
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch { /* เบราว์เซอร์ไม่ให้เล่นเสียง */ }
};

// ใบครัวของบิลที่เพิ่งยืนยัน — ปกติ Print Server (พิมพ์อัตโนมัติ) พิมพ์เอง สั่งให้ดึงเดี๋ยวนี้เลยจะได้ไม่ต้องรอรอบ
// Print Server ยังไม่ได้ตั้งพิมพ์อัตโนมัติ (ไม่มี URL API) หรือเพิ่งเริ่มรอบแรก → เครื่องนี้สั่งพิมพ์เองแทน
const printKitchen = async (payment, allMenu) => {
  const r = await runAutoPrintNow().catch(() => null);
  const res = r && r.result;
  const autoHandled = r && r.success && res && !('baseline' in res) && !(res.skipped && /URL/.test(res.skipped));
  if (autoHandled) return { success: true };
  const table = String(payment.tableNo || '');
  return printKitchenOrder({
    id: payment.orderNumber,
    orderNumber: payment.orderNumber,
    dining: payment.dining || '',
    customerDetails: { name: `โต๊ะ ${table}`, address: `โต๊ะ ${table}` },
    items: (payment.items || []).map(it => ({
      isFlattened: true,
      name: it.qty > 1 ? `${it.name} (x${it.qty})` : it.name,
      subItems: it.options ? String(it.options).split(', ').filter(Boolean) : []
    }))
  }, allMenu);
};

export default function KioskPaymentAlerts({ branchId = '', userName = '', allMenu = [], onApproved }) {
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState({});          // id → 'approve' | 'reject'
  const [expanded, setExpanded] = useState({});  // แถบที่กดขยาย
  const [notice, setNotice] = useState('');
  const hidden = useRef(new Set());              // เพิ่งกดไป — ซ่อนไว้ก่อนระหว่างรอรอบดึงถัดไป

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}?action=getPendingKioskPayments&branch=${encodeURIComponent(branchId || '')}`);
      const json = await res.json();
      if (json && json.success && Array.isArray(json.payments)) {
        setPayments(json.payments.filter(p => !hidden.current.has(p.id)));
      }
    } catch { /* เน็ตหลุด — รอบหน้าลองใหม่ */ }
  }, [branchId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // ปลดล็อกเสียงตั้งแต่พนักงานแตะจอครั้งแรก (ก่อนมีลูกค้าแจ้งโอน) จะได้ดังทันทีตอนมีรายการเข้า
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, []);

  // เสียงเตือนดังต่อเนื่องไม่หยุด (เว้นแค่ช่วงหายใจสั้น ๆ) จนกว่าจะยืนยัน/ปฏิเสธครบทุกโต๊ะ
  // แท็บที่กำลังเล่นเสียงอยู่ เบราว์เซอร์ไม่หน่วงตัวจับเวลา จึงดังต่อเนื่องแม้สลับไปหน้าอื่น
  const hasPending = payments.length > 0;
  useEffect(() => {
    if (!hasPending) return undefined;
    alarm();
    const t = setInterval(alarm, RING_EVERY_MS);
    return () => clearInterval(t);
  }, [hasPending]);
  // เสียงยังถูกเบราว์เซอร์ปิดอยู่ไหม (ไม่มีใครแตะจอเลยตั้งแต่เปิดหน้า) — โชว์ปุ่มให้กดเปิด
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    if (!hasPending) { setMuted(false); return undefined; }
    const check = () => setMuted(!soundReady());
    const t = setTimeout(check, 400);
    const i = setInterval(check, 2000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [hasPending]);

  const respond = async (p, approve) => {
    if (busy[p.id]) return;
    if (!approve && !window.confirm(`ยืนยันว่ายังไม่ได้รับเงินจาก ${tableLabel(p)} ยอด ฿${money(p.total)}?\nลูกค้าจะเห็นข้อความให้ตรวจสอบการโอน/แจ้งพนักงาน`)) return;
    setBusy(b => ({ ...b, [p.id]: approve ? 'approve' : 'reject' }));
    setNotice('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'respondKioskPayment', id: p.id, approve, by: userName })
      });
      const json = await res.json().catch(() => null);
      if (!json || !json.success) {
        setNotice(`❌ ${tableLabel(p)}: ${(json && json.error) || 'ทำรายการไม่สำเร็จ'}`);
        if (json && /จัดการไปแล้ว/.test(json.error || '')) { hidden.current.add(p.id); setPayments(list => list.filter(x => x.id !== p.id)); }
      } else {
        hidden.current.add(p.id);
        setPayments(list => list.filter(x => x.id !== p.id));
        if (approve) {
          const paid = { ...p, ...(json.payment || {}) };
          setNotice(`✅ ${tableLabel(p)} ยืนยันแล้ว · บิล ${paid.orderNumber || '-'} · กำลังพิมพ์ใบครัว`);
          onApproved && onApproved(paid);
          // สั่งก่อนจ่ายทีหลัง: ครัวได้ใบตั้งแต่ตอนลูกค้าสั่งแล้ว — ยืนยันยอด = ปิดบิลอย่างเดียว
          if (p.payLater) setNotice(`✅ ${tableLabel(p)} รับเงินแล้ว · ปิดบิล ${paid.orderNumber || '-'}`);
          else if (!json.already) {
            const pr = await printKitchen(paid, allMenu);
            setNotice(pr && pr.success
              ? `✅ ${tableLabel(p)} ยืนยันแล้ว · บิล ${paid.orderNumber || '-'} · ส่งใบครัวแล้ว`
              : `⚠️ ${tableLabel(p)} ยืนยันแล้ว (บิล ${paid.orderNumber || '-'}) แต่พิมพ์ใบครัวไม่สำเร็จ: ${(pr && pr.error) || 'เช็ก Print Server'} — พิมพ์ซ้ำได้ที่โต๊ะนั้น`);
          }
        } else {
          setNotice(`${tableLabel(p)}: แจ้งลูกค้าแล้วว่ายังไม่ได้รับเงิน`);
        }
        setTimeout(() => hidden.current.delete(p.id), 30000);
      }
    } catch (e) {
      setNotice(`❌ ${tableLabel(p)}: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้`);
    }
    setBusy(b => { const n = { ...b }; delete n[p.id]; return n; });
  };

  if (payments.length === 0) {
    return notice ? (
      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 3000, background: '#141414', color: '#fff', borderRadius: 12, padding: '0.7rem 1rem', fontWeight: 700, maxWidth: 420, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{notice}</span>
        <button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', color: '#7a7a7a', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
      </div>
    ) : null;
  }

  const newestId = payments.reduce((a, p) => (!a || p.requestedAt > a.requestedAt ? p : a), null)?.id;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(20, 20, 20, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '2vh 1rem' }}>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'inherit', color: '#141414' }}>
        <div style={{ background: '#141414', color: '#fff', borderRadius: 14, padding: '0.7rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800 }}>
          <span>🔔 ลูกค้าแจ้งโอนชำระเงิน</span>
          <span style={{ background: '#c8102e', borderRadius: 999, padding: '0.1rem 0.7rem', fontSize: '0.85rem' }}>รอยืนยัน {payments.length} โต๊ะ</span>
        </div>
        {muted && (
          <button onClick={() => { unlockAudio(); setTimeout(alarm, 150); setTimeout(() => setMuted(!soundReady()), 500); }}
            style={{ background: '#f5b5bf', border: '2px solid #a50d25', borderRadius: 12, padding: '0.7rem 1rem', fontWeight: 800, fontSize: '0.95rem', color: '#5c0815', cursor: 'pointer', fontFamily: 'inherit' }}>
            🔇 เบราว์เซอร์ปิดเสียงแจ้งเตือนไว้ — แตะตรงนี้เพื่อเปิดเสียง
          </button>
        )}
        {notice && <div style={{ background: '#fff', borderRadius: 10, padding: '0.55rem 0.8rem', fontWeight: 700, fontSize: '0.88rem' }}>{notice}</div>}

        {payments.map((p, idx) => {
          const isNew = p.id === newestId && payments.length > 1;
          const full = idx < FULL_CARDS || expanded[p.id];
          const accent = isNew ? '#ef4444' : '#c8102e';
          if (!full) {
            return (
              <button key={p.id} onClick={() => setExpanded(e => ({ ...e, [p.id]: true }))}
                style={{ background: '#fff', borderRadius: 12, padding: '0.65rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `2px solid ${accent}`, fontWeight: 800, fontSize: '0.92rem', cursor: 'pointer', fontFamily: 'inherit', color: '#141414', textAlign: 'left' }}>
                <span>{p.dining === 'ห่อกลับบ้าน' ? '🛍️' : '🍽️'} {tableLabel(p)} · {p.dining} <span style={{ color: '#5a5a5a', fontWeight: 600, fontSize: '0.8rem' }}>· {p.items.length} รายการ · {minutesAgo(p.requestedAt)}</span></span>
                <span style={{ color: '#c8102e' }}>฿{money(p.total)} ▾</span>
              </button>
            );
          }
          const b = busy[p.id];
          return (
            <div key={p.id} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: `3px solid ${accent}`, boxShadow: '0 12px 30px rgba(0,0,0,0.25)' }}>
              <div style={{ background: accent, color: '#fff', padding: '0.55rem 0.9rem', fontWeight: 900, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{isNew ? 'ใหม่ · ' : ''}{tableLabel(p)}</span>
                <span style={{ background: '#fff', color: isNew ? '#dc2626' : '#8e0b20', borderRadius: 999, padding: '0.05rem 0.6rem', fontSize: '0.75rem' }}>{minutesAgo(p.requestedAt)}</span>
              </div>
              <div style={{ padding: '0.7rem 0.9rem' }}>
                <div style={{ fontSize: '1.35rem', fontWeight: 900 }}>{tableLabel(p)}{p.dining && tableLabel(p) !== p.dining ? ` · ${p.dining}` : ''}</div>
                <div style={{ color: '#5a5a5a', fontSize: '0.78rem' }}>{p.payLater ? 'ขอชำระทั้งบิล · อาหารส่งเข้าครัวไปแล้ว' : 'สั่งผ่าน QR'} · แจ้งโอน {clock(p.requestedAt)}</div>
                <div style={{ marginTop: 6 }}>
                  {p.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.88rem', padding: '0.1rem 0' }}>
                      <span>{it.qty}× {it.name}{it.options ? <span style={{ color: '#5a5a5a' }}> ({it.options})</span> : null}</span>
                      <b>฿{Number(it.amount || 0).toLocaleString()}</b>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '1.1rem', borderTop: '1px dashed #d0d0d0', marginTop: 6, paddingTop: 6 }}>
                  <span>ยอดที่ต้องได้รับ</span><span style={{ color: '#c8102e' }}>฿{money(p.total)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button disabled={!!b} onClick={() => respond(p, false)}
                    style={{ flex: 1, borderRadius: 10, padding: '0.65rem', fontWeight: 800, fontSize: '0.88rem', border: '1.5px solid #fecaca', background: '#fff', color: '#dc2626', cursor: b ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {b === 'reject' ? 'กำลังส่ง...' : '✕ ยังไม่ได้รับเงิน'}
                  </button>
                  <button disabled={!!b} onClick={() => respond(p, true)}
                    style={{ flex: 1.6, borderRadius: 10, padding: '0.65rem', fontWeight: 800, fontSize: '0.9rem', border: 'none', background: '#16a34a', color: '#fff', cursor: b ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {b === 'approve' ? 'กำลังยืนยัน...' : (p.payLater ? '✅ ได้รับเงินแล้ว · ปิดบิล' : '✅ ได้รับเงินแล้ว · ส่งเข้าครัว')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ color: '#e4e4e4', fontSize: '0.78rem', textAlign: 'center' }}>เช็กยอดเงินเข้าในแอปธนาคารของร้านก่อนกดยืนยัน</div>
      </div>
    </div>
  );
}
