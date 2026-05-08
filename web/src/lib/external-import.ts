/**
 * Одноразовый импорт Excel «2gis_Организации.xlsx» в БД:
 *  - лист «Категории»          → ext_categories
 *  - лист «Организации»         → ext_orgs + пустой снапшот (на каждую пару
 *                                 категория+организация — по строке)
 *  - лист «Организации_raw»     → метрики снапшота (рейтинг, отзывы, телефоны,
 *                                 сайт, часы, координаты) — UPDATE по
 *                                 совпадению name+address
 *
 * Идемпотентен: если запись с source='excel-import' уже есть в ext_runs,
 * вторично ничего не делает (если только не передан force=true).
 */
import ExcelJS from 'exceljs';
import { db, getSetting, setSetting, localIsoDateTime } from './db';

// Имя ключа в app_settings для пути к Excel-файлу с категориями 2GIS.
// Менять путь можно через UI (POST /api/settings) или прямо в БД —
// без перезапуска приложения.
export const SETTING_EXTERNAL_EXCEL = 'external.excel_path';

// Дефолтный путь — записывается в app_settings при первом запуске,
// если ключа ещё нет, чтобы UI сразу показывал актуальное значение.
const DEFAULT_EXCEL_PATH =
  'C:\\Users\\Князева\\Desktop\\TRC_tools\\2gis_Организации.xlsx';

function resolveExcelPath(): string {
  const fromDb = getSetting(SETTING_EXTERNAL_EXCEL);
  if (fromDb) return fromDb;
  // Записываем дефолт, чтобы пользователь видел его в настройках и мог поменять.
  setSetting(
    SETTING_EXTERNAL_EXCEL,
    DEFAULT_EXCEL_PATH,
    'Путь к Excel «2gis_Организации.xlsx» для одноразового импорта категорий и первого снапшота.',
  );
  return DEFAULT_EXCEL_PATH;
}

export interface ImportResult {
  ok: boolean;
  alreadyImported?: boolean;
  categoriesUpserted: number;
  orgsUpserted: number;
  snapshotsInserted: number;
  metricsUpdated: number;
  runId: number | null;
  durationMs: number;
  error?: string;
}

