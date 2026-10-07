@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SA-NAE POS - อัปเดต API Server
color 0B

echo =========================================
echo    อัปเดต API SERVER จาก GitHub
echo =========================================
echo.

rem หยุด/เปิด Scheduled Task ที่ทำงานในนาม SYSTEM ต้องใช้สิทธิ์ผู้ดูแล
net session >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ต้องเปิดไฟล์นี้ด้วยสิทธิ์ผู้ดูแลระบบ
  echo คลิกขวาที่ไฟล์ update-api.bat แล้วเลือก "Run as administrator"
  echo.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Git ในเครื่องนี้
  echo ติดตั้งก่อนตามคู่มือ docs\UPDATE-API-WITH-GIT.md แล้วรันไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.git" (
  echo [ผิดพลาด] โฟลเดอร์นี้ยังไม่ได้เชื่อมกับ GitHub
  echo ทำขั้น "ตั้งค่าครั้งแรก" ในคู่มือ docs\UPDATE-API-WITH-GIT.md ก่อน
  echo.
  pause
  exit /b 1
)

rem จำรุ่นก่อนอัปเดต ไว้เช็กว่าต้องลงส่วนประกอบใหม่ไหม
for /f %%i in ('git rev-parse HEAD') do set "OLDREV=%%i"

echo [1/4] ดึงโค้ดล่าสุดจาก GitHub...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] ดึงโค้ดไม่สำเร็จ — ไม่มีอะไรถูกเปลี่ยน API ตัวเดิมยังทำงานอยู่
  echo  - ถ้าขึ้นเรื่องรหัสผ่าน/สิทธิ์: token หมดอายุ ดูคู่มือหัวข้อ "เข้า GitHub ไม่ได้"
  echo  - ถ้าขึ้นว่ามีไฟล์ถูกแก้ในเครื่อง: มีคนแก้ไฟล์ในโฟลเดอร์นี้เอง ดูคู่มือหัวข้อ "ไฟล์ในเครื่องถูกแก้"
  echo.
  pause
  exit /b 1
)
for /f %%i in ('git rev-parse HEAD') do set "NEWREV=%%i"
echo.

echo [2/4] ตรวจส่วนประกอบ (node_modules)...
set "NEEDINSTALL="
if not exist "%~dp0node_modules\mssql" set "NEEDINSTALL=1"
git diff --quiet %OLDREV% %NEWREV% -- package.json package-lock.json
if errorlevel 1 set "NEEDINSTALL=1"
if defined NEEDINSTALL (
  echo    มีส่วนประกอบเปลี่ยน กำลังติดตั้ง ^(1-3 นาที^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ผิดพลาด] ติดตั้งส่วนประกอบไม่สำเร็จ — API ตัวเดิมยังทำงานอยู่ ยังไม่ได้รีสตาร์ต
    echo.
    pause
    exit /b 1
  )
) else (
  echo    ไม่มีอะไรเปลี่ยน ข้าม
)
echo.

echo [3/4] อัปเดตโครงสร้างฐานข้อมูล (รันซ้ำได้ ไม่มีข้อมูลหาย)...
call npm run sql:init
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] อัปเดตโครงสร้างฐานข้อมูลไม่สำเร็จ — API ตัวเดิมยังทำงานอยู่ ยังไม่ได้รีสตาร์ต
  echo.
  pause
  exit /b 1
)
echo.

echo [4/4] รีสตาร์ต API Server...
schtasks /End /TN "SA-NAE API Server" >nul 2>&1
rem schtasks /End หยุดแค่ตัวเฝ้า ^(wscript^) แต่ node ที่มันเปิดไว้ยังค้างอยู่ — ต้องปิดเอง
rem ปิดเฉพาะตัวที่รัน API Server — Print Server ในเครื่องเดียวกันต้องทำงานต่อได้
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe' OR Name='node.exe'\" | Where-Object { $_.CommandLine -match 'api-server-daemon\.vbs|sql-api-server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
schtasks /Run /TN "SA-NAE API Server" >nul
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] ไม่พบ Scheduled Task "SA-NAE API Server"
  echo รัน install-api-autostart.bat ^(Run as administrator^) หนึ่งครั้ง
  echo.
  pause
  exit /b 1
)

echo    รอให้เซิร์ฟเวอร์พร้อม...
ping -n 16 127.0.0.1 >nul
echo.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 'http://127.0.0.1:8081/api/pos?action=ping'; Write-Host $r.Content } catch { Write-Host ('[ผิดพลาด] API ยังไม่ตอบ: ' + $_.Exception.Message); Write-Host 'ดูรายละเอียดใน logs\api-server.log' }"

echo.
echo =========================================
echo    เสร็จสิ้น — อัปเดตเป็นรุ่น %NEWREV:~0,7%
echo =========================================
echo    ต้องเห็น "db":"connected" ด้านบน
echo.
pause
