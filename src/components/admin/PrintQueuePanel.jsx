import React, { useCallback, useEffect, useState } from 'react';
import { Smartphone, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import {
  getPrintQueueStatus,
  fetchPrintAgentKey,
  getPrintQueueAgent,
  savePrintQueueAgent
} from '../../utils/printServer';
import { apiUrlAbsolute } from '../../utils/api';

// ===============================================================
// รับงานพิมพ์จากมือถือ/แท็บเล็ต (คิวงานพิมพ์)
// ---------------------------------------------------------------
// เครื่องที่ติดตั้ง Print Server: กดเปิดครั้งเดียว → ระบบส่งที่อยู่ API + สาขา + กุญแจของสาขา
//   ให้ Print Server แล้วมันจะดึงงานจากคิวมาพิมพ์เองทุก ~3 วินาที
// มือถือ/แท็บเล็ต: ไม่ต้องตั้งอะไร — ต่อ Print Server ตรง ๆ ไม่ได้ก็ส่งผ่านคิวให้เอง
//   กล่องนี้บอกแค่ว่า Print Server ของสาขาออนไลน์อยู่ไหม
// ===============================================================

const POLL_MS = 15000;

const ago = (seconds) => {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} นาทีที่แล้ว`;
  return `${Math.round(seconds / 3600)} ชั่วโมงที่แล้ว`;
};
const timeText = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleTimeString('th-TH');
};

const PrintQueuePanel = ({ health, branchId }) => {
  const serverHere = health.status === 'online';
  const [queue, setQueue] = useState(null);   // สถานะจาก API: { success, agent } หรือ { success:false, error, unsupported }
  const [local, setLocal] = useState(null);   // ค่าที่ Print Server เครื่องนี้เก็บไว้ (เฉพาะเครื่องที่ติดตั้ง)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { ok, text }

  const refresh = useCallback(async () => {
    const [q, l] = await Promise.all([
      getPrintQueueStatus(),
      serverHere ? getPrintQueueAgent() : Promise.resolve(null)
    ]);
    setQueue(q);
    setLocal(l);
  }, [serverHere]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = async (enable) => {
    setBusy(true);
    setMsg(null);
    try {
      if (enable) {
        const k = await fetchPrintAgentKey();
        if (!k.success) { setMsg({ ok: false, text: k.error }); return; }
        const res = await savePrintQueueAgent({ enabled: true, apiUrl: apiUrlAbsolute(), branchId: k.branchId || branchId || '', key: k.key });
        if (!res || !res.success) { setMsg({ ok: false, text: (res && res.error) || 'ตั้งค่า Print Server ไม่สำเร็จ' }); return; }
        setMsg({ ok: true, text: 'เปิดแล้ว — Print Server เครื่องนี้จะรับงานพิมพ์จากมือถือ/แท็บเล็ตของสาขานี้' });
      } else {
        const res = await savePrintQueueAgent({ enabled: false });
        if (!res || !res.success) { setMsg({ ok: false, text: (res && res.error) || 'ปิดไม่สำเร็จ' }); return; }
        setMsg({ ok: true, text: 'ปิดแล้ว — มือถือ/แท็บเล็ตจะสั่งพิมพ์ไม่ได้จนกว่าจะเปิดใหม่' });
      }
      // Print Server ดึงคิวรอบแรกทันที — รอสักครู่ให้สถานะออนไลน์ขึ้นก่อนอ่านใหม่
      setTimeout(refresh, 2500);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const agent = queue && queue.success ? queue.agent : null;
  const localOutdated = !!(local && local.outdated);
  const localOn = !!(local && local.success && local.enabled);

  let badge;
  if (!queue) badge = { color: '#7a0a1c', bg: '#fdf2f4', border: '#f5b5bf', icon: <RefreshCw size={13} />, text: 'กำลังตรวจสอบ...' };
  else if (!queue.success) badge = { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: <XCircle size={13} />, text: queue.unsupported ? 'API ยังไม่รองรับ' : 'ตรวจสอบไม่ได้' };
  else if (agent && agent.online) badge = { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', icon: <CheckCircle size={13} />, text: 'พร้อมรับงาน' };
  else badge = { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: <XCircle size={13} />, text: 'ยังไม่พร้อม' };

  const btn = (primary) => ({
    border: primary ? 'none' : '1px solid #d0d0d0', borderRadius: '10px', padding: '0.5rem 1rem', fontWeight: 800,
    fontSize: '0.85rem', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
    background: primary ? '#141414' : '#ffffff', color: primary ? '#ffffff' : '#333333'
  });

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e4e4e4', borderRadius: '14px', padding: '1rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <Smartphone size={18} style={{ color: '#141414' }} />
        <span style={{ fontWeight: 800, color: '#141414', fontSize: '0.98rem' }}>สั่งพิมพ์จากมือถือ / แท็บเล็ต</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color, borderRadius: '999px', padding: '1px 9px', fontSize: '0.76rem', fontWeight: 800 }}>
          {badge.icon} {badge.text}
        </span>
      </div>

      <div style={{ fontSize: '0.82rem', color: '#454545', lineHeight: 1.6, marginBottom: '0.7rem' }}>
        มือถือ/แท็บเล็ตติดต่อ Print Server ในร้านตรง ๆ ไม่ได้ ระบบจึงฝากงานพิมพ์ไว้ในคิวผ่านอินเทอร์เน็ต
        แล้วให้ Print Server ในร้านมารับไปพิมพ์ (ใบออกช้ากว่าพิมพ์ตรงไม่กี่วินาที) — มือถือ/แท็บเล็ต<b>ไม่ต้องตั้งค่าอะไร</b>
        ขอแค่ล็อกอินสาขาเดียวกัน
      </div>

      {/* สถานะ Print Server ของสาขา (เห็นได้จากทุกเครื่อง) */}
      {queue && queue.success && (
        <div style={{ fontSize: '0.84rem', color: agent && agent.online ? '#166534' : '#991b1b', fontWeight: 600, marginBottom: '0.6rem' }}>
          {agent && agent.online
            ? <>Print Server ของสาขาออนไลน์ — {agent.agent || 'ไม่ทราบชื่อเครื่อง'}{agent.version ? ` (v${agent.version})` : ''} · ติดต่อมาล่าสุด {ago(agent.secondsAgo)}</>
            : agent && agent.lastSeen
              ? <>Print Server ของสาขาออฟไลน์ — ติดต่อมาล่าสุด {ago(agent.secondsAgo)} ({agent.agent || 'ไม่ทราบชื่อเครื่อง'}) · เปิดคอมเครื่องนั้นและ Print Server</>
              : <>ยังไม่มี Print Server ของสาขานี้เปิดรับงาน — ทำที่<b>คอมเครื่องที่ติดตั้ง Print Server</b>: เปิดหน้านี้แล้วกดปุ่มเปิดรับงานด้านล่าง</>}
        </div>
      )}
      {queue && !queue.success && (
        <div style={{ fontSize: '0.82rem', color: '#991b1b', marginBottom: '0.6rem' }}>
          {queue.unsupported ? 'API ยังเป็นเวอร์ชันเก่า ยังไม่มีคิวงานพิมพ์ — ต้องอัปเดต API ก่อน' : queue.error}
        </div>
      )}

      {/* เครื่องที่ติดตั้ง Print Server: เปิด/ปิดการรับงาน */}
      {serverHere ? (
        localOutdated ? (
          <div style={{ background: '#fdf2f4', border: '1px solid #f5b5bf', color: '#7a0a1c', borderRadius: '10px', padding: '0.7rem 0.85rem', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.6 }}>
            ⚠️ Print Server เครื่องนี้ (v{health.info?.version || 'เก่า'}) ยังรับงานจากมือถือไม่ได้ — ต้องเป็น v1.6.0 ขึ้นไป
            ดาวน์โหลด Print Server ตัวใหม่ในกล่องด้านบน แตกไฟล์ทับ แล้วรัน <code>restart-print-server.bat</code>
          </div>
        ) : (
          <div style={{ background: '#f8f8f8', border: '1px solid #e4e4e4', borderRadius: '10px', padding: '0.75rem 0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#141414' }}>
                Print Server เครื่องนี้: {localOn ? <span style={{ color: '#15803d' }}>เปิดรับงานจากมือถือ/แท็บเล็ตอยู่</span> : <span style={{ color: '#5a5a5a' }}>ยังไม่ได้เปิดรับงาน</span>}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                {localOn ? (
                  <button type="button" disabled={busy} onClick={() => toggle(false)} style={btn(false)}>ปิดการรับงาน</button>
                ) : (
                  <button type="button" disabled={busy || !queue || (queue && queue.unsupported)} onClick={() => toggle(true)} style={btn(true)}>
                    {busy ? 'กำลังตั้งค่า...' : 'เปิดรับงานพิมพ์จากมือถือ/แท็บเล็ต'}
                  </button>
                )}
              </div>
            </div>
            {localOn && local && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.35rem 1rem', marginTop: '0.6rem', fontSize: '0.78rem', color: '#454545' }}>
                <span>ดึงคิวล่าสุด: {timeText(local.lastPollAt)}</span>
                <span>พิมพ์แล้ว: {local.printed || 0} งาน</span>
                <span>ไม่สำเร็จ: {local.failed || 0} งาน</span>
                <span>งานล่าสุด: {timeText(local.lastJobAt)}</span>
              </div>
            )}
            {localOn && local && local.lastError && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b91c1c', fontWeight: 600, display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {local.lastError}
              </div>
            )}
            <div style={{ marginTop: '0.45rem', fontSize: '0.76rem', color: '#5a5a5a', lineHeight: 1.5 }}>
              เปิดที่ Print Server เครื่องเดียวต่อสาขาก็พอ (เปิดสองเครื่องก็ไม่พิมพ์ซ้ำ) · ค่าที่ตั้งเก็บไว้ในเครื่องนี้ ปิด-เปิดคอมก็ยังทำงานต่อ
            </div>
          </div>
        )
      ) : (
        <div style={{ fontSize: '0.8rem', color: '#5a5a5a', lineHeight: 1.6 }}>
          เครื่องนี้ไม่ได้ติดตั้ง Print Server — งานพิมพ์จากเครื่องนี้จะส่งผ่านคิวให้เอง ดูผลได้ที่กล่องสถานะมุมล่างขวาของจอ หรือกด “ทดสอบพิมพ์” ด้านล่าง
        </div>
      )}

      {msg && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', fontWeight: 700, color: msg.ok ? '#15803d' : '#b91c1c' }}>{msg.text}</div>
      )}
    </div>
  );
};

export default PrintQueuePanel;
