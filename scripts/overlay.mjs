// Lapisan keputusan monitor (TIDAK mengubah mesin). Semua ambang = HIPOTESIS di config/monitor.json, diuji lewat audit.
// Diadaptasi dari overlay.mjs monitortn (swing, TF 4H/12H) menjadi versi scalping (TF 15m, jendela event FOMC/CPI).
import { bj, kl } from './net.mjs';
import { sessionOf } from '../site/quality.mjs';
import { activeWindow } from '../site/events.mjs';

const DAY = 864e5;
const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'EUR', 'USD1', 'PYUSD', 'USDE', 'BUSD', 'USDS', 'USDT']);
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f2 = (x, d = 2) => (x == null ? '–' : (+x).toFixed(d));

// Volume altcoin: tiap koin = rata-rata 7 hari terakhir / MEDIAN 60 hari sebelumnya; lalu median lintas 30 koin teratas.
async function breadth(P) {
  const t = (await bj('ticker/24hr')).filter(x => x.symbol.endsWith('USDT') && !STABLE.has(x.symbol.slice(0, -4))).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 30), rs = [];
  for (let i = 0; i < t.length; i += 6) await Promise.all(t.slice(i, i + 6).map(async x => {
    try {
      const k = (await kl(x.symbol, '1d', 67)).slice(0, -1), qv = k.map(q => q.v * q.c), base = med(qv.slice(0, -7)), l7 = mean(qv.slice(-7));
      if (base > 0) rs.push(l7 / base);
    } catch { /* koin dilewati */ }
  }));
  return { n: rs.length, med: rs.length >= P.minKoin ? med(rs) : null };
}

// Kondisi pasar untuk scalping: volume altcoin, volatilitas 1 jam BTC, dan mode range/trend (efficiency ratio 15m, info saja).
export async function marketRegime(M, now = Date.now()) {
  const P = M.pasar;
  const h1 = (await kl('BTCUSDT', '1h', 60)).slice(0, -1), m15 = (await kl('BTCUSDT', '15m', 60)).slice(0, -1);
  const px = h1.at(-1).c, tr = h1.slice(-14).map((q, i, a) => Math.max(q.h - q.l, i ? Math.abs(q.h - a[i - 1].c) : 0));
  const atr1h = mean(tr) / px * 100;
  const c = m15.slice(-48).map(q => q.c), path = c.slice(1).reduce((s, x, i) => s + Math.abs(x - c[i]), 0);
  const er = path > 0 ? Math.abs(c.at(-1) - c[0]) / path : null;
  const br = await breadth(P), fl = [];
  if (br.med != null && br.med < P.volRendah) fl.push(`volume altcoin rendah (median 7 hari = ${f2(br.med)}x median 60 hari, ${br.n} koin): order book tipis, stop scalping mudah tersapu`);
  if (atr1h < P.atr1hMin) fl.push(`volatilitas 1 jam BTC rendah (ATR14 ${f2(atr1h)}%): jarak stop scalping habis dimakan biaya`);
  if (atr1h > P.atr1hMax) fl.push(`volatilitas 1 jam BTC ekstrem (ATR14 ${f2(atr1h)}%): jangan kejar harga, tunggu reda`);
  const status = fl.length >= 2 ? 'TIDAK TRADING' : fl.length === 1 ? 'SELEKTIF' : 'NORMAL';
  const mode = er == null ? null : er < P.erRange ? 'RANGE' : er > P.erTrend ? 'TREND' : 'CAMPUR';
  return { status, flags: fl, volRatio: br.med, volN: br.n, atr1h, er, mode, sesi: sessionOf(now), btc: px };
}

// Semua harga sekaligus (satu panggilan).
export async function allPrices() {
  const o = {}; for (const x of await bj('ticker/price')) o[x.symbol] = +x.price; return o;
}

// Konfirmasi sinyal menunggu pada TF 15m (versi scalping dari konfirmasi 4H/12H monitortn).
async function confirm(s, P, cache) {
  const k = (cache[s.pair] ??= (await kl(s.pair, '15m', 40)).slice(0, -1));
  if (k.length < 10) return ['-', 'data 15m kurang'];
  const long = s.side === 'long', c = k.at(-1).c, tol = P.retestTolPct / 100;
  if (long ? c < s.stop : c > s.stop) return ['BATAL', 'close 15m melewati SL'];
  const held = k.slice(-P.candles).some(q => long ? q.l <= s.entry * (1 + tol) && q.c > s.entry : q.h >= s.entry * (1 - tol) && q.c < s.entry);
  const onSide = long ? c > s.entry : c < s.entry;
  if (onSide) return held ? ['SIAP', 'retest di entry tertahan (close 15m)'] : ['TUNGGU', 'di sisi benar, belum ada retest di entry'];
  return ['TUNGGU', `tunggu close 15m ${long ? 'di atas' : 'di bawah'} entry`];
}

