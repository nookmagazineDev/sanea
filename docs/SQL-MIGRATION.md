# ย้ายข้อมูล POS จาก Google Sheet → SQL Server

ระบบเดิมเก็บข้อมูลทุกอย่างไว้ใน Google Sheet ไฟล์เดียว แล้วคุยกับหน้าเว็บผ่าน Google Apps Script
ตอนนี้ย้ายมาอยู่บน **SQL Server** โดยยังใช้รูปแบบคำขอ/คำตอบแบบเดิมทั้งหมด

| เดิม | ใหม่ |
|---|---|
| Google Sheet (16 ชีท) | ตารางใน SQL Server (`db/schema.sql`) |
| Apps Script `/exec` | `/api/pos` (โค้ดอยู่ใน `api/`) |
| รูปเมนู/สลิปบน Google Drive | ตาราง `Images` เสิร์ฟผ่าน `/api/image?id=...` |
| `GAS_URL` ฮาร์ดโค้ดใน 16 ไฟล์ | `src/utils/api.js` ที่เดียว (ตั้งค่าได้ด้วย `VITE_API_URL`) |

ชื่อ action ทุกตัวเหมือนเดิม (`getLive`, `insertOrder`, `kioskPaidOrder`, `deductStock`, ...)
และคีย์ใน JSON ที่ส่งกลับก็เหมือนเดิม หน้าบ้านจึงไม่ต้องแก้ตรรกะใด ๆ

---

## 1. เตรียม SQL Server

```sql
CREATE DATABASE SaneaPOS;
GO
USE SaneaPOS;
CREATE LOGIN pos_app WITH PASSWORD = 'รหัสผ่านที่ตั้งเอง';
CREATE USER  pos_app FOR LOGIN pos_app;
ALTER ROLE db_owner ADD MEMBER pos_app;   -- ต้องสร้างตารางได้ตอนรัน sql:init
GO
```

ตรวจด้วยว่า
- เปิด **TCP/IP** ใน SQL Server Configuration Manager และเปิดพอร์ต **1433** ที่ไฟร์วอลล์
- เปิด **SQL Server Authentication** (Mixed Mode) — ระบบใช้ user/password ไม่ได้ใช้ Windows Auth

## 2. ตั้งค่าโปรเจกต์

```bash
npm install                 # ดึงแพ็กเกจ mssql เข้ามา แล้ว commit package-lock.json ที่อัปเดตด้วย
cp .env.example .env        # แล้วแก้ค่า SQL_* ให้ตรงกับเซิร์ฟเวอร์จริง
npm run sql:init            # สร้างตารางทั้งหมด (รันซ้ำได้ ไม่ลบข้อมูล)
```

> รหัสผ่านที่มีตัว `#` ต้องเขียนเป็น `SQL_PASSWORD="รหัสผ่าน"` เสมอ ไม่งั้นค่าจะถูกตัดตั้งแต่ตัว `#`
> (Node อ่าน `.env` แล้วถือว่าหลัง `#` เป็นคอมเมนต์) อาการที่ได้คือขึ้น `Login failed for user`

> `package.json` เพิ่ม `mssql` เข้ามาใหม่ แต่ `package-lock.json` ยังไม่ได้อัปเดต
> (เครื่องที่เขียนโค้ดนี้ต่อ npm registry ไม่ได้) — รัน `npm install` หนึ่งครั้งแล้ว commit lock file ตามไปด้วย

## 3. ย้ายข้อมูลเดิมจาก Google Sheet

1. เปิด Apps Script เดิม → วางโค้ดจาก `gas_complete_script.js` เวอร์ชันล่าสุด (ตัวที่มี `action=exportSheet`)
   → **Deploy เวอร์ชันใหม่** แล้วเช็กด้วย `<URL>/exec?action=ping` ว่า `build` เป็น `2026-09-11-export-for-sql`
2. ใส่ URL `/exec` นั้นลงในไฟล์ `.env` ที่ตัวแปร `GAS_EXPORT_URL`
3. ลองดูก่อนว่าจะย้ายอะไรบ้าง (ยังไม่เขียนข้อมูล):

```bash
npm run sql:migrate
```

4. ย้ายจริง (ตารางปลายทางถูกล้างก่อนเขียนใหม่ — รันซ้ำได้ ข้อมูลไม่ซ้อน):

```bash
npm run sql:migrate -- --write
npm run sql:migrate -- --write --only Orders      # เฉพาะบางชีท
```

## 3.5 เปลี่ยนรหัสเมนู/หมวดหมู่เป็น SN00001

