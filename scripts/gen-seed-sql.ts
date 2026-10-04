// Генерирует supabase/seed.sql из src/lib/db/seed.ts (тот же сид, что у локального режима).
// Запуск: npm run gen:seed

import fs from 'node:fs';
import path from 'node:path';

import { seedContent, seedHallTables, seedRooms, seedZones } from '../src/lib/db/seed';

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const lines: string[] = [
  '-- Сгенерировано scripts/gen-seed-sql.ts — не редактировать вручную (npm run gen:seed).',
  '-- Идемпотентно: повторный запуск не дублирует данные.',
  '',
  '-- Зоны: A «Поговорить» 60–65 дБ, B «Фон» 65–72 дБ, C «Движ» 72–80 дБ',
];

for (const z of seedZones()) {
  lines.push(
    `insert into public.zones (id, name, target_min_db, target_max_db, music_volume, tempo, auto_mode, music_ref_db, music_ref_volume) values (${[
      z.id,
      z.name,
      z.target_min_db,
      z.target_max_db,
      z.music_volume,
      z.tempo,
      z.auto_mode,
      z.music_ref_db,
      z.music_ref_volume,
    ]
      .map(q)
      .join(', ')}) on conflict (id) do nothing;`,
  );
}

lines.push('', '-- План зала: 41 стол, 200 мест');
for (const t of seedHallTables()) {
  lines.push(
    `insert into public.hall_tables (table_no, zone_id, seats, x, y, w, h, shape) values (${[
      t.table_no,
      t.zone_id,
      t.seats,
      t.x,
      t.y,
      t.w,
      t.h,
      t.shape,
    ]
      .map(q)
      .join(', ')}) on conflict (table_no) do nothing;`,
  );
}

lines.push('', '-- Комнаты Table Mode для столов 1–12');
for (const r of seedRooms()) {
  lines.push(`insert into public.rooms (table_no, phase, state) values (${r.table_no}, 'idle', '{}'::jsonb) on conflict (table_no) do nothing;`);
}

lines.push('', '-- Библиотека контента: 30 вопросов, 25 миссий, 5 миссий с персоналом');
for (const c of seedContent()) {
  lines.push(
    `insert into public.content_library (id, type, occasion, lang, text, approved, source) values (${[
      c.id,
      c.type,
      c.occasion,
      c.lang,
      c.text,
      c.approved,
      c.source,
    ]
      .map(q)
      .join(', ')}) on conflict (id) do nothing;`,
  );
}

const out = path.resolve(process.cwd(), 'supabase/seed.sql');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`seed.sql: ${lines.length} строк → ${out}`);
