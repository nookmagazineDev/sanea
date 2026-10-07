# เปิด API ผ่านโดเมน https ที่มีอยู่แล้ว

ใช้เมื่อที่ออฟฟิศ**มีเว็บ/API ของระบบอื่นที่เข้าจากอินเทอร์เน็ตได้อยู่แล้ว** (มีโดเมน + https)
วิธีนี้ง่ายที่สุด เพราะเส้นทางเข้าจากนอกถูกเปิดและพิสูจน์แล้วว่าใช้ได้จริง — เราแค่ขอเกาะไปด้วย

```
หน้าเว็บบน Vercel
      ↓  https://โดเมนเดิมของคุณ/sanea/api/pos
เว็บเซิร์ฟเวอร์เดิม (IIS / nginx / Apache / Caddy)
      ↓  ส่งต่อภายในเครื่อง → http://localhost:8081
API Server ของ POS
      ↓  วงแลน
SQL Server พอร์ต 1433
```

**สิ่งที่ไม่ต้องทำเลย:** เปิดพอร์ตใหม่ที่เราเตอร์, ซื้อโดเมนเพิ่ม, ลงโปรแกรม tunnel,
เปิดพอร์ต 1433 ออกเน็ต

## เงื่อนไขข้อเดียว

เครื่องที่รันเว็บเซิร์ฟเวอร์เดิม ต้อง**มองเห็น SQL Server ในวงแลน** (เครื่องเดียวกันยิ่งดี)
ถ้าคนละเครื่องแต่อยู่วงแลนเดียวกันก็ใช้ได้ แค่ตั้ง `SQL_SERVER` เป็น IP วงในของเครื่อง SQL

---

## ขั้นที่ 1 — เปิด API Server ในเครื่องนั้น

ก๊อปโฟลเดอร์โปรเจกต์ไปไว้ที่เครื่องที่รันเว็บเซิร์ฟเวอร์เดิม แล้ว:

1. คัดลอก `.env.example` เป็น `.env` แก้ค่าให้ตรงกับ SQL Server ในวงแลน

   ```
   SQL_SERVER=192.168.2.x          ← IP วงในของเครื่อง SQL (localhost ถ้าเครื่องเดียวกัน)
   SQL_PORT=1433
   SQL_DATABASE=SaneaPOS
   SQL_USER=pos_app
   SQL_PASSWORD="รหัสผ่านจริง"      ← มีตัว # ต้องครอบด้วยเครื่องหมายคำพูด
   SQL_ENCRYPT=false
   SQL_TRUST_CERT=true
   API_PORT=8081                   ← ถ้าพอร์ตนี้ถูกใช้อยู่แล้ว เปลี่ยนเป็นเลขอื่นได้
   ```

2. ดับเบิลคลิก **`start-api.bat`** (ครั้งแรกติดตั้งส่วนประกอบให้เอง 1-3 นาที)

3. เปิดในเบราว์เซอร์ที่เครื่องนั้น: <http://localhost:8081/api/pos?action=ping>
   ต้องได้ `"db": "connected"` — **ยังไม่ได้ อย่าเพิ่งไปขั้นต่อไป**

4. ผ่านแล้วปิดหน้าต่างนั้น แล้วดับเบิลคลิก **`install-api-autostart.bat`**
   API Server จะเปิดเองทุกครั้งที่เปิดเครื่อง และดับเมื่อไหร่ก็เปิดใหม่ให้เองใน 5 วินาที

> เปลี่ยน `API_PORT` เป็นเลขอื่น? ต้องแก้เลขพอร์ตใน `api-server-daemon.vbs` บรรทัด `HEALTH_URL` ให้ตรงกันด้วย

## ขั้นที่ 2 — ให้เว็บเซิร์ฟเวอร์เดิมส่งต่อเข้ามา

เลือกทำตามเว็บเซิร์ฟเวอร์ที่ใช้อยู่ ทุกแบบใช้หลักเดียวกันคือ
**`/sanea/อะไรก็ตาม` → `http://localhost:8081/อะไรก็ตาม`**

(ชื่อ `sanea` เปลี่ยนเป็นอย่างอื่นได้ ขอแค่ไม่ชนกับ path ที่ระบบเดิมใช้อยู่)

### IIS (Windows — เจอบ่อยที่สุด)

ต้องมี 2 ส่วนเสริมก่อน โหลดจาก Microsoft: **URL Rewrite** และ **Application Request Routing (ARR)**

เปิด IIS Manager → คลิกที่ชื่อเครื่อง (node บนสุด) → **Application Request Routing Cache**
→ Server Proxy Settings → ติ๊ก **Enable proxy** → Apply

