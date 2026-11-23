import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Images, Save, Upload, ArrowUp, ArrowDown, Trash2, ToggleLeft, ToggleRight, CheckCircle2, AlertTriangle, Link as LinkIcon } from 'lucide-react';
import { API_URL } from '../../utils/api';
import Wordmark from '../Wordmark';
import { BANNER_RATIO, resolveBanner, hasPromoSlides, safeUrl } from '../../utils/banner';
import KioskBanner from '../KioskBanner';

// หลังบ้าน > ตั้งค่าแบนเนอร์
// จัดสไลด์หัวจอของหน้าลูกค้าสั่งเอง: เพิ่มรูป เรียงลำดับ เปิด/ปิด ตั้งลิงก์เมื่อกด และการค้างจอ/ปุ่มปิด
// บันทึกรวมในก้อนตั้งค่าร้าน (settings.banner) ใช้ชุดเดียวทุกสาขา

const readStored = () => {
  try { return JSON.parse(localStorage.getItem('pos_settings') || '{}') || {}; } catch { return {}; }
};

// ย่อรูปก่อนอัป (ด้านยาวสุด 1600px) + รองพื้นขาว เผื่อไฟล์ PNG พื้นใส
const fileToBannerDataUrl = (file, maxDim = 1600, quality = 0.86) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale); height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('เปิดไฟล์รูปไม่ได้'));
    img.src = ev.target.result;
  };
  reader.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
  reader.readAsDataURL(file);
});

const Toggle = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: checked ? '#22c55e' : 'rgba(0,0,0,0.2)', flexShrink: 0, display: 'flex' }}>
    {checked ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
  </button>
);

const inputStyle = { padding: '0.55rem 0.7rem', background: '#ffffff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.95rem', minWidth: 0 };
const hintStyle = { color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 };
const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' };

