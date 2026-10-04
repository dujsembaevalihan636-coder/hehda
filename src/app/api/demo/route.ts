import { z } from 'zod';

import { getDb } from '@/lib/db';
import { seedZones } from '@/lib/db/seed';
import { HALL_TABLES } from '@/lib/hall-layout';
import { body, route } from '@/lib/server/http';

// Служебные действия для питча: «волна броней через 20 минут» и сброс зала.

const Action = z.object({ action: z.enum(['forecast', 'reset_hall']) });

export const POST = route(async (req) => {
  const { action } = await body(req, Action);
  const db = getDb();
  const now = Date.now();

  if (action === 'forecast') {
    const at = new Date(now + 20 * 60_000).toISOString();
    const tables = HALL_TABLES.filter((t) => t.zone_id === 'A' && t.seats >= 6).slice(0, 3);
    const rows = tables.map((t, i) => ({
      guest_name: `Демо: компания ${i + 1}`,
      party_size: 6,
      time: at,
      atmosphere: 'talk' as const,
      zone_id: 'A' as const,
      table_no: t.table_no,
    }));
    await db.insert('bookings', rows);
    return { ok: true, guests: rows.reduce((s, r) => s + r.party_size, 0), at };
  }

  // reset_hall: громкость/темп/состояния к исходным, калибровка и цели сохраняются
  const zones = await db.select('zones');
  for (const seed of seedZones()) {
    const cur = zones.find((z) => z.id === seed.id);
    await db.update(
      'zones',
      {
        music_volume: seed.music_volume,
        tempo: seed.tempo,
        auto_mode: true,
        control_state: 'ok',
        state_since: null,
        above_since: null,
        last_change_at: null,
        last_tempo_change_at: null,
        version: (cur?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
      [['id', 'eq', seed.id]],
    );
  }
  const old = new Date(now + 60_000).toISOString();
  await Promise.all([
    db.remove('events', [['created_at', 'lt', old]]),
    db.remove('readings', [['created_at', 'lt', old]]),
    db.remove('feedback', [['created_at', 'lt', old]]),
    db.remove('bookings', [['guest_name', 'in', ['Демо: компания 1', 'Демо: компания 2', 'Демо: компания 3']]]),
  ]);
  return { ok: true };
});
