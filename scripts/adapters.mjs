// Adapter: format jurnal tiap mesin -> skema sinyal ternormalisasi.
// Skema: {engine,id,ts,symbol,pair,side,setup,level,locationKind,confirmTf,entryType,structuralStop,
//         entry,stop,tp,stopPct,rr,rr1,touches,riskPct,state:'open'|'closed'|'void',phase,r,rNet,outcome,exitTs,note}
//  - phase: 'pending' (limit belum terisi) | 'running' (sudah terisi) | 'unknown' (mesin tidak membedakan) | null
//  - rNet: true bila R dari mesin sudah bersih biaya (tidak dipotong lagi oleh monitor)
//  - outcome: TP | SL | BE | tidak terisi | menunggu | berjalan

const NOISE = .05;
const iso = ms => new Date(ms).toISOString();
const num = x => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const pctDist = (a, b) => (a > 0 && b > 0 ? Math.abs(a - b) / a * 100 : null);
const rrOf = (entry, stop, tp) => { const r = Math.abs(entry - stop); return r > 0 && tp != null ? +(Math.abs(tp - entry) / r).toFixed(2) : null; };
const round = (x, d = 3) => (x == null ? null : +x.toFixed(d));

export const pairOf = (symbol, pair) => {
  const s = String(pair || symbol || '').toUpperCase();
  return !s ? null : s.endsWith('USDT') ? s : s + 'USDT';
};

// Tebak jenis lokasi dari nama level
export function locFromLevel(name) {
  if (name == null || name === '') return null;
  const s = String(name).toLowerCase();
  if (/fib|ema|\bbb\b|bollinger|trend|flip|ribbon/.test(s)) return 'indicator';
  if (/range|\brh\b|\brl\b/.test(s)) return 'range_edge';
  if (/mon|pd[hl]|pw[hl]|prev|swing|pivot|support|resist|breakout|breakdown|high|low/.test(s)) return 'key_level';
  return 'none';
}
const tf = x => (x == null ? null : String(x).toLowerCase());
const reversal = side => (side === 'short' ? 'failed_breakout' : 'sweep_reclaim');

// Lengkapi field turunan (outcome) untuk sinyal yang sudah berskema; dipakai juga oleh data demo.
export function finalize(s) {
  const o = { phase: null, rNet: false, tp: null, note: null, pair: pairOf(s.symbol), ...s };
  o.outcome = o.state === 'closed' ? (o.r > NOISE ? 'TP' : o.r < -NOISE ? 'SL' : 'BE')
    : o.state === 'void' ? 'tidak terisi' : (o.phase === 'running' ? 'berjalan' : 'menunggu');
  return o;
}

function base(engine, o) {
  const stopPct = o.stopPct ?? pctDist(o.entry, o.stop);
  return finalize({
    engine, id: String(o.id), ts: o.ts, symbol: o.symbol, pair: pairOf(o.symbol, o.pair), side: o.side, setup: o.setup, level: o.level ?? null,
    locationKind: o.locationKind ?? null, confirmTf: tf(o.confirmTf), entryType: o.entryType ?? null,
    structuralStop: o.structuralStop ?? true, entry: o.entry, stop: o.stop, tp: o.tp ?? null, stopPct: round(stopPct, 3),
    rr: o.rr ?? null, rr1: o.rr1 ?? null, touches: o.touches ?? null, riskPct: o.riskPct ?? null,
    state: o.state, phase: o.state === 'open' ? (o.phase ?? 'unknown') : null,
    r: o.state === 'closed' ? round(o.r, 3) : null, rNet: !!o.rNet, exitTs: o.exitTs ?? null, note: o.note ?? null,
  });
}

