import 'server-only';

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import type { TableName } from '../types';
import { seedContent, seedHallTables, seedRooms, seedZones } from './seed';
import { DbError, type ChangeEvent, type Db, type Filter, type Insert, type Row, type SelectOpts } from './types';

// Локальное хранилище «как Postgres» в памяти процесса Next.js + JSON-файл на диске.
// Используется, когда Supabase не настроен (локальное демо, зал без интернета, тесты).

type AnyRow = Record<string, unknown>;

interface TableSpec {
  pk: string;
  id?: 'uuid' | 'serial';
  unique?: string[];
  defaults?: (now: string) => AnyRow;
}

const SPECS: Record<TableName, TableSpec> = {
  zones: { pk: 'id' },
  hall_tables: { pk: 'table_no' },
  readings: { pk: 'id', id: 'serial', defaults: (now) => ({ table_no: null, created_at: now }) },
  bookings: { pk: 'id', id: 'uuid', defaults: (now) => ({ created_at: now }) },
  feedback: { pk: 'id', id: 'uuid', defaults: (now) => ({ table_no: null, created_at: now }) },
  events: { pk: 'id', id: 'uuid', defaults: (now) => ({ zone_id: null, payload: {}, created_at: now }) },
  companies: { pk: 'id', id: 'uuid', unique: ['code'], defaults: (now) => ({ created_at: now }) },
  members: { pk: 'id', id: 'uuid', defaults: (now) => ({ total_points: 0, created_at: now }) },
  episodes: {
    pk: 'id',
    id: 'uuid',
    defaults: (now) => ({
      status: 'active',
      started_at: now,
      ended_at: null,
      summary_text: null,
      mvp_member_id: null,
      quote_of_night: null,
      plan: null,
    }),
  },
  rooms: {
    pk: 'table_no',
    defaults: (now) => ({ current_episode_id: null, phase: 'idle', state: {}, version: 0, updated_at: now }),
  },
  answers: { pk: 'id', id: 'uuid', defaults: (now) => ({ member_id: null, payload: {}, created_at: now }) },
  missions: {
    pk: 'id',
    id: 'uuid',
    defaults: (now) => ({ member_id: null, staff: false, status: 'assigned', created_at: now }),
  },
  content_library: {
    pk: 'id',
    id: 'uuid',
    defaults: (now) => ({ lang: 'ru', approved: false, source: 'seed', created_at: now }),
  },
};

const TABLES = Object.keys(SPECS) as TableName[];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function norm(v: unknown): unknown {
  if (typeof v === 'string' && ISO_RE.test(v)) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return v;
}

function cmp(a: unknown, b: unknown): number {
  const x = norm(a) as number | string;
  const y = norm(b) as number | string;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x < y ? -1 : 1;
}

function eqv(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return cmp(a, b) === 0;
}

export function matchFilters(row: AnyRow, filters: Filter[] = []): boolean {
  return filters.every(([col, op, val]) => {
    const v = row[col];
    switch (op) {
      case 'eq':
        return eqv(v, val);
      case 'neq':
        return !eqv(v, val);
      case 'gt':
        return v !== null && v !== undefined && cmp(v, val) > 0;
      case 'gte':
        return v !== null && v !== undefined && cmp(v, val) >= 0;
      case 'lt':
        return v !== null && v !== undefined && cmp(v, val) < 0;
      case 'lte':
        return v !== null && v !== undefined && cmp(v, val) <= 0;
      case 'in':
        return Array.isArray(val) && val.some((x) => eqv(v, x));
      case 'is':
        return val === null ? v === null || v === undefined : v === val;
      default:
        return false;
    }
  });
}

const clone = <T>(v: T): T => structuredClone(v);

interface StoreShape {
  tables: Record<TableName, AnyRow[]>;
  serial: number;
}

class MemoryDb implements Db {
  kind = 'local' as const;
  readonly bus = new EventEmitter();
  private store: StoreShape;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly file: string;

  constructor(file: string) {
    this.bus.setMaxListeners(0);
    this.file = path.resolve(process.cwd(), file);
    this.store = this.load();
  }

  private fresh(): StoreShape {
    const now = new Date().toISOString();
    const tables = Object.fromEntries(TABLES.map((t) => [t, [] as AnyRow[]])) as StoreShape['tables'];
    tables.zones = seedZones(now) as unknown as AnyRow[];
    tables.hall_tables = seedHallTables() as unknown as AnyRow[];
    tables.rooms = seedRooms(now) as unknown as AnyRow[];
    tables.content_library = seedContent(now) as unknown as AnyRow[];
    return { tables, serial: 1 };
  }

