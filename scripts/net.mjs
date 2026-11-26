// Helper jaringan: Binance (publik, tanpa kunci), GitHub raw, dan riwayat dari deploy Pages sebelumnya.
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

export async function bj(path) {
  let err;
  for (const h of HOSTS) {
    try {
      const r = await fetch(h + '/api/v3/' + path, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (x) { err = x; }
  }
  throw err;
}

export const kl = async (sym, iv, n) =>
  (await bj(`klines?symbol=${sym}&interval=${iv}&limit=${n}`)).map(a => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] }));

export async function http(url, headers = {}, timeout = 25000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'msc-monitor', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/\/\/[^@/]*@/, '//')}`);
  return res.text();
}

// Riwayat (laporan harian, status pasar, keputusan) disimpan di deploy Pages sebelumnya.
// 404 = belum ada (deploy pertama). Galat lain = build DIHENTIKAN agar riwayat tidak terhapus diam-diam.
export async function loadPrev(base, name, fallback) {
  if (!base) return fallback;
  const r = await fetch(`${String(base).replace(/\/$/, '')}/data/${name}?cb=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (r.ok) return r.json();
  if (r.status === 404) return fallback;
  throw new Error(`${name} HTTP ${r.status}: build dihentikan agar riwayat tidak hilang`);
}