จากนั้นเพิ่มลงใน `web.config` ของเว็บไซต์เดิม ภายใต้ `<system.webServer>`:

```xml
<rewrite>
  <rules>
    <rule name="SA-NAE POS API" stopProcessing="true">
      <match url="^sanea/(.*)" />
      <action type="Rewrite" url="http://localhost:8081/{R:1}" />
    </rule>
  </rules>
</rewrite>
<!-- รูปเมนูที่อัปโหลดมีขนาดถึงหลัก MB ค่าเริ่มต้นของ IIS จะตัดทิ้ง -->
<security>
  <requestFiltering>
    <requestLimits maxAllowedContentLength="20971520" />
  </requestFiltering>
</security>
```

> ถ้ากฎนี้ไปทับของเดิม ให้ย้ายบล็อก `<rule>` ของ SA-NAE ไว้**บนสุด** แล้วเช็คว่าเว็บเดิมยังใช้ได้

### nginx

```nginx
location /sanea/ {
    proxy_pass http://127.0.0.1:8081/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # รูปเมนูที่อัปโหลดมีขนาดหลัก MB — ค่าเริ่มต้นของ nginx คือ 1MB จะโดนตัด
    client_max_body_size 20m;
}
```

> เครื่องหมาย `/` ปิดท้ายทั้งใน `location` และ `proxy_pass` ต้องมีทั้งคู่ ไม่งั้น path จะเพี้ยน

แล้ว `nginx -t && nginx -s reload`

### Apache

เปิดโมดูล `proxy` กับ `proxy_http` ก่อน แล้วใส่ใน VirtualHost ของ https:

```apache
ProxyPreserveHost On
ProxyPass        /sanea/ http://127.0.0.1:8081/
ProxyPassReverse /sanea/ http://127.0.0.1:8081/
LimitRequestBody 20971520
```

### Caddy

```caddy
handle_path /sanea/* {
    reverse_proxy 127.0.0.1:8081
}
```

## ขั้นที่ 3 — ทดสอบจากข้างนอก

เปิดจาก**มือถือที่ใช้เน็ตมือถือ** (ไม่ใช่ Wi-Fi ร้าน):

```
https://โดเมนเดิมของคุณ/sanea/api/pos?action=ping
```

ได้ `"db": "connected"` = ผ่านแล้ว ✅

| ได้อะไรแทน | แปลว่า |
|---|---|
| 404 | กฎ rewrite ยังไม่ทำงาน หรือสะกด path ไม่ตรง |
| 502 / 503 | กฎทำงานแล้ว แต่ API Server ในเครื่องดับ — ดู `logs\api-server.log` |
| หน้าเว็บของระบบเดิม | กฎถูกกฎอื่นทับอยู่ ต้องเลื่อนกฎของ SA-NAE ขึ้นไปก่อน |

## ขั้นที่ 4 — ให้หน้าเว็บเรียกปลายทางใหม่

**ที่ Vercel** → Settings → Environment Variables:

1. เพิ่ม `VITE_API_URL` = `https://โดเมนเดิมของคุณ/sanea/api/pos`
2. ลบ `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ENCRYPT`, `SQL_TRUST_CERT` ทิ้งให้หมด (ไม่ได้ใช้แล้ว และไม่ควรเก็บรหัสผ่านฐานข้อมูลไว้เฉย ๆ)
3. **อย่าลบ** `SLIPOK_API_KEY` กับ `SLIPOK_BRANCH_ID` — การตรวจสลิปยังทำงานบน Vercel เหมือนเดิม
4. กด **Redeploy**

> `VITE_API_URL` ถูกฝังตอน build ไม่ใช่ตอนรัน — **ไม่ Redeploy = ไม่มีผล**

**ที่เครื่องออฟฟิศ** เพิ่ม 2 บรรทัดนี้ในไฟล์ `.env` แล้วรีสตาร์ต API Server:

```
# ให้ลิงก์รูปที่อัปโหลดใหม่ชี้มาที่โดเมนนี้ (ไม่ตั้ง = รูปใหม่เปิดไม่ขึ้น)
IMAGE_BASE_URL=https://โดเมนเดิมของคุณ/sanea

# จำกัดว่าเบราว์เซอร์จากโดเมนไหนเรียก API ได้ (คั่นหลายอันด้วยจุลภาค)
API_ALLOW_ORIGIN=https://hum-lai-pos.vercel.app
```

รีสตาร์ตด้วยการรัน `uninstall-api-autostart.bat` แล้วตามด้วย `install-api-autostart.bat`

## ขั้นที่ 5 — ปิดทางเข้าเก่า

