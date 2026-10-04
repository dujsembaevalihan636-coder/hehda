import { getLocalDb, PUBLIC_TABLES, type ChangeEvent } from '@/lib/db';

// SSE-поток изменений для локального режима (в режиме Supabase клиенты слушают Supabase Realtime).

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const db = getLocalDb();
  if (!db) return new Response('Realtime идёт через Supabase', { status: 410 });

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const onChange = (ev: ChangeEvent) => {
        if (PUBLIC_TABLES.includes(ev.table)) send(`data: ${JSON.stringify(ev)}\n\n`);
      };
      db.bus.on('change', onChange);
      const ping = setInterval(() => send(': ping\n\n'), 15_000);
      send('retry: 2000\n: hello\n\n');
      cleanup = () => {
        clearInterval(ping);
        db.bus.off('change', onChange);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
