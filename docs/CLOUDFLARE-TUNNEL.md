# เปิด API ออกอินเทอร์เน็ตด้วย Cloudflare Tunnel

ใช้เมื่อ **SQL Server อยู่ในวงแลนร้าน/ออฟฟิศ** แล้วไม่อยากเปิดพอร์ต 1433 ออกอินเทอร์เน็ต

## ทำไมต้องทางนี้

เปิดพอร์ต 1433 ให้ Vercel เข้ามาตรง ๆ มีปัญหาค้าง 3 เรื่อง:

| ปัญหา | ผลที่ตามมา |
|---|---|
| ISP บล็อกพอร์ต 1433 ขาเข้า (โดยเฉพาะจากต่างประเทศ) | Vercel ต่อไม่ติด ทั้งที่เช็คจากในไทยแล้วพอร์ตเปิด |
| IP สาธารณะเปลี่ยนเอง | ระบบล่มทันทีโดยไม่มีสัญญาณเตือน ต้องมาแก้ค่าที่ Vercel ใหม่ |
| SQL Server โผล่ออกเน็ต | โดนบอตไล่เดารหัสผ่านตลอดเวลา ข้างในคือข้อมูลขายทั้งร้าน |

Cloudflare Tunnel แก้ทั้งสามเรื่องพร้อมกัน — เครื่องในร้านเป็นฝ่าย**ต่อออก**ไปหา Cloudflare เอง
จึงไม่ต้องเปิดพอร์ตขาเข้าสักพอร์ต, IP เปลี่ยนก็ไม่พัง, และ SQL Server ไม่เห็นจากอินเทอร์เน็ตเลย

```
เบราว์เซอร์/มือถือลูกค้า → หน้าเว็บบน Vercel
                            ↓ เรียก API
                   https://pos-api.โดเมนคุณ
                            ↓ (Cloudflare Tunnel)
              เครื่องออฟฟิศ: API Server พอร์ต 8081
                            ↓ (วงแลน)
                    SQL Server พอร์ต 1433
```

## ⚡ ทางลัด: มี Tunnel ใช้อยู่แล้ว

เปิดหน้า DNS ของโดเมนใน Cloudflare แล้วเห็นแถวที่ **Type = Tunnel** อยู่แล้วใช่ไหม
(เช่น `api.โดเมนคุณ` หรือ `usage.โดเมนคุณ` ที่ Proxy status เป็น **Proxied**)

ถ้าใช่ แปลว่า cloudflared ติดตั้งและทำงานอยู่ที่เครื่องออฟฟิศเรียบร้อยแล้ว
**ข้ามขั้นที่ 2 กับ 3 ไปได้เลย** เหลือแค่เพิ่มปลายทางอีกอันเข้าไปใน tunnel เดิม:

1. <https://one.dash.cloudflare.com> → **Networks → Tunnels** → คลิกชื่อ tunnel ที่มีอยู่
2. **Configure → Public Hostname → Add a public hostname**
3. ใส่ค่า:

   | ช่อง | ใส่อะไร |
   |---|---|
   | Subdomain | `pos-api` |
   | Domain | โดเมนของคุณ |
   | Path | เว้นว่าง |
   | Type | `HTTP` |
   | URL | `localhost:8081` |

4. **Save hostname** — Cloudflare สร้าง DNS ให้เองอัตโนมัติ (จะเห็นแถว Tunnel เพิ่มมาอีกหนึ่ง)

### ถ้าหน้า Routes ขึ้นว่า "This tunnel is locally managed"

แปลว่า tunnel นี้อ่านค่าจาก**ไฟล์ config ในเครื่อง** ปุ่ม Add route บนหน้าเว็บจึงใช้ไม่ได้
ต้องไปแก้ไฟล์ที่เครื่องที่รัน cloudflared แทน

หาไฟล์ก่อน — เซอร์วิสรันเป็น LocalSystem จึงอ่าน config จากโฟลเดอร์ของบัญชีนั้น:

```powershell
sc.exe qc cloudflared        # ดู command line ว่ามี --config ระบุไว้ไหม
Get-ChildItem "C:\Windows\System32\config\systemprofile\.cloudflared\", "$env:USERPROFILE\.cloudflared\", "C:\ProgramData\cloudflared\" -ErrorAction SilentlyContinue | Select-Object FullName
```