// Keputusan untuk setiap sinyal terbuka. `rank` = nomor urut sinyal pada hari itu per mesin (batas harian uji).
export async function decide(open, { M, regime, prices, events, now, rank, offline = false }) {
  const P = M.pending, cache = {}, rows = [];
  for (const s of open) {
    const px = prices[s.pair] ?? null, dist = px && s.entry ? (px - s.entry) / s.entry * 100 : null, age = (now - Date.parse(s.ts)) / 36e5;
    let kp = '-', kn = '';
    if (s.phase === 'running') {
      const toSL = px ? Math.abs(px - s.stop) / px * 100 : null, toTP = px && s.tp ? Math.abs(s.tp - px) / px * 100 : null;
      kp = 'BERJALAN'; kn = px ? `harga ${f2(toSL)}% dari SL${toTP != null ? `, ${f2(toTP)}% dari TP` : ''}` : 'harga tidak terbaca';
    } else if (offline) {
      kn = 'mode demo/offline: konfirmasi pasar tidak diambil';
    } else {
      try {
        const c = await confirm(s, P, cache); kp = c[0]; kn = c[1];
        if (kp !== 'BATAL') {
          const ev = activeWindow(events, now, M.event.sebelumJam, M.event.sesudahJam);
          if (age > P.maxUmurJam) { kp = 'BASI'; kn = `sinyal ${f2(age, 0)} jam: setup scalping cepat basi`; }
          else if (regime?.status === 'TIDAK TRADING') { kp = 'HINDARI'; kn = 'pasar tanpa volume/volatilitas layak'; }
          else if (ev) { kp = 'HINDARI'; kn = `jendela event ${ev.type} (${ev.name}): tunggu rilis selesai`; }
          else if (kp === 'SIAP' && dist != null && Math.abs(dist) > P.maxJarakPct) { kp = 'TUNGGU'; kn = `harga >${P.maxJarakPct}% dari entry`; }
        }
      } catch { kn = 'konfirmasi gagal diambil'; }
    }
    const rk = rank.get(s) ?? null;
    if (rk != null && rk > M.dailyCap) { kn = `sinyal ke-${rk} pada hari itu (batas uji ${M.dailyCap}); hanya diuji. ${kn}`; kp = kp === 'BERJALAN' ? kp : 'LEWAT BATAS'; }
    rows.push({ e: s.engine, id: s.id, sym: s.symbol, pair: s.pair, side: s.side, entry: s.entry, sl: s.stop, tp: s.tp, px, dist, ts: s.ts, phase: s.phase, kp, kn, rk });
  }
  return rows;
}

// Tag ringan dari teks @eliz883 (untuk dicocokkan, BUKAN pemicu keputusan)
export function tagEliz(t) {
  const s = String(t).toLowerCase(), tg = [];
  if (/volume/.test(s) && /(low|little|rendah|thin|weak|lack|pointless|without)/.test(s)) tg.push('volume_rendah');
  if (/order ?books?/.test(s) && /(empty|thin|shallow)/.test(s)) tg.push('orderbook_tipis');
  if (/choppy|mess|pointless|no clear|unreliable|sideways|range-bound|directionless|no direction/.test(s)) tg.push('choppy');
  return tg;
}

// Audit: keputusan dicatat saat sinyal pertama kali terlihat (tanpa backfill), lalu dibandingkan dengan hasil akhirnya.
export function updateAudit(prevDecisions, rows, sigsById, today, costFn) {
  const seen = new Map(prevDecisions.map(d => [d.k, d]));
  for (const r of rows) {
    const k = `${r.e}|${r.id}`;
    if (r.kp !== '-' && !seen.has(k)) seen.set(k, { k, t: new Date().toISOString(), kp: r.kp, bf: String(r.ts).slice(0, 10) < today });
  }
  const dec = [...seen.values()].slice(-3000), G = {};
  for (const d of dec) {
    const s = sigsById.get(d.k);
    if (d.bf || !s || s.state !== 'closed' || s.r == null) continue;
    const g = d.kp === 'SIAP' ? 'SIAP' : d.kp === 'LEWAT BATAS' ? 'LEWAT BATAS' : 'LAINNYA', x = G[g] ??= { n: 0, tp: 0, r: 0 }, r = costFn(s);
    x.n++; if (r > .05) x.tp++; x.r += r;
  }
  return {
    decisions: dec,
    audit: { catatan: 'Keputusan dicatat saat sinyal pertama kali terlihat (tanpa backfill). Baca hanya bila tiap grup ≥ 30.', total: dec.length, grup: Object.entries(G).map(([g, x]) => ({ g, n: x.n, tp: x.tp, r: x.r / x.n })) },
  };
}
