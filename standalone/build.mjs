// Сборка HTML-версии: всё приложение (страницы, route handlers, локальная база) в одном HTML-файле.
//   node standalone/build.mjs  →  standalone/dist/hehda.html     — открыть двойным кликом в браузере
//                                 standalone/dist/artifact.html  — страница для превью claude.ai (без <html>/<head>)

import tailwind from '@tailwindcss/postcss';
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const shim = (file) => path.join(here, 'shims', file);

const TITLE = 'Зал, где слышно друг друга';

// Пакеты и модули Node/Next.js → браузерные заменители
const PACKAGES = {
  'next/link': shim('next-link.tsx'),
  'next/navigation': shim('next-navigation.ts'),
  'next/server': shim('next-server.ts'),
  'next/headers': shim('next-headers.ts'),
  'node:crypto': shim('node-crypto.ts'),
  'node:events': shim('node-events.ts'),
  'node:fs': shim('node-fs.ts'),
  'node:path': shim('node-path.ts'),
  'server-only': shim('empty.ts'),
  '@anthropic-ai/sdk': shim('anthropic.ts'),
  '@anthropic-ai/sdk/helpers/zod': shim('anthropic.ts'),
  '@anthropic-ai/sdk/helpers/beta/zod': shim('anthropic.ts'),
  '@supabase/supabase-js': shim('supabase.ts'),
};

// Файлы приложения, у которых в HTML-версии своя реализация
const FILES = {
  'src/lib/client/origin.ts': shim('origin.ts'),
  'src/components/game/PhoneScreen.tsx': shim('phone-screen.tsx'),
  'node_modules/zod/v4/locales/index.js': shim('zod-locales.ts'),
};

const swapPlugin = {
  name: 'html-swaps',
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.swapped) return undefined;
      if (PACKAGES[args.path]) return { path: PACKAGES[args.path] };
      if (!args.path.startsWith('.') && !args.path.startsWith('@/')) return undefined;
      const r = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: { swapped: true },
      });
      if (r.errors.length) return undefined;
      const swap = FILES[path.relative(root, r.path).split(path.sep).join('/')];
      return swap ? { path: swap } : { path: r.path };
    });
  },
};

async function buildJs() {
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2022', 'chrome111', 'safari16.4', 'firefox115'],
    minify: true,
    legalComments: 'none',
    jsx: 'automatic',
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    inject: [shim('globals.ts')],
    loader: { '.css': 'empty' },
    plugins: [swapPlugin],
    logLevel: 'warning',
    metafile: true,
  });
  const js = result.outputFiles[0].text;
  // Внутри <script> нельзя встретить «</script» — экранируем (в JS «<\/» означает то же самое)
  return { js: js.replace(/<\/script/gi, '<\\/script'), metafile: result.metafile };
}

async function buildCss() {
  const from = path.join(here, 'styles.css');
  const out = await postcss([tailwind({ base: root, optimize: { minify: true } })]).process(await readFile(from, 'utf8'), { from });
  return out.css.replace(/<\/style/gi, '<\\/style');
}

function page(css, js, mode) {
  return [
    `<title>${TITLE}</title>`,
    `<style>${css}</style>`,
    '<div id="root"></div>',
    `<script>window.__HEHDA_HTML__=${JSON.stringify(mode)}</script>`,
    `<script>${js}</script>`,
  ].join('\n');
}

const [{ js, metafile }, css] = await Promise.all([buildJs(), buildCss()]);
await mkdir(dist, { recursive: true });

const artifact = page(css, js, 'artifact');
const file = [
  '<!doctype html>',
  '<html lang="ru">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="theme-color" content="#110d0b">',
  '</head>',
  '<body class="antialiased">',
  page(css, js, 'file'),
  '</body>',
  '</html>',
].join('\n');

await writeFile(path.join(dist, 'artifact.html'), artifact);
await writeFile(path.join(dist, 'hehda.html'), file);
await writeFile(path.join(dist, 'meta.json'), JSON.stringify(metafile));

const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} КБ`;
console.log(`HTML-версия: ${path.relative(root, path.join(dist, 'hehda.html'))} (${kb(file)}; JS ${kb(js)}, CSS ${kb(css)})`);