รหัสเดิมที่ยกมาจากชีทเป็น timestamp 13 หลัก (เมนู) และคำอย่าง `food` / `cat_1712345678` (หมวดหมู่)
สคริปต์นี้เปลี่ยนให้เป็น `SN` + เลข 5 หลัก เรียงกันไป แล้วไล่แก้ทุกที่ที่อ้างถึงรหัสนั้นให้ครบ

```bash
npm run sql:renumber              # ดูตารางรหัสเก่า→ใหม่ ไม่เขียนอะไร
npm run sql:renumber -- --write   # เปลี่ยนจริง (ทำในทรานแซกชันเดียว)
```

เมนูกับหมวดหมู่ใช้ชุดเลขเดียวกัน รหัสตัวหนึ่งจึงชี้ไปที่ของชิ้นเดียวเสมอ ไม่มีทางซ้ำข้ามตาราง
ตารางเทียบรหัสเก่า/ใหม่ถูกเก็บไว้ที่ `db/id-map.json`

ที่ถูกแก้ตามไปด้วย:

| ตาราง | คอลัมน์ |
|---|---|
| Categories | `slug`, `popupNCategory`, `popupNItems`, `popupNItemsMax` (คีย์) |
| Menu | `id`, `category`, `categories[]`, `bundledItems[]`, `popupConfig` (ข้างใน JSON) |
| Bom | `menuId` |
| StockOut | `menuId` |
| Discounts | `categories[]` |

`Orders` กับ `TableOrders` เก็บ "ชื่อเมนู" ไม่ได้เก็บรหัส บิลเก่าจึงไม่ได้รับผลกระทบ

**สองเรื่องที่ต้องรู้**

1. หมวดเครื่องดื่มเดิม (slug ขึ้นต้นด้วย `drink`) จะถูกตั้ง `hasDining = false` ให้อัตโนมัติ
   เพราะโค้ดหน้าขายเคยเช็กตรง ๆ ว่าหมวดชื่อ `drink` เพื่อข้ามคำถาม "ทานที่ร้าน/ห่อกลับบ้าน"
   ตอนนี้ย้ายมาอ่านจากค่า `hasDining` แทน ถ้าร้านมีหมวดเครื่องดื่มที่ตั้งชื่อ slug เป็นอย่างอื่น
   ให้เข้าไปติ๊กปิด "ถามการรับประทาน" ในหน้าจัดการหมวดหมู่เอง
2. ถ้ารัน `sql:migrate` ซ้ำอีกครั้ง ข้อมูลจากชีทจะทับด้วยรหัสเก่า ต้องรัน `sql:renumber -- --write` ซ้ำ
   (รันซ้ำได้ตลอด รหัสที่เป็น SN อยู่แล้วจะไม่ขยับ)

รหัสของรายการที่สร้างใหม่หลังจากนี้จะเดินต่อให้เองจากเลขสูงสุดที่มีอยู่

## 4. ตั้งค่าให้หน้าเว็บใช้ API ใหม่

**กรณี A — SQL Server เปิดให้เข้าจากอินเทอร์เน็ตได้** (ทางที่ง่ายที่สุด)

ใส่ตัวแปรเหล่านี้ที่ Vercel → Settings → Environment Variables แล้ว deploy:

```
SQL_SERVER, SQL_PORT, SQL_DATABASE, SQL_USER, SQL_PASSWORD, SQL_ENCRYPT, SQL_TRUST_CERT
```

หน้าเว็บจะเรียก `/api/pos` บนโดเมนเดียวกันเอง ไม่ต้องตั้งอะไรเพิ่ม

**กรณี B — SQL Server อยู่วงในออฟฟิศ ออกเน็ตไม่ได้**

> วิธีที่แนะนำคือเปิดออกผ่าน **Cloudflare Tunnel** — ไม่ต้องเปิดพอร์ตที่เราเตอร์เลย, IP เปลี่ยนก็ไม่พัง,
> และ SQL Server ไม่โผล่ออกอินเทอร์เน็ต ขั้นตอนครบอยู่ที่ [`CLOUDFLARE-TUNNEL.md`](CLOUDFLARE-TUNNEL.md)
> (เจอบ่อย: ISP ไทยบล็อกพอร์ต 1433 ขาเข้าจากต่างประเทศ ทำให้ Vercel ต่อไม่ติดทั้งที่เช็คจากในไทยแล้วพอร์ตเปิด)

รัน API ไว้ที่เครื่องในออฟฟิศที่มองเห็น SQL Server (เครื่องเดียวกันก็ได้):

```bash
npm run api:serve          # ขึ้นที่พอร์ต 8081
```

ที่เครื่อง Windows ใช้ `start-api.bat` แทนได้ (ติดตั้งส่วนประกอบให้เองครั้งแรก)
และ `install-api-autostart.bat` เพื่อให้เปิดเองทุกครั้งที่เปิดเครื่อง

