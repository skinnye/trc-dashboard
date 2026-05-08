// Source values come from .env.local (gitignored). See .env.example at the
// repo root for the template. Hard fail at first use if a secret is missing —
// silently using `undefined` would let the app start but break with confusing
// errors deep inside mssql/excel.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return v;
}

export const EXCEL_PATH = process.env.EXCEL_PATH
  ?? '\\\\Acad-server\\общие\\02_Бухгалтерия\\01_Бюджет\\2026\\01_рабочая таблица 2026.xlsx';

export const SQL_CONFIG = {
  server: process.env.MSSQL_HOST ?? '192.168.30.3',
  port: Number(process.env.MSSQL_PORT ?? 1433),
  database: process.env.MSSQL_DB ?? 'CM_Academ_523',
  get user() { return requireEnv('MSSQL_USER'); },
  get password() { return requireEnv('MSSQL_PASSWORD'); },
  connectionTimeout: 10_000,
  requestTimeout: 30_000,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    // CompacsM хранит TimeRecord в локальном времени сервера без TZ.
    // Без useUTC=false драйвер mssql конвертирует JS-Date → UTC, и наша
    // "локальная полночь" уезжает на 3 часа назад → live-счётчик ловит
    // вчерашние вечерние уходы и показывает 0/мусор.
    useUTC: false,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
};

export const MONTH_NAMES_RU: Record<number, string> = {
  1: 'Январь', 2: 'Февраль', 3: 'Март', 4: 'Апрель',
  5: 'Май', 6: 'Июнь', 7: 'Июль', 8: 'Август',
  9: 'Сентябрь', 10: 'Октябрь', 11: 'Ноябрь', 12: 'Декабрь',
};

export const MONTH_KEY: Record<string, number> = {
  'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4,
  'май': 5, 'июнь': 6, 'июль': 7, 'август': 8,
  'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
};

// ── Rent column indexes (0-based) ──
// Monthly sheets 2026 ("январь 26", ...)
export const COL_MONTHLY = {
  FLOOR:        0,
  ROOM:         1,
  AREA:         2,
  STATUS:       3,
  RATE:         4,
  LEGAL:        5,
  TRADE:        6,
  PLAN_VAT:     18,
  PLAN_OPLAT:   19,
  FACT_VAT:     23,
  FACT_OPLAT:   24,
} as const;

// December sheet — shifted by 2 columns
export const COL_DEC = {
  FLOOR:        0,
  ROOM:         1,
  AREA:         2,
  STATUS:       3,
  RATE:         4,
  LEGAL:        5,
  TRADE:        6,
  PLAN_VAT:     20,
  PLAN_OPLAT:   21,
  FACT_VAT:     25,
  FACT_OPLAT:   26,
} as const;

// Plan sheet: "Оплачено с НДС" column index per month (0-based)
export const PLAN_COL: Record<number, number> = {
  1: 18, 2: 28, 3: 38, 4: 52, 5: 62, 6: 72,
  7: 86, 8: 96, 9: 106, 10: 120, 11: 130, 12: 140,
};

export const MIN_TENANT_PAYMENT = 100;
export const DATA_START_ROW = 9; // 0-based: row 10 in 1-based
