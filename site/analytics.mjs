// Analitik murni (tanpa DOM) yang dipakai browser dan Node.
// Diadaptasi dari monitortn (swing): R bersih setelah biaya, lapisan uji ala Van Tharp, level unik,
// syarat layak uang sungguhan, uji batas harian & akhir pekan. Semua ambang = HIPOTESIS, bukan fakta.

export const fin = s => s.state === 'closed' && s.r != null;

// R bersih setelah biaya pulang-pergi (persen dari harga). Biaya dalam R = costPct / stopPct.
// Mesin yang sudah mencatat R bersih (rNet) tidak dipotong lagi agar biaya tidak dihitung dua kali.
export const netR = (s, costPct = 0) => (s.r == null ? null : (s.rNet || !(s.stopPct > 0) ? s.r : s.r - costPct / s.stopPct));

const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : null);
const stdev = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };
const tsOf = s => (Number.isFinite(s.t) ? s.t : Date.parse(s.ts));
const exitOf = s => Date.parse(s.exitTs || s.ts);

export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

export function isoWeek(ms) {
  const d = new Date(ms), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return t.getUTCFullYear() + '-' + String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0');
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- ringkasan dasar (R bersih) ----------
export function summarize(list, costPct = 0, noise = .05) {
  const f = list.filter(fin), n = f.map(s => netR(s, costPct));
  const tp = n.filter(x => x > noise).length, sl = n.filter(x => x < -noise).length;
  const gp = sum(n.filter(x => x > 0)), gl = -sum(n.filter(x => x < 0));
  const wk = new Set(f.map(s => isoWeek(exitOf(s)))), days = new Set(list.map(s => String(s.ts).slice(0, 10)));
  let ci = null;
  if (wk.size >= 6) { // bootstrap per minggu (deterministik) agar hasil build stabil
    const g = {}; f.forEach((s, i) => (g[isoWeek(exitOf(s))] ??= []).push(n[i]));
    const v = Object.values(g), r = rng(20261126), b = [];
    for (let i = 0; i < 2000; i++) { let a = 0, c = 0; for (let j = 0; j < v.length; j++) { const x = v[Math.floor(r() * v.length)]; a += sum(x); c += x.length; } b.push(a / c); }
    b.sort((x, y) => x - y); ci = [b[50], b[1950]];
  }
  return {
    sinyal: list.length, selesai: f.length, tp, sl, be: f.length - tp - sl,
    tidakIsi: list.filter(s => s.state === 'void').length, terbuka: list.filter(s => s.state === 'open').length,
    win: f.length ? tp / f.length : null, winCI: wilson(tp, f.length),
    exp: f.length ? mean(n) : null, total: sum(n), pf: gl > 0 ? gp / gl : null,
    minggu: wk.size, hari: days.size, sinyalPerHari: days.size ? list.length / days.size : 0, ci,
  };
}

export function bySide(list, costPct) {
  const o = {}; for (const k of ['long', 'short']) o[k] = summarize(list.filter(s => s.side === k), costPct); return o;
}

// ---------- lapisan uji ala Van Tharp ----------
export function tharp(list, costPct = 0) {
  const f = list.filter(fin), n = f.length;
  if (n < 2) return { ok: false, n };
  const nr = f.map(s => netR(s, costPct)), m = mean(nr), sd = stdev(nr);
  const sqn = sd > 0 ? Math.sqrt(n) * m / sd : null, sqn100 = sd > 0 ? Math.sqrt(Math.min(n, 100)) * m / sd : null;
  const cls = sqn == null ? '–' : sqn < 1.6 ? 'buruk' : sqn < 2 ? 'di bawah rata-rata' : sqn < 2.5 ? 'rata-rata' : sqn < 3 ? 'bagus' : 'sangat bagus';
  // sensitivitas biaya: hanya baris yang R-nya mentah (bukan rNet) dan punya stop
  const gross = f.filter(s => !s.rNet && s.stopPct > 0);
  let be = null, biaya = null;
  if (gross.length >= 2) {
    const g = gross.map(s => s.r), inv = gross.map(s => 100 / s.stopPct);
    be = mean(g) / mean(inv) * 100;
    biaya = [0, .05, .1, .2, .3, .5].map(c => ({ c, r: mean(gross.map(s => s.r - c / s.stopPct)) }));
  }
  const edges = [['≤ -1,1', x => x <= -1.1], ['-1,1…-0,5', x => x > -1.1 && x <= -.5], ['-0,5…+0,5', x => x > -.5 && x < .5], ['+0,5…+1,5', x => x >= .5 && x < 1.5], ['+1,5…+2,5', x => x >= 1.5 && x <= 2.5], ['> +2,5', x => x > 2.5]];
  const srt = [...nr].sort((a, b) => b - a), pos = sum(srt.filter(x => x > 0)), top3 = sum(srt.slice(0, 3).filter(x => x > 0));
  return {
    ok: true, n, mean: m, sd, sqn, sqn100, cls, be, biaya, grossN: gross.length,
    dist: edges.map(([l, fn]) => ({ l, n: nr.filter(fn).length })),
    top3: pos > 0 ? top3 / pos : null, meanEx3: n > 3 ? mean(srt.slice(3)) : null,
  };
}

// ---------- level unik: sinyal berulang di level yang sama = satu trade independen ----------
export function levels(list, costPct = 0) {
  const f = list.filter(fin), n = f.length, g = {};
  for (const s of f) (g[[s.symbol, s.side, s.entry, s.stop].join('|')] ??= []).push(s);
  const L = Object.values(g), u = L.length;
  if (!u) return { ok: false, n, u: 0 };
  const lv = L.map(v => mean(v.map(s => netR(s, costPct)))), m = mean(lv), sd = stdev(lv);
  const big = L.reduce((a, v) => (v.length > a.n ? { n: v.length, sym: v[0].symbol, side: v[0].side } : a), { n: 0 });
  return { ok: true, n, u, dup: n - u, neff: n * n / sum(L.map(v => v.length ** 2)), mean: m, sd, sqn: sd > 0 ? Math.sqrt(u) * m / sd : null, big };
}

// ---------- syarat layak uang sungguhan (HIPOTESIS, ambang di config/monitor.json) ----------
export function readiness(sm, V) {
  const items = [
    [sm.selesai >= V.minTrades, `Trade selesai ${sm.selesai}/${V.minTrades}`],
    [sm.minggu >= V.minWeeks, `Minggu aktif ${sm.minggu}/${V.minWeeks}`],
    [!!sm.ci && sm.ci[0] > 0, sm.ci ? `Batas bawah CI95 R/trade ${sm.ci[0].toFixed(2)} > 0` : 'CI95 R/trade belum dapat dihitung (butuh ≥6 minggu)'],
    [sm.pf != null && sm.pf >= V.minPF, `Profit factor ${sm.pf == null ? '–' : sm.pf.toFixed(2)} ≥ ${V.minPF}`],
  ];
  return { items, layak: items.every(x => x[0]) };
}

// ---------- uji hipotesis lintas mesin ----------
// Nomor urut sinyal per mesin per hari UTC (untuk uji batas harian).
export function rankPerDay(signals) {
  const out = new Map(), by = {};
  for (const s of signals) (by[s.engine + '|' + String(s.ts).slice(0, 10)] ??= []).push(s);
  for (const L of Object.values(by)) L.sort((a, b) => tsOf(a) - tsOf(b)).forEach((s, i) => out.set(s, i + 1));
  return out;
}

export function hipotesisHarian(signals, cap, costPct) {
  const rk = rankPerDay(signals), G = {};
  for (const s of signals) {
    if (!fin(s)) continue;
    const g = rk.get(s) > cap ? 'lewat' : 'dalam', x = G[g] ??= { n: 0, tp: 0, r: 0 }, r = netR(s, costPct);
    x.n++; if (r > .05) x.tp++; x.r += r;
  }
  return ['dalam', 'lewat'].filter(g => G[g]).map(g => ({ g: g === 'lewat' ? `lewat batas (sinyal ke-${cap + 1} dst)` : `dalam batas (maks ${cap}/hari)`, n: G[g].n, tp: G[g].tp, r: G[g].r / G[g].n }));
}

export function hipotesisAkhirPekan(signals, costPct) {
  const G = {};
  for (const s of signals) {
    if (!fin(s)) continue;
    const w = new Date(tsOf(s)).getUTCDay(), g = (w === 0 || w === 6) ? 'akhir pekan (Sab/Min UTC)' : 'hari kerja', r = netR(s, costPct);
    const x = G[g] ??= { n: 0, tp: 0, r: 0, q: 0 }; x.n++; if (r > .05) x.tp++; x.r += r; x.q += r * r;
  }
  return Object.entries(G).map(([g, x]) => { const mu = x.r / x.n; return { g, n: x.n, tp: x.tp, r: mu, se: x.n > 1 ? Math.sqrt(Math.max(0, x.q / x.n - mu * mu) / (x.n - 1)) : null }; });
}

// Seluruh analitik satu mesin dalam satu objek.
export function analyze(list, costPct, V) {
  const sm = summarize(list, costPct);
  return { sm, th: tharp(list, costPct), lv: levels(list, costPct), dir: bySide(list, costPct), ready: readiness(sm, V) };
}
