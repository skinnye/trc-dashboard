@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Регистрация задач в Windows Task Scheduler — один раз на машине.
REM  После этого парсеры запускаются автоматически по расписанию.
REM
REM  Запускать ОТ ИМЕНИ АДМИНИСТРАТОРА:
REM    правый клик на setup_schedule.bat → «Запустить от имени админа».
REM
REM  Что регистрируется:
REM   1. TRC_PlanFakt           — ежедневно 02:00, импорт плана-факта
REM                                (заполняемость + съезды/заезды)
REM   2. TRC_2GIS_Scrape        — еженедельно, суббота 03:00, парсинг 2GIS
REM
REM  Чтобы удалить: запустить unschedule.bat (тоже от админа).
REM ─────────────────────────────────────────────────────────────────────

setlocal
set BASE=%~dp0
REM Срезаем хвостовой обратный слэш для красоты в логах:
if "%BASE:~-1%"=="\" set BASE=%BASE:~0,-1%

echo.
echo === Регистрация TRC_PlanFakt (ежедневно в 02:00) ===
schtasks /Create ^
  /TN "TRC_PlanFakt" ^
  /TR "\"%BASE%\run_all.bat\"" ^
  /SC DAILY ^
  /ST 02:00 ^
  /RL HIGHEST ^
  /F
if errorlevel 1 goto :err

echo.
echo === Регистрация TRC_2GIS_Scrape (еженедельно, суббота 03:00) ===
schtasks /Create ^
  /TN "TRC_2GIS_Scrape" ^
  /TR "\"%BASE%\run.bat\"" ^
  /SC WEEKLY ^
  /D SAT ^
  /ST 03:00 ^
  /RL HIGHEST ^
  /F
if errorlevel 1 goto :err

echo.
echo === Текущее расписание ===
schtasks /Query /TN "TRC_PlanFakt"      /FO LIST | findstr /I "TaskName Status Next"
schtasks /Query /TN "TRC_2GIS_Scrape"   /FO LIST | findstr /I "TaskName Status Next"

echo.
echo Готово. Парсеры будут запускаться автоматически.
echo Логи каждого запуска: %BASE%\logs\
echo.
goto :end

:err
echo.
echo !!! Ошибка регистрации задачи. Скрипт надо запускать ОТ АДМИНИСТРАТОРА.
echo.
exit /b 1

:end
endlocal
