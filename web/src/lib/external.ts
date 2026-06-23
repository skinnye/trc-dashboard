/**
 * Чтение «внешнего контура» (2GIS) из БД для дашборда.
 *
 * Источник данных: ext_categories, ext_runs, ext_orgs, ext_snapshots.
 * Заполняется одноразовым импортом из Excel и еженедельным прогоном
 * Python-парсера parser-2gis.
 */
import { db } from './db';

// ── Охваты (scope) ────────────────────────────────────────────────────
// Ссылки в Excel имеют границы карты = район Академический. Парсер умеет
// собирать в трёх охватах, помечая ext_runs.source:
//   district → '2gis-district' (или старый 'excel-import' — тоже район)
//   city     → '2gis-city'     (или старый 'parser-2gis' — был по городу)
//   mall:X   → '2gis-mall:X'   (вокруг другого ТРЦ)
// UI выбирает охват, а мы резолвим последний успешный прогон этого охвата.
export type ExtScope = string; // 'district' | 'city' | 'mall:<name>'

function scopeSourceSql(scope: string): string {
  if (scope === 'city') return `source IN ('2gis-city','parser-2gis')`;
  if (scope.startsWith('mall:')) {
    // source хранит '2gis-mall:<label>'. Чистим кавычки во избежание инъекции.
    const name = scope.slice(5).replace(/'/g, '');
    return `source = '2gis-mall:${name}'`;
  }
  return `source IN ('2gis-district','excel-import')`;
}

// Гео-фильтр охвата. 2ГИС не клиппит выдачу по карте — параметр m=центр/зум
// лишь центрирует, а поиск возвращает весь город. Поэтому «район» отбираем
// сами по расстоянию от ТРЦ Академический (у карточек есть координаты).
const MALL = { lat: 56.78901, lng: 60.530548 };
const DISTRICT_KM = 3;                              // радиус «района», км (легко менять)
const K_LAT = 111.0;                                // км на градус широты
const K_LNG = 111.0 * Math.cos(MALL.lat * Math.PI / 180); // км на градус долготы на этой широте

// Возвращает SQL-условие гео-фильтра по координатам снапшота (alias по умолч. 's').
// Для города/ТРЦ — пусто (без фильтра). Для района — круг радиусом DISTRICT_KM.
function geoCond(scope: ExtScope, alias = 's'): string {
  if (scope === 'city' || scope.startsWith('mall:')) return '';
  const r2 = DISTRICT_KM * DISTRICT_KM;
  return `AND ${alias}.latitude IS NOT NULL AND ${alias}.longitude IS NOT NULL
          AND (((${alias}.latitude  - ${MALL.lat}) * ${K_LAT}) * ((${alias}.latitude  - ${MALL.lat}) * ${K_LAT})
             + ((${alias}.longitude - ${MALL.lng}) * ${K_LNG.toFixed(4)}) * ((${alias}.longitude - ${MALL.lng}) * ${K_LNG.toFixed(4)})) <= ${r2}`;
}

// Последний успешный непустой прогон выбранного охвата.
export function resolveRunId(scope: ExtScope = 'district'): number | null {
  const r = db()
    .prepare(`SELECT MAX(id) AS id FROM ext_runs
              WHERE status = 'ok' AND total_orgs > 0 AND ${scopeSourceSql(scope)}`)
    .get() as { id: number | null };
  return r?.id ?? null;
}

export interface ScopeInfo {
  scope: string; label: string; runId: number;
  startedAt: string; orgs: number;
}

// Доступные охваты (с данными) для селектора в UI.
export function listScopes(): ScopeInfo[] {
  const conn = db();
  const out: ScopeInfo[] = [];
  const add = (scope: string, label: string) => {
    const id = resolveRunId(scope);
    if (!id) return;
    const started = (conn.prepare('SELECT started_at AS s FROM ext_runs WHERE id = ?').get(id) as { s: string }).s;
    // число с учётом гео-фильтра охвата (район — только в радиусе от ТРЦ)
    const orgs = (conn.prepare(`SELECT COUNT(DISTINCT s.org_id) AS n FROM ext_snapshots s
                                WHERE s.run_id = ? ${geoCond(scope)}`).get(id) as { n: number }).n;
    out.push({ scope, label, runId: id, startedAt: started, orgs });
  };
  add('district', 'Район Академический');
  add('city', 'Весь Екатеринбург');
  const malls = conn
    .prepare(`SELECT DISTINCT source FROM ext_runs
              WHERE status = 'ok' AND total_orgs > 0 AND source LIKE '2gis-mall:%'`)
    .all() as { source: string }[];
  for (const m of malls) {
    const name = m.source.slice('2gis-mall:'.length);
    add(`mall:${name}`, `ТРЦ ${name}`);
  }
  return out;
}

export interface ExternalSummary {
  categoriesCount: number;
  orgsCount: number;
  duplicatesCount: number;
  runs: number;
  lastRun: { id: number; startedAt: string; finishedAt: string | null; status: string; totalOrgs: number | null } | null;
}

export function getExternalSummary(scope: ExtScope = 'district'): ExternalSummary {
  const conn = db();
  const runId = resolveRunId(scope);
  const cats = conn.prepare('SELECT COUNT(*) AS n FROM ext_categories WHERE active = 1').get() as { n: number };
  const runs = conn.prepare('SELECT COUNT(*) AS n FROM ext_runs').get() as { n: number };
  // Орги и дубли — в рамках выбранного охвата (по снапшотам его прогона).
  let orgsCount = 0, dupCount = 0;
  if (runId) {
    orgsCount = (conn.prepare(`SELECT COUNT(DISTINCT s.org_id) AS n FROM ext_snapshots s
                               WHERE s.run_id = ? ${geoCond(scope)}`)
      .get(runId) as { n: number }).n;
    dupCount = (conn.prepare(`SELECT COUNT(DISTINCT s.org_id) AS n FROM ext_snapshots s
                              JOIN ext_orgs o ON o.id = s.org_id
                              WHERE s.run_id = ? AND o.is_duplicate = 1 ${geoCond(scope)}`)
      .get(runId) as { n: number }).n;
  }
  const last = runId
    ? (conn.prepare(`SELECT id, started_at AS startedAt, finished_at AS finishedAt,
                            status, total_orgs AS totalOrgs FROM ext_runs WHERE id = ?`)
        .get(runId) as ExternalSummary['lastRun'])
    : null;
  return {
    categoriesCount: cats.n,
    orgsCount,
    duplicatesCount: dupCount,
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

export function getCategoriesOverview(scope: ExtScope = 'district'): CategoryRow[] {
  const runId = resolveRunId(scope);
  if (!runId) return [];
  // orgsCount/рейтинги — только по оргам, попавшим в прогон этого охвата.
  return db()
    .prepare(`
      SELECT
        c.id, c.name, c.search_url AS searchUrl,
        COUNT(s.org_id) AS orgsCount,
        SUM(CASE WHEN o.is_duplicate = 1 AND s.org_id IS NOT NULL THEN 1 ELSE 0 END) AS duplicatesCount,
        AVG(s.rating) AS avgRating,
        SUM(s.reviews_count) AS totalReviews
      FROM ext_categories c
      LEFT JOIN ext_orgs o      ON o.category_id = c.id
      LEFT JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = ? ${geoCond(scope)}
      WHERE c.active = 1
      GROUP BY c.id
      ORDER BY orgsCount DESC, c.name
    `)
    .all(runId) as unknown as CategoryRow[];
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

export function getCategory(categoryId: number, scope: ExtScope = 'district'): { category: CategoryRow | null; orgs: OrgRow[] } {
  const conn = db();
  const runId = resolveRunId(scope);
  const cat = conn
    .prepare(`
      SELECT c.id, c.name, c.search_url AS searchUrl,
             COUNT(s.org_id) AS orgsCount,
             SUM(CASE WHEN o.is_duplicate = 1 AND s.org_id IS NOT NULL THEN 1 ELSE 0 END) AS duplicatesCount,
             AVG(s.rating) AS avgRating,
             SUM(s.reviews_count) AS totalReviews
      FROM ext_categories c
      LEFT JOIN ext_orgs o      ON o.category_id = c.id
      LEFT JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = ? ${geoCond(scope)}
      WHERE c.id = ?
      GROUP BY c.id
    `)
    .get(runId, categoryId) as unknown as CategoryRow | undefined;

  // Только организации, попавшие в прогон выбранного охвата.
  const orgs = conn
    .prepare(`
      SELECT
        o.id, o.name, o.address, o.street,
        o.is_duplicate AS isDuplicate,
        o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt,
        s.rating, s.reviews_count AS reviewsCount,
        s.website, s.phones, s.hours,
        s.longitude, s.latitude
      FROM ext_orgs o
      JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = ? ${geoCond(scope)}
      WHERE o.category_id = ?
      ORDER BY (s.reviews_count IS NULL), s.reviews_count DESC, o.name
    `)
    .all(runId, categoryId) as unknown as OrgRow[];

  return { category: cat ?? null, orgs };
}

export interface OrgHistoryPoint {
  runId: number;
  capturedAt: string;
  rating: number | null;
  reviewsCount: number | null;
}

export function getOrg(orgId: number, scope: ExtScope = 'district'): { org: (OrgRow & { categoryId: number; categoryName: string }) | null; history: OrgHistoryPoint[] } {
  const conn = db();
  const runId = resolveRunId(scope);
  const org = conn
    .prepare(`
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
      LEFT JOIN ext_snapshots s ON s.org_id = o.id AND s.run_id = ?
      WHERE o.id = ?
    `)
    .get(runId, orgId) as unknown as (OrgRow & { categoryId: number; categoryName: string }) | undefined;

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
export function getMapPoints(categoryId?: number, scope: ExtScope = 'district'): MapPoint[] {
  const conn = db();
  const runId = resolveRunId(scope);
  if (!runId) return [];
  const baseSql = `
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
    WHERE s.run_id = ? AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL ${geoCond(scope)}
  `;
  if (categoryId) {
    return conn
      .prepare(baseSql + ' AND o.category_id = ?')
      .all(runId, categoryId) as unknown as MapPoint[];
  }
  return conn.prepare(baseSql).all(runId) as unknown as MapPoint[];
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

function latestRunStarted(scope: ExtScope = 'district'): string | null {
  const id = resolveRunId(scope);
  if (!id) return null;
  const r = db().prepare('SELECT started_at AS startedAt FROM ext_runs WHERE id = ?')
    .get(id) as { startedAt?: string } | undefined;
  return r?.startedAt ?? null;
}

function okRunsCount(scope: ExtScope = 'district'): number {
  const r = db()
    .prepare(`SELECT COUNT(*) AS n FROM ext_runs
              WHERE status = 'ok' AND total_orgs > 0 AND ${scopeSourceSql(scope)}`)
    .get() as { n: number };
  return r.n;
}

export function getNewcomers(categoryId?: number, scope: ExtScope = 'district', limit = 200): NewcomerRow[] {
  // Если в этом охвате только один успешный прогон — «новых» по определению нет.
  if (okRunsCount(scope) < 2) return [];
  const start = latestRunStarted(scope);
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

export function getDropouts(categoryId?: number, scope: ExtScope = 'district', limit = 200): NewcomerRow[] {
  if (okRunsCount(scope) < 2) return [];
  const start = latestRunStarted(scope);
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

export function getDynamicsSummary(scope: ExtScope = 'district'): DynamicsSummary {
  const conn = db();
  const okRuns = okRunsCount(scope);
  const start = latestRunStarted(scope);
  const latest = resolveRunId(scope);
  if (!start || okRuns < 2) {
    return { hasMultipleRuns: false, latestRunId: latest ?? null, newcomersCount: 0, dropoutsCount: 0 };
  }
  const newc = conn.prepare(`SELECT COUNT(*) AS n FROM ext_orgs WHERE first_seen_at >= ?`).get(start) as { n: number };
  const drop = conn.prepare(`SELECT COUNT(*) AS n FROM ext_orgs WHERE last_seen_at < ?`).get(start) as { n: number };
  return {
    hasMultipleRuns: true,
    latestRunId: latest ?? null,
    newcomersCount: newc.n,
    dropoutsCount: drop.n,
  };
}
