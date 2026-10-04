// node:fs для локальной базы: «файл» — запись в localStorage этого браузера.
// Хранилище может быть недоступно (приватный режим, превью) — тогда база живёт в памяти вкладки.

const PREFIX = 'hehda:file:';

function read(file: string): string | null {
  try {
    return localStorage.getItem(PREFIX + file);
  } catch {
    return null;
  }
}

export function existsSync(file: string) {
  return read(file) !== null;
}

export function readFileSync(file: string) {
  const v = read(file);
  if (v === null) throw new Error(`ENOENT: ${file}`);
  return v;
}

export function writeFileSync(file: string, data: string) {
  try {
    localStorage.setItem(PREFIX + file, data);
  } catch {
    // Квота кончилась — не оставляем устаревший снимок
    try {
      localStorage.removeItem(PREFIX + file);
    } catch {
      /* хранилище недоступно */
    }
  }
}

export function removeFile(file: string) {
  try {
    localStorage.removeItem(PREFIX + file);
  } catch {
    /* хранилище недоступно */
  }
}

export function mkdirSync() {}

const fs = { existsSync, readFileSync, writeFileSync, mkdirSync };
export default fs;
