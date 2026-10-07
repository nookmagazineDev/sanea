@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SA-NAE POS - ตรวจสอบ Print Server
color 0B

echo =========================================
echo    ตรวจสอบว่าทำไม Print Server ไม่ขึ้น
echo =========================================
echo.
echo โฟลเดอร์ที่ตรวจ: %~dp0
echo.

echo [1/6] Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo    ไม่พบ Node.js  ==^> ติดตั้งจาก https://nodejs.org แล้วรันไฟล์นี้ใหม่
  goto :summary
)
for /f "delims=" %%v in ('node -v') do echo    พบแล้ว %%v
echo.

echo [2/6] ไฟล์ server.js
if not exist "%~dp0server.js" (
  echo    ไม่พบ server.js  ==^> ไฟล์นี้ต้องอยู่ในโฟลเดอร์โปรเจกต์เดียวกับ server.js
  goto :summary
)
echo    พบแล้ว
echo.

echo [3/6] ส่วนประกอบที่ต้องใช้ (node_modules)
if not exist "%~dp0node_modules\express" (
  echo    ยังไม่ได้ติดตั้ง  ==^> นี่คือสาเหตุที่ Print Server เปิดแล้วดับทันที
  echo    กำลังติดตั้งให้เดี๋ยวนี้ (ครั้งแรกอาจใช้เวลา 1-3 นาที)...
  echo.
  call npm install
  echo.
  if not exist "%~dp0node_modules\express" (
    echo    ติดตั้งไม่สำเร็จ  ==^> ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่
    goto :summary
  )
  echo    ติดตั้งเรียบร้อย
) else (
  echo    ครบแล้ว
)
echo.

echo [4/6] พอร์ต 3001 มีโปรแกรมเปิดอยู่ไหม
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo    ยังไม่มีอะไรเปิดพอร์ต 3001  ==^> Print Server ยังไม่ทำงาน
) else (
  echo    มีโปรแกรมเปิดพอร์ต 3001 อยู่:
  netstat -ano | findstr /r /c:":3001 .*LISTENING"
)
echo.

echo [5/6] ลองเรียก http://127.0.0.1:3001/health
curl -s -m 3 http://127.0.0.1:3001/health
if errorlevel 1 (
  echo    ติดต่อไม่ได้  ==^> เปิด Print Server ด้วย start-printer.bat ^(หรือ install-autostart.bat ให้เปิดเองอัตโนมัติ^)
) else (
  echo.
  echo    ติดต่อได้ตามปกติ — ถ้าหน้าเว็บยังขึ้นสีแดง ให้ดูข้อ 6
)
echo.

echo [6/6] IP ของเครื่องนี้ในวงแลน ^(ใช้ตอนเปิดหน้าเว็บจากเครื่อง/แท็บเล็ตอื่น^)
ipconfig | findstr /c:"IPv4"
echo.
echo    - เปิดหน้าเว็บในเครื่องนี้ ให้ตั้งที่อยู่ Print Server เป็น  http://127.0.0.1:3001
echo    - เปิดหน้าเว็บจากแท็บเล็ต/มือถือ ให้ตั้งเป็น  http://IP ด้านบน:3001
echo      และหน้าเว็บนั้นต้องเปิดผ่าน http:// ไม่ใช่ https:// ^(เบราว์เซอร์บล็อก https ยิงเข้า IP วงแลน^)
echo.

:summary
echo =========================================
if exist "%~dp0logs\print-server.log" (
  echo    20 บรรทัดสุดท้ายของ logs\print-server.log
  echo =========================================
  powershell -NoProfile -Command "Get-Content -Path 'logs\print-server.log' -Tail 20"
  echo.
)
echo เสร็จสิ้น — ถ้าแก้ไม่ได้ ให้ถ่ายรูปหน้าจอนี้ส่งให้ผู้ดูแลระบบ
echo.
pause
