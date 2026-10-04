import * as adminContent from '@/app/api/admin/content/route';
import * as adminLogin from '@/app/api/admin/login/route';
import * as adminOverview from '@/app/api/admin/overview/route';
import * as adminRooms from '@/app/api/admin/rooms/route';
import * as bookings from '@/app/api/bookings/route';
import * as control from '@/app/api/control/route';
import * as demo from '@/app/api/demo/route';
import * as events from '@/app/api/events/route';
import * as feedback from '@/app/api/feedback/route';
import * as generate from '@/app/api/generate/route';
import * as hallPublic from '@/app/api/hall/public/route';
import * as hall from '@/app/api/hall/route';
import * as health from '@/app/api/health/route';
import * as metrics from '@/app/api/metrics/route';
import * as readings from '@/app/api/readings/route';
import * as roomMission from '@/app/api/room/[table]/mission/route';
import * as room from '@/app/api/room/[table]/route';
import * as zonesCalibrate from '@/app/api/zones/calibrate/route';
import * as zones from '@/app/api/zones/route';

// Те же route handlers, что в Next.js, только вызываются из fetch-перехватчика в этой вкладке.
// /api/realtime не нужен: изменения базы приходят через локальный EventSource (runtime.ts).

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Partial<Record<Method, Handler>>;

const mod = (m: object) => m as RouteModule;

// [шаблон пути, модуль, имена параметров по группам шаблона]
const ROUTES: [RegExp, RouteModule, string[]?][] = [
  [/^\/api\/room\/([^/]+)\/mission$/, mod(roomMission), ['table']],
  [/^\/api\/room\/([^/]+)$/, mod(room), ['table']],
  [/^\/api\/admin\/content$/, mod(adminContent)],
  [/^\/api\/admin\/login$/, mod(adminLogin)],
  [/^\/api\/admin\/overview$/, mod(adminOverview)],
  [/^\/api\/admin\/rooms$/, mod(adminRooms)],
  [/^\/api\/bookings$/, mod(bookings)],
  [/^\/api\/control$/, mod(control)],
  [/^\/api\/demo$/, mod(demo)],
  [/^\/api\/events$/, mod(events)],
  [/^\/api\/feedback$/, mod(feedback)],
  [/^\/api\/generate$/, mod(generate)],
  [/^\/api\/hall\/public$/, mod(hallPublic)],
  [/^\/api\/hall$/, mod(hall)],
  [/^\/api\/health$/, mod(health)],
  [/^\/api\/metrics$/, mod(metrics)],
  [/^\/api\/readings$/, mod(readings)],
  [/^\/api\/zones\/calibrate$/, mod(zonesCalibrate)],
  [/^\/api\/zones$/, mod(zones)],
];

export async function handleApi(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  for (const [pattern, routeModule, names = []] of ROUTES) {
    const m = pattern.exec(pathname);
    if (!m) continue;
    const handler = routeModule[req.method.toUpperCase() as Method];
    if (!handler) return Response.json({ error: 'Метод не поддерживается' }, { status: 405 });
    const params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
    return handler(req, { params: Promise.resolve(params) });
  }
  return Response.json({ error: 'Нет такого API' }, { status: 404 });
}
