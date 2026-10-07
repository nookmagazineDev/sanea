# เสน่ห์ POS

ระบบขายหน้าร้าน (React + Vite) — หน้าขาย, จอครัว, ลูกค้าสแกน QR สั่งเอง, จัดการเมนู/สต็อก/กะ/รายงาน

## ข้อมูลอยู่ที่ไหน

ตอนนี้ข้อมูลทั้งหมดอยู่ใน **Google Sheet ของเสน่ห์** เรียกผ่าน Google Apps Script
(URL อยู่ที่ `src/utils/api.js` · โค้ดฝั่ง Apps Script คือไฟล์ `gas_complete_script.js`)

**ต้องทำหลัง merge (ครั้งเดียว):** เปิดโปรเจกต์ Apps Script ตัวเดิมของเสน่ห์ → วางโค้ดจาก `gas_complete_script.js` ทับทั้งไฟล์ →
Deploy > Manage deployments > แก้ deployment เดิม > Version: **New version** (URL เดิมไม่เปลี่ยน)
แล้วเปิด `<URL>?action=ping` ดูว่า `build` เป็น `2026-10-07-sanea-humlai-features`
- ก่อน deploy สคริปต์ใหม่ หน้าขาย/หลังบ้านหลัก ๆ ยังใช้ได้ (หน้าเว็บถอยไปใช้คำสั่งเดิมให้เอง)
  แต่ล็อกอินที่เซิร์ฟเวอร์, สาขา, ผังโต๊ะ, เมนูรายสาขา, ลำดับเมนู, ใบกำกับภาษี, ลูกค้าสแกนจ่าย, บันทึกเตรียม/นับสต็อก จะใช้ได้หลัง deploy
- สคริปต์ใหม่สร้างชีตที่ขาด (Branches, MenuBranch, KioskPayments, TaxInvoices, TaxCustomers) และเพิ่มคอลัมน์ให้ชีตเดิมเอง

### ย้ายไป SQL Server ภายหลัง (ยังไม่ต้องทำ)

โค้ด API ฝั่ง SQL Server อยู่ในโฟลเดอร์ `api/` ครบแล้ว (`db/schema.sql` = โครงสร้างตาราง) — พร้อมเมื่อไรแค่ build ด้วย `VITE_API_URL=/api/pos`
- ตั้งค่าการเชื่อมต่อ: คัดลอก `.env.example` เป็น `.env` แล้วแก้ค่า `SQL_*` → `npm run sql:init` → `npm run sql:migrate -- --write`
- ขั้นตอนทั้งหมด: [`docs/SQL-MIGRATION.md`](docs/SQL-MIGRATION.md) · เกาะโดเมนเดิม: [`docs/API-BEHIND-EXISTING-DOMAIN.md`](docs/API-BEHIND-EXISTING-DOMAIN.md) · Cloudflare Tunnel: [`docs/CLOUDFLARE-TUNNEL.md`](docs/CLOUDFLARE-TUNNEL.md)

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | เปิดหน้าเว็บโหมดพัฒนา |
| `npm run build` | build ไฟล์สำหรับ deploy |
| `npm run sql:init` | สร้าง/ตรวจสอบตารางบน SQL Server |
| `npm run sql:migrate` | ย้ายข้อมูลจาก Google Sheet เดิม (ใส่ `-- --write` เพื่อเขียนจริง) |
| `npm run sql:renumber` | เปลี่ยนรหัสเมนู/หมวดหมู่เป็น SN00001 พร้อมไล่แก้ทุกที่ที่อ้างถึง |
| `npm run api:serve` | รัน API เป็นเซิร์ฟเวอร์ของตัวเอง (กรณีไม่ได้ deploy บน Vercel) |
| `node server.js` | Print Server ที่เครื่องหน้าร้าน |

## สคริปต์สำหรับเครื่องที่ร้าน (Windows — ดับเบิลคลิกได้เลย)

| ไฟล์ | ทำอะไร |
|---|---|
| `start-api.bat` | เปิด API Server แบบเห็นหน้าต่าง (ใช้ตอนตั้งค่าครั้งแรก/หาสาเหตุ) |
| `install-api-autostart.bat` | ตั้งให้ API Server เปิดเองทุกครั้งที่เปิดเครื่อง และเปิดใหม่ให้เองถ้าดับ |
| `uninstall-api-autostart.bat` | ยกเลิกการเปิดอัตโนมัติ (ไม่กระทบ Print Server) |
| `start-printer.bat` | เปิด Print Server แบบเห็นหน้าต่าง |
| `install-autostart.bat` | ตั้งให้ Print Server เปิดเองทุกครั้งที่เปิดเครื่อง |

---
## เทียบกับ HumLai-POS

โค้ดชุดนี้ใช้ฟังก์ชันและหน้าจอชุดเดียวกับ HumLai-POS ทุกหน้า สิ่งที่แยกเป็นของร้านเสน่ห์เอง:

- **เมนู หมวดหมู่ และรูปเมนู** — อยู่ใน Google Sheet ของเสน่ห์เอง (ถ้าย้ายไป SQL ภายหลัง ใช้ฐานข้อมูลแยก `SaneaPOS`) และรูปใน `public/images/` ไม่ปนกับร้านอื่น
- **รหัสเมนู/หมวดหมู่** ขึ้นต้นด้วย `SN` (เช่น `SN00001`)
- **พอร์ต API Server (ตอนใช้ SQL)** ค่าเริ่มต้นคือ `8081` เปิดเครื่องเดียวกับ API ของร้านอื่นได้โดยไม่ชนกัน
- ชื่อร้าน/โลโก้บนหน้าจอและใบเสร็จเป็นของเสน่ห์