function dedupeKey(category: string, name: string, address: string): string {
  return `${category}|${name}|${address}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    // ExcelJS hyperlink/richtext
    const o = v as { text?: string; hyperlink?: string; result?: unknown };
    if (typeof o.text === 'string') return o.text.trim();
    if (typeof o.hyperlink === 'string') return o.hyperlink.trim();
    if (o.result != null) return String(o.result).trim();
  }
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  const s = cellText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime())
    ? d.toISOString().slice(0, 19).replace('T', ' ')
    : null;
}

function cellNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = cellText(v).replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellInt(v: unknown): number | null {
  const n = cellNumber(v);
  return n == null ? null : Math.trunc(n);
}

// 2GIS-экспорт раскладывает «Организации_raw» так:
//   row 1                        — заголовки секций (некоторые ячейки слиты)
//   row 2 cols  1-35             — данные первой организации
//   row 2 cols 36-84             — суб-заголовки правой секции «связанные категории»
//   row 3+ cols  1-35            — данные org #2..N
//   row 3+ cols 36-84            — связанные категории (нам не нужны, всё уже есть
//                                  в листе «Организации»)
//
// Поэтому мы читаем только cols 1-35 и стартуем с row 2.
const RAW_COL = {
  NAME:        1,
  TAGLINE:     2,
  CATEGORIES:  3,
  ADDRESS:     4,
  ADDR_NOTE:   5,
  HOURS:      13,
  RATING:     15,
  REVIEWS:    16,
  PHONE_1:    17,
  PHONE_2:    18,
  PHONE_3:    19,
  EMAIL:      20,
  WEBSITE_1:  21,
  WEBSITE_2:  22,
  WEBSITE_3:  23,
  VK:         25,
  TELEGRAM:   29,
  // Колонки в шапке подписаны как «Долгота» x4, но реальные значения
  // показывают, что 32 — это широта (~56.78), 33 — долгота (~60.5).
  LATITUDE:   32,
  LONGITUDE:  33,
  GIS_URL:    34,
} as const;

export async function importExternalExcel(force = false): Promise<ImportResult> {
  const t0 = Date.now();
  const conn = db();

  if (!force) {
    const existing = conn
      .prepare(`SELECT id FROM ext_runs WHERE source = 'excel-import' LIMIT 1`)
      .get() as { id?: number } | undefined;
    if (existing?.id) {
      return {
        ok: true,
        alreadyImported: true,
        categoriesUpserted: 0,
        orgsUpserted: 0,
        snapshotsInserted: 0,
        metricsUpdated: 0,
        runId: existing.id,
        durationMs: Date.now() - t0,
      };
    }
  }

  const excelPath = resolveExcelPath();
  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(excelPath);
  } catch (e) {
    return {
      ok: false,
      categoriesUpserted: 0,
      orgsUpserted: 0,
      snapshotsInserted: 0,
      metricsUpdated: 0,
      runId: null,
      durationMs: Date.now() - t0,
      error: `Не удалось открыть ${excelPath}: ${(e as Error).message}`,
    };
  }

  const wsCat = wb.getWorksheet('Категории');
  const wsOrg = wb.getWorksheet('Организации');
  if (!wsCat || !wsOrg) {
    return {
      ok: false,
      categoriesUpserted: 0,
      orgsUpserted: 0,
      snapshotsInserted: 0,
      metricsUpdated: 0,
      runId: null,
      durationMs: Date.now() - t0,
      error: 'В Excel нет листа «Категории» или «Организации»',
    };
  }

  conn.exec('BEGIN');
  try {
    // Если force — стираем предыдущий excel-import и его данные.
    if (force) {
      const old = conn
        .prepare(`SELECT id FROM ext_runs WHERE source = 'excel-import'`)
        .all() as { id: number }[];
      for (const r of old) {
        conn.prepare('DELETE FROM ext_snapshots WHERE run_id = ?').run(r.id);
      }
      conn.prepare(`DELETE FROM ext_runs WHERE source = 'excel-import'`).run();
      // Орги/категории не трогаем — UPSERT'ы ниже их обновят.
    }

    const now = localIsoDateTime();

    // ── Категории ────────────────────────────────────────────────
    const upsertCat = conn.prepare(`
      INSERT INTO ext_categories (name, search_url, active, added_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(name) DO UPDATE SET search_url = excluded.search_url
    `);
    const getCatId = conn.prepare(`SELECT id FROM ext_categories WHERE name = ?`);

    let catCount = 0;
    wsCat.eachRow((row, rn) => {
      if (rn === 1) return; // header
      const name = cellText(row.getCell(1).value);
      const url = cellText(row.getCell(2).value);
      if (!name || !url) return;
      upsertCat.run(name, url, now);
      catCount++;
    });

    // ── Run-запись для первого снапшота ─────────────────────────
    // started_at — самая ранняя "Дата добавления" из листа «Организации»,
    // или сейчас, если ничего нет.
    let earliest: string | null = null;
    wsOrg.eachRow((row, rn) => {
      if (rn === 1) return;
      const d = cellDate(row.getCell(5).value);
      if (d && (!earliest || d < earliest)) earliest = d;
    });
    const runStart = earliest ?? now;

    const insRun = conn.prepare(`
      INSERT INTO ext_runs (started_at, finished_at, status, source, categories_total)
      VALUES (?, ?, 'ok', 'excel-import', ?)
    `);
    const runId = Number(insRun.run(runStart, now, catCount).lastInsertRowid);

    // ── Организации + первый снапшот ─────────────────────────────
    const upsertOrg = conn.prepare(`
      INSERT INTO ext_orgs
        (dedupe_key, category_id, name, address, street, is_duplicate, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        category_id  = excluded.category_id,
        name         = excluded.name,
        address      = excluded.address,
        street       = excluded.street,
        is_duplicate = excluded.is_duplicate,
        last_seen_at = excluded.last_seen_at
    `);
    const getOrgId = conn.prepare(`SELECT id FROM ext_orgs WHERE dedupe_key = ?`);
    const insSnap = conn.prepare(`
      INSERT INTO ext_snapshots (run_id, org_id) VALUES (?, ?)
    `);

    let orgCount = 0;
    let snapCount = 0;
    wsOrg.eachRow((row, rn) => {
      if (rn === 1) return; // header

      const category = cellText(row.getCell(2).value);
      const name = cellText(row.getCell(3).value);
      const address = cellText(row.getCell(4).value);
      const dateAdded = cellDate(row.getCell(5).value) ?? runStart;
      const street = cellText(row.getCell(6).value);
      const isDup = cellText(row.getCell(8).value).toLowerCase() === 'да' ? 1 : 0;
      if (!category || !name) return;

      const cat = getCatId.get(category) as { id?: number } | undefined;
      if (!cat?.id) return; // категория не нашлась в справочнике — пропускаем

      const key = dedupeKey(category, name, address);
      upsertOrg.run(key, cat.id, name, address, street, isDup, dateAdded, dateAdded);
      orgCount++;

      const org = getOrgId.get(key) as { id?: number } | undefined;
      if (org?.id) {
        insSnap.run(runId, org.id);
        snapCount++;
      }
    });

    // ── Метрики из «Организации_raw» ────────────────────────────
    // Один и тот же снимок (rating/reviews/phones/...) применяется ко
    // всем ext_orgs с таким name+address — они отличаются только
    // category_id, а метрики 2GIS принадлежат самой организации.
    let metricsUpdated = 0;
    const wsRaw = wb.getWorksheet('Организации_raw');
    if (wsRaw) {
      const findOrgs = conn.prepare(`
        SELECT id FROM ext_orgs WHERE name = ? AND address = ?
      `);
      const updateSnap = conn.prepare(`
        UPDATE ext_snapshots
        SET rating         = ?,
            reviews_count  = ?,
            phones         = ?,
            website        = ?,
            hours          = ?,
            longitude      = ?,
            latitude       = ?,
            raw_json       = ?
        WHERE run_id = ? AND org_id = ?
      `);

      wsRaw.eachRow((row, rn) => {
        if (rn === 1) return; // секционная шапка

        const name    = cellText(row.getCell(RAW_COL.NAME).value);
        const address = cellText(row.getCell(RAW_COL.ADDRESS).value);
        if (!name || !address) return;

        const rating  = cellNumber(row.getCell(RAW_COL.RATING).value);
        const reviews = cellInt(row.getCell(RAW_COL.REVIEWS).value);
        const phones  = [
          cellText(row.getCell(RAW_COL.PHONE_1).value),
          cellText(row.getCell(RAW_COL.PHONE_2).value),
          cellText(row.getCell(RAW_COL.PHONE_3).value),
        ].filter(Boolean);
        const websites = [
          cellText(row.getCell(RAW_COL.WEBSITE_1).value),
          cellText(row.getCell(RAW_COL.WEBSITE_2).value),
          cellText(row.getCell(RAW_COL.WEBSITE_3).value),
        ].filter(Boolean);
        const hours    = cellText(row.getCell(RAW_COL.HOURS).value) || null;
        const lat      = cellNumber(row.getCell(RAW_COL.LATITUDE).value);
        const lng      = cellNumber(row.getCell(RAW_COL.LONGITUDE).value);
        const gisUrl   = cellText(row.getCell(RAW_COL.GIS_URL).value);
        const tagline  = cellText(row.getCell(RAW_COL.TAGLINE).value);
        const email    = cellText(row.getCell(RAW_COL.EMAIL).value);
        const vk       = cellText(row.getCell(RAW_COL.VK).value);
        const tg       = cellText(row.getCell(RAW_COL.TELEGRAM).value);

        // Если ничего «полезного» не нашли — не трогаем существующий пустой снапшот.
        const hasAnyMetric =
          rating != null || reviews != null || phones.length > 0 ||
          websites.length > 0 || hours || lat != null || lng != null;
        if (!hasAnyMetric) return;

        const rawJson = JSON.stringify({
          tagline: tagline || undefined,
          email:   email || undefined,
          vk:      vk || undefined,
          telegram: tg || undefined,
          gisUrl:  gisUrl || undefined,
        });

        const orgs = findOrgs.all(name, address) as { id: number }[];
        for (const o of orgs) {
          updateSnap.run(
            rating,
            reviews,
            phones.length ? JSON.stringify(phones) : null,
            websites[0] ?? null,
            hours,
            lng,
            lat,
            rawJson,
            runId,
            o.id,
          );
          metricsUpdated++;
        }
      });
    }

    // Финализируем run-запись с total_orgs.
    conn
      .prepare(`UPDATE ext_runs SET total_orgs = ? WHERE id = ?`)
      .run(snapCount, runId);

    conn.exec('COMMIT');

    return {
      ok: true,
      categoriesUpserted: catCount,
      orgsUpserted: orgCount,
      snapshotsInserted: snapCount,
      metricsUpdated,
      runId,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    try {
      conn.exec('ROLLBACK');
    } catch {}
    return {
      ok: false,
      categoriesUpserted: 0,
      orgsUpserted: 0,
      snapshotsInserted: 0,
      metricsUpdated: 0,
      runId: null,
      durationMs: Date.now() - t0,
      error: (e as Error).message,
    };
  }
}
