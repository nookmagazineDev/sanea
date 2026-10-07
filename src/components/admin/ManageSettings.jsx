import React, { useState, useEffect } from 'react';
import { Settings, ToggleLeft, ToggleRight, Save, Info, QrCode, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import jsQR from 'jsqr';
import { parseKShopPayload } from '../../utils/promptpay';
import { DEFAULT_NOTE_OPTIONS } from '../../utils/popupConfig';
import { API_URL } from '../../utils/api';

const DEFAULT_SETTINGS = {
  serviceCharge: { enabled: false, rate: 10 },
  vat: { enabled: false, rate: 7 },
  promptPayId: '',
  qrType: 'dynamic', // 'dynamic' | 'static' | 'kshop_dynamic'
  staticQrUrl: '/kshop_qr.png',
  kshopRawPayload: '',
  qrShopName: '',
  qrAccountName: '',
  branchQR: {}, // { [ชื่อสาขา]: { qrType, kshopRawPayload, qrShopName, qrAccountName, promptPayId, staticQrUrl } }
  // หมายเหตุถึงครัวที่ลูกค้าเลือกได้ตอนสั่ง
  orderNotes: { options: DEFAULT_NOTE_OPTIONS, allowCustomPos: true, allowCustomKiosk: false }
};

// ชื่อสาขา = คอลัม branch ของชีต Users (เผื่อข้อมูลเก่าใช้ id/username)
const branchOf = (u) => String(u?.branch || u?.id || u?.username || '').trim();

// ถอดรหัส QR จากไฟล์ภาพ → payload EMVCo (คืนผ่าน onOk / ข้อความ error ผ่าน onErr)
const decodeQrImage = (file, onOk, onErr) => {
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          if (!code.data.startsWith('000201')) {
            onErr('QR Code นี้ไม่ใช่รูปแบบมาตรฐานพร้อมเพย์หรือ Thai QR (ไม่ขึ้นต้นด้วย 000201) กรุณาตรวจสอบรูปภาพครับ');
            return;
          }
          onOk(code.data);
        } else {
          onErr('ไม่สามารถถอดรหัส QR Code จากรูปนี้ได้ กรุณาครอปภาพให้เห็นเฉพาะใบ QR หรือใช้รูปสกรีนช็อตที่ชัดเจนกว่านี้ครับ');
        }
      } catch (err) {
        onErr('เกิดข้อผิดพลาดในการอ่านไฟล์ภาพ: ' + err.message);
      }
    };
    img.onerror = () => onErr('ไม่สามารถโหลดไฟล์ภาพนี้ได้ กรุณาลองใหม่อีกครั้ง');
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
};

const ToggleBtn = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: checked ? '#22c55e' : 'rgba(0,0,0,0.15)', transition: 'color 0.2s', flexShrink: 0 }}
  >
    {checked ? <ToggleRight size={44} /> : <ToggleLeft size={44} />}
  </button>
);

