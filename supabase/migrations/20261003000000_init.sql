-- «Зал, где слышно друг друга» + «Table Mode»: общая схема Supabase (Postgres 15+).
-- Запуск: Supabase Dashboard → SQL Editor → вставить этот файл → Run, затем supabase/seed.sql.
-- Или через CLI: supabase db push (файл лежит в supabase/migrations).

create extension if not exists pgcrypto;

-- =====================================================================
-- Зал: акустические зоны, датчики, брони, обратная связь, события
-- =====================================================================

create table if not exists public.zones (
  id                    text primary key check (id in ('A', 'B', 'C')),
  name                  text not null,
  target_min_db         real not null,
  target_max_db         real not null,
  music_volume          real not null default 0.6 check (music_volume between 0 and 1),
  tempo                 text not null default 'mid' check (tempo in ('slow', 'mid', 'fast')),
  auto_mode             boolean not null default true,
  -- состояние алгоритма управления (гистерезис, паузы, таймеры)
  control_state         text not null default 'ok' check (control_state in ('ok', 'loud', 'quiet')),
  state_since           timestamptz,
  above_since           timestamptz,
  last_change_at        timestamptz,
  last_tempo_change_at  timestamptz,
  -- калибровка «пустой зал»: уровень музыки (дБ) при громкости music_ref_volume
  music_ref_db          real,
  music_ref_volume      real,
  version               integer not null default 0,
  updated_at            timestamptz not null default now(),
  check (target_min_db < target_max_db)
);

create table if not exists public.hall_tables (
  table_no  integer primary key,
  zone_id   text not null references public.zones (id),
  seats     integer not null check (seats > 0),
  x         real not null,
  y         real not null,
  w         real not null,
  h         real not null,
  shape     text not null default 'round' check (shape in ('round', 'rect', 'bar'))
);

-- Только числа: звук никогда не записывается и не хранится. Хранение — 24 часа.
create table if not exists public.readings (
  id          bigint generated always as identity primary key,
  zone_id     text not null references public.zones (id),
  sensor_id   text not null,
  table_no    integer,
  db          real not null check (db between 0 and 140),
  created_at  timestamptz not null default now()
);
create index if not exists readings_zone_created_idx on public.readings (zone_id, created_at desc);
create index if not exists readings_created_idx on public.readings (created_at);

create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  guest_name  text not null,
  party_size  integer not null check (party_size between 1 and 20),
  time        timestamptz not null,
  atmosphere  text not null check (atmosphere in ('talk', 'background', 'lively')),
  zone_id     text not null references public.zones (id),
  table_no    integer not null references public.hall_tables (table_no),
  created_at  timestamptz not null default now()
);
create index if not exists bookings_time_idx on public.bookings (time);

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  zone_id     text not null references public.zones (id),
  table_no    integer,
  type        text not null check (type in ('too_loud', 'could_hear_yes', 'could_hear_no')),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_zone_created_idx on public.feedback (zone_id, created_at desc);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  zone_id     text references public.zones (id),
  type        text not null check (type in ('auto_volume_down', 'auto_volume_up', 'tempo_change', 'alert', 'manual')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_created_idx on public.events (created_at desc);

-- =====================================================================
-- Table Mode: компании, сезоны, эпизоды, комнаты столов
-- =====================================================================

create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text not null unique check (code ~ '^[A-Z0-9]{4}$'),
  season_name  text not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  display_name  text not null,
  total_points  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists members_company_idx on public.members (company_id);

create table if not exists public.episodes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  table_no        integer not null,
  episode_no      integer not null default 1,
  occasion        text not null check (occasion in ('meetup', 'birthday', 'reunion', 'success')),
  mode            text not null check (mode in ('short', 'full')),
  status          text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  summary_text    text,
  mvp_member_id   uuid references public.members (id) on delete set null,
  quote_of_night  text,
  plan            jsonb -- секретные миссии эпизода: только для сервера
);
create index if not exists episodes_company_idx on public.episodes (company_id, started_at);
create index if not exists episodes_started_idx on public.episodes (started_at desc);

-- Комната стола: фаза и общее состояние (синхронизируется между телефонами через Realtime).
-- current_episode_id без внешнего ключа: состояние комнаты пишется раньше строки эпизода.
create table if not exists public.rooms (
  table_no            integer primary key,
  current_episode_id  uuid,
  phase               text not null default 'idle',
  state               jsonb not null default '{}'::jsonb,
  version             integer not null default 0,
  updated_at          timestamptz not null default now()
);

create table if not exists public.answers (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null references public.episodes (id) on delete cascade,
  member_id   uuid,
  round       integer not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists answers_episode_idx on public.answers (episode_id);

create table if not exists public.missions (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null references public.episodes (id) on delete cascade,
  member_id   uuid references public.members (id) on delete set null,
  text        text not null,
  staff       boolean not null default false,
  status      text not null default 'assigned' check (status in ('assigned', 'done', 'guessed')),
  created_at  timestamptz not null default now()
);
create index if not exists missions_episode_idx on public.missions (episode_id);

create table if not exists public.content_library (
  id          text primary key default gen_random_uuid()::text,
  type        text not null check (type in ('question', 'mission', 'staff_mission')),
  occasion    text not null default 'any' check (occasion in ('any', 'meetup', 'birthday', 'reunion', 'success')),
  lang        text not null default 'ru',
  text        text not null,
  approved    boolean not null default false,
  source      text not null default 'seed' check (source in ('seed', 'ai')),
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
-- Пишет только сервер (service role обходит RLS). Браузеру (anon) открыто только чтение
-- таблиц, нужных для Realtime. Брони, миссии, ответы, компании и библиотека — закрыты.
-- =====================================================================

alter table public.zones           enable row level security;
alter table public.hall_tables     enable row level security;
alter table public.readings        enable row level security;
alter table public.bookings        enable row level security;
alter table public.feedback        enable row level security;
alter table public.events          enable row level security;
alter table public.companies       enable row level security;
alter table public.members         enable row level security;
alter table public.episodes        enable row level security;
alter table public.rooms           enable row level security;
alter table public.answers         enable row level security;
alter table public.missions        enable row level security;
alter table public.content_library enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['zones', 'hall_tables', 'readings', 'events', 'feedback', 'rooms'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- =====================================================================
-- Realtime: публикация изменений для дашборда, плеера и комнат
-- =====================================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['zones', 'readings', 'events', 'feedback', 'rooms'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =====================================================================
-- Хранение показаний 24 часа
-- =====================================================================

create or replace function public.prune_readings() returns void
language sql
as $$
  delete from public.readings where created_at < now() - interval '24 hours';
$$;

-- Если доступен pg_cron — чистим каждые 15 минут. Иначе чистит приложение (/api/control).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('prune-readings', '*/15 * * * *', 'select public.prune_readings()');
  end if;
exception when others then
  raise notice 'pg_cron недоступен — очистку readings выполняет /api/control';
end $$;
