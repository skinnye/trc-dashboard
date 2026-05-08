/**
 * Чтение «внешнего контура» (2GIS) из БД для дашборда.
 *
 * Источник данных: ext_categories, ext_runs, ext_orgs, ext_snapshots.
 * Заполняется одноразовым импортом из Excel и еженедельным прогоном
 * Python-парсера parser-2gis.
 */
import { db } from './db';

export interface ExternalSummary {
  categoriesCount: number;
  orgsCount: number;
  duplicatesCount: number;
  runs: number;
  lastRun: { id: number; startedAt: string; finishedAt: string | null; status: string; totalOrgs: number | null } | null;
}

export function getExternalSummary(): ExternalSummary {
  const conn = db();
  const cats = conn.prepare('SELECT COUNT(*) AS n FROM ext_categories WHERE active = 1').get() as { n: number };
  const orgs = conn.prepare('SELECT COUNT(*) AS n FROM ext_orgs').get() as { n: number };
  const dups = conn.prepare('SELECT COUNT(*) AS n FROM ext_orgs WHERE is_duplicate = 1').get() as { n: number };
  const runs = conn.prepare('SELECT COUNT(*) AS n FROM ext_runs').get() as { n: number };
  const last = conn
    .prepare(`
      SELECT id, started_at AS startedAt, finished_at AS finishedAt,
             status, total_orgs AS totalOrgs
      FROM ext_runs ORDER BY id DESC LIMIT 1
    `)
    .get() as ExternalSummary['lastRun'];
  return {
    categoriesCount: cats.n,
    orgsCount: orgs.n,
    duplicatesCount: dups.n,
    runs: runs.n,
    lastRun: last ?? null,
  };
}

export interface CategoryRow {
  id: number;
  name: string;
  searchUrl: string;
  orgsCount: number;
  duplicatesCount: number;
  avgRating: number | null;
  totalReviews: number | null;
}

export function getCategoriesOverview(): CategoryRow[] {
  return db()
    .prepare(`
      WITH latest AS (
        SELECT MAX(id) AS run_id FROM ext_runs WHERE status = 'ok'
      ),
      org_metrics AS (
        SELECT s.org_id, s.rating, s.reviews_count
        FROM ext_snapshots s, latest
        WHERE s.run_id = latest.run_id
      )
      SELECT
        c.id, c.name, c.search_url AS searchUrl,
        COUNT(o.id) AS orgsCount,
        SUM(CASE WHEN o.is_duplicate = 1 THEN 1 ELSE 0 END) AS duplicatesCount,
        AVG(m.rating) AS avgRating,
        SUM(m.reviews_count) AS totalReviews
      FROM ext_categories c
      LEFT JOIN ext_orgs o      ON o.category_id = c.id
      LEFT JOIN org_metrics m   ON m.org_id = o.id
      WHERE c.active = 1
      GROUP BY c.id
      ORDER BY orgsCount DESC, c.name
    `)
    .all() as unknown as CategoryRow[];
}

export interface OrgRow {
  id: number;
  name: string;
  address: string | null;
  street: string | null;
  isDuplicate: number;
  firstSeenAt: string;
  lastSeenAt: string;
  rating: number | null;
  reviewsCount: number | null;
  website: string | null;
  phones: string | null;        // JSON
  hours: string | null;         // JSON
  longitude: number | null;
  latitude: number | null;
}

export function getCategory(categoryId: number): { category: CategoryRow | null; orgs: OrgRow[] } {
  const conn = db();
  const cat = conn
    .prepare(`
      WITH latest AS (
        SELECT MAX(id) AS run_id FROM ext_runs WHERE status = 'ok'
      ),
      org_metrics AS (
        SELECT s.org_id, s.rating, s.reviews_count
        FROM ext_snapshots s, latest WHERE s.run_id = latest.run_id
      )
      SELECT c.id, c.name, c.search_url AS searchUrl,
             COUNT(o.id) AS orgsCount,
             SUM(CASE WHEN o.is_duplicate = 1 THEN 1 ELSE 0 END) AS duplicatesCount,
             AVG(m.rating) AS avgRating,
             SUM(m.reviews_count) AS totalReviews
      FROM ext_categories c
      LEFT JOIN ext_orgs o    ON o.category_id = c.id
      LEFT JOIN org_metrics m ON m.org_id = o.id
      WHERE c.id = ?
      GROUP BY c.id
    `)
    .get(categoryId) as unknown as CategoryRow | undefined;

  const orgs = conn
    .prepare(`
      WITH latest AS (
        SELECT MAX(id) AS run_id FROM ext_runs WHERE status = 'ok'
      )
      SELECT
        o.id, o.name, o.address, o.street,
        o.is_duplicate AS isDuplicate,
        o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt,
        s.rating, s.reviews_count AS reviewsCount,
        s.website, s.phones, s.hours,
        s.longitude, s.latitude
      FROM ext_orgs o
      LEFT JOIN latest l ON 1=1
      LEFT JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = l.run_id
      WHERE o.category_id = ?
      ORDER BY (s.reviews_count IS NULL), s.reviews_count DESC, o.name
    `)
    .all(categoryId) as unknown as OrgRow[];

  return { category: cat ?? null, orgs };
}

