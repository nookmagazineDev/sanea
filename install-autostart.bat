@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SA-NAE POS - ตั้งค่าเปิด Print Server อัตโนมัติ
color 0A

echo =========================================
echo    ตั้งค่าให้ PRINT SERVER เปิดเองอัตโนมัติ
echo =========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js ในเครื่องนี้
  echo ติดตั้งจาก https://nodejs.org ก่อน แล้วรันไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

rem ยังไม่ได้ลง dependency (node_modules) — Print Server จะเปิดไม่ขึ้นแบบเงียบ ๆ
rem เพราะ daemon ซ่อนหน้าต่างไว้ จึงลงให้เสร็จตั้งแต่ตอนนี้
if exist "%~dp0node_modules\express" goto deps_ok
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

if not exist "%~dp0print-server-daemon.vbs" (
  echo [ผิดพลาด] ไม่พบไฟล์ print-server-daemon.vbs
  echo ต้องวางไฟล์นี้ไว้ในโฟลเดอร์โปรเจกต์เดียวกับ server.js
  echo.
  pause
  exit /b 1
)

set "SCRIPTDIR=%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SA-NAE Print Server.lnk"

echo กำลังสร้างทางลัดในโฟลเดอร์ Startup...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir=$env:SCRIPTDIR; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\SA-NAE Print Server.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=[char]34+(Join-Path $dir 'print-server-daemon.vbs')+[char]34; $s.WorkingDirectory=$dir; $s.Description='SA-NAE POS Print Server'; $s.Save()"

if not exist "%LNK%" (
  echo [ผิดพลาด] สร้างทางลัดไม่สำเร็จ
  echo.
  pause
  exit /b 1
)
echo    สร้างเรียบร้อย
echo.

echo กำลังเปิด Print Server ตอนนี้เลย...
start "" wscript.exe "%~dp0print-server-daemon.vbs"

echo.
echo =========================================
echo    เสร็จสิ้น
echo =========================================
echo.
echo    - Print Server ทำงานอยู่แล้วตอนนี้ (ไม่มีหน้าต่างแสดง)
echo    - เปิดเครื่องครั้งต่อไปจะเริ่มทำงานเองอัตโนมัติ
echo    - ไม่ต้องเปิด start-printer.bat อีกต่อไป
echo    - ถ้า server ดับเอง จะถูกเปิดใหม่ให้ภายใน 5 วินาที
echo    - บันทึกการทำงานอยู่ที่ logs\print-server.log
echo.
echo    ไปที่หน้า "ตั้งค่าเครื่องพิมพ์" แล้วกด "ตรวจสอบอีกครั้ง"
echo    สถานะควรเปลี่ยนเป็นสีเขียวภายในไม่กี่วินาที
echo.
echo    ถ้าสถานะยังไม่เขียว ให้ดับเบิลคลิก check-printer.bat เพื่อตรวจหาสาเหตุ
echo    (หรือดูไฟล์ logs\print-server.log)
echo.
echo    ถ้าต้องการยกเลิก ให้รัน uninstall-autostart.bat
echo.
pause
