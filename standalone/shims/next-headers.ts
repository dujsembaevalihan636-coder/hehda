// Cookies «сервера» в браузере: только cookie админки, хранится в localStorage этой вкладки.

const KEY = 'hehda:cookies';

function load(): [string, string][] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as [string, string][]) : [];
  } catch {
    return [];
  }
}

const jar = new Map<string, string>(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...jar]));
  } catch {
    /* без хранилища cookie живёт до перезагрузки */
  }
}

export async function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
      save();
    },
    delete: (name: string) => {
      jar.delete(name);
      save();
    },
  };
}

export function clearCookies() {
  jar.clear();
  save();
}