const ManageSettings = ({ users = [] }) => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // สาขาที่กำลังตั้งค่า QR แยก + error ของการอัปโหลดรูปสาขานั้น
  const [branchTab, setBranchTab] = useState('');
  const [branchUploadError, setBranchUploadError] = useState('');
  // ช่องพิมพ์หมายเหตุใหม่ที่กำลังจะเพิ่ม
  const [newNote, setNewNote] = useState('');
  const [newNoteEn, setNewNoteEn] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('pos_settings');
    if (stored) {
      try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) }); } catch (e) {}
    }
  }, []);

  // รายชื่อสาขา = สาขาในหน้าตั้งค่าสาขา + สาขาที่พนักงานใช้อยู่ (ไม่ซ้ำ)
  const branchList = React.useMemo(() => {
    const set = new Set();
    try {
      const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
      (Array.isArray(d.branches) ? d.branches : []).forEach(b => { const id = String(b.id || '').trim(); if (id) set.add(id); });
    } catch {}
    (users || []).forEach(u => { const b = branchOf(u); if (b && b !== '*') set.add(b); }); // '*' = พนักงานทุกสาขา ไม่ใช่สาขา
    return Array.from(set).sort();
  }, [users]);

  // QR ของสาขาที่เลือกอยู่ (อ่านจาก settings.branchQR)
  const branchQRMap = settings.branchQR && typeof settings.branchQR === 'object' ? settings.branchQR : {};
  const curBranchQR = (branchTab && branchQRMap[branchTab]) || {};

  // อัปเดตค่า QR ของสาขาที่เลือก
  const updateBranchQR = (field, value) => {
    if (!branchTab) return;
    setSettings(prev => {
      const map = prev.branchQR && typeof prev.branchQR === 'object' ? prev.branchQR : {};
      return { ...prev, branchQR: { ...map, [branchTab]: { ...(map[branchTab] || {}), [field]: value } } };
    });
    setSaved(false);
  };

  // ลบ QR เฉพาะสาขา (กลับไปใช้ค่ากลาง)
  const clearBranchQR = () => {
    if (!branchTab) return;
    setSettings(prev => {
      const map = { ...(prev.branchQR && typeof prev.branchQR === 'object' ? prev.branchQR : {}) };
      delete map[branchTab];
      return { ...prev, branchQR: map };
    });
    setSaved(false);
    setBranchUploadError('');
  };

  const handleBranchQrUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBranchUploadError('');
    decodeQrImage(
      file,
      (payload) => {
        setSettings(prev => {
          const map = prev.branchQR && typeof prev.branchQR === 'object' ? prev.branchQR : {};
          return { ...prev, branchQR: { ...map, [branchTab]: { ...(map[branchTab] || {}), kshopRawPayload: payload, qrType: 'kshop_dynamic' } } };
        });
        setSaved(false);
      },
      (msg) => setBranchUploadError(msg)
    );
  };

  // เปิดบังคับล็อกอินได้เมื่อมีแอดมินที่ล็อกอินได้จริงอย่างน้อย 1 คน กันล็อกตัวเองออกจากระบบ
  const canRequireLogin = (users || []).some(u =>
    (u.isAdmin === true || u.isAdmin === 'TRUE') && (u.hasPin === true || String(u.pin || '').trim() !== '')
  );

  const handleSave = () => {
    localStorage.setItem('pos_settings', JSON.stringify(settings));
    window.dispatchEvent(new Event('pos_settings_changed'));
    fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'saveSettings', settings })
    }).catch(console.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const update = (key, field, value) => {
    setSettings(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    setSaved(false);
  };

  // ── รายการหมายเหตุถึงครัว ──
  const noteCfg = settings.orderNotes && typeof settings.orderNotes === 'object'
    ? settings.orderNotes
    : DEFAULT_SETTINGS.orderNotes;
  const noteOptions = Array.isArray(noteCfg.options) ? noteCfg.options : [];

  const setNoteOptions = (next) => {
    setSettings(prev => ({ ...prev, orderNotes: { ...noteCfg, options: next } }));
    setSaved(false);
  };

  const addNoteOption = () => {
    const text = newNote.trim();
    if (!text) return;
    setNoteOptions([...noteOptions, { id: `note_${Date.now()}`, name: text, nameEn: newNoteEn.trim() || text }]);
    setNewNote('');
    setNewNoteEn('');
  };

  const editNoteOption = (index, field, value) => {
    setNoteOptions(noteOptions.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  };

  const removeNoteOption = (index) => setNoteOptions(noteOptions.filter((_, i) => i !== index));

  // สลับที่กับรายการข้างบน/ข้างล่าง — ลำดับนี้คือลำดับที่ลูกค้าเห็นในป๊อปอัพ
  const moveNoteOption = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= noteOptions.length) return;
    const next = [...noteOptions];
    [next[index], next[target]] = [next[target], next[index]];
    setNoteOptions(next);
  };

  const handleQrUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    decodeQrImage(
      file,
      (payload) => {
        setSettings(prev => ({ ...prev, kshopRawPayload: payload, qrType: 'kshop_dynamic' }));
        setSaved(false);
      },
      (msg) => setUploadError(msg)
    );
  };

  const decodedDetails = parseKShopPayload(settings.kshopRawPayload);

  const exampleSubtotal = 300;
  const scAmount = settings.serviceCharge.enabled ? Math.round(exampleSubtotal * settings.serviceCharge.rate) / 100 : 0;
  const vatBase = exampleSubtotal + scAmount;
  const vatAmount = settings.vat.enabled ? Math.round(vatBase * settings.vat.rate) / 100 : 0;
  const grandTotal = exampleSubtotal + scAmount + vatAmount;

  return (
    <div className="admin-page admin-page-cards" style={{ padding: '2rem' }}>
      <h2 style={{ color: 'var(--text-main)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.4rem' }}>
        <Settings size={22} color="var(--accent-hover)" /> ตั้งค่าค่าบริการ
      </h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
        เซอร์วิชชาร์จและ VAT จะแสดงในหน้าตะกร้าและหน้าชำระเงินโดยอัตโนมัติ
      </p>

      {/* บังคับล็อกอิน */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem' }}>ล็อก API: รับเฉพาะคำขอที่ล็อกอินแล้ว (แนะนำให้เปิด)</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
              หน้าพนักงานต้องล็อกอินเสมออยู่แล้ว สวิตช์นี้ทำให้เซิร์ฟเวอร์ปฏิเสธคำขอที่ไม่ได้ล็อกอินและตรวจสิทธิ์ตามบทบาท/สาขาด้วย
              — ปิดอยู่ = ใครรู้ที่อยู่ API ก็เรียกได้ (หน้าลูกค้าสแกน QR สั่งเองใช้ได้ทั้งสองแบบ)
            </p>
          </div>
          <ToggleBtn
            checked={settings.requireLogin === true}
            onChange={(v) => {
              if (v && !canRequireLogin) {
                alert('ยังเปิดไม่ได้ — ต้องมีพนักงานสิทธิ์แอดมินที่ตั้งรหัสไว้อย่างน้อย 1 คนก่อน ไม่งั้นจะไม่มีใครเข้าหลังบ้านได้');
                return;
              }
              setSettings(prev => ({ ...prev, requireLogin: v }));
              setSaved(false);
            }}
          />
        </div>
        {!canRequireLogin && (
          <p style={{ color: '#b45309', fontSize: '0.82rem', margin: '0.75rem 0 0' }}>
            ⚠️ ยังไม่มีพนักงานสิทธิ์แอดมินที่ตั้งรหัสไว้ — เพิ่มที่หน้า "พนักงาน" ก่อน
          </p>
        )}
      </div>

      {/* Service Charge Card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem' }}>ค่าเซอร์วิชชาร์จ</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
              Service Charge — คิดจากยอดอาหารก่อน VAT
            </p>
          </div>
          <ToggleBtn checked={settings.serviceCharge.enabled} onChange={(v) => update('serviceCharge', 'enabled', v)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', opacity: settings.serviceCharge.enabled ? 1 : 0.38, transition: 'opacity 0.2s' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>อัตรา</label>
          <input
            type="number" min="0" max="100" step="0.5"
            value={settings.serviceCharge.rate}
            onChange={(e) => update('serviceCharge', 'rate', parseFloat(e.target.value) || 0)}
            disabled={!settings.serviceCharge.enabled}
            style={{ width: '90px', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '1.05rem', textAlign: 'center', fontWeight: '700' }}
          />
          <span style={{ color: 'var(--text-muted)' }}>%</span>
          {settings.serviceCharge.enabled && (
            <span style={{ color: '#fbbf24', fontSize: '0.82rem', fontWeight: '600' }}>
              ฿100 → +฿{(100 * settings.serviceCharge.rate / 100).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* VAT Card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem' }}>ภาษีมูลค่าเพิ่ม (VAT)</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
              VAT — คิดจากยอด (อาหาร + เซอร์วิชชาร์จ)
            </p>
          </div>
          <ToggleBtn checked={settings.vat.enabled} onChange={(v) => update('vat', 'enabled', v)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', opacity: settings.vat.enabled ? 1 : 0.38, transition: 'opacity 0.2s' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>อัตรา</label>
          <input
            type="number" min="0" max="100" step="0.5"
            value={settings.vat.rate}
            onChange={(e) => update('vat', 'rate', parseFloat(e.target.value) || 0)}
            disabled={!settings.vat.enabled}
            style={{ width: '90px', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '1.05rem', textAlign: 'center', fontWeight: '700' }}
          />
          <span style={{ color: 'var(--text-muted)' }}>%</span>
          {settings.vat.enabled && (
            <span style={{ color: '#fbbf24', fontSize: '0.82rem', fontWeight: '600' }}>
              ฿100 → +฿{(100 * settings.vat.rate / 100).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Preview */}
      {(settings.serviceCharge.enabled || settings.vat.enabled) && (
        <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: '14px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Info size={14} /> ตัวอย่างการคำนวณ (ฐาน ฿{exampleSubtotal})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)' }}>
              <span>ยอดอาหาร</span><span>฿{exampleSubtotal.toFixed(2)}</span>
            </div>
            {settings.serviceCharge.enabled && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)' }}>
                <span>เซอร์วิชชาร์จ {settings.serviceCharge.rate}%</span><span>+฿{scAmount.toFixed(2)}</span>
              </div>
            )}
            {settings.vat.enabled && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#60a5fa' }}>
                <span>VAT {settings.vat.rate}%</span><span>+฿{vatAmount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)', fontWeight: '800', fontSize: '1.05rem', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
              <span>รวมทั้งสิ้น</span><span style={{ color: 'var(--accent-hover)' }}>฿{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* PromptPay / QR ชำระเงิน Card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <QrCode size={18} color="#60a5fa" /> รูปแบบ QR ชำระเงิน (เงินโอน)
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
            เลือกรูปแบบ QR ที่จะแสดงในขั้นตอนเช็คบิลผ่านเงินโอน
          </p>
        </div>

        {/* QR Type Selection */}
        <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setSettings(prev => ({ ...prev, qrType: 'kshop_dynamic' })); setSaved(false); }}
            style={{
              flex: '1 1 100%', padding: '0.8rem', borderRadius: '10px',
              background: (settings.qrType || 'dynamic') === 'kshop_dynamic' ? 'rgba(34,197,94,0.15)' : 'rgba(0,0,0,0.02)',
              border: (settings.qrType || 'dynamic') === 'kshop_dynamic' ? '1px solid #22c55e' : '1px solid rgba(0,0,0,0.08)',
              color: (settings.qrType || 'dynamic') === 'kshop_dynamic' ? '#22c55e' : 'var(--text-muted)',
              fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
            }}
          >
            <span>K Shop (Dynamic QR) — เจนยอดเงินอัตโนมัติ ⭐</span>
          </button>
          
          <button
            onClick={() => { setSettings(prev => ({ ...prev, qrType: 'dynamic' })); setSaved(false); }}
            style={{
              flex: '1 1 48%', padding: '0.75rem', borderRadius: '10px',
              background: (settings.qrType || 'dynamic') === 'dynamic' ? 'rgba(96,165,250,0.15)' : 'rgba(0,0,0,0.02)',
              border: (settings.qrType || 'dynamic') === 'dynamic' ? '1px solid #60a5fa' : '1px solid rgba(0,0,0,0.08)',
              color: (settings.qrType || 'dynamic') === 'dynamic' ? '#60a5fa' : 'var(--text-muted)',
              fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            พร้อมเพย์ทั่วไป (Dynamic QR)
          </button>
          
          <button
            onClick={() => { setSettings(prev => ({ ...prev, qrType: 'static' })); setSaved(false); }}
            style={{
              flex: '1 1 48%', padding: '0.75rem', borderRadius: '10px',
              background: (settings.qrType || 'dynamic') === 'static' ? 'rgba(234,179,8,0.18)' : 'rgba(0,0,0,0.02)',
              border: (settings.qrType || 'dynamic') === 'static' ? '1px solid var(--accent)' : '1px solid rgba(0,0,0,0.08)',
              color: (settings.qrType || 'dynamic') === 'static' ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            ใช้รูปภาพ QR นิ่ง (Static QR)
          </button>
        </div>

        {settings.qrType === 'kshop_dynamic' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              อัปโหลดรูปภาพหน้าจอ QR K Shop (ระบบจะสแกนและดึงบัญชีโดยอัตโนมัติ)
            </label>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1rem',
                background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.1)',
                borderRadius: '8px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '700'
              }}>
                <Upload size={16} /> เลือกรูปภาพสกรีนช็อต
                <input type="file" accept="image/*" onChange={handleQrUpload} style={{ display: 'none' }} />
              </label>
              
              {settings.kshopRawPayload ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e', fontSize: '0.85rem', fontWeight: '600' }}>
                  <CheckCircle2 size={16} /> ตรวจสอบบัญชี K Shop สำเร็จแล้ว
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  ยังไม่ได้เพิ่มข้อมูล QR
                </div>
              )}
            </div>

            {uploadError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.82rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{uploadError}</span>
              </div>
            )}

            {decodedDetails && (
              <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ fontWeight: '700', color: 'var(--text-main)', marginBottom: '0.15rem', fontSize: '0.9rem' }}>ข้อมูลบัญชีที่ตรวจพบ:</div>
                {decodedDetails.ref1 && (
                  <div>• Ref 1 (เลขอ้างอิงหลัก): <strong style={{ color: '#22c55e', wordBreak: 'break-all' }}>{decodedDetails.ref1}</strong></div>
                )}
                {decodedDetails.ref2 && (
                  <div>• Ref 2 (เลขอ้างอิง K Shop): <strong style={{ color: '#22c55e', wordBreak: 'break-all' }}>{decodedDetails.ref2}</strong></div>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                  * บัญชีนี้จะถูกใช้เพื่อสร้าง Dynamic QR Code ชำระเงินแนบยอดบิลอัตโนมัติในตอนเช็คบิล
                </div>
              </div>
            )}

            {/* ช่องกรอกชื่อร้านและชื่อบัญชีเพิ่มเติม */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', borderTop: '1px dashed rgba(0,0,0,0.1)', paddingTop: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.35rem' }}>ชื่อร้านค้าที่จะให้แสดงบนการ์ด QR (เช่น NARAI-KHANOY UNION MALL 4F.)</label>
                <input
                  type="text"
                  value={settings.qrShopName || ''}
                  onChange={(e) => { setSettings(prev => ({ ...prev, qrShopName: e.target.value })); setSaved(false); }}
                  placeholder="เช่น NARAI-KHANOY UNION MALL 4F."
                  style={{ width: '100%', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.35rem' }}>ชื่อบัญชีรับเงินที่จะให้แสดงบนการ์ด QR (เช่น ร้านเสน่ห์)</label>
                <input
                  type="text"
                  value={settings.qrAccountName || ''}
                  onChange={(e) => { setSettings(prev => ({ ...prev, qrAccountName: e.target.value })); setSaved(false); }}
                  placeholder="เช่น ร้านเสน่ห์"
                  style={{ width: '100%', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>
        )}

        {settings.qrType === 'dynamic' && (
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>หมายเลขพร้อมเพย์ (PromptPay ID)</label>
            <input
              type="text"
              inputMode="numeric"
              value={settings.promptPayId || ''}
              onChange={(e) => { setSettings(prev => ({ ...prev, promptPayId: e.target.value.replace(/[^0-9]/g, '') })); setSaved(false); }}
              placeholder="เช่น 0812345678 หรือ 004000001641684"
              style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '10px', color: 'var(--text-main)', fontSize: '1.05rem', fontWeight: '700', letterSpacing: '0.04em', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.6rem 0 0' }}>
              {settings.promptPayId
                ? '✅ จะใช้เลขนี้สร้าง QR พร้อมยอดที่ต้องชำระ'
                : 'ℹ️ ถ้าเว้นว่าง จะใช้ค่าเริ่มต้น 004000001641684 (K Shop)'}
            </p>
          </div>
        )}

        {settings.qrType === 'static' && (
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>พาธรูปภาพ QR Code (แนะนำให้อัปโหลดไปที่โฟลเดอร์ public/kshop_qr.png)</label>
            <input
              type="text"
              value={settings.staticQrUrl || '/kshop_qr.png'}
              onChange={(e) => { setSettings(prev => ({ ...prev, staticQrUrl: e.target.value })); setSaved(false); }}
              placeholder="เช่น /kshop_qr.png หรือ ลิงก์รูปภาพออนไลน์"
              style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '10px', color: 'var(--text-main)', fontSize: '1rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.6rem 0 0' }}>
              💡 หากใช้ไฟล์รูปภาพของ K Shop กรุณาเซฟรูปเป็นชื่อ <strong>kshop_qr.png</strong> แล้วนำไปวางไว้ที่โฟลเดอร์ <strong>public</strong> ของโปรเจกต์นี้
            </p>
          </div>
        )}
      </div>

      {/* QR แยกตามสาขา Card */}
      <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <QrCode size={18} color="var(--accent-hover)" /> QR ชำระเงินแยกตามสาขา
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
            ตั้ง QR เฉพาะของแต่ละสาขา — ตอนเช็คบิลระบบจะใช้ QR ของสาขาที่ล็อกอินอยู่ ถ้าสาขาไหนไม่ได้ตั้ง จะใช้ QR กลางด้านบนแทน
          </p>
        </div>

        {branchList.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', background: 'rgba(0,0,0,0.02)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
            ยังไม่มีข้อมูลสาขา (เพิ่มสาขาได้ที่หน้า "จัดการผู้ใช้" โดยกรอกช่องสาขาให้ผู้ใช้แต่ละคน)
          </div>
        ) : (
          <>
            {/* เลือกสาขา */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 700 }}>เลือกสาขา:</label>
              <select
                value={branchTab}
                onChange={(e) => { setBranchTab(e.target.value); setBranchUploadError(''); }}
                style={{ flex: 1, minWidth: '180px', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', padding: '0.5rem 0.7rem', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none' }}
              >
                <option value="">— เลือกสาขาที่ต้องการตั้ง QR —</option>
                {branchList.map(b => (
                  <option key={b} value={b}>{b}{branchQRMap[b] ? '  ✅ (ตั้งแล้ว)' : ''}</option>
                ))}
              </select>
            </div>

            {/* สรุปสาขาที่ตั้ง QR แล้ว */}
            {Object.keys(branchQRMap).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                {Object.keys(branchQRMap).map(b => (
                  <span key={b} style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 20, padding: '0.2rem 0.65rem' }}>
                    {b}
                  </span>
                ))}
              </div>
            )}

            {branchTab && (
              <div style={{ borderTop: '1px dashed rgba(0,0,0,0.12)', paddingTop: '1rem' }}>
                {/* QR type ของสาขา */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {[
                    { key: 'kshop_dynamic', label: 'K Shop (Dynamic) ⭐', color: '#22c55e' },
                    { key: 'dynamic', label: 'พร้อมเพย์ทั่วไป', color: '#60a5fa' },
                    { key: 'static', label: 'รูปภาพนิ่ง', color: '#facc15' }
                  ].map(t => {
                    const active = (curBranchQR.qrType || 'kshop_dynamic') === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => updateBranchQR('qrType', t.key)}
                        style={{ flex: '1 1 30%', minWidth: '110px', padding: '0.6rem', borderRadius: 10, background: active ? `${t.color}22` : 'rgba(0,0,0,0.02)', border: active ? `1px solid ${t.color}` : '1px solid rgba(0,0,0,0.08)', color: active ? t.color : 'var(--text-muted)', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {(curBranchQR.qrType || 'kshop_dynamic') === 'kshop_dynamic' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1rem', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, alignSelf: 'flex-start' }}>
                      <Upload size={16} /> อัปโหลดรูป QR K Shop ของสาขา {branchTab}
                      <input type="file" accept="image/*" onChange={handleBranchQrUpload} style={{ display: 'none' }} />
                    </label>

                    {curBranchQR.kshopRawPayload ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e', fontSize: '0.85rem', fontWeight: 600 }}>
                        <CheckCircle2 size={16} /> ตรวจสอบบัญชี K Shop ของสาขานี้สำเร็จ
                        {(() => { const d = parseKShopPayload(curBranchQR.kshopRawPayload); return d?.ref2 ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({d.ref2})</span> : null; })()}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>ยังไม่ได้เพิ่มรูป QR ของสาขานี้</div>
                    )}

                    {branchUploadError && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.82rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
                        <AlertTriangle size={15} style={{ flexShrink: 0 }} /><span>{branchUploadError}</span>
                      </div>
                    )}

                    <input
                      type="text"
                      value={curBranchQR.qrShopName || ''}
                      onChange={(e) => updateBranchQR('qrShopName', e.target.value)}
                      placeholder="ชื่อร้านที่แสดงบนการ์ด QR (เช่น NARAI -KHANOY CENTURY)"
                      style={{ width: '100%', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                    <input
                      type="text"
                      value={curBranchQR.qrAccountName || ''}
                      onChange={(e) => updateBranchQR('qrAccountName', e.target.value)}
                      placeholder="ชื่อบัญชีรับเงิน (เช่น ร้านเสน่ห์)"
                      style={{ width: '100%', padding: '0.55rem 0.75rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                )}

                {curBranchQR.qrType === 'dynamic' && (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={curBranchQR.promptPayId || ''}
                    onChange={(e) => updateBranchQR('promptPayId', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="หมายเลขพร้อมเพย์ของสาขา (เช่น 0812345678)"
                    style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, color: 'var(--text-main)', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                )}

                {curBranchQR.qrType === 'static' && (
                  <input
                    type="text"
                    value={curBranchQR.staticQrUrl || ''}
                    onChange={(e) => updateBranchQR('staticQrUrl', e.target.value)}
                    placeholder="พาธ/ลิงก์รูป QR ของสาขา (เช่น /kshop_qr_center.png)"
                    style={{ width: '100%', padding: '0.7rem 0.9rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, color: 'var(--text-main)', fontSize: '1rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                )}

                {branchQRMap[branchTab] && (
                  <button
                    onClick={clearBranchQR}
                    style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    🗑️ ลบ QR สาขานี้ (กลับไปใช้ QR กลาง)
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── หมายเหตุถึงครัว ─── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ marginBottom: '1.1rem' }}>
          <h3 style={{ color: 'var(--text-main)', margin: '0 0 0.3rem', fontSize: '1.05rem' }}>หมายเหตุถึงครัว</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
            รายการที่ลูกค้ากดเลือกได้ตอนสั่ง เช่น ไม่เผ็ด / ไม่ใส่ผักชี — ตั้งที่นี่ที่เดียว ใช้ได้ทุกเมนู
            (ปิดเป็นรายเมนูได้ในหน้าจัดการเมนู)
          </p>
        </div>

        {noteOptions.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.9rem', background: 'rgba(0,0,0,0.03)', borderRadius: 10, margin: 0 }}>
            ยังไม่มีรายการหมายเหตุ — ลูกค้าจะเห็นเฉพาะช่องพิมพ์เอง (ถ้าเปิดไว้) หรือไม่เห็นขั้นตอนนี้เลย
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {noteOptions.map((o, i) => (
              <div
                key={o.id || i}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.6rem', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flexShrink: 0 }}>
                  <button
                    onClick={() => moveNoteOption(i, -1)}
                    disabled={i === 0}
                    title="เลื่อนขึ้น"
                    style={{ width: 24, height: 20, lineHeight: 1, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, background: '#fff', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1, fontFamily: 'inherit', fontSize: '0.7rem' }}
                  >▲</button>
                  <button
                    onClick={() => moveNoteOption(i, 1)}
                    disabled={i === noteOptions.length - 1}
                    title="เลื่อนลง"
                    style={{ width: 24, height: 20, lineHeight: 1, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, background: '#fff', cursor: i === noteOptions.length - 1 ? 'default' : 'pointer', opacity: i === noteOptions.length - 1 ? 0.35 : 1, fontFamily: 'inherit', fontSize: '0.7rem' }}
                  >▼</button>
                </div>

                <input
                  value={o.name || ''}
                  onChange={e => editNoteOption(i, 'name', e.target.value)}
                  placeholder="ภาษาไทย"
                  style={{ flex: '1 1 150px', minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.9rem' }}
                />
                <input
                  value={o.nameEn || ''}
                  onChange={e => editNoteOption(i, 'nameEn', e.target.value)}
                  placeholder="English"
                  style={{ flex: '1 1 150px', minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.9rem' }}
                />
                <button
                  onClick={() => removeNoteOption(i)}
                  title="ลบรายการนี้"
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1 }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <input
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNoteOption(); } }}
            placeholder="หมายเหตุใหม่ เช่น ไม่ใส่ถั่ว"
            maxLength={40}
            style={{ flex: '1 1 170px', minWidth: 0, padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.9rem' }}
          />
          <input
            value={newNoteEn}
            onChange={e => setNewNoteEn(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNoteOption(); } }}
            placeholder="English (ไม่ใส่ = ใช้ภาษาไทย)"
            maxLength={40}
            style={{ flex: '1 1 170px', minWidth: 0, padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.9rem' }}
          />
          <button
            onClick={addNoteOption}
            style={{ flexShrink: 0, padding: '0.6rem 1.2rem', borderRadius: 8, border: 'none', background: 'var(--text-main)', color: '#fff', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >เพิ่ม</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '1.25rem', paddingTop: '1.1rem', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.92rem' }}>หน้าขาย — ให้พิมพ์หมายเหตุเองได้</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>พนักงานพิมพ์เพิ่มเองได้ในป๊อปอัพ นอกเหนือจากรายการข้างบน</div>
          </div>
          <ToggleBtn checked={noteCfg.allowCustomPos !== false} onChange={(v) => update('orderNotes', 'allowCustomPos', v)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.9rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.92rem' }}>ลูกค้าสแกน QR สั่งเอง — ให้พิมพ์หมายเหตุเองได้</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>ปิดไว้ = ลูกค้าเลือกได้เฉพาะรายการข้างบน กันพิมพ์สิ่งที่ครัวทำให้ไม่ได้</div>
          </div>
          <ToggleBtn checked={noteCfg.allowCustomKiosk === true} onChange={(v) => update('orderNotes', 'allowCustomKiosk', v)} />
        </div>
      </div>

      <button
        onClick={handleSave}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.85rem 2rem', background: saved ? '#22c55e' : 'var(--accent)', color: saved ? 'white' : 'black', border: 'none', borderRadius: '12px', fontWeight: '700', fontSize: '1rem', cursor: 'pointer', transition: 'background 0.3s', fontFamily: 'inherit' }}
      >
        <Save size={18} /> {saved ? 'บันทึกแล้ว ✓' : 'บันทึกการตั้งค่า'}
      </button>
    </div>
  );
};

export default ManageSettings;
