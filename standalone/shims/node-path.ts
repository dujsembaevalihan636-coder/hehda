// node:path для файла локальной базы: пути — просто ключи в localStorage.

export function resolve(...parts: string[]) {
  return ('/' + parts.filter(Boolean).join('/')).replace(/\/+/g, '/');
}

export function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '/';
}

const path = { resolve, dirname };
export default path;