เปิดพอร์ตนั้นออกอินเทอร์เน็ต (ทำ reverse proxy + โดเมน + https ให้เรียบร้อย เพราะหน้าเว็บเป็น https
เบราว์เซอร์จะบล็อกการเรียก http ปนกัน) แล้ว build หน้าเว็บโดยชี้ปลายทางไปที่นั่น:

```
VITE_API_URL=https://pos-api.example.com/api/pos
IMAGE_BASE_URL=https://pos-api.example.com     # ให้ลิงก์รูปที่บันทึกใหม่ชี้ถูกที่
```

> คีออสลูกค้า (สแกน QR สั่งเอง) ใช้เน็ตมือถือ ไม่ได้อยู่ในวงแลนร้าน
> ถ้า API เข้าจากนอกไม่ได้ หน้าลูกค้าสั่งเองจะใช้ไม่ได้ — ต้องเลือกกรณี A หรือทำ B ให้เข้าจากนอกได้

## 5. ตรวจว่าใช้งานได้จริง

เปิดในเบราว์เซอร์:

| URL | ต้องได้ |
|---|---|
| `/api/pos?action=ping` | `"db": "connected"` พร้อมจำนวนแถวในตาราง Menu |
| `/api/pos?action=getStatic` | เมนู/หมวดหมู่/พนักงานครบ |
| `/api/pos?action=getLive` | รายการรายโต๊ะ + บิลล่าสุด |

แล้วทดสอบบนหน้าจริงตามลำดับนี้: เปิดกะ → สั่งอาหารเข้าโต๊ะ → เช็กบิล → ดูรายงาน → ปิดกะ

## 6. ตั้งค่า Print Server

หน้า **จัดการหลังบ้าน → ตั้งค่าเครื่องพิมพ์** กดบันทึกการพิมพ์อัตโนมัติอีกครั้งหนึ่ง
ระบบจะส่ง URL ของ API ใหม่ไปให้ Print Server เอง (ของเดิมยังชี้ไปที่ Apps Script อยู่)

## 7. ถ้าต้องถอยกลับ

โปรโตคอลของ API ใหม่เหมือน Apps Script เดิมทุกอย่าง ถอยกลับได้ด้วยการ build ใหม่โดยชี้กลับไปที่ของเดิม:

```
VITE_API_URL=https://script.google.com/macros/s/xxxxx/exec
```

ข้อมูลที่ลงใน SQL ระหว่างนั้นจะไม่ถูกย้ายกลับเข้าชีทให้อัตโนมัติ — ถ้าใช้งานจริงไปแล้วหลายวัน
ให้ดึงจาก SQL ออกมาเองก่อนถอย

---

## ตารางเทียบชีท ↔ ตาราง

| ชีทเดิม | ตารางใหม่ | หมายเหตุ |
|---|---|---|
| Orders | `Orders` | เพิ่ม `TsLocal` (เวลาไทยแบบวันที่จริง) ไว้ทำดัชนีรายงาน |
| TableOrders | `TableOrders` | |
| Menu | `Menu` | `Seq` = ลำดับการแสดงผลแทนลำดับแถวในชีท |
| Categories | `Categories` | ป๊อปอัพ 6 ชุด ชุดละ 7 คอลัมน์เหมือนเดิม |
| Promotions / Users / Discounts / Settings / Printers | ชื่อเดียวกัน | |
| LiquorStorage / Waste / PaymentApprovals / OutstandingBills / Shifts / PaymentSummary | ชื่อเดียวกัน | |
| วัตถุดิบ | `Ingredients` | |
| BOM | `Bom` | |
| รับวัตถุดิบ | `StockIn` | |
| ตัดสต็อก | `StockOut` | |
| สรุปสต็อก | *(ไม่มี)* | คำนวณสดจาก `StockIn − StockOut` ตอนเรียก `getStock` |
| — | `Images` | รูปเมนู/สลิป (แทน Google Drive) |

## เรื่องที่ต่างจากของเดิม

- **เลขบิลคีออส** เดิมกันชนกันด้วย `LockService` ตอนนี้ใช้ทรานแซกชันระดับ SERIALIZABLE + `UPDLOCK`
- **บิล + ยอดชำระ** (`insertOrder`) เขียนในทรานแซกชันเดียว — ไม่มีทางที่บิลขึ้นแต่ payment หายอีก
- **ไม่มี cache 60 วินาที** ของฝั่งเซิร์ฟเวอร์แล้ว แก้เมนูหลังบ้านเห็นผลรอบ poll ถัดไปเลย
- **`initSheets`** ไม่ทำอะไรแล้ว โครงสร้างตารางมาจาก `db/schema.sql`