export interface OrgHistoryPoint {
  runId: number;
  capturedAt: string;
  rating: number | null;
  reviewsCount: number | null;
}

export function getOrg(orgId: number): { org: (OrgRow & { categoryId: number; categoryName: string }) | null; history: OrgHistoryPoint[] } {
  const conn = db();
  const org = conn
    .prepare(`
      WITH latest AS (
        SELECT MAX(id) AS run_id FROM ext_runs WHERE status = 'ok'
      )
      SELECT
        o.id, o.name, o.address, o.street,
        o.is_duplicate AS isDuplicate,
        o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt,
        o.category_id AS categoryId, c.name AS categoryName,
        s.rating, s.reviews_count AS reviewsCount,
        s.website, s.phones, s.hours,
        s.longitude, s.latitude
      FROM ext_orgs o
      JOIN ext_categories c ON c.id = o.category_id
      LEFT JOIN latest l ON 1=1
      LEFT JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = l.run_id
      WHERE o.id = ?
    `)
    .get(orgId) as unknown as (OrgRow & { categoryId: number; categoryName: string }) | undefined;

  const history = conn
    .prepare(`
      SELECT s.run_id AS runId,
             COALESCE(r.finished_at, r.started_at) AS capturedAt,
             s.rating, s.reviews_count AS reviewsCount
      FROM ext_snapshots s
      JOIN ext_runs r ON r.id = s.run_id
      WHERE s.org_id = ? AND r.status = 'ok'
      ORDER BY r.started_at
    `)
    .all(orgId) as unknown as OrgHistoryPoint[];

  return { org: org ?? null, history };
}

export interface RunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorMsg: string | null;
  totalOrgs: number | null;
  source: string | null;
}

export interface MapPoint {
  orgId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviews: number | null;
}

/**
 * Все точки с координатами для тепловой карты.
 * Опциональный фильтр по категории.
 *
 * Берём данные из последнего успешного прогона. Без LIMIT — карта рендерит
 * все ~1000 точек одной волной, разбиение страницами тут не нужно.
 */
export function getMapPoints(categoryId?: number): MapPoint[] {
  const conn = db();
  const baseSql = `
    WITH latest AS (
      SELECT MAX(id) AS run_id FROM ext_runs WHERE status = 'ok'
    )
    SELECT
      o.id            AS orgId,
      o.name          AS name,
      o.category_id   AS categoryId,
      c.name          AS categoryName,
      s.latitude      AS lat,
      s.longitude     AS lng,
      s.rating        AS rating,
      s.reviews_count AS reviews
    FROM ext_snapshots s
    JOIN ext_orgs o       ON o.id = s.org_id
    JOIN ext_categories c ON c.id = o.category_id
    JOIN latest l         ON s.run_id = l.run_id
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  `;
  if (categoryId) {
    return conn
      .prepare(baseSql + ' AND o.category_id = ?')
      .all(categoryId) as unknown as MapPoint[];
  }
  return conn.prepare(baseSql).all() as unknown as MapPoint[];
}

export function listRuns(limit = 50): RunRow[] {
  return db()
    .prepare(`
      SELECT id, started_at AS startedAt, finished_at AS finishedAt, status,
             error_msg AS errorMsg, total_orgs AS totalOrgs, source
      FROM ext_runs
      ORDER BY id DESC LIMIT ?
    `)
    .all(limit) as unknown as RunRow[];
}

// ── Динамика ──────────────────────────────────────────────────────────
// «Появилось» / «Исчезло» считаются относительно последнего УСПЕШНОГО
// прогона. Условия:
//   • новая орг — first_seen_at попадает в окно [latest.started_at, latest.finished_at]
//   • исчезнувшая — last_seen_at < latest.started_at (т.е. в этот прогон не пришла,
//     но раньше точно видели)
// Эти запросы стоят дёшево: оба поля проиндексированы естественно через
// первичный ключ + UNIQUE на dedupe_key.

