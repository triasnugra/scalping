// Mesin penilaian kualitas scalping (murni, tanpa DOM). Dipakai browser (site/app.js) dan Node (tests).
// Skema sinyal ternormalisasi: lihat README bagian "Skema sinyal".
// Perubahan dari scalping-main: semua R memakai R BERSIH setelah biaya (cfg.costPct), konsep dari monitortn.
import { netR } from './analytics.mjs';

export const SETUPS = {
  failed_breakout: { label: 'Failed Breakout', base: 100 },
  sweep_reclaim:   { label: 'Sweep + Reclaim', base: 100 },
  breakout_retest: { label: 'Breakout + Retest', base: 95 },
  support_scalp:   { label: 'Support/Resistance Scalp', base: 85 },
  pullback:        { label: 'Pullback / Trend', base: 60 },
  momentum:        { label: 'Momentum / Chase', base: 30 },
  unknown:         { label: 'Tanpa trigger jelas', base: 0 },
};

export const FLAGS = {
  NO_TRIGGER:      'Tidak ada trigger yang jelas',
  NO_CONFIRM_LTF:  'Tanpa konfirmasi 5m/15m',
  CHASING:         'Mengejar harga (momentum / market entry)',
  MID_RANGE:       "Entry di tengah range (no-man's land)",
  NOT_AT_LEVEL:    'Tidak di level/struktur penting',
  EXHAUSTED_LEVEL: 'Level sudah diuji ≥3x (jenuh)',
  WIDE_STOP:       'Stop terlalu longgar',
  TIGHT_NOISE:     'Stop terlalu rapat (tergerus noise/biaya)',
  NO_STRUCT_STOP:  'Invalidation tidak struktural',
  LOW_RR:          'R:R di bawah minimum',
  FAKE_RR:         'Target R:R tidak realistis (>10R)',
  RAPID_REENTRY:   'Re-entry cepat di simbol yang sama',
};

export const DEFAULTS = {
  costPct: .2,
  weights: { trigger: .35, structure: .20, stop: .15, winrate: .15, sample: .10, patience: .05 },
  minStopPct: .15, hqMaxStopPct: 1.5, softMaxStopPct: 3.5, minRR: 1.5, maxSaneRR: 10, maxTouches: 3,
  hqMinBase: 80, hqMinQ: 75, hqTfs: ['5m', '15m'],
  confFactor: { '15m': 1, '5m': .85, '1h': .7 }, unknownConf: .45, marketEntryFactor: .85,
  locScore: { range_edge: 100, key_level: 90, indicator: 55, none: 30, unknown: 40, mid_range: 5 },
  cooldownMin: 60, spdOk: 3, spdMax: 12, targetSample: 50,
  wrPrior: .40, wrPriorN: 6, wrLo: .30, wrHi: .65, assumedRiskPct: 1, noiseR: .05,
  sessions: { asia: [0, 8], london: [8, 13], ny: [13, 22] },
  verdict: { activateScore: 70, activateMaxForced: 20, minHqClosed: 15, pauseScore: 45, pauseForced: 50, pauseMinClosed: 20, pauseExp: -.15 },
};

const clamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sum = a => a.reduce((s, x) => s + x, 0);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}
export const sessionOf = (ms, cfg = DEFAULTS) => {
  const h = new Date(ms).getUTCHours();
  for (const [k, [a, b]] of Object.entries(cfg.sessions)) if (h >= a && h < b) return k;
  return 'asia'; // 22:00-24:00 UTC (Sydney) dikelompokkan ke Asia
};

