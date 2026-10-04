// Общие типы строк БД для обоих модулей: «Зал» (акустика) и «Table Mode» (игра).

export type ZoneId = 'A' | 'B' | 'C';
export type Tempo = 'slow' | 'mid' | 'fast';
export type Atmosphere = 'talk' | 'background' | 'lively';
export type FeedbackType = 'too_loud' | 'could_hear_yes' | 'could_hear_no';
export type EventType =
  | 'auto_volume_down'
  | 'auto_volume_up'
  | 'tempo_change'
  | 'alert'
  | 'manual';
export type ControlState = 'ok' | 'loud' | 'quiet';

export interface Zone {
  id: ZoneId;
  name: string;
  target_min_db: number;
  target_max_db: number;
  music_volume: number; // 0..1
  tempo: Tempo;
  auto_mode: boolean;
  // Состояние алгоритма управления (гистерезис, паузы, таймеры)
  control_state: ControlState;
  state_since: string | null;
  above_since: string | null;
  last_change_at: string | null;
  last_tempo_change_at: string | null;
  // Калибровка «пустой зал»: уровень музыки (дБ) при громкости music_ref_volume
  music_ref_db: number | null;
  music_ref_volume: number | null;
  version: number;
  updated_at: string;
}

export interface HallTable {
  table_no: number;
  zone_id: ZoneId;
  seats: number;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'round' | 'rect' | 'bar';
}

export interface Reading {
  id: number;
  zone_id: ZoneId;
  sensor_id: string;
  table_no: number | null;
  db: number;
  created_at: string;
}

export interface Booking {
  id: string;
  guest_name: string;
  party_size: number;
  time: string;
  atmosphere: Atmosphere;
  zone_id: ZoneId;
  table_no: number;
  created_at: string;
}

export interface Feedback {
  id: string;
  zone_id: ZoneId;
  table_no: number | null;
  type: FeedbackType;
  created_at: string;
}

export interface HallEvent {
  id: string;
  zone_id: ZoneId | null;
  type: EventType;
  payload: Record<string, unknown>;
  created_at: string;
}

// ---------- Table Mode ----------

export type Occasion = 'meetup' | 'birthday' | 'reunion' | 'success';
export type EpisodeMode = 'short' | 'full';
export type EpisodeStatus = 'active' | 'finished' | 'abandoned';
export type ContentType = 'question' | 'mission' | 'staff_mission';
export type ContentOccasion = Occasion | 'any';

export interface Company {
  id: string;
  name: string;
  code: string;
  season_name: string;
  created_at: string;
}

export interface Member {
  id: string;
  company_id: string;
  display_name: string;
  total_points: number;
  created_at: string;
}

export interface EpisodePlanItem {
  id: string; // id элемента библиотеки
  text: string;
}

// Серверная часть плана эпизода (секретные миссии) — не уходит клиентам.
export interface EpisodePlan {
  missions: EpisodePlanItem[];
  staffMission: EpisodePlanItem | null;
  decoys: EpisodePlanItem[];
}

export interface Episode {
  id: string;
  company_id: string;
  table_no: number;
  episode_no: number;
  occasion: Occasion;
  mode: EpisodeMode;
  status: EpisodeStatus;
  started_at: string;
  ended_at: string | null;
  summary_text: string | null;
  mvp_member_id: string | null;
  quote_of_night: string | null;
  plan: EpisodePlan | null;
}

export interface Room {
  table_no: number;
  current_episode_id: string | null;
  phase: string;
  state: unknown;
  version: number;
  updated_at: string;
}

export interface Answer {
  id: string;
  episode_id: string;
  member_id: string | null;
  round: number;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Mission {
  id: string;
  episode_id: string;
  member_id: string | null;
  text: string;
  staff: boolean;
  status: 'assigned' | 'done' | 'guessed';
  created_at: string;
}

export interface ContentItem {
  id: string;
  type: ContentType;
  occasion: ContentOccasion;
  lang: string;
  text: string;
  approved: boolean;
  source: 'seed' | 'ai';
  created_at: string;
}

export interface TableRows {
  zones: Zone;
  hall_tables: HallTable;
  readings: Reading;
  bookings: Booking;
  feedback: Feedback;
  events: HallEvent;
  companies: Company;
  members: Member;
  episodes: Episode;
  rooms: Room;
  answers: Answer;
  missions: Mission;
  content_library: ContentItem;
}

export type TableName = keyof TableRows;