// ---------- sc (v1): data/journal.json ----------
export function adaptSc(files) {
  return JSON.parse(files.journal).map(r => {
    const side = String(r.arah).toLowerCase(), h = String(r.hasil);
    const state = h === 'menunggu' ? 'open' : h === 'tidak terisi' ? 'void' : num(r.R) != null ? 'closed' : 'void';
    const sweep = r.setup === 'sweep', high = /swing high/i.test(r.alasan || '');
    return base('sc', {
      id: r.id, ts: iso(r.t0 ?? Date.parse(r.waktu)), symbol: r.aset, side,
      setup: sweep ? (high ? 'failed_breakout' : 'sweep_reclaim') : 'pullback',
      level: sweep ? `Swing ${high ? 'High' : 'Low'} 15m` : 'EMA20 15m', locationKind: sweep ? 'key_level' : 'indicator',
      confirmTf: '15m', entryType: 'confirm_close', entry: r.entry, stop: r.sl, tp: num(r.tp),
      rr: rrOf(r.entry, r.sl, r.tp), rr1: rrOf(r.entry, r.sl, r.tp), state, phase: 'pending', r: num(r.R),
      exitTs: r.tx ? iso(r.tx) : null, note: r.alasan,
    });
  });
}

// ---------- sctn: jurnal bergaya tn (aset/arah/entry/sl/tp/hasil/R) ----------
// ASUMSI: repo sctn memakai format jurnal yang sama dengan tn/sc. Setup & lokasi ditebak dari teks `setup`/`alasan`;
// TF konfirmasi tidak diketahui sehingga dinilai konservatif. Bila jurnal sctn berbeda, adapter ini yang perlu disesuaikan.
export function inferSetup(text, side) {
  const s = String(text || '').toLowerCase();
  if (/sweep|reclaim|deviation|deviasi|false break|failed break|fakeout/.test(s)) return { setup: reversal(side), loc: 'key_level' };
  if (/retest/.test(s)) return { setup: 'breakout_retest', loc: 'key_level' };
  if (/fib|0[.,]75|0[.,]786/.test(s)) return { setup: 'support_scalp', loc: 'key_level' };
  if (/range (high|low)|tepi range|range edge|range-edge/.test(s)) return { setup: 'support_scalp', loc: 'range_edge' };
  if (/pullback|ema|retrace/.test(s)) return { setup: 'pullback', loc: 'indicator' };
  if (/breakout|squeeze|momentum|ekspansi/.test(s)) return { setup: 'momentum', loc: 'indicator' };
  return { setup: 'unknown', loc: 'none' };
}
export function adaptSctn(files) {
  const rows = JSON.parse(files.journal);
  if (!Array.isArray(rows)) throw new Error('jurnal sctn bukan array (format berbeda dari tn)');
  return rows.map(r => {
    const side = String(r.arah ?? r.side ?? '').toLowerCase(), h = String(r.hasil ?? '');
    const t = num(r.t0) ?? num(r.t) ?? Date.parse(String(r.waktu || '').replace(' UTC', 'Z').replace(' ', 'T'));
    if (!Number.isFinite(t) || !['long', 'short'].includes(side)) return null;
    const state = h === 'menunggu' ? 'open' : h === 'tidak terisi' ? 'void' : num(r.R) != null ? 'closed' : 'void';
    const { setup, loc } = inferSetup(`${r.setup ?? ''} ${r.alasan ?? ''}`, side);
    return base('sctn', {
      id: r.id ?? `${r.aset}|${side}|${t}`, ts: iso(t), symbol: r.aset ?? r.symbol, side, setup,
      level: r.level ?? null, locationKind: loc, confirmTf: r.tf ?? null, entryType: null,
      entry: num(r.entry), stop: num(r.sl), tp: num(r.tp), rr: rrOf(r.entry, r.sl, r.tp), rr1: rrOf(r.entry, r.sl, r.tp),
      state, phase: 'pending', r: num(r.R), exitTs: r.tx ? iso(num(r.tx)) : null, note: r.alasan,
    });
  }).filter(Boolean);
}

