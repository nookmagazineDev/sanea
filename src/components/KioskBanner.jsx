import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Wordmark from './Wordmark';
import { BANNER_RATIO, activeSlides, safeUrl } from '../utils/banner';

// สไลด์แบนเนอร์หัวจอหน้าลูกค้าสั่งเอง (ตั้งค่าที่หลังบ้าน > ตั้งค่าแบนเนอร์)
// - รูปเดียว = แสดงนิ่ง ๆ ไม่มีลูกศร/จุด เหมือนโลโก้เดิม
// - หลายรูป = ปัดซ้ายขวาได้ + เลื่อนเองตามเวลาที่ตั้ง
//
// props
//   banner    ค่าจาก resolveBanner(settings)
//   lang      'th' | 'en'
//   joinUrl   ลิงก์สมัครสมาชิก LINE (ว่าง = สไลด์ที่ลิงก์ไปสมัครสมาชิกจะกดไม่ได้)
//   onMember  เรียกตอนลูกค้ากดสไลด์ที่ลิงก์ไปสมัครสมาชิก
//   onCategory(slug)  เรียกตอนกดสไลด์ที่ลิงก์ไปหมวดเมนู
//   onClose   มีค่า = แสดงปุ่ม ✕
//   maxWidth  ความกว้างสูงสุดของสไลด์ (px)
const KioskBanner = ({ banner, lang = 'th', joinUrl = '', onMember, onCategory, onClose, maxWidth = 340 }) => {
  const th = lang === 'th';
  const slides = activeSlides(banner);
  const count = slides.length;
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  // นับใหม่ทุกครั้งที่ลูกค้าเลื่อนเอง จะได้ไม่เด้งหนีทันทีหลังเพิ่งปัดมาดู
  const [tick, setTick] = useState(0);
  const interval = Number(banner && banner.interval) || 0;

  const goTo = (n, smooth = true) => {
    const el = trackRef.current;
    if (!el || count === 0) return;
    const next = ((n % count) + count) % count;
    el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    setIndex(next);
  };

  // ร้านลบ/ปิดสไลด์ระหว่างที่ลูกค้าเปิดหน้าอยู่ → กลับไปใบแรก ไม่ค้างที่ตำแหน่งว่าง
  useEffect(() => {
    if (index >= count && count > 0) goTo(0, false);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // ลูกค้าปัดเอง → อัปเดตจุดบอกตำแหน่ง
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let timer = null;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (el.clientWidth > 0) setIndex(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
      }, 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(timer); el.removeEventListener('scroll', onScroll); };
  }, [count]);

  // หมุนจอ/ย่อขยายหน้าต่าง → จัดให้ตรงใบเดิม
  useEffect(() => {
    const onResize = () => {
      const el = trackRef.current;
      if (el) el.scrollTo({ left: index * el.clientWidth, behavior: 'auto' });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [index]);

  // เลื่อนเอง — หยุดตอนแท็บไม่ได้เปิดดูอยู่ และตอนเครื่องตั้งค่าลดการเคลื่อนไหว
  useEffect(() => {
    if (count < 2 || interval <= 0) return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      goTo(index + 1);
    }, interval * 1000);
    return () => clearInterval(timer);
  }, [count, interval, index, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (count === 0) return null;

  const manual = (n) => { goTo(n); setTick(t => t + 1); };

  const fill = { display: 'block', width: '100%', height: '100%', border: 'none', padding: 0, margin: 0, background: 'none', cursor: 'pointer' };
  const renderSlide = (slide) => {
    const isLogo = slide.kind === 'logo';
    const alt = isLogo ? (th ? 'เสน่ห์' : 'SA-NAE') : (slide.name || (th ? 'โปรโมชัน' : 'Promotion'));
    const img = isLogo ? (
      <div role="img" aria-label={alt} style={{ width: '100%', height: '100%', background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Wordmark variant="dark" size={52} />
      </div>
    ) : (
      <img src={slide.url} alt={alt} draggable={false}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
    );
    const link = slide.link || { type: 'none' };
    if (link.type === 'member' && joinUrl) {
      return <a href={joinUrl} target="_blank" rel="noopener noreferrer" onClick={() => onMember && onMember()} style={fill}>{img}</a>;
    }
    if (link.type === 'url' && safeUrl(link.value)) {
      return <a href={safeUrl(link.value)} target="_blank" rel="noopener noreferrer" style={fill}>{img}</a>;
    }
    if (link.type === 'category' && link.value && onCategory) {
      return <button type="button" onClick={() => onCategory(link.value)} style={fill}>{img}</button>;
    }
    return img;
  };

  const navBtn = (side) => ({
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 6, zIndex: 2,
    width: 30, height: 30, borderRadius: '50%', border: 'none', padding: 0,
    background: 'rgba(255,255,255,0.88)', color: '#141414', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.18)'
  });

  return (
    <div style={{ width: '100%', maxWidth, margin: '0 auto' }}>
      <div style={{ position: 'relative', borderRadius: count > 1 || slides[0].kind !== 'logo' ? 14 : 0, overflow: 'hidden' }}>
        <div ref={trackRef} className="kiosk-banner-track"
          style={{ display: 'flex', overflowX: count > 1 ? 'auto' : 'hidden', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {slides.map(slide => (
            <div key={slide.id} style={{ flex: '0 0 100%', minWidth: 0, scrollSnapAlign: 'start', aspectRatio: BANNER_RATIO, background: '#ffffff' }}>
              {renderSlide(slide)}
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            <button type="button" onClick={() => manual(index - 1)} aria-label={th ? 'สไลด์ก่อนหน้า' : 'Previous slide'} style={navBtn('left')}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => manual(index + 1)} aria-label={th ? 'สไลด์ถัดไป' : 'Next slide'} style={navBtn('right')}>
              <ChevronRight size={18} />
            </button>
          </>
        )}

        {onClose && (
          <button type="button" onClick={onClose} aria-label={th ? 'ปิดแบนเนอร์' : 'Close banner'}
            style={{
              position: 'absolute', top: 6, right: 6, zIndex: 3, width: 30, height: 30, borderRadius: '50%',
              border: 'none', padding: 0, background: 'rgba(20, 20, 20, 0.65)', color: '#ffffff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
            <X size={16} />
          </button>
        )}
      </div>

      {count > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 7 }}>
          {slides.map((slide, i) => (
            <button key={slide.id} type="button" onClick={() => manual(i)}
              aria-label={(th ? 'ไปสไลด์ ' : 'Go to slide ') + (i + 1)} aria-current={i === index ? 'true' : undefined}
              style={{
                width: i === index ? 22 : 8, height: 8, borderRadius: 4, border: 'none', padding: 0, cursor: 'pointer',
                background: i === index ? '#c8102e' : '#e4e4e4', transition: 'width 0.3s, background 0.3s'
              }} />
          ))}
        </div>
      )}
      <style>{`.kiosk-banner-track::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
};

export default KioskBanner;
