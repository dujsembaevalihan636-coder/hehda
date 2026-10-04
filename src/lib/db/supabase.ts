import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { TableName } from '../types';
import { DbError, type Db, type Filter, type Insert, type Row, type SelectOpts } from './types';

// Адаптер Supabase (PostgREST). Сервер ходит с service role key — RLS для записи не нужен.

const PK: Record<TableName, string> = {
  zones: 'id',
  hall_tables: 'table_no',
  readings: 'id',
  bookings: 'id',
  feedback: 'id',
  events: 'id',
  companies: 'id',
  members: 'id',
  episodes: 'id',
  rooms: 'table_no',
  answers: 'id',
  missions: 'id',
  content_library: 'id',
};

const PAGE = 1000; // лимит строк PostgREST по умолчанию в Supabase

// Типы конструктора запросов supabase-js слишком сложны для обобщённого адаптера.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QB = any;

function applyFilters(q: QB, filters: Filter[] = []): QB {
  for (const [col, op, val] of filters) {
    switch (op) {
      case 'eq':
        q = q.eq(col, val);
        break;
      case 'neq':
        q = q.neq(col, val);
        break;
      case 'gt':
        q = q.gt(col, val);
        break;
      case 'gte':
        q = q.gte(col, val);
        break;
      case 'lt':
        q = q.lt(col, val);
        break;
      case 'lte':
        q = q.lte(col, val);
        break;
      case 'in':
        q = q.in(col, val as unknown[]);
        break;
      case 'is':
        q = q.is(col, val);
        break;
    }
  }
  return q;
}

function fail(table: string, action: string, error: { message: string; code?: string }): never {
  throw new DbError(`[supabase] ${action} ${table}: ${error.message}`, error.code);
}

export class SupabaseDb implements Db {
  kind = 'supabase' as const;
  private sb: SupabaseClient;

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async select<T extends TableName>(table: T, opts: SelectOpts = {}): Promise<Row<T>[]> {
    const order = opts.order?.length ? opts.order : [{ col: PK[table], asc: true }];
    const build = () => {
      let q: QB = this.sb.from(table).select('*');
      q = applyFilters(q, opts.filters);
      for (const o of order) q = q.order(o.col, { ascending: o.asc !== false });
      return q;
    };
    if (opts.limit !== undefined) {
      const { data, error } = await build().limit(opts.limit);
      if (error) fail(table, 'select', error);
      return (data ?? []) as Row<T>[];
    }
    // Без лимита — постранично, чтобы не упереться в max_rows
    const out: Row<T>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) fail(table, 'select', error);
      out.push(...((data ?? []) as Row<T>[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async insert<T extends TableName>(table: T, rows: Insert<T> | Insert<T>[]): Promise<Row<T>[]> {
    const { data, error } = await this.sb.from(table).insert(rows as never).select();
    if (error) fail(table, 'insert', error);
    return (data ?? []) as Row<T>[];
  }

  async update<T extends TableName>(table: T, patch: Insert<T>, filters: Filter[]): Promise<Row<T>[]> {
    let q: QB = this.sb.from(table).update(patch as never);
    q = applyFilters(q, filters);
    const { data, error } = await q.select();
    if (error) fail(table, 'update', error);
    return (data ?? []) as Row<T>[];
  }

  async upsert<T extends TableName>(table: T, rows: Insert<T> | Insert<T>[], onConflict: string): Promise<Row<T>[]> {
    const { data, error } = await this.sb
      .from(table)
      .upsert(rows as never, { onConflict })
      .select();
    if (error) fail(table, 'upsert', error);
    return (data ?? []) as Row<T>[];
  }

  async remove<T extends TableName>(table: T, filters: Filter[]): Promise<void> {
    let q: QB = this.sb.from(table).delete();
    q = applyFilters(q, filters);
    const { error } = await q;
    if (error) fail(table, 'delete', error);
  }
}
