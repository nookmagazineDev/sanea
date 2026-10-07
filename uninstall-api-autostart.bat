@echo off
chcp 65001 >nul
setlocal
title SA-NAE POS - ยกเลิกการเปิด API Server อัตโนมัติ
color 0E

echo =========================================
echo    ยกเลิกการเปิด API SERVER อัตโนมัติ
echo =========================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ต้องเปิดไฟล์นี้ด้วยสิทธิ์ผู้ดูแลระบบ
  echo คลิกขวาที่ไฟล์ uninstall-api-autostart.bat แล้วเลือก "Run as administrator"
  echo.
  pause
  exit /b 1
)

echo กำลังหยุดและลบ Scheduled Task...
schtasks /End    /TN "SA-NAE API Server" >nul 2>&1
schtasks /Delete /TN "SA-NAE API Server" /F >nul 2>&1
if errorlevel 1 (
  echo    ไม่พบ Scheduled Task อยู่แล้ว
) else (
  echo    ลบเรียบร้อย
)

rem ของเวอร์ชันเก่าที่ใช้โฟลเดอร์ Startup — เก็บให้ด้วยเผื่อยังค้างอยู่
set "OLDLNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SA-NAE API Server.lnk"
if exist "%OLDLNK%" (
  del "%OLDLNK%"
  echo    ลบทางลัดแบบเก่าในโฟลเดอร์ Startup แล้ว
)

echo กำลังปิด API Server ที่ทำงานอยู่...
rem ปิดเฉพาะตัวที่รัน API Server — Print Server ในเครื่องเดียวกันต้องทำงานต่อได้
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe' OR Name='node.exe'\" | Where-Object { $_.CommandLine -match 'api-server-daemon\.vbs|sql-api-server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo    เสร็จสิ้น - ต่อไปนี้ต้องเปิด start-api.bat เองทุกครั้ง
echo    (Print Server ยังทำงานตามปกติ ไม่ได้ถูกปิดไปด้วย)
echo.
pause
