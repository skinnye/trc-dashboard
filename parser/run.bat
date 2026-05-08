@echo off
REM Запуск еженедельного сбора данных 2GIS (внешний контур).
REM Используется отдельно — для дашборда /external.
REM
REM Для агрегатного импорта плана-факта (заполняемость + съезды/заезды)
REM используйте run_all.bat или напрямую run_all.py.

setlocal
cd /d "%~dp0"

REM Если используется virtualenv, раскомментируйте:
REM call venv\Scripts\activate

python scrape_2gis.py %*

exit /b %ERRORLEVEL%
