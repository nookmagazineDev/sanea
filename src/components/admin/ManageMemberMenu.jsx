import React, { useEffect, useMemo, useState } from 'react';
import { Crown, Save, RefreshCw } from 'lucide-react';
import { API_URL } from '../../utils/api';

// หลังบ้าน > เมนูสมาชิก: จำการล็อกอินของลูกค้า · จำกัดการสั่งเมนูสมาชิกต่อวัน (นับเป็นชิ้น รวมทุกสาขา) · ใครสั่งอะไรวันนี้
// เมนูไหนเป็นเมนูสมาชิก ตั้งที่ หลังบ้าน > เมนู > "เฉพาะสมาชิก"
const card = { background: '#fff', border: '1px solid #e4e4e4', borderRadius: 14, padding: '1rem 1.1rem', marginBottom: '1rem' };
const h3 = { margin: '0 0 0.6rem', fontSize: '1.02rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 };
const hint = { color: '#5a5a5a', fontSize: '0.8rem', marginTop: '0.35rem' };
const num = { width: 72, textAlign: 'center', fontWeight: 800, fontSize: '1rem', border: '1.5px solid #d0d0d0', borderRadius: 10, padding: '0.35rem 0.4rem' };
const th = { textAlign: 'left', color: '#5a5a5a', fontWeight: 700, padding: '0.45rem 0.4rem', borderBottom: '1px solid #e4e4e4', fontSize: '0.85rem' };
const td = { padding: '0.5rem 0.4rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.88rem' };
const post = async (body) => {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ');
  return json;
};
const STATUS = { held: ['รอยืนยันโอน', '#fbe0e4', '#7a0a1c'], used: ['ชำระแล้ว', '#dcfce7', '#166534'], released: ['คืนสิทธิ์แล้ว', '#f1f1f1', '#5a5a5a'] };

const ManageMemberMenu = () => {
  const [data, setData] = useState(null);
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setMsg('');
    try { const j = await post({ action: 'getMemberMenuToday' }); setData(j); setS(j.settings); }
    catch (e) { setMsg('❌ โหลดไม่สำเร็จ: ' + e.message); }
  };
  useEffect(() => {
    let alive = true;
    post({ action: 'getMemberMenuToday' })
      .then(j => { if (alive) { setData(j); setS(j.settings); } })
      .catch(e => { if (alive) setMsg('❌ โหลดไม่สำเร็จ: ' + e.message); });
    return () => { alive = false; };
  }, []);

  const summary = useMemo(() => {
    const out = {};
    ((data && data.rows) || []).filter(r => r.Status !== 'released').forEach(r => {
      const o = out[r.MenuId] || (out[r.MenuId] = { qty: 0, members: new Set() });
      o.qty += Number(r.Qty) || 0; o.members.add(r.MemberId);
    });
    return out;
  }, [data]);

  if (!s) return <div style={{ padding: '1rem' }}>{msg || 'กำลังโหลด…'}</div>;
  const set = (patch) => { setS(prev => ({ ...prev, ...patch })); setMsg(''); };
  const setPer = (id, v) => { const n = parseInt(v, 10); const per = { ...s.perMenu }; if (n > 0) per[id] = n; else delete per[id]; set({ perMenu: per }); };
  const save = async () => {
    setBusy(true); setMsg('');
    try { const j = await post({ action: 'saveMemberMenuSettings', settings: s }); setS(j.settings); setMsg('✅ บันทึกแล้ว มีผลทันที'); }
    catch (e) { setMsg('❌ บันทึกไม่สำเร็จ: ' + e.message); }
    setBusy(false);
  };
  const menus = (data && data.menus) || [];
  const check = (key, label) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16, cursor: 'pointer' }}>
      <input type="checkbox" checked={s[key] !== false} onChange={e => set({ [key]: e.target.checked })} style={{ width: 18, height: 18 }} /> {label}
    </label>
  );

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, margin: '0 0 0.2rem' }}><Crown size={24} color="#a50d25" /> เมนูสมาชิก</h2>
      <p style={{ color: '#5a5a5a', marginTop: 0, fontSize: '0.9rem' }}>ตั้งค่าเมนูที่ติ๊ก "เฉพาะสมาชิก" ในหน้าจัดการเมนู · ใช้กับทุกสาขา · วันที่นับตอนนี้: <b>{data.day}</b></p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '1 1 380px' }}>
          <div style={h3}>🔐 การล็อกอินของลูกค้า (หน้าสั่งเอง)</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: '0.5rem', fontWeight: 700 }}>
            <input type="checkbox" checked={s.requireCode === true} onChange={e => set({ requireCode: e.target.checked })} style={{ width: 18, height: 18 }} />
            ต้องใส่รหัส 6 หลักจากบัตร LINE ก่อนสั่งเมนูสมาชิก
          </label>
          <div style={{ ...hint, marginBottom: '0.6rem' }}>{s.requireCode === true
            ? 'ปลอดภัย: ต้องเป็นเจ้าของบัตรจริงถึงสั่งได้'
            : 'ไม่ติ๊ก = ลูกค้าใส่เลขสมาชิกหรือเบอร์โทรก็สั่งเมนูสมาชิกได้เลย (สะดวก แต่คนที่รู้เบอร์คนอื่นใช้สิทธิ์/โควตาแทนได้)'}</div>
          <label>จำการล็อกอินไว้ในมือถือลูกค้า{' '}
            <input type="number" min={0} max={90} value={s.rememberDays} onChange={e => set({ rememberDays: Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0)) })} style={num} /> วัน
          </label>
          <div style={hint}>ล็อกอินครั้งเดียว (เลขสมาชิก + รหัส 6 หลักในบัตร LINE) ครั้งต่อไปสแกน QR โต๊ะแล้วเป็นสมาชิกเลย ไม่ต้องยืนยันซ้ำ · ใช้ได้ทั้งเมนูสมาชิก คูปอง และแลกแต้ม · ลูกค้ากด "ออกจากระบบ" เองได้ · 0 = ต้องยืนยันใหม่ทุก 1 ชั่วโมง · สูงสุด 90 วัน · มีผลกับการล็อกอินครั้งถัดไป</div>
        </div>
        <div style={{ ...card, flex: '1 1 260px' }}>
          <div style={h3}>📅 วันใหม่เริ่มนับเมื่อ</div>
          <label>เวลา{' '}
            <select value={s.dayStart} onChange={e => set({ dayStart: e.target.value })} style={{ ...num, width: 110 }}>
              {Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).concat(/:00$/.test(s.dayStart) ? [] : [s.dayStart]).map(v => <option key={v} value={v}>{v} น.</option>)}
            </select> (เวลาไทย)
          </label>
          <div style={hint}>จำนวนที่สั่งไปแล้วของสมาชิกแต่ละคนเริ่มนับใหม่ทุกวันตามเวลานี้</div>
        </div>
      </div>

      <div style={card}>
        <div style={h3}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.limitEnabled} onChange={e => set({ limitEnabled: e.target.checked })} style={{ width: 20, height: 20 }} />
            จำกัดการสั่งเมนูสมาชิกต่อวัน
          </label>
        </div>
        <div style={{ opacity: s.limitEnabled ? 1 : 0.5 }}>
          <label>สมาชิก 1 คน สั่งเมนูสมาชิก <b>รวมทุกเมนู</b> ได้ไม่เกิน{' '}
            <input type="number" min={0} value={s.totalLimit || ''} placeholder="—" onChange={e => set({ totalLimit: parseInt(e.target.value, 10) > 0 ? parseInt(e.target.value, 10) : null })} style={num} disabled={!s.limitEnabled} /> ชิ้นต่อวัน
          </label>
          <div style={hint}>นับเป็นชิ้น รวมทุกสาขา · เว้นว่าง = ไม่จำกัดรวม (ใช้แค่จำนวนของแต่ละเมนูด้านล่าง) · ออเดอร์ที่ลูกค้าแจ้งโอนแล้วนับทันที ถ้าพนักงานปฏิเสธ ยกเลิกบิล หรือคืนเงิน จะคืนสิทธิ์ให้</div>
          <div style={{ marginTop: '0.6rem' }}>ใช้กับ: {check('applyKiosk', 'หน้าลูกค้าสั่งเอง')}{check('applyStaff', 'หน้าขายพนักงาน')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.8rem' }}>
            <thead><tr><th style={th}>เมนูสมาชิก</th><th style={th}>ราคา</th><th style={th}>จำกัดต่อคนต่อวัน</th><th style={th}>วันนี้สั่งไปแล้ว</th></tr></thead>
            <tbody>
              {menus.length === 0 && <tr><td style={td} colSpan={4}>ยังไม่มีเมนูสมาชิก — ไปที่ หลังบ้าน &gt; เมนู แล้วติ๊ก "เฉพาะสมาชิก"</td></tr>}
              {menus.map(m => (
                <tr key={m.id}>
                  <td style={td}>{m.name}</td>
                  <td style={td}>{m.price.toLocaleString()}</td>
                  <td style={td}><input type="number" min={0} value={s.perMenu[m.id] || ''} placeholder="—" onChange={e => setPer(m.id, e.target.value)} style={num} disabled={!s.limitEnabled} /> {s.perMenu[m.id] ? 'ชิ้น' : 'ไม่จำกัด'}</td>
                  <td style={td}>{summary[m.id] ? `${summary[m.id].members.size} คน · ${summary[m.id].qty} ชิ้น` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1rem' }}>
        <button onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.7rem 1.4rem', borderRadius: 12, border: 0, background: '#16a34a', color: '#fff', fontWeight: 900, fontSize: '1rem', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <Save size={18} /> {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        {msg && <span role="status" style={{ fontWeight: 700, color: msg.startsWith('❌') ? '#dc2626' : '#166534' }}>{msg}</span>}
      </div>

      <div style={card}>
        <div style={{ ...h3, justifyContent: 'space-between' }}>
          <span>🧾 สมาชิกที่สั่งเมนูสมาชิกวันนี้</span>
          <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #d0d0d0', background: '#fff', borderRadius: 8, padding: '0.3rem 0.6rem', fontWeight: 700, cursor: 'pointer' }}><RefreshCw size={14} /> รีเฟรช</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>เวลา</th><th style={th}>สมาชิก</th><th style={th}>เมนู</th><th style={th}>จำนวน</th><th style={th}>ช่องทาง</th><th style={th}>สาขา</th><th style={th}>บิล</th><th style={th}>สถานะ</th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td style={td} colSpan={8}>วันนี้ยังไม่มีใครสั่งเมนูสมาชิก</td></tr>}
              {data.rows.map((r, i) => {
                const st = STATUS[r.Status] || [r.Status, '#f1f1f1', '#333333'];
                return (
                  <tr key={i} style={{ opacity: r.Status === 'released' ? 0.55 : 1 }}>
                    <td style={td}>{String(r.at || '').slice(11, 16)}</td>
                    <td style={td}>{r.MemberId}</td>
                    <td style={td}>{r.MenuName}</td>
                    <td style={td}>{r.Qty}</td>
                    <td style={td}>{r.Channel === 'staff' ? 'พนักงาน' : 'สั่งเอง'}</td>
                    <td style={td}>{r.BranchId || '-'}</td>
                    <td style={td}>{r.OrderNumber || '-'}</td>
                    <td style={td}><span style={{ background: st[1], color: st[2], borderRadius: 20, padding: '2px 9px', fontWeight: 800, fontSize: '0.78rem' }}>{st[0]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ManageMemberMenu;