  private load(): StoreShape {
    const base = this.fresh();
    try {
      if (!fs.existsSync(this.file)) return base;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreShape>;
      for (const t of TABLES) {
        const rows = raw.tables?.[t];
        if (Array.isArray(rows) && (rows.length || !['zones', 'hall_tables', 'content_library'].includes(t))) {
          base.tables[t] = rows;
        }
      }
      // Новые сид-элементы библиотеки (если файл старый)
      const ids = new Set(base.tables.content_library.map((r) => r.id));
      for (const c of seedContent()) if (!ids.has(c.id)) base.tables.content_library.push(c as unknown as AnyRow);
      // Комнаты 1–12 должны существовать всегда
      const rooms = new Set(base.tables.rooms.map((r) => r.table_no));
      for (const r of seedRooms()) if (!rooms.has(r.table_no)) base.tables.rooms.push(r as unknown as AnyRow);
      base.serial = Math.max(raw.serial ?? 1, ...base.tables.readings.map((r) => Number(r.id) + 1), 1);
    } catch (e) {
      console.warn('[local-db] не удалось прочитать файл, начинаю с сида:', e);
    }
    return base;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const cutoff = Date.now() - 3 * 3600_000;
        const snapshot: StoreShape = {
          serial: this.store.serial,
          tables: {
            ...this.store.tables,
            readings: this.store.tables.readings.filter((r) => Date.parse(String(r.created_at)) >= cutoff),
          },
        };
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(snapshot));
      } catch (e) {
        console.warn('[local-db] не удалось сохранить:', e);
      }
    }, 1000);
  }

  private emit(table: TableName, eventType: ChangeEvent['eventType'], next: AnyRow | null, old: AnyRow | null) {
    const ev: ChangeEvent = { table, eventType, new: next ? clone(next) : null, old: old ? clone(old) : null };
    this.bus.emit('change', ev);
  }

  reset() {
    this.store = this.fresh();
    this.scheduleSave();
  }

  async select<T extends TableName>(table: T, opts: SelectOpts = {}): Promise<Row<T>[]> {
    let rows = this.store.tables[table].filter((r) => matchFilters(r, opts.filters));
    if (opts.order?.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of opts.order!) {
          const c = cmp(a[o.col], b[o.col]);
          if (c !== 0) return o.asc === false ? -c : c;
        }
        return 0;
      });
    }
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return clone(rows) as unknown as Row<T>[];
  }

  async insert<T extends TableName>(table: T, input: Insert<T> | Insert<T>[]): Promise<Row<T>[]> {
    const spec = SPECS[table];
    const list = Array.isArray(input) ? input : [input];
    const now = new Date().toISOString();
    const out: AnyRow[] = [];
    for (const item of list) {
      const row: AnyRow = { ...(spec.defaults?.(now) ?? {}), ...clone(item as AnyRow) };
      if (row[spec.pk] === undefined || row[spec.pk] === null) {
        if (spec.id === 'serial') row[spec.pk] = this.store.serial++;
        else if (spec.id === 'uuid') row[spec.pk] = crypto.randomUUID();
      }
      const all = this.store.tables[table];
      if (all.some((r) => eqv(r[spec.pk], row[spec.pk]))) {
        throw new DbError(`duplicate key ${spec.pk}=${String(row[spec.pk])} in ${table}`, '23505');
      }
      for (const u of spec.unique ?? []) {
        if (all.some((r) => eqv(r[u], row[u]))) throw new DbError(`duplicate key ${u} in ${table}`, '23505');
      }
      all.push(row);
      out.push(row);
      this.emit(table, 'INSERT', row, null);
    }
    this.scheduleSave();
    return clone(out) as unknown as Row<T>[];
  }

  async update<T extends TableName>(table: T, patch: Insert<T>, filters: Filter[]): Promise<Row<T>[]> {
    const out: AnyRow[] = [];
    const all = this.store.tables[table];
    for (let i = 0; i < all.length; i++) {
      if (!matchFilters(all[i], filters)) continue;
      const old = all[i];
      const next = { ...old, ...clone(patch as AnyRow) };
      all[i] = next;
      out.push(next);
      this.emit(table, 'UPDATE', next, old);
    }
    if (out.length) this.scheduleSave();
    return clone(out) as unknown as Row<T>[];
  }

  async upsert<T extends TableName>(table: T, input: Insert<T> | Insert<T>[], onConflict: string): Promise<Row<T>[]> {
    const list = Array.isArray(input) ? input : [input];
    const out: Row<T>[] = [];
    for (const item of list) {
      const key = (item as AnyRow)[onConflict];
      const existing = this.store.tables[table].find((r) => eqv(r[onConflict], key));
      if (existing) out.push(...(await this.update(table, item, [[onConflict, 'eq', key]])));
      else out.push(...(await this.insert(table, item)));
    }
    return out;
  }

  async remove<T extends TableName>(table: T, filters: Filter[]): Promise<void> {
    const all = this.store.tables[table];
    const keep: AnyRow[] = [];
    let removed = 0;
    for (const r of all) {
      if (matchFilters(r, filters)) {
        removed++;
        if (table !== 'readings') this.emit(table, 'DELETE', null, r);
      } else keep.push(r);
    }
    if (removed) {
      this.store.tables[table] = keep;
      this.scheduleSave();
    }
  }
}

const g = globalThis as unknown as { __hallLocalDb?: MemoryDb };

export function getMemoryDb(file: string): MemoryDb {
  if (!g.__hallLocalDb) g.__hallLocalDb = new MemoryDb(file);
  return g.__hallLocalDb;
}

export type { MemoryDb };
