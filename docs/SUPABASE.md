# เสน่ห์ POS บน Supabase

ข้อมูลของเสน่ห์ย้ายจาก Google Sheet มาอยู่ที่ Supabase แล้ว (โปรเจกต์ **sanea-pos**, สิงคโปร์, แพ็กเกจฟรี)

| ส่วน | อยู่ที่ |
|---|---|
| ฐานข้อมูล | Supabase Postgres · schema `dbo` (ไม่เปิดผ่าน REST API ของ Supabase เข้าได้ทางฟังก์ชัน `pos` เท่านั้น) |
| API | Edge Function `pos` · `https://gdcdbzwhucqkxrjlpege.supabase.co/functions/v1/pos` |
| รูปเมนู / สลิป | Supabase Storage · bucket `images` (เปิดให้ดูได้) |
| โค้ด API | `supabase/functions/pos/` (แปลงจาก API ของ HumLai-POS ให้ใช้ Postgres) |

หน้าเว็บเรียก API นี้เป็นค่าเริ่มต้น (`src/utils/api.js`) — ไม่ต้องตั้งค่าเพิ่ม

## Deploy API ใหม่หลังแก้โค้ด

```bash
npx supabase login
```

```bash
npx supabase functions deploy pos --project-ref gdcdbzwhucqkxrjlpege
```

ทดสอบ: เปิด `https://gdcdbzwhucqkxrjlpege.supabase.co/functions/v1/pos?action=ping` ต้องเห็น `"db":"connected"`

## ย้ายข้อมูลจาก Google Sheet อีกครั้ง

ล้างตารางที่ย้ายแล้วเขียนใหม่ทั้งหมด (บิลที่เกิดบน Supabase หลังย้ายจะหายด้วย — ใช้เฉพาะก่อนเปิดใช้งานจริง)

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate-sheets-to-supabase.mjs
```

สคริปต์ Google รุ่นที่ deploy อยู่ส่งออกไม่ได้: บันทึกการทิ้ง สูตรอาหาร (BOM) และประวัติรับเข้า/ตัดสต็อกรายครั้ง
สต็อกจึงย้ายเป็นยอดคงเหลือ ณ วันที่ย้าย (แถว "ยอดยกมาจาก Google Sheet")

## สาขาและเลขบิล

- ย้ายมาเป็นสาขาเดียว รหัส `sanea` ชื่อ "เสน่ห์" คำนำหน้าเลขบิล `SN` (แก้ได้ที่ หลังบ้าน > สาขา)
- บิลเก่าคงเลขเดิม (`#001` …) บิลใหม่เริ่ม `SN-#001`

## ลูกค้าสั่งก่อน จ่ายทีหลัง

1. ลูกค้ากด "ยืนยันสั่งอาหาร" → `kioskOrder` ลงรายการในโต๊ะ (ยังไม่จ่าย)
2. เครื่องพนักงานที่ตั้งเครื่องพิมพ์ไว้ ดึง `claimKioskTickets` ทุก 6 วินาที แล้วพิมพ์ใบครัวให้ (แต่ละรอบพิมพ์เครื่องเดียว)
3. ลูกค้ากด "ชำระเงิน" → `kioskPaymentRequest` (payLater) — ยอดคิดจากรายการในโต๊ะที่เซิร์ฟเวอร์
4. พนักงานกด "ได้รับเงินแล้ว · ปิดบิล" → ออกเลขบิล ลงยอดขาย ทำเครื่องหมายรายการในโต๊ะว่าจ่ายแล้ว

## Print Server ในร้าน

ถ้าใช้ Print Server ให้เปลี่ยนที่อยู่ API ในเครื่องนั้นเป็นที่อยู่ข้างบน (เดิมชี้ Google Apps Script)

## หมายเหตุ

- โฟลเดอร์ `api/` (API สำหรับ SQL Server บน Vercel) ไม่ได้ใช้แล้ว
- โปรเจกต์ฟรีของ Supabase จะหยุดเองถ้าไม่มีใครใช้ 7 วันติด — เปิดใช้ใหม่ได้ที่หน้า Supabase
