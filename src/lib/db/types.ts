import type { TableName, TableRows } from '../types';

// Минимальный табличный интерфейс поверх Supabase (PostgREST) и локального хранилища в памяти.

export type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is';
export type Filter = [col: string, op: Op, val: unknown];

export interface SelectOpts {
  filters?: Filter[];
  order?: { col: string; asc?: boolean }[];
  limit?: number;
}

export type Row<T extends TableName> = TableRows[T];
export type Insert<T extends TableName> = Partial<TableRows[T]>;

export interface Db {
  kind: 'supabase' | 'local';
  select<T extends TableName>(table: T, opts?: SelectOpts): Promise<Row<T>[]>;
  insert<T extends TableName>(table: T, rows: Insert<T> | Insert<T>[]): Promise<Row<T>[]>;
  update<T extends TableName>(table: T, patch: Insert<T>, filters: Filter[]): Promise<Row<T>[]>;
  upsert<T extends TableName>(table: T, rows: Insert<T> | Insert<T>[], onConflict: string): Promise<Row<T>[]>;
  remove<T extends TableName>(table: T, filters: Filter[]): Promise<void>;
}

/** Таблицы, изменения которых можно видеть всем (realtime / SSE). */
export const PUBLIC_TABLES: TableName[] = ['zones', 'readings', 'events', 'feedback', 'rooms'];

export interface ChangeEvent<T = Record<string, unknown>> {
  table: TableName;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T | null;
  old: Partial<T> | null;
}

export class DbError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
