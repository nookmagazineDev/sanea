import React, { useEffect, useMemo, useState } from 'react';
import { Receipt, Upload, Trash2, Save, Printer, Info } from 'lucide-react';
import { API_URL } from '../../utils/api';
import { getReceiptHeader, sendPrintJob } from '../../utils/printServer';
import { normalizeReceipt, shrinkSource, makePrintLogo, PAPER_DOTS } from '../../utils/receiptStyle';

// หลังบ้าน > ใบเสร็จ: โลโก้บนหัวใบเสร็จ (อัปโหลด · ปรับขนาด · ปรับความเข้ม) และเลือกรายละเอียดที่แสดง
// ใช้กับทุกสาขา · ชื่อร้าน/ที่อยู่/เบอร์/เลขผู้เสียภาษี/ข้อความท้ายใบ ยังตั้งแยกสาขาที่เมนู "สาขา"
const card = { background: '#fff', border: '1px solid #e4e4e4', borderRadius: '14px', padding: '1rem 1.1rem', marginBottom: '1rem' };
const label = { fontWeight: 800, fontSize: '0.92rem', color: '#141414', marginBottom: '0.5rem', display: 'block' };
const hint = { fontSize: '0.8rem', color: '#5a5a5a', marginTop: '0.35rem' };

const ManageReceipt = ({ receiptSettings, onSaved, branches = [], branchId = '' }) => {
  const [draft, setDraft] = useState(() => normalizeReceipt(receiptSettings));
  const [preview, setPreview] = useState(draft.logo || '');   // โลโก้ขาว-ดำตามขนาด/ความเข้มที่ตั้งอยู่
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);
  const [previewBranch, setPreviewBranch] = useState(branchId || (branches[0] && branches[0].id) || '');

  // ค่าจากเซิร์ฟเวอร์มาทีหลัง (เปิดหน้านี้ก่อนโหลดเสร็จ) → ใช้ค่านั้น ถ้ายังไม่ได้แก้อะไร
  useEffect(() => {
    if (!dirty) { const n = normalizeReceipt(receiptSettings); setDraft(n); setPreview(n.logo || ''); }
  }, [receiptSettings, dirty]);

  const maxW = PAPER_DOTS[draft.paper === 58 ? 58 : 80];
  const set = (patch) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); setMsg(''); };

  // สร้างโลโก้ขาว-ดำใหม่ทุกครั้งที่ปรับขนาด/ความเข้ม (ตัวอย่างบนจอ = สิ่งที่เครื่องพิมพ์พิมพ์)
  useEffect(() => {
    let alive = true;
    if (!draft.logoSrc) { setPreview(''); return undefined; }
    const w = Math.min(draft.logoWidth, maxW);
    const tm = setTimeout(() => {
      makePrintLogo(draft.logoSrc, w, draft.logoThreshold).then(url => { if (alive) setPreview(url); }).catch(() => {});
    }, 120);
    return () => { alive = false; clearTimeout(tm); };
  }, [draft.logoSrc, draft.logoWidth, draft.logoThreshold, maxW]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setMsg('❌ รองรับเฉพาะรูป PNG, JPG หรือ WEBP'); return; }
    if (file.size > 8 * 1024 * 1024) { setMsg('❌ รูปใหญ่เกิน 8 MB'); return; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    try {
      const src = await shrinkSource(dataUrl, 800);
      set({ logoSrc: src, logoWidth: Math.min(draft.logoWidth || 240, maxW) });
    } catch { setMsg('❌ เปิดรูปไม่ได้'); }
  };

  const header = useMemo(() => {
    const b = branches.find(x => String(x.id) === String(previewBranch)) || {};
    return { ...(getReceiptHeader() || {}), name: b.name || b.id || 'ชื่อร้าน', address: b.address || '', phone: b.phone || '', taxId: b.taxId || '', posId: b.posId || '', footer: b.receiptFooter || '' };
  }, [branches, previewBranch]);
  const draftHeader = { ...header, logo: preview, logoWidth: Math.min(draft.logoWidth, maxW), paper: draft.paper, showName: draft.showName, showAddress: draft.showAddress, showPhone: draft.showPhone };

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const logo = draft.logoSrc ? await makePrintLogo(draft.logoSrc, Math.min(draft.logoWidth, maxW), draft.logoThreshold) : '';
      const receipt = { ...draft, logo, logoWidth: Math.min(draft.logoWidth, maxW) };
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'saveReceiptSettings', receipt }) });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) throw new Error((json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      try { const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}'); d.receiptSettings = json.receipt; localStorage.setItem('gas_all_data', JSON.stringify(d)); } catch {}
      onSaved && onSaved(json.receipt);
      setDirty(false); setMsg('✅ บันทึกแล้ว ใบเสร็จใบถัดไปใช้รูปแบบนี้');
    } catch (err) { setMsg('❌ บันทึกไม่สำเร็จ: ' + (err.message || err)); }
    setBusy(false);
  };

  // พิมพ์ทดสอบด้วยค่าที่ตั้งอยู่ (ยังไม่ต้องบันทึก) ออกเครื่องพิมพ์ใบเสร็จของสาขานี้
  const receiptPrinters = (() => { try { return (JSON.parse(localStorage.getItem('printers_config') || '[]') || []).filter(p => p && p.type === 'receipt' && p.ip); } catch { return []; } })();
  const testPrint = async () => {
    const p = receiptPrinters[0];
    if (!p) { setMsg('❌ ยังไม่ได้ตั้งเครื่องพิมพ์ใบเสร็จ (หลังบ้าน > ปริ้นเตอร์)'); return; }
    setMsg('กำลังส่งพิมพ์ทดสอบ…');
    const res = await sendPrintJob({ ip: p.ip, printerType: 'receipt', orderData: {
      orderNumber: 'TEST', customerDetails: { name: 'ทดสอบใบเสร็จ' }, header: draftHeader,
      items: [{ isFlattened: true, name: 'ข้าวมันไก่ (ทดสอบ)', amount: 69, subItems: [] }], summary: [], total: '69.00', paid: false
    } });
    setMsg(res && res.success ? '✅ ส่งพิมพ์ทดสอบแล้ว' : '❌ พิมพ์ไม่สำเร็จ: ' + ((res && res.error) || ''));
  };

  // ตัวอย่างหน้ากระดาษ: 80mm = กว้าง 300px บนจอ · 58mm = 218px (สัดส่วนเดียวกับกระดาษจริง)
  const paperPx = draft.paper === 58 ? 218 : 300;
  const logoPx = Math.round(paperPx * Math.min(draft.logoWidth, maxW) / maxW);
  const isAbb = !!header.taxId;
  const toggle = (key, text, note) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={draft[key] !== false} onChange={e => set({ [key]: e.target.checked })} style={{ marginTop: '3px', width: 18, height: 18 }} />
      <span><b>{text}</b>{note && <div style={hint}>{note}</div>}</span>
    </label>
  );

  return (
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 900, marginBottom: '0.25rem' }}><Receipt size={24} /> รูปแบบใบเสร็จ</h2>
      <p style={{ color: '#5a5a5a', marginTop: 0, marginBottom: '1rem', fontSize: '0.9rem' }}>
        โลโก้และรายละเอียดหัวใบเสร็จ ใช้กับทุกสาขา · ชื่อร้าน ที่อยู่ เบอร์โทร เลขผู้เสียภาษี และข้อความท้ายใบ ตั้งแยกแต่ละสาขาที่เมนู "สาขา"
      </p>

      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div style={card}>
            <span style={label}>ขนาดกระดาษ</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[80, 58].map(mm => (
                <button key={mm} type="button" onClick={() => set({ paper: mm, logoWidth: Math.min(draft.logoWidth, PAPER_DOTS[mm]) })}
                  style={{ flex: 1, padding: '0.6rem', borderRadius: '10px', fontWeight: 800, cursor: 'pointer', border: `2px solid ${draft.paper === mm ? '#141414' : '#d0d0d0'}`, background: draft.paper === mm ? '#f1f1f1' : '#fff' }}>
                  {mm} มม.
                </button>
              ))}
            </div>
            <div style={hint}>ดูจากเครื่องพิมพ์ใบเสร็จที่ร้านใช้ (ส่วนใหญ่ 80 มม.)</div>
          </div>

          <div style={card}>
            <span style={label}>โลโก้</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0.55rem 0.9rem', borderRadius: '10px', background: '#141414', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                <Upload size={16} /> {draft.logoSrc ? 'เปลี่ยนรูปโลโก้' : 'อัปโหลดโลโก้'}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: 'none' }} />
              </label>
              {draft.logoSrc && (
                <button type="button" onClick={() => set({ logoSrc: '', logo: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0.55rem 0.9rem', borderRadius: '10px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 800, cursor: 'pointer' }}>
                  <Trash2 size={16} /> ไม่ใช้โลโก้
                </button>
              )}
            </div>
            <div style={hint}>PNG / JPG / WEBP · แนะนำรูปพื้นขาวหรือพื้นโปร่งใส ลายเส้นชัด เครื่องพิมพ์ความร้อนพิมพ์ได้แค่สีดำ</div>

            {draft.logoSrc && (
              <>
                <label htmlFor="logo-w" style={{ ...label, marginTop: '1rem' }}>
                  ขนาดโลโก้: {Math.min(draft.logoWidth, maxW)} จุด ({Math.round(Math.min(draft.logoWidth, maxW) / maxW * 100)}% ของความกว้างกระดาษ)
                </label>
                <input id="logo-w" type="range" min={48} max={maxW} step={8} value={Math.min(draft.logoWidth, maxW)} onChange={e => set({ logoWidth: Number(e.target.value) })} style={{ width: '100%' }} />
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  {[['เล็ก', 0.3], ['กลาง', 0.5], ['ใหญ่', 0.75], ['เต็มแผ่น', 1]].map(([t, f]) => (
                    <button key={t} type="button" onClick={() => set({ logoWidth: Math.round(maxW * f / 8) * 8 })} style={{ flex: 1, padding: '0.35rem', borderRadius: '8px', border: '1px solid #d0d0d0', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>{t}</button>
                  ))}
                </div>
                <label htmlFor="logo-t" style={{ ...label, marginTop: '1rem' }}>ความเข้มของโลโก้: {draft.logoThreshold}</label>
                <input id="logo-t" type="range" min={60} max={220} step={5} value={draft.logoThreshold} onChange={e => set({ logoThreshold: Number(e.target.value) })} style={{ width: '100%' }} />
                <div style={hint}>เลื่อนไปทางขวา = ส่วนสีอ่อนกลายเป็นสีดำมากขึ้น · ดูตัวอย่างด้านขวาให้ชัดก่อนบันทึก</div>
              </>
            )}
          </div>

          <div style={card}>
            <span style={label}>รายละเอียดที่แสดงบนหัวใบเสร็จ</span>
            {toggle('showName', 'ชื่อร้าน', isAbb ? 'ใบกำกับภาษีอย่างย่อจะแสดงชื่อร้านเสมอ (กฎหมายกำหนด) · ปิดได้ถ้าโลโก้มีชื่อร้านอยู่แล้ว มีผลกับใบเสร็จธรรมดา' : 'ปิดได้ถ้าโลโก้มีชื่อร้านอยู่แล้ว')}
            {toggle('showAddress', 'ที่อยู่')}
            {toggle('showPhone', 'เบอร์โทร')}
            <div style={{ ...hint, display: 'flex', gap: '6px' }}><Info size={14} style={{ flexShrink: 0, marginTop: 2 }} /> เลขผู้เสียภาษีและ POS ID แสดงเสมอเมื่อสาขาตั้งไว้ (ใบกำกับภาษีอย่างย่อ)</div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0.75rem 1.4rem', borderRadius: '12px', border: 0, background: '#16a34a', color: '#fff', fontWeight: 900, fontSize: '1rem', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              <Save size={18} /> {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button type="button" onClick={testPrint} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0.75rem 1.1rem', borderRadius: '12px', border: '1px solid #d0d0d0', background: '#fff', fontWeight: 800, cursor: 'pointer' }}>
              <Printer size={18} /> พิมพ์ทดสอบ
            </button>
          </div>
          {msg && <div role="status" style={{ marginTop: '0.75rem', fontWeight: 700, color: msg.startsWith('❌') ? '#dc2626' : '#166534' }}>{msg}</div>}
          {dirty && !msg && <div style={{ ...hint, color: '#8e0b20', fontWeight: 700 }}>ยังไม่ได้บันทึก</div>}
        </div>

        <div style={{ flex: '0 0 auto' }}>
          <div style={{ ...label, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span>ตัวอย่างใบเสร็จ</span>
            {branches.length > 1 && (
              <select value={previewBranch} onChange={e => setPreviewBranch(e.target.value)} aria-label="สาขาที่ดูตัวอย่าง" style={{ fontWeight: 600, padding: '2px 6px', borderRadius: 6 }}>
                {branches.map(x => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
              </select>
            )}
          </div>
          <div style={{ width: paperPx, background: '#fff', border: '1px solid #d0d0d0', boxShadow: '0 4px 14px rgba(0,0,0,0.08)', padding: '14px 12px', fontFamily: 'monospace, sans-serif', fontSize: 12, color: '#000', textAlign: 'center' }}>
            {preview && <img src={preview} alt="โลโก้" style={{ width: logoPx, maxWidth: '100%', imageRendering: 'pixelated', display: 'block', margin: '0 auto 6px' }} />}
            {(draft.showName || isAbb) && <div style={{ fontWeight: 900, fontSize: 15 }}>{header.name}</div>}
            {draft.showAddress && header.address && header.address.split(/\r?\n/).map((l, i) => <div key={i}>{l}</div>)}
            {draft.showPhone && header.phone && <div>โทร {header.phone}</div>}
            {header.taxId && <div>เลขผู้เสียภาษี {header.taxId}</div>}
            {header.taxId && header.posId && <div>POS ID: {header.posId}</div>}
            <div>{header.taxId ? 'ใบกำกับภาษีอย่างย่อ / TAX INV (ABB)' : 'ใบเสร็จรับเงิน / RECEIPT'}</div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>1x ข้าวมันไก่</span><span>69.00</span></div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 14 }}><span>รวมทั้งสิ้น</span><span>69.00</span></div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div>{header.footer || 'ขอบคุณที่ใช้บริการ'}</div>
          </div>
          <div style={{ ...hint, width: paperPx }}>ตัวอย่างโดยประมาณ · ฟอนต์จริงขึ้นกับเครื่องพิมพ์ · กด "พิมพ์ทดสอบ" เพื่อดูของจริง</div>
        </div>
      </div>
    </div>
  );
};

export default ManageReceipt;
