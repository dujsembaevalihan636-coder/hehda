// Собирает public/music/manifest.json из файлов в public/music/{slow,mid,fast}.
// Запускается автоматически перед dev и build (npm run music).

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'public/music');
const exts = new Set(['.mp3', '.ogg', '.oga', '.m4a', '.aac', '.wav', '.flac', '.webm', '.opus']);
const manifest = {};

for (const tempo of ['slow', 'mid', 'fast']) {
  const dir = path.join(root, tempo);
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => exts.has(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => `/music/${tempo}/${encodeURIComponent(f)}`);
  } catch {
    /* папки нет — значит синтез */
  }
  manifest[tempo] = files;
}

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((s, a) => s + a.length, 0);
console.log(`music manifest: ${total ? `${total} треков` : 'файлов нет — плеер будет синтезировать эмбиент'}`);
