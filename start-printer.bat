@echo off
chcp 65001 >nul
title SA-NAE POS - Print Server
color 0A
cd /d "%~dp0"

echo =========================================
echo    เปิด PRINT SERVER ของ SA-NAE POS
echo =========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js ในเครื่องนี้
  echo ติดตั้งจาก https://nodejs.org ก่อน แล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0server.js" (
  echo [ผิดพลาด] ไม่พบไฟล์ server.js ในโฟลเดอร์นี้
  echo วางไฟล์ start-printer.bat ไว้ในโฟลเดอร์โปรเจกต์เดียวกับ server.js
  echo.
  pause
  exit /b 1
)

rem ยังไม่ได้ลง dependency (node_modules) — node server.js จะดับทันทีแบบไม่บอกอะไร
rem จึงลงให้เองตรงนี้ครั้งเดียว ผู้ใช้จะได้ไม่ต้องพิมพ์ npm install เอง
if not exist "%~dp0node_modules\express" (
  echo ยังไม่ได้ติดตั้งส่วนประกอบที่ต้องใช้ กำลังติดตั้งให้ (ครั้งแรกอาจใช้เวลา 1-3 นาที)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ผิดพลาด] ติดตั้งส่วนประกอบไม่สำเร็จ — ตรวจสอบว่าเครื่องต่ออินเทอร์เน็ตอยู่ แล้วลองใหม่
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo กำลังเปิด Print Server ที่ http://localhost:3001 ...
echo (ปล่อยหน้าต่างนี้เปิดค้างไว้ ปิดเมื่อไหร่ Print Server จะหยุดทำงาน)
echo.
node server.js
echo.
echo [PRINT SERVER หยุดทำงานแล้ว]
echo ถ้ามีข้อความ error อยู่ด้านบน ให้ถ่ายรูปหน้าจอนี้ไว้ หรือรัน check-printer.bat เพื่อตรวจสอบ
pause