// ---------- penilaian 1 sinyal ----------
export function assess(s, cfg = DEFAULTS) {
  const flags = [];
  const base = SETUPS[s.setup]?.base ?? 0;
  const p = Number(s.stopPct);
  const stopOk = p > 0;
  const conf = s.confirmTf ? (cfg.confFactor[s.confirmTf] ?? cfg.unknownConf) : cfg.unknownConf;
  const clarity = base * conf * (s.entryType === 'market' ? cfg.marketEntryFactor : 1);
  const inval = !stopOk ? 0 : s.structuralStop ? (p >= cfg.minStopPct && p <= cfg.hqMaxStopPct ? 100 : 65) : 45;
  let trigger = clamp(.65 * clarity + .35 * inval);

  let loc = cfg.locScore[s.locationKind ?? 'unknown'] ?? cfg.locScore.unknown;
  const exhausted = s.touches != null && s.touches >= cfg.maxTouches;
  if (exhausted) loc -= 25;
  const structure = clamp(loc);

  const stop = !stopOk ? 0 : p < cfg.minStopPct ? 50 : p <= .5 ? 100 : clamp(100 * (1 - (p - .5) / (cfg.softMaxStopPct - .5)));
  const q = (35 * trigger + 20 * structure + 15 * stop) / 70;

  const chasing = s.setup === 'momentum' || (s.entryType === 'market' && !['range_edge', 'key_level'].includes(s.locationKind));
  const hqTf = cfg.hqTfs.includes(s.confirmTf);
  if (base === 0) flags.push('NO_TRIGGER');
  if (!hqTf) flags.push('NO_CONFIRM_LTF');
  if (chasing) flags.push('CHASING');
  if (s.locationKind === 'mid_range') flags.push('MID_RANGE');
  if (structure < 35 && s.locationKind !== 'mid_range') flags.push('NOT_AT_LEVEL');
  if (exhausted) flags.push('EXHAUSTED_LEVEL');
  if (stopOk && p > cfg.hqMaxStopPct) flags.push('WIDE_STOP');
  if (stopOk && p < cfg.minStopPct) flags.push('TIGHT_NOISE');
  if (!s.structuralStop) flags.push('NO_STRUCT_STOP');
  if (s.rr != null && s.rr < cfg.minRR) flags.push('LOW_RR');
  if (s.rr != null && s.rr > cfg.maxSaneRR) flags.push('FAKE_RR');

  const forced = flags.includes('NO_TRIGGER') || flags.includes('MID_RANGE') || chasing || structure < 35;
  if (forced) trigger = Math.min(trigger, 40); // sinyal forced tidak boleh dianggap punya trigger jelas
  const hq = base >= cfg.hqMinBase && hqTf && !chasing && ['range_edge', 'key_level'].includes(s.locationKind) &&
    stopOk && p >= cfg.minStopPct && p <= cfg.hqMaxStopPct && !!s.structuralStop && !exhausted &&
    (s.rr == null || (s.rr >= cfg.minRR && s.rr <= cfg.maxSaneRR)) && q >= cfg.hqMinQ;
  return { trigger, structure, stop, q, hq, forced, chasing, flags };
}

// ---------- anotasi seluruh sinyal 1 mesin ----------
export function annotate(list, cfg = DEFAULTS) {
  const sorted = [...list].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const last = new Map();
  return sorted.map(s => {
    const a = assess(s, cfg), t = Date.parse(s.ts), prev = last.get(s.symbol);
    if (prev != null && t - prev < cfg.cooldownMin * 60000) { a.flags.push('RAPID_REENTRY'); a.rapid = true; }
    last.set(s.symbol, t);
    return { ...s, t, a, session: sessionOf(t, cfg) };
  });
}

// ---------- statistik dasar dari sekumpulan sinyal ter-anotasi ----------
const exitT = s => Date.parse(s.exitTs || s.ts);
function core(L, cfg) {
  const closed = L.filter(s => s.state === 'closed' && s.r != null).sort((x, y) => exitT(x) - exitT(y));
  const rs = closed.map(s => netR(s, cfg.costPct));
  const wins = rs.filter(r => r > cfg.noiseR).length, losses = rs.filter(r => r < -cfg.noiseR).length;
  const gp = sum(rs.filter(r => r > 0)), gl = -sum(rs.filter(r => r < 0));
  let eq = 0, peak = 0, dd = 0, run = 0, mcl = 0;
  for (const r of rs) {
    eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    run = r < -cfg.noiseR ? run + 1 : 0; mcl = Math.max(mcl, run);
  }
  const rrs = L.filter(s => s.rr > 0).map(s => Math.min(s.rr, cfg.maxSaneRR));
  const rr1s = L.filter(s => s.rr1 > 0).map(s => Math.min(s.rr1, cfg.maxSaneRR));
  let c = 0;
  return {
    n: L.length, closedN: closed.length, wins, losses, be: closed.length - wins - losses,
    wr: closed.length ? wins / closed.length * 100 : null,
    expR: mean(rs), totalR: sum(rs), pf: gl > 0 ? gp / gl : null, maxDD: dd, mcl,
    avgRR: mean(rrs), avgRR1: mean(rr1s), avgStop: mean(L.filter(s => s.stopPct > 0).map(s => s.stopPct)),
    avgRisk: mean(L.map(s => s.riskPct ?? cfg.assumedRiskPct)),
    equity: closed.map((s, i) => ({ t: exitT(s), r: +(c += rs[i]).toFixed(3) })),
  };
}

