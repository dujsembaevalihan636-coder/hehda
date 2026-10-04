// next/server в браузере: after() — после ответа «сервера», connection() — ничего не ждёт.

export function after(task: () => unknown) {
  setTimeout(() => {
    Promise.resolve()
      .then(task)
      .catch((e) => console.error('[after]', e));
  }, 0);
}

export async function connection() {}
