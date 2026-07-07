import { defineEventHandler, getQuery } from 'h3';

async function isUp(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

// Generic health check by port -- ?ports=3000,8080,4001 -- supaya bisa cek
// backend apa saja tanpa daftar nama tetap di kode.
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const raw = String(query.ports ?? '');
  const ports = raw
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);

  const results = await Promise.all(ports.map(async (port) => [port, await isUp(port)] as const));

  return Object.fromEntries(results);
});