const STOP_BINS = [0, .25, .5, .75, 1, 1.5, 2, 3, Infinity];
const binLabel = i => i === STOP_BINS.length - 2 ? `>${STOP_BINS[i]}%` : `${STOP_BINS[i]}–${STOP_BINS[i + 1]}%`;
const closedR = (L, cfg) => L.filter(s => s.state === 'closed' && s.r != null).sort((x, y) => exitT(x) - exitT(y)).map(s => netR(s, cfg.costPct));
function groupBy(L, f) { const o = {}; for (const x of L) (o[f(x)] ||= []).push(x); return o; }

// ---------- evaluasi 1 mesin ----------
export function evaluate(list, cfgIn = {}, opts = {}) {
  const cfg = merge(DEFAULTS, cfgIn);
  const all = annotate(list, cfg);
  const view = opts.hqOnly ? all.filter(s => s.a.hq) : all;
  const full = core(all, cfg), v = opts.hqOnly ? core(view, cfg) : full;
  const hqL = all.filter(s => s.a.hq), hqCore = core(hqL, cfg);
  const n = all.length;
  const pct = f => n ? all.filter(f).length / n * 100 : 0;
  const m = {
    n, shown: view.length, hq: hqL.length, hqPct: pct(s => s.a.hq), forcedPct: pct(s => s.a.forced),
    chasePct: pct(s => s.a.chasing), midPct: pct(s => s.a.flags.includes('MID_RANGE')),
    full, view: v, hqCore, sigs: all, viewSigs: view, cfg,
  };
  if (!n) return { ...m, score: null, components: null, verdict: { action: 'NO DATA', cls: 'mut', reasons: ['Belum ada sinyal pada periode ini.'] }, notes: [], bySetup: [], bySession: [], stopDist: [], last10: [] };

  const days = Math.max(1, (Date.parse(all[n - 1].ts) - Date.parse(all[0].ts)) / 864e5);
  const spd = n / days;
  const rapidPct = pct(s => s.a.rapid);
  const wrS = (hqCore.wins + cfg.wrPrior * cfg.wrPriorN) / (hqCore.closedN + cfg.wrPriorN);
  const pool = hqCore.closedN >= 8 ? closedR(hqL, cfg) : closedR(all, cfg);
  const size = Math.max(1, Math.ceil(pool.length / 4));
  const buckets = []; for (let i = 0; i < pool.length; i += size) buckets.push(pool.slice(i, i + size));
  const bucketPos = buckets.length >= 2 ? buckets.filter(b => mean(b) >= 0).length / buckets.length : 0;
  const mclF = clamp(1 - Math.max(0, full.mcl - 3) * .1, 0, 1);
  const freqF = clamp(1 - (spd - cfg.spdOk) / (cfg.spdMax - cfg.spdOk), 0, 1);
  const components = {
    trigger: mean(all.map(s => s.a.trigger)),
    structure: mean(all.map(s => s.a.structure)),
    stop: mean(all.map(s => s.a.stop)),
    winrate: clamp((wrS - cfg.wrLo) / (cfg.wrHi - cfg.wrLo) * 100),
    sample: 100 * (.5 * Math.min(1, full.closedN / cfg.targetSample) + .3 * bucketPos + .2 * mclF),
    patience: 100 * (.6 * (1 - m.forcedPct / 100) + .2 * freqF + .2 * (1 - rapidPct / 100)),
  };
  const W = cfg.weights;
  const score = clamp(Object.keys(W).reduce((s, k) => s + W[k] * components[k], 0));
  Object.assign(m, { spd, rapidPct, score, components });

  m.bySetup = Object.entries(groupBy(view, s => s.setup)).map(([k, L]) => {
    const c = core(L, cfg);
    return { key: k, label: SETUPS[k]?.label ?? k, n: L.length, hqPct: L.filter(s => s.a.hq).length / L.length * 100, closedN: c.closedN, wr: c.wr, expR: c.expR, avgStop: c.avgStop };
  }).sort((a, b) => b.n - a.n);
  m.bySession = ['asia', 'london', 'ny'].map(k => {
    const L = view.filter(s => s.session === k), c = core(L, cfg), h = core(L.filter(s => s.a.hq), cfg);
    return { key: k, n: L.length, hqPct: L.length ? L.filter(s => s.a.hq).length / L.length * 100 : null, closedN: c.closedN, wr: c.wr, expR: c.expR, hqExp: h.expR, hqN: h.closedN };
  });
  const bins = new Array(STOP_BINS.length - 1).fill(0), binsHQ = [...bins];
  for (const s of view) if (s.stopPct > 0) {
    const i = STOP_BINS.findIndex((b, j) => s.stopPct >= b && s.stopPct < STOP_BINS[j + 1]);
    bins[i]++; if (s.a.hq) binsHQ[i]++;
  }
  m.stopDist = bins.map((c, i) => ({ label: binLabel(i), n: c, hq: binsHQ[i] }));
  m.last10 = [...view].reverse().slice(0, 10);
  m.notes = weaknesses(m, cfg);
  m.verdict = verdict(m, cfg);
  return m;
}

