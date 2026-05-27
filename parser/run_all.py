"""
Запускает все импорты годовых план-фактов одной командой:
  1. import_status_history.py — помесячные статусы помещений (Сдан / Не сдан)
  2. import_movements.py      — съезды/заезды арендаторов (лист «4 съезд-заезд»)

Используется как точка входа для еженедельного / по-расписанию обновления
дашборда. Все аргументы (например --year, --dry-run) передаются обоим
скриптам as-is — то есть `python run_all.py --year 2025` запустит обе
обработки только для 2025 года.

Запуск (Task Scheduler / руками):
  python run_all.py
  python run_all.py --year 2026
  python run_all.py --dry-run
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent.resolve()

SCRIPTS = [
    'import_status_history.py',  # помесячная заполняемость
    'import_movements.py',        # съезды/заезды (лист «4 съезд-заезд»)
    'import_turnover.py',         # товарооборот (лист «НОВАЯ» в 02_ТО АП.xlsx)
]


def main() -> int:
    extra_args = sys.argv[1:]
    print(f'>>> run_all: {len(SCRIPTS)} parsers, args={extra_args!r}', flush=True)
    for script in SCRIPTS:
        path = HERE / script
        if not path.exists():
            print(f'!!! Не найден: {path}', file=sys.stderr)
            return 2
        print(f'\n>>> {script}\n', flush=True)
        r = subprocess.run(
            [sys.executable, '-X', 'utf8', '-u', str(path), *extra_args],
        )
        if r.returncode != 0:
            print(f'!!! {script} вернул код {r.returncode}', file=sys.stderr)
            return r.returncode
    print('\n>>> Все импорты прошли успешно', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