export interface NewcomerRow {
  id: number;
  name: string;
  address: string | null;
  street: string | null;
  categoryId: number;
  categoryName: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

function latestRunStarted(): string | null {
  const r = db()
    .prepare(`SELECT started_at AS startedAt FROM ext_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`)
    .get() as { startedAt?: string } | undefined;
  return r?.startedAt ?? null;
}

function okRunsCount(): number {
  const r = db().prepare(`SELECT COUNT(*) AS n FROM ext_runs WHERE status = 'ok'`).get() as { n: number };
  return r.n;
}

export function getNewcomers(categoryId?: number, limit = 200): NewcomerRow[] {
  // Если в системе только один успешный прогон — «новых» по определению нет:
  // первая загрузка проставляет всем first_seen_at, и сравнивать не с чем.
  if (okRunsCount() < 2) return [];
  const start = latestRunStarted();
  if (!start) return [];
  const args: (string | number)[] = [start];
  let where = 'o.first_seen_at >= ?';
  if (categoryId) { where += ' AND o.category_id = ?'; args.push(categoryId); }
  args.push(limit);
  return db()
    .prepare(`
      SELECT o.id, o.name, o.address, o.street,
             o.category_id AS categoryId, c.name AS categoryName,
             o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt
      FROM ext_orgs o
      JOIN ext_categories c ON c.id = o.category_id
      WHERE ${where}
      ORDER BY o.first_seen_at DESC, o.name
      LIMIT ?
    `)
    .all(...args) as unknown as NewcomerRow[];
}

export function getDropouts(categoryId?: number, limit = 200): NewcomerRow[] {
  if (okRunsCount() < 2) return [];
  const start = latestRunStarted();
  if (!start) return [];
  const args: (string | number)[] = [start];
  let where = 'o.last_seen_at < ?';
  if (categoryId) { where += ' AND o.category_id = ?'; args.push(categoryId); }
  args.push(limit);
  return db()
    .prepare(`
      SELECT o.id, o.name, o.address, o.street,
             o.category_id AS categoryId, c.name AS categoryName,
             o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt
      FROM ext_orgs o
      JOIN ext_categories c ON c.id = o.category_id
      WHERE ${where}
      ORDER BY o.last_seen_at DESC, o.name
      LIMIT ?
    `)
    .all(...args) as unknown as NewcomerRow[];
}

// Тренд по числу организаций в категории по всем прогонам.
// Каждая точка — один run. Полезно для линейного графика «динамика».
export interface CategoryTrendPoint {
  runId: number;
  capturedAt: string;
  orgs: number;
  avgRating: number | null;
  totalReviews: number | null;
}

export function getCategoryTrend(categoryId: number): CategoryTrendPoint[] {
  return db()
    .prepare(`
      SELECT r.id AS runId,
             COALESCE(r.finished_at, r.started_at) AS capturedAt,
             COUNT(DISTINCT s.org_id) AS orgs,
             AVG(s.rating) AS avgRating,
             SUM(s.reviews_count) AS totalReviews
      FROM ext_runs r
      JOIN ext_snapshots s ON s.run_id = r.id
      JOIN ext_orgs o      ON o.id = s.org_id
      WHERE r.status = 'ok' AND o.category_id = ?
      GROUP BY r.id
      ORDER BY r.started_at
    `)
    .all(categoryId) as unknown as CategoryTrendPoint[];
}

// Сводка для главной /external: счётчики «новые/исчезнувшие за последний прогон».
export interface DynamicsSummary {
  hasMultipleRuns: boolean;
  latestRunId: number | null;
  newcomersCount: number;
  dropoutsCount: number;
}

export function getDynamicsSummary(): DynamicsSummary {
  const conn = db();
  const okRuns = conn.prepare(`SELECT COUNT(*) AS n FROM ext_runs WHERE status = 'ok'`).get() as { n: number };
  const start = latestRunStarted();
  const latest = conn.prepare(`SELECT MAX(id) AS id FROM ext_runs WHERE status = 'ok'`).get() as { id?: number };
  if (!start || okRuns.n < 2) {
    return { hasMultipleRuns: false, latestRunId: latest?.id ?? null, newcomersCount: 0, dropoutsCount: 0 };
  }
  const newc = conn.prepare(`SELECT COUNT(*) AS n FROM ext_orgs WHERE first_seen_at >= ?`).get(start) as { n: number };
  const drop = conn.prepare(`SELECT COUNT(*) AS n FROM ext_orgs WHERE last_seen_at < ?`).get(start) as { n: number };
  return {
    hasMultipleRuns: true,
    latestRunId: latest?.id ?? null,
    newcomersCount: newc.n,
    dropoutsCount: drop.n,
  };
}
