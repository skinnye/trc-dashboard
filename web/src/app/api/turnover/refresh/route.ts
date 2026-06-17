import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const pExecFile = promisify(execFile);

export const dynamic = 'force-dynamic';

// Кнопка «Обновить» на /turnover. Запускает Python-импорт товарооборота
// из листа «НОВАЯ» файла 02_ТО АП.xlsx (SMB-шара Acad-server) и метрик
// Focus. Дашборд стартует через start_dashboard.bat → .creds.bat монтирует
// шару в той же сессии, поэтому у node-процесса (и его python-потомка) есть
// доступ к \\Acad-server. БД — общий dashboard.db (дефолт у python и web).
let running = false;

async function runPy(parserDir: string, script: string, timeout: number): Promise<string> {
  const { stdout } = await pExecFile('python', ['-X', 'utf8', '-u', script], {
    cwd: parserDir, timeout, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const lines = (stdout || '').trim().split(/\r?\n/);
  return lines[lines.length - 1] || '';
}

export async function POST() {
  if (running) {
    return NextResponse.json({ ok: false, error: 'обновление уже идёт' }, { status: 409 });
  }
  running = true;
  const parserDir = path.join(process.cwd(), '..', 'parser');
  const result: { ok: boolean; turnover?: string; focus?: string; error?: string } = { ok: true };
  try {
    // Главный источник — товарооборот из Excel (SMB).
    result.turnover = await runPy(parserDir, 'import_turnover.py', 180_000);
    // Метрики Focus — если выгрузка лежит в корне проекта (необязательно).
    try {
      result.focus = await runPy(parserDir, 'import_focus.py', 120_000);
    } catch (e) {
      result.focus = 'пропущено: ' + ((e as Error)?.message ?? String(e));
    }
    return NextResponse.json(result);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return NextResponse.json(
      { ok: false, error: err?.stderr || err?.message || String(e) },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