1. ลบ port forward พอร์ต **1433** ที่เราเตอร์ทิ้ง — ไม่ต้องใช้แล้ว และเป็นจุดเสี่ยงที่สุด
2. ที่เครื่อง SQL ลบกฎ inbound 1433 ที่เปิดให้ทุก IP ออก (เหลือไว้เฉพาะช่วงวงแลน)
3. เช็คซ้ำที่ <https://www.yougetsignal.com/tools/open-ports/> ใส่ IP สาธารณะ พอร์ต 1433 → ต้องขึ้น **ปิด**

## ขั้นที่ 6 — Print Server

หน้า **จัดการหลังบ้าน → ตั้งค่าเครื่องพิมพ์** กด**บันทึกการพิมพ์อัตโนมัติ**อีกครั้ง
ระบบจะส่ง URL ใหม่ไปให้ Print Server เอง

## ตรวจว่าใช้งานได้จริง

| ขั้นตอน | ต้องได้ |
|---|---|
| `https://โดเมนเดิม/sanea/api/pos?action=ping` จากเน็ตมือถือ | `"db": "connected"` |
| เปิดหน้าเว็บบน Vercel | เมนู/หมวดหมู่ขึ้นครบ |
| เปิดกะ → สั่งอาหารเข้าโต๊ะ → เช็กบิล | บันทึกได้ ใบเสร็จออก |
| หน้าลูกค้าสแกน QR สั่งเอง (เน็ตมือถือ) | เห็นเมนู แนบสลิปแล้วออเดอร์เข้าครัว |
| อัปโหลดรูปเมนูใหม่ในหลังบ้าน | รูปขึ้นบนหน้าขาย |
| **เว็บ/API ของระบบเดิม** | ยังใช้ได้ตามปกติ ไม่กระทบ |

บรรทัดสุดท้ายสำคัญ — หลังใส่กฎ rewrite แล้วให้ลองเปิดระบบเดิมดูด้วยทุกครั้ง

---

## แก้ปัญหาที่เจอบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `ping` ขึ้น `"db":"error"` | API ต่อ SQL ในวงแลนไม่ได้ — ข้อความบอกสาเหตุเอง แก้ที่ `.env` |
| `connected` แต่ `menuRows` เป็น 0 | ยังไม่ได้ย้ายข้อมูล — รัน `npm run sql:migrate -- --write` |
| หน้าเว็บขึ้น error เรื่อง CORS | `API_ALLOW_ORIGIN` ต้องตรงเป๊ะ มี `https://` และห้ามมี `/` ปิดท้าย |
| อัปโหลดรูปแล้วขึ้น 413 | reverse proxy จำกัดขนาด body — ตั้งตามที่บอกในขั้นที่ 2 |
| รูปใหม่ไม่ขึ้น | ยังไม่ได้ตั้ง `IMAGE_BASE_URL` หรือยังไม่ได้รีสตาร์ต API Server |
| หน้าเว็บยังเรียกที่เดิม | ยังไม่ได้ Redeploy หลังตั้ง `VITE_API_URL` (หรือกด Ctrl+F5 ล้าง cache) |
| API ดับบ่อย | ดู `logs\api-server.log` — daemon เปิดใหม่ให้เองอยู่แล้วใน 5 วินาที |

## ข้อควรรู้เรื่องความปลอดภัย

`/sanea/api/pos` ที่เปิดออกไปนี้ **ใครรู้ URL ก็เรียกได้** เหมือนตอนใช้ Google Apps Script `/exec` เดิม
ถ้าอยากล็อกให้แน่นกว่านี้ (บังคับกุญแจลับ หรือให้เฉพาะคนที่ล็อกอิน) แจ้งได้ ทำเพิ่มได้
สิ่งที่ดีขึ้นชัดเจนคือ **SQL Server ไม่โผล่ออกอินเทอร์เน็ตอีกแล้ว**

## ถ้าต้องถอยกลับ

ลบ `VITE_API_URL` ออกจาก Vercel แล้ว Redeploy — หน้าเว็บจะกลับไปเรียก `/api/pos` บน Vercel เหมือนเดิม
(ต้องใส่ค่า `SQL_*` ที่ Vercel กลับคืนด้วย ระบบถึงจะทำงาน)

## ทางเลือกอื่น

- ไม่มีโดเมน https อยู่แล้ว → [`CLOUDFLARE-TUNNEL.md`](CLOUDFLARE-TUNNEL.md)
- ขั้นตอนย้ายข้อมูลจาก Google Sheet และภาพรวมทั้งหมด → [`SQL-MIGRATION.md`](SQL-MIGRATION.md)
