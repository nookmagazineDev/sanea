@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SA-NAE POS - อัปเดต Print Server
color 0A

echo =========================================
echo    อัปเดต PRINT SERVER จาก GitHub
echo =========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Git ในเครื่องนี้
  echo ติดตั้งจาก https://git-scm.com/download/win หรือโหลด ZIP จาก GitHub มาวางทับโฟลเดอร์นี้แทน
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.git" (
  echo [ผิดพลาด] โฟลเดอร์นี้ยังไม่ได้เชื่อมกับ GitHub
  echo ทำขั้น "ตั้งค่าครั้งแรก" ในคู่มือ docs\UPDATE-API-WITH-GIT.md ก่อน ^(ใช้กับโฟลเดอร์นี้แทน D:\sanea-pos^)
  echo.
  pause
  exit /b 1
)

for /f %%i in ('git rev-parse HEAD') do set "OLDREV=%%i"

echo [1/3] ดึงโค้ดล่าสุดจาก GitHub...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] ดึงโค้ดไม่สำเร็จ — ไม่มีอะไรถูกเปลี่ยน Print Server ตัวเดิมยังทำงานอยู่
  echo.
  pause
  exit /b 1
)
for /f %%i in ('git rev-parse HEAD') do set "NEWREV=%%i"
echo.

echo [2/3] ตรวจส่วนประกอบ (node_modules)...
set "NEEDINSTALL="
if not exist "%~dp0node_modules\express" set "NEEDINSTALL=1"
git diff --quiet %OLDREV% %NEWREV% -- package.json package-lock.json
if errorlevel 1 set "NEEDINSTALL=1"
if defined NEEDINSTALL (
  echo    มีส่วนประกอบเปลี่ยน กำลังติดตั้ง ^(1-3 นาที^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ผิดพลาด] ติดตั้งส่วนประกอบไม่สำเร็จ — Print Server ตัวเดิมยังทำงานอยู่ ยังไม่ได้รีสตาร์ต
    echo.
    pause
    exit /b 1
  )
) else (
  echo    ไม่มีอะไรเปลี่ยน ข้าม
)
echo.

echo [3/3] รีสตาร์ต Print Server...
rem ปิดเฉพาะ Print Server ของโฟลเดอร์นี้ — API Server (sql-api-server.js) และ node ของโปรแกรมอื่นต้องทำงานต่อ
set "PS_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [regex]::Escape($env:PS_DIR); Get-CimInstance Win32_Process -Filter \"Name='wscript.exe' OR Name='node.exe'\" | Where-Object { $_.CommandLine -match ($d + 'print-server-daemon\.vbs') -or $_.CommandLine -match ($d + 'server\.js') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
start "" wscript.exe "%~dp0print-server-daemon.vbs"

echo    รอให้ Print Server พร้อม...
ping -n 9 127.0.0.1 >nul
echo.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 'http://127.0.0.1:3001/health'; Write-Host 'Print Server ทำงานแล้ว:' $r.Content } catch { Write-Host ('[ผิดพลาด] Print Server ยังไม่ตอบ: ' + $_.Exception.Message); Write-Host 'ดูรายละเอียดใน logs\print-server.log' }"

echo.
echo =========================================
echo    เสร็จสิ้น — อัปเดตเป็นรุ่น %NEWREV:~0,7%
echo =========================================
echo    ต่อไป: หลังบ้าน ^> ปริ้นเตอร์ ^> กด "อัปเดตให้ตรงกันเดี๋ยวนี้" ถ้ามีกล่องสีเหลือง
echo.
pause