ส่วนใหญ่คือ `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`
เปิดดูจะเห็นโครงแบบนี้ — **เพิ่มเฉพาะสองบรรทัดของ `pos-api` ก่อนบรรทัด `http_status:404`**
(กฎถูกไล่จากบนลงล่าง ตัว catch-all ต้องอยู่ท้ายสุดเสมอ):

```yaml
tunnel: <tunnel id>
credentials-file: C:\Users\Administrator\.cloudflared\<tunnel id>.json

ingress:
  - hostname: api.โดเมนคุณ
    service: http://localhost:14365
  - hostname: pos-api.โดเมนคุณ        # ← เพิ่มบรรทัดนี้
    service: http://localhost:8081     # ← และบรรทัดนี้
  - service: http_status:404
```

ตรวจไวยากรณ์ก่อนเสมอ แล้วค่อยรีสตาร์ต (YAML ผิดเว้นวรรคช่องเดียว hostname เดิมจะดับไปด้วย):

```powershell
C:\tools\cloudflared.exe --config "<path ของ config.yml>" tunnel ingress validate
Restart-Service cloudflared
```

ต้องได้คำว่า `OK` ก่อนถึงจะรีสตาร์ต

**DNS ของ tunnel แบบนี้ไม่ถูกสร้างให้อัตโนมัติ** สร้างเองด้วยคำสั่งเดียว (ใช้ `cert.pem` ที่มีอยู่แล้ว):

```powershell
C:\tools\cloudflared.exe tunnel route dns <ชื่อ tunnel> pos-api.โดเมนคุณ
```

ได้ `Added CNAME ... which will route to this tunnel` = เรียบร้อย
หรือจะเพิ่มเองในหน้า DNS ก็ได้: CNAME ชื่อ `pos-api` ชี้ไปที่ `<tunnel id>.cfargotunnel.com` แบบ **Proxied**

**ข้อควรระวังข้อเดียว:** ช่อง URL ต้องเป็นที่อยู่ที่ **เครื่องซึ่งรัน cloudflared** มองเห็น

- API Server อยู่เครื่องเดียวกับ cloudflared → ใส่ `localhost:8081`
- อยู่คนละเครื่องแต่วงแลนเดียวกัน → ใส่ IP วงในแทน เช่น `192.168.2.x:8081`

ดู tunnel รันอยู่เครื่องไหน: หน้า Tunnels จะบอกชื่อเครื่องของ connector ไว้
หรือรัน `sc query cloudflared` ที่เครื่องที่สงสัย

จากนั้นข้ามไปทำ **ขั้นที่ 1** (เปิด API Server) แล้วต่อด้วย **ขั้นที่ 4** เป็นต้นไปได้เลย

---

> **ไม่มี Tunnel แต่มีเว็บ/API ของระบบอื่นที่มีโดเมน https อยู่แล้ว?**
> ใช้ [`API-BEHIND-EXISTING-DOMAIN.md`](API-BEHIND-EXISTING-DOMAIN.md) แทนได้ —
> เพิ่มกฎส่งต่อในเว็บเซิร์ฟเวอร์ที่มีอยู่ ไม่ต้องลงโปรแกรมเพิ่มเช่นกัน

## สิ่งที่ต้องมี

