@echo off
REM Удаление зарегистрированных задач TRC_*. Запускать ОТ АДМИНА.

setlocal

echo Удаляю TRC_PlanFakt...
schtasks /Delete /TN "TRC_PlanFakt" /F 2>nul

echo Удаляю TRC_2GIS_Scrape...
schtasks /Delete /TN "TRC_2GIS_Scrape" /F 2>nul

echo.
echo Готово. Расписание снято.
endlocal