const ManageBanner = ({ categories = [] }) => {
  const { lang } = useOutletContext();
  const th = lang === 'th';
  const [cfg, setCfg] = useState(() => resolveBanner(readStored()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // ค่าล่าสุดจากเซิร์ฟเวอร์มาถึงทีหลัง (หน้าเพิ่งเปิด) → อัปเดตตาม ถ้ายังไม่ได้แก้อะไร
  useEffect(() => {
    const handler = () => { if (!dirty) setCfg(resolveBanner(readStored())); };
    window.addEventListener('pos_settings_changed', handler);
    return () => window.removeEventListener('pos_settings_changed', handler);
  }, [dirty]);

  const change = (fn) => { setCfg(prev => fn(prev)); setDirty(true); setSaved(false); setError(''); };
  const setField = (key, value) => change(prev => ({ ...prev, [key]: value }));
  const setSlide = (id, patch) => change(prev => ({ ...prev, slides: prev.slides.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  const move = (i, dir) => change(prev => {
    const slides = [...prev.slides];
    const j = i + dir;
    if (j < 0 || j >= slides.length) return prev;
    [slides[i], slides[j]] = [slides[j], slides[i]];
    return { ...prev, slides };
  });
  const remove = (id) => change(prev => ({ ...prev, slides: prev.slides.filter(s => s.id !== id) }));
  const addSlide = (url, name) => change(prev => ({
    ...prev,
    slides: [...prev.slides, { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'image', url, name: name || '', on: true, link: { type: 'none', value: '' } }]
  }));

  const handleUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError('');
    try {
      const dataUrl = await fileToBannerDataUrl(file);
      const base64 = String(dataUrl).split(',')[1];
      if (!base64) throw new Error('อ่านไฟล์รูปไม่ได้');
      // ฝากรูปที่เดียวกับรูปเมนู (ImgBB ผ่านเครื่อง API — คีย์อยู่ที่ .env ของเครื่อง API)
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'uploadMenuImageHost', base64, name: 'banner' })
      });
      const data = await res.json().catch(() => null);
      if (!(data && data.success && data.url)) throw new Error((data && data.error) || 'อัปโหลดรูปไม่สำเร็จ');
      addSlide(data.url, file.name.replace(/\.[^.]+$/, '').slice(0, 60));
    } catch (err) {
      setError((th ? 'อัปโหลดรูปไม่สำเร็จ: ' : 'Image upload failed: ') + (err.message || err));
    }
    setUploading(false);
  };

  const addFromUrl = () => {
    const url = safeUrl(urlInput);
    if (!url) { setError(th ? 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://' : 'Image link must start with http:// or https://'); return; }
    addSlide(url, '');
    setUrlInput('');
  };

  const badLink = cfg.slides.find(s => s.on && s.link.type === 'url' && !safeUrl(s.link.value));
  const noCategory = cfg.slides.find(s => s.on && s.link.type === 'category' && !s.link.value);

  const handleSave = async () => {
    if (badLink) { setError(th ? 'มีสไลด์ที่ตั้งเป็น "ลิงก์อื่น" แต่ลิงก์ยังไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)' : 'A slide has an invalid link (must start with http:// or https://)'); return; }
    if (noCategory) { setError(th ? 'มีสไลด์ที่ตั้งเป็น "หมวดเมนู" แต่ยังไม่ได้เลือกหมวด' : 'A slide links to a menu category but none is chosen'); return; }
    setSaving(true); setError('');
    try {
      // ดึงค่าตั้งร้านล่าสุดจากเซิร์ฟเวอร์ก่อน แล้วแก้เฉพาะส่วนแบนเนอร์ —
      // ไม่เอาค่าที่ค้างในเครื่องนี้ไปทับการตั้งค่าอื่นที่เครื่องอื่นเพิ่งแก้
      const cur = await fetch(`${API_URL}?action=getStatic`).then(r => r.json());
      if (!cur || cur.success === false || cur.error) throw new Error((cur && cur.error) || 'โหลดการตั้งค่าล่าสุดไม่ได้');
      const base = cur.settings && typeof cur.settings === 'object' ? cur.settings : readStored();
      const next = { ...base, banner: cfg };
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveSettings', settings: next })
      });
      const data = await res.json().catch(() => null);
      if (!(data && data.success)) throw new Error((data && data.error) || `บันทึกไม่สำเร็จ (${res.status})`);
      localStorage.setItem('pos_settings', JSON.stringify(next));
      setDirty(false); setSaved(true);
      window.dispatchEvent(new Event('pos_settings_changed'));
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((th ? 'บันทึกไม่สำเร็จ: ' : 'Save failed: ') + (err.message || err));
    }
    setSaving(false);
  };

  const preview = useMemo(() => resolveBanner({ banner: cfg }), [cfg]);
  const promo = hasPromoSlides(preview);
  const catOptions = (Array.isArray(categories) ? categories : []).filter(c => c && c.slug);

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Images size={28} /> {th ? 'ตั้งค่าแบนเนอร์' : 'Banner Settings'}</h1>
          <p>{th ? 'สไลด์ด้านบนของหน้าลูกค้าสแกน QR สั่งอาหาร (หน้าแรกและหน้ารายการเมนู) ใช้ชุดเดียวทุกสาขา' : 'The slider at the top of the customer self-order page (first screen and menu list). One set for all branches.'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {saved && <span role="status" style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={18} /> {th ? 'บันทึกแล้ว' : 'Saved'}</span>}
          {dirty && !saving && <span style={{ color: '#8e0b20', fontWeight: 600, fontSize: '0.9rem' }}>{th ? 'ยังไม่ได้บันทึก' : 'Unsaved changes'}</span>}
          <button className="admin-btn" onClick={handleSave} disabled={saving || uploading} style={{ opacity: saving || uploading ? 0.6 : 1 }}>
            <Save size={18} /> {saving ? (th ? 'กำลังบันทึก...' : 'Saving...') : (th ? 'บันทึก' : 'Save')}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', color: '#b91c1c', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontWeight: 600 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} /> <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{error}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
          {/* ── รายการสไลด์ ── */}
          <div className="admin-card">
            <h3 style={{ margin: '0 0 0.35rem 0' }}>{th ? 'รายการสไลด์' : 'Slides'}</h3>
            <p style={{ ...hintStyle, marginBottom: '1rem' }}>
              {th ? 'แสดงตามลำดับจากบนลงล่าง ถ้าเปิดไว้รูปเดียวจะแสดงนิ่ง ๆ ไม่เลื่อน' : 'Shown top to bottom. With a single slide on, it stays still.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {cfg.slides.map((s, i) => {
                const isLogo = s.kind === 'logo';
                const title = isLogo ? (th ? 'ชื่อร้าน' : 'Shop name') : (s.name || (th ? `รูปแบนเนอร์ ${i + 1}` : `Banner ${i + 1}`));
                return (
                  <div key={s.id} style={{ border: '1px solid var(--border-color, rgba(0,0,0,0.12))', borderRadius: 12, padding: '0.6rem', opacity: s.on ? 1 : 0.55, background: '#ffffff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                      <div style={{ width: 110, aspectRatio: BANNER_RATIO, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)', background: '#ffffff', flexShrink: 0 }}>
                        {isLogo ? (
                          <div style={{ width: '100%', height: '100%', background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Wordmark variant="dark" size={16} /></div>
                        ) : (
                          <img src={s.url} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                        {isLogo ? (
                          <>
                            <div style={{ fontWeight: 700 }}>{title}</div>
                            <div style={hintStyle}>{th ? 'รูปเดิมของร้าน ปิดได้แต่ลบไม่ได้' : 'Built in. Can be turned off, not deleted.'}</div>
                          </>
                        ) : (
                          <input value={s.name} onChange={e => setSlide(s.id, { name: e.target.value.slice(0, 60) })}
                            aria-label={th ? 'ชื่อสไลด์ (ไว้จำ ลูกค้าไม่เห็น)' : 'Slide name (for your reference)'}
                            placeholder={th ? 'ชื่อสไลด์ (ไว้จำ ลูกค้าไม่เห็น)' : 'Slide name (for your reference)'}
                            style={{ ...inputStyle, width: '100%' }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                        <button type="button" className="admin-btn secondary" style={{ padding: '0.4rem' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label={(th ? 'เลื่อนขึ้น: ' : 'Move up: ') + title}><ArrowUp size={16} /></button>
                        <button type="button" className="admin-btn secondary" style={{ padding: '0.4rem' }} disabled={i === cfg.slides.length - 1} onClick={() => move(i, 1)} aria-label={(th ? 'เลื่อนลง: ' : 'Move down: ') + title}><ArrowDown size={16} /></button>
                        <Toggle checked={s.on} onChange={v => setSlide(s.id, { on: v })} label={(th ? 'แสดงสไลด์: ' : 'Show slide: ') + title} />
                        {!isLogo && (
                          <button type="button" className="admin-btn danger" style={{ padding: '0.4rem' }} onClick={() => remove(s.id)} aria-label={(th ? 'ลบ: ' : 'Delete: ') + title}><Trash2 size={16} /></button>
                        )}
                      </div>
                    </div>

                    {/* เมื่อลูกค้ากดสไลด์นี้ */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                      <label htmlFor={`bn-link-${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600 }}>
                        <LinkIcon size={14} /> {th ? 'เมื่อกดแล้วให้ไปที่' : 'When tapped, go to'}
                      </label>
                      <select id={`bn-link-${s.id}`} value={s.link.type} style={inputStyle}
                        onChange={e => setSlide(s.id, { link: { type: e.target.value, value: '' } })}>
                        <option value="none">{th ? 'ไม่ต้องไปไหน (รูปอย่างเดียว)' : 'Nowhere (image only)'}</option>
                        <option value="member">{th ? 'สมัครสมาชิก LINE' : 'Join membership on LINE'}</option>
                        <option value="category">{th ? 'หมวดเมนู' : 'Menu category'}</option>
                        <option value="url">{th ? 'ลิงก์อื่น' : 'Other link'}</option>
                      </select>
                      {s.link.type === 'category' && (
                        <select value={s.link.value} style={inputStyle} aria-label={th ? 'เลือกหมวดเมนู' : 'Choose category'}
                          onChange={e => setSlide(s.id, { link: { type: 'category', value: e.target.value } })}>
                          <option value="">{th ? '— เลือกหมวด —' : '— choose —'}</option>
                          {catOptions.map(c => <option key={c.slug} value={c.slug}>{(c.icon ? c.icon + ' ' : '') + (th ? c.name : (c.nameEn || c.name))}</option>)}
                        </select>
                      )}
                      {s.link.type === 'url' && (
                        <input value={s.link.value} placeholder="https://..." inputMode="url" aria-label={th ? 'ลิงก์ปลายทาง' : 'Destination link'}
                          onChange={e => setSlide(s.id, { link: { type: 'url', value: e.target.value } })}
                          style={{ ...inputStyle, flex: '1 1 180px' }} />
                      )}
                    </div>
                    {s.link.type === 'member' && (
                      <p style={{ ...hintStyle, marginTop: '0.35rem' }}>{th ? 'เปิดลิงก์เดียวกับปุ่ม "สมัครฟรีผ่าน LINE" — ใช้ได้เมื่อเปิดระบบสมาชิก (CRM) ไว้ ถ้าไม่ได้เปิด สไลด์นี้จะเป็นรูปอย่างเดียว' : 'Opens the same link as the "Join free on LINE" button. Needs the membership (CRM) system on; otherwise the slide is image only.'}</p>
                    )}
                    {s.link.type === 'category' && (
                      <p style={{ ...hintStyle, marginTop: '0.35rem' }}>{th ? 'ถ้าลูกค้ากดจากหน้าแรก ระบบจะให้เลือกทานที่ร้าน/ห่อกลับบ้านก่อน แล้วพาไปหมวดนี้' : 'If tapped on the first screen, customers choose dine in / take away first, then jump to this category.'}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.9rem', border: '2px dashed #f5b5bf', background: '#fdf2f4', color: '#a50d25', borderRadius: 12, padding: '0.9rem', fontWeight: 700, cursor: uploading ? 'wait' : 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: '1rem' }}>
              <Upload size={18} /> {uploading ? (th ? 'กำลังอัปโหลด...' : 'Uploading...') : (th ? 'เพิ่มรูปแบนเนอร์จากเครื่อง' : 'Add a banner image from this device')}
              <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder={th ? 'หรือวางลิงก์รูป https://...' : 'or paste an image link https://...'}
                aria-label={th ? 'ลิงก์รูปแบนเนอร์' : 'Banner image link'}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFromUrl(); } }}
                style={{ ...inputStyle, flex: '1 1 200px' }} />
              <button type="button" className="admin-btn secondary" onClick={addFromUrl} disabled={!urlInput.trim()}>{th ? 'เพิ่มจากลิงก์' : 'Add link'}</button>
            </div>
            <p style={{ ...hintStyle, marginTop: '0.7rem' }}>
              {th ? 'ขนาดแนะนำ 1200 × 520 พิกเซล (แนวนอน สัดส่วนเดียวกับโลโก้) รูปสัดส่วนอื่นจะถูกครอบตัดตรงกลางให้พอดี' : 'Recommended 1200 × 520 px (landscape, same shape as the logo). Other shapes are center-cropped to fit.'}
            </p>
          </div>

          {/* ── การเลื่อน / การแสดงผล ── */}
          <div className="admin-card">
            <h3 style={{ margin: '0 0 1rem 0' }}>{th ? 'การเลื่อนและการแสดงผล' : 'Motion and display'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={rowStyle}>
                <label htmlFor="bn-interval" style={{ fontWeight: 600 }}>{th ? 'เลื่อนอัตโนมัติทุก' : 'Auto-advance every'}</label>
                <select id="bn-interval" value={String(cfg.interval)} onChange={e => setField('interval', Number(e.target.value))} style={inputStyle}>
                  {[3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} {th ? 'วินาที' : 'seconds'}</option>)}
                  {![0, 3, 4, 5, 6, 8, 10].includes(cfg.interval) && <option value={cfg.interval}>{cfg.interval} {th ? 'วินาที' : 'seconds'}</option>}
                  <option value="0">{th ? 'ไม่เลื่อนเอง' : 'Do not auto-advance'}</option>
                </select>
              </div>
              <div style={rowStyle}>
                <span style={{ fontWeight: 600, flex: '1 1 200px' }}>{th ? 'แสดงข้อความ "สั่งอาหารด้วยตนเอง" ใต้สไลด์' : 'Show the "Self-ordering" line under the slider'}</span>
                <Toggle checked={cfg.showCaption} onChange={v => setField('showCaption', v)} label={th ? 'แสดงข้อความใต้สไลด์' : 'Show caption'} />
              </div>
              <div style={rowStyle}>
                <span style={{ fontWeight: 600, flex: '1 1 200px' }}>{th ? 'ค้างแบนเนอร์ไว้ด้านบนตลอดเมื่อลูกค้าเลื่อนจอ' : 'Keep the banner pinned to the top while scrolling'}</span>
                <Toggle checked={cfg.sticky} onChange={v => setField('sticky', v)} label={th ? 'ค้างแบนเนอร์ไว้ด้านบน' : 'Pin banner'} />
              </div>
              <div style={rowStyle}>
                <span style={{ fontWeight: 600, flex: '1 1 200px' }}>{th ? 'มีปุ่ม ✕ ให้ลูกค้ากดปิดแบนเนอร์เอง' : 'Show a ✕ button so customers can close the banner'}</span>
                <Toggle checked={cfg.closable} onChange={v => setField('closable', v)} label={th ? 'ให้ลูกค้าปิดแบนเนอร์ได้' : 'Closable'} />
              </div>
              <p style={hintStyle}>
                {th
                  ? 'ลูกค้าปิดแล้วจะไม่เห็นอีกจนกว่าจะสแกน QR เข้ามาใหม่ · การค้างจอและปุ่ม ✕ ทำงานเมื่อมีรูปแบนเนอร์เปิดอยู่อย่างน้อย 1 รูป ถ้าเหลือแต่โลโก้จะแสดงแบบเดิม'
                  : 'Once closed it stays hidden until the customer scans the QR again. Pinning and the ✕ button apply only when at least one banner image is on; with just the logo it shows as before.'}
              </p>
            </div>
          </div>
        </div>

        {/* ── ตัวอย่าง ── */}
        <div className="admin-card" style={{ minWidth: 0 }}>
          <h3 style={{ margin: '0 0 0.35rem 0' }}>{th ? 'ตัวอย่างบนจอลูกค้า' : 'Customer screen preview'}</h3>
          <p style={{ ...hintStyle, marginBottom: '1rem' }}>{th ? 'เปลี่ยนตามที่ตั้งทันที แต่ลูกค้าจะเห็นเมื่อกดบันทึกแล้ว' : 'Updates as you edit. Customers see it after you save.'}</p>
          <div style={{ maxWidth: 380, margin: '0 auto', background: '#ffffff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 22, padding: '0.9rem', textTransform: 'none', letterSpacing: 0 }}>
            {preview.slides.some(s => s.on) ? (
              <KioskBanner banner={preview} lang={lang} maxWidth={promo ? 448 : 340}
                onCategory={() => {}} onClose={promo && preview.closable ? () => {} : undefined} />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0.5rem', fontSize: '0.95rem' }}>
                {th ? 'ปิดไว้ทุกสไลด์ — ลูกค้าจะไม่เห็นแบนเนอร์และโลโก้ด้านบน' : 'All slides are off — customers will see no banner or logo at the top.'}
              </div>
            )}
            {preview.showCaption && (
              <div style={{ textAlign: 'center', color: '#c8102e', fontWeight: 700, fontSize: '0.85rem', marginTop: '0.4rem' }}>
                {th ? 'สั่งอาหารด้วยตนเอง' : 'Self-ordering'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageBanner;