- เครื่อง Windows ในออฟฟิศที่**เปิดทิ้งไว้ตลอด** และมองเห็น SQL Server ในวงแลน (เครื่องเดียวกับ SQL ก็ได้)
- Node.js 20 ขึ้นไป ([nodejs.org](https://nodejs.org) เลือก LTS)
- บัญชี Cloudflare (ฟรี) + **โดเมนที่ย้าย DNS มาอยู่กับ Cloudflare แล้ว**

> ยังไม่มีโดเมน? ใช้ Quick Tunnel ทดลองก่อนได้ (ดูหัวข้อสุดท้าย) แต่ URL จะเปลี่ยนทุกครั้งที่รีสตาร์ต
> จึงใช้กับหน้าร้านจริงไม่ได้

---

## ขั้นที่ 1 — ให้ API Server ทำงานในเครื่องออฟฟิศก่อน

ทำที่เครื่องออฟฟิศ ในโฟลเดอร์โปรเจกต์:

1. คัดลอก `.env.example` เป็น `.env` แล้วแก้ค่าให้ตรงกับ SQL Server ในวงแลน

   ```
   SQL_SERVER=192.168.2.x          ← IP วงในของเครื่อง SQL (หรือ localhost ถ้าเป็นเครื่องเดียวกัน)
   SQL_PORT=1433
   SQL_DATABASE=SaneaPOS
   SQL_USER=pos_app
   SQL_PASSWORD="รหัสผ่านจริง"      ← ถ้ามีตัว # ต้องครอบด้วยเครื่องหมายคำพูด
   SQL_ENCRYPT=false
   SQL_TRUST_CERT=true
   API_PORT=8081
   ```

2. ดับเบิลคลิก **`start-api.bat`** — ครั้งแรกจะติดตั้งส่วนประกอบให้เอง (1-3 นาที)

3. เปิดในเบราว์เซอร์ที่เครื่องนั้น: <http://localhost:8081/api/pos?action=ping>

   ต้องได้ `"db": "connected"` พร้อม `menuRows` — **ถ้ายังไม่ได้ อย่าเพิ่งไปขั้นต่อไป**
   ข้อความ error จะบอกเองว่าติดตรงไหน (ต่อไม่ติด / รหัสผ่านผิด / ยังไม่ได้สร้างตาราง)

4. ได้ `connected` แล้วปิดหน้าต่างนั้นทิ้ง แล้ว**คลิกขวา**ที่ **`install-api-autostart.bat`** เลือก **Run as administrator**
   คราวนี้ API Server จะเปิดเองทุกครั้งที่เปิดเครื่อง และดับเมื่อไหร่ก็เปิดใหม่ให้เองใน 5 วินาที

   > สคริปต์นี้สร้าง **Scheduled Task** ที่ทำงานตั้งแต่บูตในนาม SYSTEM จึงขึ้นเองแม้ไม่มีใครล็อกอิน
   > (เครื่องเซิร์ฟเวอร์ที่ปล่อยไว้เฉย ๆ จะไม่มีใครล็อกอิน ทางลัดในโฟลเดอร์ Startup จึงใช้ไม่ได้)
   > ตรวจสถานะภายหลังได้ด้วย `schtasks /Query /TN "SA-NAE API Server"`

## ขั้นที่ 2 — ติดตั้ง cloudflared

เปิด **Command Prompt แบบ Run as administrator** แล้วรัน:

```
winget install --id Cloudflare.cloudflared
```

ถ้าไม่มี winget ให้โหลดไฟล์ `cloudflared-windows-amd64.msi` จาก
<https://github.com/cloudflare/cloudflared/releases/latest> แล้วติดตั้งตามปกติ

## ขั้นที่ 3 — สร้าง Tunnel

1. เข้า <https://one.dash.cloudflare.com> → เลือกบัญชีของคุณ
2. เมนูซ้าย **Networks → Tunnels** → ปุ่ม **Create a tunnel**
3. เลือก **Cloudflared** → ตั้งชื่อ เช่น `sanea-pos` → **Save tunnel**
4. หน้าถัดไปเลือก **Windows / 64-bit** จะได้คำสั่งติดตั้งที่มี token ยาว ๆ ติดมาด้วย
   ก๊อปคำสั่งนั้นไปรันใน **Command Prompt แบบ Run as administrator** ที่เครื่องออฟฟิศ

   คำสั่งจะหน้าตาประมาณนี้ (อย่าใช้อันนี้ ต้องใช้ของคุณเองที่มี token จริง):
   ```
   cloudflared.exe service install eyJhIjoiXXXXXXXX...
   ```

   คำสั่งนี้ติดตั้ง cloudflared เป็น **Windows Service** = ทำงานตั้งแต่เปิดเครื่อง
   ไม่ต้องมีคนล็อกอินค้างไว้

5. กลับมาที่หน้าเว็บ รอสักครู่ สถานะ Tunnel จะเปลี่ยนเป็น **HEALTHY** แล้วกด **Next**

6. หน้า **Route Tunnel** ใส่ค่า:

   | ช่อง | ใส่อะไร |
   |---|---|
   | Subdomain | `pos-api` |
   | Domain | เลือกโดเมนของคุณ |
   | Path | เว้นว่าง |
   | Type | `HTTP` |
   | URL | `localhost:8081` |

   > Type เป็น **HTTP** (ไม่ใช่ HTTPS) เพราะ API Server ในเครื่องพูด http ธรรมดา
   > ส่วนขาที่ออกอินเทอร์เน็ตจะเป็น https ให้เองโดย Cloudflare

7. **Save tunnel**

## ขั้นที่ 4 — ทดสอบว่าเข้าได้จากข้างนอก

เปิดจาก**มือถือที่ใช้เน็ตมือถือ** (ไม่ใช่ Wi-Fi ร้าน):

```
https://pos-api.โดเมนคุณ/api/pos?action=ping
```

ได้ `"db": "connected"` = ผ่านแล้ว ✅ ตอนนี้ API เข้าถึงได้จากทั้งโลกโดยไม่ต้องเปิดพอร์ตสักพอร์ต

## ขั้นที่ 5 — ให้หน้าเว็บเรียก API ใหม่

**ที่ Vercel** → โปรเจกต์ → Settings → Environment Variables:

1. **เพิ่ม** `VITE_API_URL` = `https://pos-api.โดเมนคุณ/api/pos`
2. **ลบ** `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ENCRYPT`, `SQL_TRUST_CERT` ออกให้หมด
   — ไม่ได้ใช้แล้ว และไม่ควรเก็บรหัสผ่านฐานข้อมูลไว้ในที่ที่ไม่ได้ใช้
3. **อย่าลบ** `SLIPOK_API_KEY` กับ `SLIPOK_BRANCH_ID` — การตรวจสลิปยังทำงานบน Vercel เหมือนเดิม
4. กด **Redeploy**

> `VITE_API_URL` เป็นค่าที่ถูกฝังตอน build ไม่ใช่ตอนรัน **ต้อง Redeploy เท่านั้นถึงจะมีผล**

**ที่เครื่องออฟฟิศ** เปิดไฟล์ `.env` เพิ่ม 2 บรรทัดนี้:

```
# ให้ลิงก์รูปที่อัปโหลดใหม่ชี้มาที่ Tunnel (ไม่งั้นรูปใหม่จะเปิดไม่ขึ้นบนหน้าเว็บ)
IMAGE_BASE_URL=https://pos-api.โดเมนคุณ

# จำกัดว่าเบราว์เซอร์จากโดเมนไหนเรียก API ได้บ้าง (คั่นหลายอันด้วยจุลภาค)
API_ALLOW_ORIGIN=https://<โดเมนหน้าเว็บเสน่ห์>.vercel.app
```

แล้วรีสตาร์ต API Server: `uninstall-api-autostart.bat` → `install-api-autostart.bat`
(หรือรีสตาร์ตเครื่อง)

## ขั้นที่ 6 — ปิดทางเข้าเก่าให้หมด

1. **ลบ port forward พอร์ต 1433** ที่เราเตอร์ทิ้ง — ไม่ต้องใช้แล้ว และนี่คือจุดที่เสี่ยงที่สุด
2. ที่เครื่อง SQL ลบกฎ inbound 1433 ใน Windows Firewall ออก (เหลือไว้เฉพาะที่วงแลนใช้)
3. เช็คซ้ำที่ <https://www.yougetsignal.com/tools/open-ports/> ใส่ IP สาธารณะ พอร์ต 1433
   ต้องขึ้นว่า **ปิด**

## ขั้นที่ 7 — Print Server

ไปที่หน้า **จัดการหลังบ้าน → ตั้งค่าเครื่องพิมพ์** แล้วกด**บันทึกการพิมพ์อัตโนมัติ**อีกครั้ง
ระบบจะส่ง URL ของ API ใหม่ไปให้ Print Server เอง (ของเดิมยังชี้ไปที่เดิมอยู่)

## ตรวจว่าใช้งานได้จริง

| ขั้นตอน | ต้องได้ |
|---|---|
| `https://pos-api.โดเมนคุณ/api/pos?action=ping` จากเน็ตมือถือ | `"db": "connected"` |
| เปิดหน้าเว็บบน Vercel | เมนู/หมวดหมู่ขึ้นครบ |
| เปิดกะ → สั่งอาหารเข้าโต๊ะ → เช็กบิล | บันทึกได้ ใบเสร็จออก |
| หน้าลูกค้าสแกน QR สั่งเอง (ใช้เน็ตมือถือ) | เห็นเมนู แนบสลิปแล้วออเดอร์เข้าครัว |
| ดูรายงาน → ปิดกะ | ตัวเลขตรง |

---

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Tunnel ขึ้น **DOWN** ในหน้า Cloudflare | เครื่องออฟฟิศปิดอยู่ หรือเซอร์วิสไม่ทำงาน — เช็คด้วย `sc query cloudflared` สั่งเปิดด้วย `sc start cloudflared` |
| เปิด URL แล้วได้ **error 502** | Tunnel ทำงานแต่ API Server ในเครื่องดับ — ดู `logs\api-server.log` แล้วรัน `start-api.bat` เพื่อดู error เต็ม ๆ |
| เปิด URL แล้วได้ **error 1033** | cloudflared ยังต่อไม่ติดกับ Cloudflare — ปกติหายเองใน 1-2 นาที ถ้าไม่หายให้รีสตาร์ตเซอร์วิส |
| `ping` ขึ้น `"db":"error"` | Tunnel ปกติดี แต่ API ต่อ SQL ในวงแลนไม่ได้ — ข้อความจะบอกสาเหตุเอง แก้ที่ `.env` |
| `ping` ขึ้น `connected` แต่ `menuRows` เป็น 0 | ยังไม่ได้ย้ายข้อมูลเข้า — รัน `npm run sql:migrate -- --write` |
| หน้าเว็บยังเรียกที่เดิมอยู่ | ยังไม่ได้ Redeploy หลังตั้ง `VITE_API_URL` หรือเบราว์เซอร์ยังจำของเก่า (กด Ctrl+F5) |
| รูปเมนูที่อัปโหลดใหม่ไม่ขึ้น | ยังไม่ได้ตั้ง `IMAGE_BASE_URL` ในไฟล์ `.env` แล้วรีสตาร์ต API Server |
| หน้าเว็บขึ้น error เรื่อง CORS | `API_ALLOW_ORIGIN` ไม่ตรงกับโดเมนหน้าเว็บ — ต้องใส่ทั้ง `https://` และห้ามมี `/` ปิดท้าย |

## ข้อควรรู้เรื่องความปลอดภัย

API ที่เปิดผ่าน Tunnel นี้**ใครรู้ URL ก็เรียกได้** เหมือนตอนที่ใช้ Google Apps Script `/exec` เดิม
ถ้าต้องการล็อกให้แน่นกว่านี้ (เช่นบังคับกุญแจลับ หรือให้เฉพาะคนที่ล็อกอินเข้าได้) แจ้งได้ — ทำเพิ่มได้
สิ่งที่ทางนี้ดีขึ้นชัด ๆ คือ **SQL Server ไม่ได้โผล่ออกอินเทอร์เน็ตอีกแล้ว**

---

## ทางเลือก: Quick Tunnel (ไม่มีโดเมน — ใช้ทดลองเท่านั้น)

```
cloudflared tunnel --url http://localhost:8081
```

จะได้ URL แบบ `https://xxxx-yyyy.trycloudflare.com` ใช้ทดสอบได้ทันทีโดยไม่ต้องมีโดเมน
แต่ **URL เปลี่ยนทุกครั้งที่รีสตาร์ต** และต้องเปิดหน้าต่างค้างไว้ จึงใช้กับหน้าร้านจริงไม่ได้

## ถ้าต้องถอยกลับ

ลบ `VITE_API_URL` ออกจาก Vercel แล้ว Redeploy — หน้าเว็บจะกลับไปเรียก `/api/pos` บน Vercel เหมือนเดิม
(ซึ่งต้องใส่ค่า `SQL_*` ที่ Vercel กลับคืนด้วย ระบบถึงจะทำงาน)
