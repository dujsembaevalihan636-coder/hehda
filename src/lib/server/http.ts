import 'server-only';

import { z } from 'zod';

import { DbError } from '../db/types';
import { HttpError } from './hall';

// Обёртка для route handlers: единый формат ошибок { error } и валидация тела через zod.

type Handler<C> = (req: Request, ctx: C) => Promise<unknown>;

export function route<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const data = await fn(req, ctx);
      if (data instanceof Response) return data;
      return Response.json(data ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError) {
        return Response.json({ error: 'Некорректные данные', issues: e.issues.slice(0, 5) }, { status: 400 });
      }
      if (e instanceof DbError) {
        console.error('[db]', e.message);
        return Response.json({ error: 'Ошибка базы данных', detail: e.message }, { status: 500 });
      }
      console.error('[api]', e);
      return Response.json({ error: 'Ошибка сервера' }, { status: 500 });
    }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Ожидался JSON');
  }
  return schema.parse(raw);
}
