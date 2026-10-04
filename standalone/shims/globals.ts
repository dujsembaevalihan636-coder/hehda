// esbuild подставляет эти объекты вместо глобальных process и Buffer из Node.js.
// Переменных окружения в браузере нет: ключей AI и Supabase нет → локальный режим и сид.

export const process = {
  env: {} as Record<string, string | undefined>,
  cwd: () => '/',
};

export const Buffer = {
  from: (s: string) => new TextEncoder().encode(String(s)),
};