// ---------- scv2: branch data / journal.json ----------
const T2 = { T1: null, T2: 'breakout_retest', T3: 'support_scalp', T4: 'pullback' };
export function adaptScv2(files) {
  return JSON.parse(files.journal).map(t => {
    const setup = t.trigger === 'T1' ? reversal(t.side) : (T2[t.trigger] ?? 'unknown');
    const st = t.status;
    const state = st === 'CLOSED' ? 'closed' : (st === 'PENDING' || st === 'OPEN') ? 'open' : 'void';
    let loc = locFromLevel(t.level);
    if (t.trigger === 'T3') loc = 'key_level';
    if (t.trigger === 'T4') loc = 'indicator';
    return base('scv2', {
      id: t.id, ts: t.ts, symbol: t.symbol, side: t.side, setup, level: t.level, locationKind: loc,
      confirmTf: t.tf, entryType: /MARKET/i.test(t.entry_type || '') ? 'market' : 'limit',
      entry: t.entry, stop: t.stop, stopPct: num(t.stop_pct), tp: num(t.tp2) ?? num(t.tp1) ?? num(t.tp),
      rr: num(t.rr_tp2) ?? num(t.rr_tp1), rr1: num(t.rr_tp1), riskPct: num(t.risk_pct),
      state, phase: st === 'OPEN' ? 'running' : 'pending', r: num(t.r), exitTs: t.exit_ts,
    });
  });
}

// ---------- scv3: state/signals.json ----------
export function adaptScv3(files) {
  const sigs = JSON.parse(files.signals).signals || [];
  return sigs.map(s => {
    const setup = { range_deviation: reversal(s.side), level_sweep: reversal(s.side), breakout_retest: 'breakout_retest', squeeze_expansion: 'momentum' }[s.setup] ?? 'unknown';
    const closed = ['WIN', 'LOSS', 'BE', 'TIMEOUT'].includes(s.status);
    return base('scv3', {
      id: s.id, ts: s.ts, symbol: s.symbol, side: s.side, setup, level: s.level_name,
      locationKind: s.setup === 'squeeze_expansion' ? 'indicator' : s.setup === 'range_deviation' ? 'range_edge' : 'key_level',
      confirmTf: '15m', entryType: s.setup === 'squeeze_expansion' ? 'market' : 'confirm_close',
      entry: s.entry, stop: s.sl, stopPct: num(s.sl_pct), tp: num(s.tp2) ?? num(s.tp1), rr: num(s.rr2), rr1: num(s.rr1),
      state: closed ? 'closed' : 'open', phase: 'running', r: num(s.r), exitTs: s.closed_at,
    });
  });
}

// ---------- scv4: <pages>/history.json ----------
const TF4 = { T1: '15m', T2: '1h', T3: '15m', T4: '1h' };
export function adaptScv4(files) {
  const sigs = JSON.parse(files.history).signals || [];
  return sigs.map(s => {
    const setup = s.trigger === 'T1' ? reversal(s.direction) : (T2[s.trigger] ?? 'unknown');
    const state = s.status === 'INVALID' ? 'void' : ['OPEN', 'TP1_OPEN'].includes(s.status) ? 'open' : 'closed';
    return base('scv4', {
      id: s.id, ts: s.time, symbol: s.symbol, side: s.direction, setup, level: s.level_label,
      locationKind: s.trigger === 'T3' ? 'key_level' : s.trigger === 'T4' ? 'indicator' : locFromLevel(s.level_label),
      confirmTf: TF4[s.trigger] ?? null, entryType: s.trigger === 'T2' ? 'limit' : 'confirm_close',
      entry: s.entry, stop: s.stop, tp: num(s.tp2) ?? num(s.tp1), rr: rrOf(s.entry, s.stop, s.tp2), rr1: rrOf(s.entry, s.stop, s.tp1),
      state, phase: 'running', r: num(s.r), exitTs: s.closed_at,
    });
  });
}

