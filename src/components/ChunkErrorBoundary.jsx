// ===============================================================
// กันจอขาวหลังดีพลอยเวอร์ชันใหม่
// ---------------------------------------------------------------
// หน้าหลังบ้านทุกหน้าโหลดแบบ lazy (โค้ดถูกแตกเป็นไฟล์ย่อยชื่อมีแฮชกำกับ)
// พอดีพลอยรอบใหม่ ไฟล์ย่อยชุดเก่าจะหายไปจากเซิร์ฟเวอร์ แท็บที่เปิดค้างไว้
// ตั้งแต่ก่อนดีพลอยยังถือรายชื่อไฟล์ชุดเก่าอยู่ พอกดเปลี่ยนเมนูจึงไปโหลด
// ไฟล์ที่ไม่มีแล้ว (404) แล้ว React ก็ถอดทั้งหน้าจอทิ้ง = จอขาว
// ต้องกดรีเฟรชเองถึงจะได้รายชื่อไฟล์ชุดใหม่
//
// ตัวนี้ดักข้อผิดพลาดแบบนั้นแล้วรีโหลดให้เอง 1 ครั้ง (ผลเหมือนผู้ใช้กดรีเฟรช)
// ถ้ารีโหลดแล้วยังพัง = ไม่ใช่เรื่องไฟล์หาย จึงโชว์ปุ่มให้กดเอง ไม่วนรีโหลดไม่จบ
// ===============================================================

import React from 'react';

// ข้อความของเบราว์เซอร์ตอนโหลดไฟล์ย่อยไม่สำเร็จ — ต่างกันไปตาม Chrome / Safari / Firefox
const CHUNK_ERROR_PATTERN = /(dynamically imported module|dynamic import|importing a module script failed|chunkloaderror|loading chunk|failed to fetch)/i;

export const isChunkLoadError = (error) => {
  if (!error) return false;
  const text = `${error.name || ''} ${error.message || ''}`;
  return CHUNK_ERROR_PATTERN.test(text);
};

const RELOAD_KEY = 'chunk_reload_at';
const RELOAD_COOLDOWN_MS = 20000;

// รีโหลดได้ไหม — กันกรณีไฟล์พังจริงจนรีโหลดแล้วพังซ้ำเป็นวงจร
export const reloadOnceForChunkError = () => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch (e) {
    // เบราว์เซอร์ปิด sessionStorage อยู่ — ยอมรีโหลดไปเลย ดีกว่าค้างจอขาว
  }
  window.location.reload();
  return true;
};

class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info);
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      this.setState({ reloading: true });
    }
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    const isTh = this.props.lang !== 'en';
    const chunk = isChunkLoadError(error);

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
        padding: '2rem 1.25rem', textAlign: 'center'
      }}>
        <div style={{ fontSize: '2rem' }}>{reloading ? '⏳' : '⚠️'}</div>
        <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main, #0f172a)' }}>
          {reloading
            ? (isTh ? 'มีเวอร์ชันใหม่ กำลังโหลดหน้าใหม่ให้...' : 'New version found — reloading...')
            : chunk
              ? (isTh ? 'โหลดหน้านี้ไม่สำเร็จ' : 'Could not load this page')
              : (isTh ? 'หน้านี้มีข้อผิดพลาด' : 'Something went wrong on this page')}
        </div>
        {!reloading && (
          <>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', maxWidth: '420px', lineHeight: 1.6 }}>
              {chunk
                ? (isTh
                    ? 'มักเกิดตอนระบบเพิ่งอัปเดตเวอร์ชันใหม่ กดปุ่มด้านล่างเพื่อโหลดหน้าใหม่ ข้อมูลที่บันทึกไว้แล้วไม่หาย'
                    : 'This usually happens right after an update. Reload to get the latest version — saved data is not affected.')
                : (isTh
                    ? 'กดโหลดหน้าใหม่อีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบพร้อมข้อความด้านล่าง'
                    : 'Try reloading. If it keeps happening, send this message to your administrator.')}
            </div>
            {!chunk && (
              <code style={{
                fontSize: '0.72rem', color: '#b91c1c', background: 'rgba(185,28,28,0.08)',
                borderRadius: '8px', padding: '0.4rem 0.6rem', maxWidth: '420px', overflowWrap: 'anywhere'
              }}>
                {String(error.message || error)}
              </code>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '0.35rem', background: '#ea580c', color: '#ffffff', border: 'none',
                borderRadius: '10px', padding: '0.65rem 1.25rem', fontWeight: 800,
                fontSize: '0.95rem', cursor: 'pointer', fontFamily: 'inherit'
              }}
            >
              {isTh ? 'โหลดหน้าใหม่' : 'Reload page'}
            </button>
          </>
        )}
      </div>
    );
  }
}

export default ChunkErrorBoundary;
