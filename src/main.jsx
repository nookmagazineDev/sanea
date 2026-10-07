import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { reloadOnceForChunkError } from './components/ChunkErrorBoundary.jsx'

// Vite ยิง event นี้เมื่อโหลดไฟล์ย่อย (chunk) ของหน้าที่กำลังจะเปิดไม่สำเร็จ
// เกิดหลังดีพลอยเวอร์ชันใหม่ ไฟล์ชุดเก่าหายไปแล้ว — รีโหลดให้เองแทนที่จะปล่อยจอขาว
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForChunkError();
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
