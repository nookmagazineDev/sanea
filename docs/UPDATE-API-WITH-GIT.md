# อัปเดต API Server ด้วย Git

ใช้กับเครื่องที่รัน API Server (เครื่อง SQL, โฟลเดอร์ `D:\sanea-pos`) แทนการโหลด ZIP มาวางทับ
ตั้งค่าครั้งเดียว หลังจากนั้นทุกครั้งที่มีโค้ดใหม่ใน `main` แค่คลิกขวา `update-api.bat` → Run as administrator

`update-api.bat` ทำให้ครบ 4 ขั้น: ดึงโค้ดล่าสุด → ลงส่วนประกอบถ้ามีเปลี่ยน → อัปเดตโครงสร้างฐานข้อมูล (`sql:init`) → รีสตาร์ต API แล้ว ping ให้ดู
ถ้าขั้นไหนพัง สคริปต์จะหยุดก่อนรีสตาร์ต API ตัวเดิมจึงยังทำงานต่อ ร้านไม่สะดุด

ไฟล์ในเครื่องที่ไม่ได้อยู่ใน GitHub ไม่ถูกแตะ: `.env`, `node_modules`, `logs`, `print-auto-config.json`

## ตั้งค่าครั้งแรก

### 1. ติดตั้ง Git

มี Git อยู่แล้ว (รัน `git --version` แล้วขึ้นเลขรุ่น) → ข้ามข้อนี้ได้เลย
ถึงจะมีบัญชี GitHub ของคนอื่นผูกอยู่ก็ไม่เป็นไร ขั้นที่ 3 แยกรหัสของ repo นี้ออกมาต่างหาก ไม่ทับของเดิม

ยังไม่มี Git → เปิด PowerShell แล้วรัน:

```
winget install --id Git.Git -e --source winget
```

ไม่มี winget → โหลดจาก <https://git-scm.com/download/win> ติดตั้งด้วยค่าเริ่มต้นทั้งหมด
ติดตั้งเสร็จ**ปิด PowerShell แล้วเปิดใหม่** ถึงจะรู้จักคำสั่ง `git`

### 2. สร้าง token แบบอ่านอย่างเดียว

repo เป็นแบบส่วนตัว เครื่องนี้ต้องมีสิทธิ์อ่าน ใช้ token ที่อ่านได้เฉพาะ repo นี้ ปลอดภัยกว่าล็อกอินบัญชี GitHub ของคนทิ้งไว้ในเครื่องเซิร์ฟเวอร์

1. GitHub → รูปโปรไฟล์ → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. ตั้งค่า:

   | ช่อง | ใส่อะไร |
   |---|---|
   | Token name | `sanea-sql-server` |
   | Expiration | 1 ปี (จดวันหมดอายุไว้) |
   | Resource owner | `nookmagazineDev` |
   | Repository access | Only select repositories → `SA-NAE-pos` |
   | Permissions → Contents | **Read-only** |

3. กด Generate แล้วคัดลอก token เก็บไว้ (เห็นได้ครั้งเดียว)

ถ้า organization ตั้งให้ token ต้องได้รับอนุมัติ ให้เจ้าของ `nookmagazineDev` กดอนุมัติก่อน

### 3. เชื่อมโฟลเดอร์เดิมกับ GitHub

มีโฟลเดอร์ `.git` อยู่แล้ว (เคย clone มาก่อน) → ข้ามข้อนี้ แค่รัน `git status --short` ดูก่อน
แล้วใช้ `git pull --ff-only origin main` แทน **ห้าม `git reset --hard`** — จะลบไฟล์ที่มีคนแก้ไว้ในเครื่อง (เช่น `scripts/renumber-ids.mjs`) ทิ้ง

เปิด **PowerShell แบบ Run as administrator** แล้วรันทีละบรรทัด:

```
cd D:\sanea-pos
git config --global --add safe.directory D:/sanea-pos
git init -b main
git remote add origin https://github.com/nookmagazineDev/sanea.git
git config credential.useHttpPath true
git fetch origin main
```

`credential.useHttpPath` ทำให้ Windows จำรหัสของ repo นี้แยกจากบัญชี GitHub ที่เครื่องใช้อยู่เดิม
(ใช้เฉพาะโฟลเดอร์นี้ โปรเจกต์อื่นในเครื่องยังใช้บัญชีเดิมตามปกติ)

ตอน `git fetch` จะมีหน้าต่างให้ล็อกอิน → เลือก **Token** แล้ววาง token จากข้อ 2
(Windows จะจำไว้ ครั้งต่อไปไม่ถามอีก)
ถ้าไม่มีหน้าต่างขึ้นแต่ดึงได้เลย แปลว่า Git หยิบบัญชีเดิมมาใช้ — รันบรรทัด `git config credential.useHttpPath true` ตกหล่น ให้รันแล้วลองใหม่

แล้วรันต่อ:

```
git reset --hard origin/main
git branch --set-upstream-to=origin/main main
```

`git reset --hard` ทำให้ไฟล์โค้ดตรงกับ GitHub ทุกไฟล์ (ใช้ได้เฉพาะโฟลเดอร์ที่เพิ่ง `git init` — ไฟล์ที่เคยแก้ในเครื่องจะหาย) ส่วน `.env` และไฟล์อื่นที่ไม่ได้อยู่ใน GitHub ยังอยู่ครบ

### 4. อัปเดตครั้งแรก

คลิกขวาที่ `D:\sanea-pos\update-api.bat` → **Run as administrator**
จบแล้วต้องเห็น `"db":"connected"`

## ใช้งานประจำ

มีโค้ดใหม่ merge เข้า `main` → Remote Desktop เข้าเครื่อง SQL → คลิกขวา `update-api.bat` → Run as administrator

หน้าเว็บบน Vercel อัปเดตเองตอน merge อยู่แล้ว ไม่ต้องทำอะไร

## แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| `git` ไม่รู้จักคำสั่ง | ปิดแล้วเปิด PowerShell ใหม่หลังติดตั้ง Git |
| `detected dubious ownership` | รัน `git config --global --add safe.directory D:/sanea-pos` ในหน้าต่าง Run as administrator |
| เข้า GitHub ไม่ได้ / `Authentication failed` / `Repository not found` | token หมดอายุหรือผิด → แผงควบคุม → **Credential Manager → Windows Credentials** ลบรายการ `git:https://github.com/nookmagazineDev/sanea.git` เท่านั้น (**อย่าลบ** `git:https://github.com` เฉย ๆ — เป็นบัญชีที่โปรเจกต์อื่นในเครื่องใช้) แล้วรัน `update-api.bat` ใหม่ วาง token ใหม่ |
| ไฟล์ในเครื่องถูกแก้ (`Your local changes would be overwritten`) | มีคนแก้ไฟล์โค้ดในโฟลเดอร์นี้เอง ดูว่าไฟล์ไหนด้วย `git status` ถ้าไม่ต้องเก็บ รัน `git reset --hard origin/main` แล้วอัปเดตใหม่ (`.env` ไม่ถูกแตะ) |
| ขั้น 4 ขึ้นว่า API ยังไม่ตอบ | ดู `D:\sanea-pos\logs\api-server.log` บรรทัดท้าย ๆ |
| ไม่พบ Scheduled Task | คลิกขวา `install-api-autostart.bat` → Run as administrator หนึ่งครั้ง |
