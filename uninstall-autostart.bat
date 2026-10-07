@echo off
chcp 65001 >nul
setlocal
title SA-NAE POS - ยกเลิกการเปิด Print Server อัตโนมัติ
color 0E

echo =========================================
echo    ยกเลิกการเปิด PRINT SERVER อัตโนมัติ
echo =========================================
echo.

set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SA-NAE Print Server.lnk"

if exist "%LNK%" (
  del "%LNK%"
  echo    ลบทางลัดใน Startup แล้ว
) else (
  echo    ไม่พบทางลัดใน Startup อยู่แล้ว
)

echo กำลังหยุด Print Server ที่ทำงานอยู่...
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo.
echo    เสร็จสิ้น - ต่อไปนี้ต้องเปิด start-printer.bat เองทุกครั้ง
echo.
pause
