import ExcelJS from 'exceljs';
import {
  EXCEL_PATH,
  MONTH_KEY,
  MONTH_NAMES_RU,
  COL_MONTHLY,
  COL_DEC,
  PLAN_COL,
  DATA_START_ROW,
  MIN_TENANT_PAYMENT,
} from './config';

export type RoomStatus = 'сдан' | 'не сдан';

export interface Tenant {
  rowNum: number;
  legal: string;      // Юр.Лицо
  trade: string;      // торговое название
  displayName: string;
  floor: string;
  room: string;
  area: number | null;
  rate: number | null;
  status: RoomStatus;
  planVat: number | null;
  planOplat: number | null;
  factVat: number | null;
  factOplat: number | null;
}

export interface MonthTotals {
  sTo: number | null;
  bezTo: number | null;
}

export interface DecReference {
  // key: normalized room code → December 2025 data
  rooms: Map<string, {
    legal: string;
    trade: string;
    status: RoomStatus;
    area: number | null;
    rate: number | null;
    planVat: number | null;    // нормальная договорная ставка на декабрь
    factOplat: number | null;
  }>;
}

export interface LostRevenueItem {
  floor: string;
  room: string;
  lastLegal: string;
  lastTrade: string;
  area: number | null;
  rate: number | null;
  potentialRevenue: number;
  monthsVacant: number[];
}

export interface RentData {
  plan: Record<number, MonthTotals>;          // 1..12
  fact: Record<number, MonthTotals>;
  tenants: Record<number, Tenant[]>;           // паящие
  tenantsAll: Record<number, Tenant[]>;        // все с планом > 0 (для отклонений)
  rented: Record<number, Tenant[]>;            // сдан + платеж
  notRented: Record<number, Tenant[]>;         // не сдан
  lostRevenue: Record<number, LostRevenueItem[]>; // по месяцу
  dec: DecReference;
  updatedAt: string;
  error: string | null;
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in (v as any)) {
    return (v as any).richText.map((r: any) => r.text).join('');
  }
  if (typeof v === 'object' && 'text' in (v as any)) {
    return String((v as any).text);
  }
  if (typeof v === 'object' && 'result' in (v as any)) {
    return cellStr((v as any).result);
  }
  return String(v);
}

function cellNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in (v as any)) {
    return cellNum((v as any).result);
  }
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeRoom(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normStatus(raw: unknown): RoomStatus | null {
  const s = cellStr(raw).trim().toLowerCase();
  if (s === 'сдан') return 'сдан';
  if (s === 'не сдан') return 'не сдан';
  return null;
}

function getRow(ws: ExcelJS.Worksheet, rowIdx0: number): any[] {
  // ExcelJS is 1-based. Returns array of cell values in order.
  const row = ws.getRow(rowIdx0 + 1);
  const out: any[] = [];
  // row.values has a leading undefined at index 0 (1-based). Normalize.
  const vals = row.values as any[];
  for (let i = 1; i < vals.length; i++) out.push(vals[i]);
  return out;
}

function detectMonthSheets(wb: ExcelJS.Workbook): Map<number, string> {
  const result = new Map<number, string>();
  wb.eachSheet((ws) => {
    const name = ws.name.trim().toLowerCase();
    const parts = name.split(/\s+/);
    const key = parts[0];
    if (!(key in MONTH_KEY)) return;
    if (parts.length < 2 || !/^\d+$/.test(parts[1])) return;
    result.set(MONTH_KEY[key], ws.name);
  });
  return result;
}

function findDecSheet(wb: ExcelJS.Workbook): string | null {
  // Sheet "декабрь" (без года) = декабрь 2025
  let found: string | null = null;
  wb.eachSheet((ws) => {
    const name = ws.name.trim().toLowerCase();
    if (name === 'декабрь') found = ws.name;
  });
  return found;
}

function findPlanSheet(wb: ExcelJS.Workbook): string | null {
  let found: string | null = null;
  wb.eachSheet((ws) => {
    if (ws.name.toLowerCase().includes('план') && !found) found = ws.name;
  });
  return found;
}

function parseMonthlySheet(
  ws: ExcelJS.Worksheet,
  monthNum: number,
  COLS: typeof COL_MONTHLY | typeof COL_DEC,
): { tenants: Tenant[]; totals: MonthTotals } {
  // Totals: row 7 (idx 6) = Аренда в т.ч. ТО, row 8 (idx 7) = без ТО
  // for monthly 2026 (col 24). For decembre — col 26.
  const totalRow7 = getRow(ws, 6);
  const totalRow8 = getRow(ws, 7);
  const factCol = COLS.FACT_OPLAT;
  const totals: MonthTotals = {
    sTo:   cellNum(totalRow7[factCol]),
    bezTo: cellNum(totalRow8[factCol]),
  };

  const tenants: Tenant[] = [];
  const lastRow = ws.rowCount;
  for (let r = DATA_START_ROW; r < lastRow; r++) {
    const row = getRow(ws, r);
    if (row.length === 0) continue;
    const status = normStatus(row[COLS.STATUS]);
    if (!status) continue; // skip итоговые строки

    const legal = cellStr(row[COLS.LEGAL]).trim();
    const trade = cellStr(row[COLS.TRADE]).trim();
    const room  = cellStr(row[COLS.ROOM]).trim();
    const floor = cellStr(row[COLS.FLOOR]).trim();

    const displayName = legal || trade || room || `row ${r + 1}`;

    tenants.push({
      rowNum: r + 1,
      legal,
      trade,
      displayName,
      floor,
      room,
      area:      cellNum(row[COLS.AREA]),
      rate:      cellNum(row[COLS.RATE]),
      status,
      planVat:   cellNum(row[COLS.PLAN_VAT]),
      planOplat: cellNum(row[COLS.PLAN_OPLAT]),
      factVat:   cellNum(row[COLS.FACT_VAT]),
      factOplat: cellNum(row[COLS.FACT_OPLAT]),
    });
  }

  return { tenants, totals };
}

function buildDecReference(tenants: Tenant[]): DecReference {
  const rooms = new Map<string, any>();
  for (const t of tenants) {
    if (!t.room) continue;
    const key = normalizeRoom(t.room);
    rooms.set(key, {
      legal: t.legal,
      trade: t.trade,
      status: t.status,
      area: t.area,
      rate: t.rate,
      planVat: t.planVat,
      factOplat: t.factOplat,
    });
  }
  return { rooms };
}

function computeLostRevenue(
  notRentedByMonth: Record<number, Tenant[]>,
  dec: DecReference,
): Record<number, LostRevenueItem[]> {
  const result: Record<number, LostRevenueItem[]> = {};
  // Группировка по помещению (агрегируем пустые месяцы подряд)
  const byRoom = new Map<string, { floor: string; room: string; months: number[]; sample: Tenant }>();
  for (const [m, list] of Object.entries(notRentedByMonth)) {
    const mNum = Number(m);
    for (const t of list) {
      if (!t.room) continue;
      const key = normalizeRoom(t.room);
      if (!byRoom.has(key)) byRoom.set(key, { floor: t.floor, room: t.room, months: [], sample: t });
      byRoom.get(key)!.months.push(mNum);
    }
  }

  for (const [m, list] of Object.entries(notRentedByMonth)) {
    const mNum = Number(m);
    const items: LostRevenueItem[] = [];
    for (const t of list) {
      if (!t.room) continue;
      const key = normalizeRoom(t.room);
      const decInfo = dec.rooms.get(key);
      // Считаем потерянную выгоду только если в декабре 2025 помещение было сдано
      if (!decInfo || decInfo.status !== 'сдан') continue;
      const potential = decInfo.planVat ?? 0;
      if (potential <= 0) continue;

      const agg = byRoom.get(key);
      items.push({
        floor: t.floor,
        room:  t.room,
        lastLegal: decInfo.legal,
        lastTrade: decInfo.trade,
        area:  t.area ?? decInfo.area,
        rate:  t.rate ?? decInfo.rate,
        potentialRevenue: potential,
        monthsVacant: agg?.months.sort((a, b) => a - b) ?? [mNum],
      });
    }
    items.sort((a, b) => b.potentialRevenue - a.potentialRevenue);
    result[mNum] = items;
  }

  return result;
}

// ── In-memory cache ────────────────────────────────────────────────────────
let _cache: { data: RentData | null; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function getRentData(force = false): Promise<RentData> {
  const now = Date.now();
  if (!force && _cache.data && now - _cache.ts < CACHE_TTL) return _cache.data;

  const data = await parseExcel();
  _cache = { data, ts: now };
  return data;
}

async function parseExcel(): Promise<RentData> {
  const empty: RentData = {
    plan: {}, fact: {}, tenants: {}, tenantsAll: {},
    rented: {}, notRented: {}, lostRevenue: {},
    dec: { rooms: new Map() },
    updatedAt: new Date().toISOString(),
    error: null,
  };

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(EXCEL_PATH);

    // Plan sheet
    const planSheetName = findPlanSheet(wb);
    if (planSheetName) {
      const ws = wb.getWorksheet(planSheetName)!;
      const row9  = getRow(ws, 8);
      const row10 = getRow(ws, 9);
      for (const [m, colIdx] of Object.entries(PLAN_COL)) {
        const mNum = Number(m);
        empty.plan[mNum] = {
          sTo:   cellNum(row9[colIdx]),
          bezTo: cellNum(row10[colIdx]),
        };
      }
    }

    // Monthly sheets 2026
    const monthSheets = detectMonthSheets(wb);
    for (const [mNum, sheetName] of monthSheets) {
      const ws = wb.getWorksheet(sheetName)!;
      const { tenants, totals } = parseMonthlySheet(ws, mNum, COL_MONTHLY);
      empty.fact[mNum] = totals;
      empty.tenants[mNum] = tenants.filter(
        t => t.factOplat != null && t.factOplat >= MIN_TENANT_PAYMENT,
      );
      empty.tenantsAll[mNum] = tenants.filter(
        t => t.planVat != null && t.planVat > 0,
      );
      empty.rented[mNum] = tenants.filter(t => t.status === 'сдан');
      empty.notRented[mNum] = tenants.filter(t => t.status === 'не сдан');
    }

    // December 2025 reference
    const decName = findDecSheet(wb);
    if (decName) {
      const ws = wb.getWorksheet(decName)!;
      const { tenants } = parseMonthlySheet(ws, 12, COL_DEC);
      empty.dec = buildDecReference(tenants);
    }

    empty.lostRevenue = computeLostRevenue(empty.notRented, empty.dec);
    empty.updatedAt = new Date().toISOString();
    return empty;
  } catch (e: any) {
    empty.error = e?.message ?? String(e);
    return empty;
  }
}

export { MONTH_NAMES_RU };
