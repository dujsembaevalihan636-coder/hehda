import { ru, type Dict } from './ru';

// Сейчас интерфейс только на русском; словари других языков добавляются сюда.
const dictionaries: Record<string, Dict> = { ru };

export const t: Dict = dictionaries.ru;

/** Подстановка {name} в шаблон. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