// ---------- catatan kelemahan ----------
function weaknesses(m, cfg) {
  const out = [], f = (x, d = 0) => x == null ? '–' : x.toFixed(d);
  const cnt = c => m.sigs.filter(s => s.a.flags.includes(c)).length / m.n * 100;
  if (m.forcedPct >= 25) out.push(`${f(m.forcedPct)}% sinyal tergolong forced / tanpa trigger jelas (chasing, tengah range, atau tanpa level) — melanggar "No trigger, no trade".`);
  if (m.chasePct >= 15) out.push(`${f(m.chasePct)}% entry mengejar harga (momentum / market entry di luar level), bukan menunggu harga datang ke level.`);
  if (m.midPct >= 8) out.push(`${f(m.midPct)}% entry terjadi di tengah range.`);
  if (m.full.avgStop > cfg.hqMaxStopPct) out.push(`Stop rata-rata ${f(m.full.avgStop, 2)}% — terlalu longgar untuk scalping (batas ${cfg.hqMaxStopPct}%).`);
  else if (cnt('WIDE_STOP') >= 30) out.push(`${f(cnt('WIDE_STOP'))}% sinyal punya stop > ${cfg.hqMaxStopPct}%.`);
  if (cnt('NO_CONFIRM_LTF') >= 30) out.push(`${f(cnt('NO_CONFIRM_LTF'))}% sinyal tanpa konfirmasi 5m/15m (konfirmasi di 1H atau tidak tercatat) — jarang menunggu konfirmasi 15m.`);
  if (cnt('EXHAUSTED_LEVEL') >= 15) out.push(`${f(cnt('EXHAUSTED_LEVEL'))}% sinyal di level yang sudah diuji ≥${cfg.maxTouches}x.`);
  if (cnt('FAKE_RR') >= 20) out.push(`Target R:R tidak realistis (>${cfg.maxSaneRR}R) pada ${f(cnt('FAKE_RR'))}% sinyal; R:R tampilan mesin tidak bisa dipercaya.`);
  else if (cnt('LOW_RR') >= 25) out.push(`${f(cnt('LOW_RR'))}% sinyal punya R:R < ${cfg.minRR}.`);
  if (m.rapidPct >= 20) out.push(`${f(m.rapidPct)}% sinyal adalah re-entry < ${cfg.cooldownMin} menit di simbol yang sama (indikasi memaksa entry / revenge).`);
  if (m.spd > cfg.spdOk) out.push(`Frekuensi ${f(m.spd, 1)} sinyal/hari melebihi batas disiplin (${cfg.spdOk}/hari).`);
  if (m.full.mcl >= 5) out.push(`Loss beruntun maksimum ${m.full.mcl}x.`);
  if (m.hqCore.closedN >= 10 && m.hqCore.expR < 0) out.push(`Expectancy bersih setup berkualitas tinggi negatif (${f(m.hqCore.expR, 2)}R, n=${m.hqCore.closedN}): filter kualitas belum menghasilkan edge.`);
  const nonHq = core(m.sigs.filter(s => !s.a.hq), cfg);
  if (m.hqCore.closedN >= 8 && nonHq.closedN >= 8 && m.hqCore.wr + 10 < nonHq.wr) out.push(`Win rate HQ (${f(m.hqCore.wr)}%) lebih rendah dari non-HQ (${f(nonHq.wr)}%): kriteria kualitas mesin tidak terbukti memisahkan hasil.`);
  const bad = m.bySetup.find(x => x.closedN >= 8 && x.expR <= -.3);
  if (bad) out.push(`Setup "${bad.label}" merugi (${f(bad.expR, 2)}R/trade, n=${bad.closedN}).`);
  const bs = m.bySession.find(x => x.closedN >= 8 && x.expR <= -.3);
  if (bs) out.push(`Sesi ${({ asia: 'Asia', london: 'London', ny: 'New York' })[bs.key]} paling buruk (${f(bs.expR, 2)}R/trade, n=${bs.closedN}).`);
  if (m.full.closedN < 20) out.push(`Sampel kecil (${m.full.closedN} trade selesai) — skor belum signifikan secara statistik.`);
  if (!out.length) out.push('Tidak ada pelanggaran besar terdeteksi pada periode ini.');
  return out.slice(0, 8);
}

