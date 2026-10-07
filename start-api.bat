@echo off
chcp 65001 >nul
title SA-NAE POS - API Server
color 0B
cd /d "%~dp0"

echo =========================================
echo    เปิด API SERVER ของ SA-NAE POS
echo =========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js ในเครื่องนี้
  echo ติดตั้งจาก https://nodejs.org ก่อน (เลือกเวอร์ชัน LTS) แล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

rem --env-file มีตั้งแต่ Node 20.6 ขึ้นไป ถ้าเก่ากว่านี้จะอ่านไฟล์ .env ไม่ออก
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo [ผิดพลาด] Node.js ในเครื่องเก่าเกินไป ต้องเป็นเวอร์ชัน 20 ขึ้นไป
  node -v
  echo ติดตั้งเวอร์ชัน LTS ใหม่จาก https://nodejs.org แล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0sql-api-server.js" (
  echo [ผิดพลาด] ไม่พบไฟล์ sql-api-server.js ในโฟลเดอร์นี้
  echo วางไฟล์ start-api.bat ไว้ในโฟลเดอร์โปรเจกต์
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.env" (
  echo [ผิดพลาด] ไม่พบไฟล์ .env — ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล
  echo.
  echo วิธีทำ: คัดลอกไฟล์ .env.example เป็น .env แล้วแก้ค่า SQL_* ให้ตรงกับเครื่องจริง
  echo         ถ้ารหัสผ่านมีตัว # ต้องครอบด้วยเครื่องหมายคำพูด เช่น SQL_PASSWORD="Narai#2026"
  echo.
  pause
  exit /b 1
)

rem ยังไม่ได้ลง dependency (node_modules) — node จะดับทันทีแบบไม่บอกอะไร
if not exist "%~dp0node_modules\mssql" (
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

echo กำลังเปิด API Server ...
echo (ปล่อยหน้าต่างนี้เปิดค้างไว้ ปิดเมื่อไหร่ระบบขายจะดึงข้อมูลไม่ได้)
echo.
echo ทดสอบการต่อฐานข้อมูล: http://localhost:8081/api/pos?action=ping
echo.
node --env-file=.env sql-api-server.js
echo.
echo [API SERVER หยุดทำงานแล้ว]
echo ถ้ามีข้อความ error อยู่ด้านบน ให้ถ่ายรูปหน้าจอนี้ไว้
pause
