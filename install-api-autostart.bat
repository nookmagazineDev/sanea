@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SA-NAE POS - ตั้งค่าเปิด API Server อัตโนมัติ
color 0B

echo =========================================
echo    ตั้งค่าให้ API SERVER เปิดเองอัตโนมัติ
echo =========================================
echo.

rem สร้าง Scheduled Task ต้องใช้สิทธิ์ผู้ดูแล — เช็คก่อนจะได้ไม่ล้มกลางคัน
net session >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ต้องเปิดไฟล์นี้ด้วยสิทธิ์ผู้ดูแลระบบ
  echo คลิกขวาที่ไฟล์ install-api-autostart.bat แล้วเลือก "Run as administrator"
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js ในเครื่องนี้
  echo ติดตั้งจาก https://nodejs.org ก่อน (เลือกเวอร์ชัน LTS) แล้วรันไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo [ผิดพลาด] Node.js ในเครื่องเก่าเกินไป ต้องเป็นเวอร์ชัน 20 ขึ้นไป
  node -v
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.env" (
  echo [ผิดพลาด] ไม่พบไฟล์ .env — ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล
  echo คัดลอก .env.example เป็น .env แล้วแก้ค่า SQL_* ก่อน แล้วรันไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

rem ยังไม่ได้ลง dependency — API Server จะเปิดไม่ขึ้นแบบเงียบ ๆ เพราะ daemon ซ่อนหน้าต่างไว้
if exist "%~dp0node_modules\mssql" goto deps_ok
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
echo    ติดตั้งเรียบร้อย
echo.
:deps_ok

if not exist "%~dp0api-server-daemon.vbs" (
  echo [ผิดพลาด] ไม่พบไฟล์ api-server-daemon.vbs
  echo ต้องวางไฟล์นี้ไว้ในโฟลเดอร์โปรเจกต์เดียวกับ sql-api-server.js
  echo.
  pause
  exit /b 1
)

rem เวอร์ชันก่อนหน้าใช้ทางลัดในโฟลเดอร์ Startup ซึ่งทำงานตอน "ล็อกอิน" เท่านั้น
rem เครื่องเซิร์ฟเวอร์ที่ไม่มีคนล็อกอินจึงไม่เคยเปิดให้เลย — เก็บของเก่าทิ้งก่อน
set "OLDLNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SA-NAE API Server.lnk"
if exist "%OLDLNK%" (
  del "%OLDLNK%"
  echo    ลบทางลัดแบบเก่าในโฟลเดอร์ Startup แล้ว
)

echo กำลังสร้าง Scheduled Task ที่ทำงานตั้งแต่เปิดเครื่อง...
schtasks /Create /TN "SA-NAE API Server" /TR "wscript.exe \"%~dp0api-server-daemon.vbs\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] สร้าง Scheduled Task ไม่สำเร็จ
  echo.
  pause
  exit /b 1
)
echo.

echo กำลังเปิด API Server ตอนนี้เลย...
schtasks /Run /TN "SA-NAE API Server" >nul

echo กำลังรอให้เซิร์ฟเวอร์พร้อม (ครั้งแรกอาจใช้เวลาสักครู่)...
rem ping ตัวเองคือวิธีหน่วงเวลาที่มีอยู่ในทุกเครื่อง ไม่ต้องพึ่งโปรแกรมเสริม
ping -n 21 127.0.0.1 >nul

echo.
echo =========================================
echo    เสร็จสิ้น
echo =========================================
echo.
echo    - API Server ทำงานอยู่แล้วตอนนี้ (ไม่มีหน้าต่างแสดง)
echo    - เปิดเครื่องครั้งต่อไปจะเริ่มทำงานเองทันที ไม่ต้องมีคนล็อกอิน
echo    - ถ้าเซิร์ฟเวอร์ดับเอง จะถูกเปิดใหม่ให้ภายใน 5 วินาที
echo    - บันทึกการทำงานอยู่ที่ logs\api-server.log
echo.
echo    ทดสอบ: เปิด http://localhost:8081/api/pos?action=ping ในเบราว์เซอร์
echo    ต้องได้ "db": "connected" พร้อมจำนวนแถวในตาราง Menu
echo.
echo    ถ้าต้องการยกเลิก ให้รัน uninstall-api-autostart.bat (ด้วยสิทธิ์ผู้ดูแลเช่นกัน)
echo.
pause