// ---------- scv5: data/journal.jsonl (replay event berantai-hash) ----------
export function adaptScv5(files) {
  const sigs = new Map();
  for (const line of files.journal.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line), d = r.data;
    if (r.type === 'SIGNAL') sigs.set(d.id, { sig: d, status: 'PENDING' });
    else if (sigs.has(d.id)) {
      const x = sigs.get(d.id);
      if (r.type === 'FILL') x.status = 'OPEN';
      else if (r.type === 'TP1') x.status = 'OPEN';
      else if (r.type === 'CLOSE') Object.assign(x, { status: 'CLOSED', r: d.r_net, exit: d.ts });
      else if (r.type === 'EXPIRE') Object.assign(x, { status: 'EXPIRED', exit: d.ts });
    }
  }
  return [...sigs.values()].map(({ sig: d, status, r, exit }) => {
    const side = String(d.direction).toLowerCase();
    const setup = d.setup === 'DEVIATION' ? reversal(side) : d.setup === 'BREAKOUT_RETEST' ? 'breakout_retest' : 'support_scalp';
    const kind = d.level?.kind || '';
    return base('scv5', {
      id: d.id, ts: iso(d.created_ts), symbol: d.symbol, side, setup,
      level: `${kind}${d.level?.monday ? ' (Monday)' : ''}`, locationKind: /range/.test(kind) ? 'range_edge' : 'key_level',
      confirmTf: '5m', entryType: 'limit', entry: d.entry, stop: d.stop, stopPct: num(d.risk_pct), tp: num(d.tp2) ?? num(d.tp1),
      rr: num(d.rr2), rr1: num(d.rr1), touches: num(d.level?.touches),
      state: status === 'CLOSED' ? 'closed' : status === 'EXPIRED' ? 'void' : 'open', phase: status === 'OPEN' ? 'running' : 'pending',
      r, rNet: true, exitTs: exit ? iso(exit) : null, note: (d.reasons || [])[0] ?? null,
    });
  });
}

// ---------- scv6: data/journal.json ----------
export function adaptScv6(files) {
  const j = JSON.parse(files.journal);
  const conv = (s, active) => {
    const side = String(s.direction).toLowerCase();
    const setup = { LIQUIDITY_SWEEP_RECLAIM: reversal(side), DEVIATION_REJECTION_SHORT: 'failed_breakout', ELIZ_FIB_075_BOUNCE: 'support_scalp', EMA_FLIP_SQUEEZE: 'momentum' }[s.setupCode] ?? 'unknown';
    const entry = (s.entryLow + s.entryHigh) / 2;
    const state = active ? 'open' : s.status === 'EXPIRED_NO_FILL' ? 'void' : 'closed';
    const r = num(s.realizedR) ?? (s.status === 'STOPPED_OUT' ? -1 : null);
    return base('scv6', {
      id: s.id, ts: s.createdAt, symbol: s.symbol, pair: s.pair, side, setup, level: s.setupName,
      locationKind: setup === 'momentum' ? 'indicator' : 'range_edge', confirmTf: '15m', entryType: 'limit',
      entry, stop: s.initialStopLoss, stopPct: num(s.stopDistancePct), tp: num(s.tp2) ?? num(s.tp1), rr: num(s.rr), rr1: rrOf(entry, s.initialStopLoss, s.tp1),
      riskPct: s.sizing ? s.sizing.riskAmountUsdt / s.sizing.baseEquityUsdt * 100 : null,
      state, phase: 'unknown', r, exitTs: s.closedAt,
    });
  };
  return [...(j.activeSignals || []).map(s => conv(s, true)), ...(j.closedSignals || []).map(s => conv(s, false))];
}

export const ADAPTERS = { sc: adaptSc, sctn: adaptSctn, scv2: adaptScv2, scv3: adaptScv3, scv4: adaptScv4, scv5: adaptScv5, scv6: adaptScv6 };
