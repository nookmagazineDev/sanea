import React, { useEffect, useMemo, useState } from 'react';
import { menuImageCandidates } from '../utils/menuImage';

// รูปที่อยู่นอกเว็บเรา (Google Drive / ImgBB) โหลดพลาดได้ชั่วคราว (เน็ตมือถือสะดุด, Google จำกัดจำนวนครั้ง)
// → รอสักครู่แล้วลองใหม่ 1 ครั้งก่อนข้ามไปไฟล์ถัดไป ไม่ให้รูปที่ตั้งไว้หายไปถาวรเพราะพลาดครั้งเดียว
const canRetry = (url) => /^https?:\/\//i.test(url || '');
// สุ่มเวลารอ ไม่ให้รูปที่พลาดพร้อมกันทั้งหน้า ยิงซ้ำพร้อมกันอีกรอบ
const retryDelay = () => 1200 + Math.floor(Math.random() * 1800);

// รูปเมนูที่ลองโหลดไล่ตามลำดับ — ถ้าไฟล์ไหนโหลดไม่ได้ก็ขยับไปไฟล์ถัดไป
// ลองครบทุกไฟล์แล้วยังไม่ได้ = โชว์ 🍽️ แทน (ไม่วนโหลดรูปเสียซ้ำไม่จบ)
const MenuImage = ({ food, width = 640, style, className, placeholderClassName, placeholderSize = '2.2rem', ref, ...imgProps }) => {
  const candidates = useMemo(
    () => menuImageCandidates(food, width),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [food?.image, food?.name, food?.category, food?.id, food?.baseId, width]
  );
  const key = candidates.join('|');
  // retry: 0 = ครั้งแรก · 1 = รอลองใหม่ · 2 = กำลังลองใหม่
  const [state, setState] = useState({ key, idx: 0, retry: 0 });
  // เมนูเปลี่ยน = เริ่มลองจากไฟล์แรกใหม่
  const cur = state.key === key ? state : { key, idx: 0, retry: 0 };
  const base = candidates[cur.idx];

  useEffect(() => {
    if (cur.retry !== 1) return undefined;
    const t = setTimeout(() => setState(s => (s.key === key && s.retry === 1 ? { ...s, retry: 2 } : s)), retryDelay());
    return () => clearTimeout(t);
  }, [cur.retry, cur.idx, key]);

  if (!base) {
    return (
      <div
        ref={ref}
        className={placeholderClassName}
        aria-hidden="true"
        style={{
          ...style,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f1f1f1', fontSize: placeholderSize
        }}
      >
        🍽️
      </div>
    );
  }

  // ลองใหม่ด้วยที่อยู่เดิม + #retry ให้เบราว์เซอร์โหลดอีกรอบ (ตัวไฟล์ที่ได้เหมือนเดิม)
  const src = cur.retry === 2 ? `${base}#retry` : base;
  const onError = () => {
    if (cur.retry === 0 && canRetry(base)) setState({ key, idx: cur.idx, retry: 1 });
    else setState({ key, idx: cur.idx + 1, retry: 0 });
  };

  return (
    <img
      ref={ref}
      src={src}
      className={className}
      /* Google Drive ปฏิเสธการโหลดรูปข้ามเว็บเมื่อมี referrer ติดไปด้วย */
      referrerPolicy="no-referrer"
      decoding="async"
      onError={onError}
      {...imgProps}
      /* ระหว่างรอลองใหม่ ซ่อนไอคอนรูปเสียไว้ก่อน */
      style={cur.retry === 1 ? { ...style, visibility: 'hidden' } : style}
    />
  );
};

export default MenuImage;