// ---------- rekomendasi operasional ----------
function verdict(m, cfg) {
  const V = cfg.verdict, r = [], hqN = m.hqCore.closedN, expHQ = m.hqCore.expR, expAll = m.full.expR, nC = m.full.closedN;
  const conf = nC < V.pauseMinClosed ? 'rendah' : 'cukup';
  if (m.score >= V.activateScore && m.forcedPct <= V.activateMaxForced && hqN >= V.minHqClosed && (expHQ ?? 0) >= 0) {
    r.push(`Skor ${m.score.toFixed(0)}, forced ${m.forcedPct.toFixed(0)}%, expectancy HQ ${expHQ.toFixed(2)}R (n=${hqN}).`);
    return { action: 'AKTIFKAN', cls: 'good', reasons: r, confidence: conf };
  }
  if (m.score < V.pauseScore || m.forcedPct >= V.pauseForced || (nC >= V.pauseMinClosed && expAll < V.pauseExp && (expHQ ?? -1) < 0)) {
    if (m.score < V.pauseScore) r.push(`Skor ${m.score.toFixed(0)} < ${V.pauseScore}.`);
    if (m.forcedPct >= V.pauseForced) r.push(`${m.forcedPct.toFixed(0)}% sinyal forced.`);
    if (nC >= V.pauseMinClosed && expAll < V.pauseExp) r.push(`Expectancy ${expAll.toFixed(2)}R/trade (n=${nC}).`);
    return { action: 'PAUSE', cls: 'bad', reasons: r, confidence: conf };
  }
  if (m.score >= V.activateScore) r.push(hqN < V.minHqClosed ? `Kualitas bagus tetapi baru ${hqN} trade HQ selesai (butuh ≥${V.minHqClosed}).` : 'Kualitas bagus tetapi expectancy/forced belum memenuhi syarat aktivasi.');
  else r.push(`Skor ${m.score.toFixed(0)} (target ≥${V.activateScore}); perbaiki komponen terlemah.`);
  return { action: 'OPTIMIZE', cls: 'warn', reasons: r, confidence: conf };
}

export function rank(list) {
  const s = list.filter(x => x.score != null).sort((a, b) => b.score - a.score);
  s.forEach((x, i) => { x.rank = i + 1; });
  list.forEach(x => { if (x.score == null) x.rank = null; });
  return list;
}

// ---------- heatmap 7 (Sen..Min) x 24 jam ----------
export function heatmap(sigs, tzHours = 0) {
  const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ hq: 0, lq: 0, n: 0 })));
  for (const s of sigs) {
    const d = new Date(s.t + tzHours * 36e5), c = g[(d.getUTCDay() + 6) % 7][d.getUTCHours()];
    c.n++; s.a.hq ? c.hq++ : c.lq++;
  }
  return g;
}

export function periodStart(key, nowMs, tzHours = 0) {
  if (key === 'all') return 0;
  if (key === 'today') { const d = new Date(nowMs + tzHours * 36e5); d.setUTCHours(0, 0, 0, 0); return d.getTime() - tzHours * 36e5; }
  return nowMs - ({ '7d': 7, '30d': 30, '90d': 90 }[key] ?? 30) * 864e5;
}
