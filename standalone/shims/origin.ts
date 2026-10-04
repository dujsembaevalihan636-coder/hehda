// В HTML-версии у страницы нет своего адреса для гостей: QR и ссылки ведут на локальный запуск.
export const DEMO_ORIGIN = 'http://localhost:3000';

export function pageOrigin(): string {
  return DEMO_ORIGIN;
}
