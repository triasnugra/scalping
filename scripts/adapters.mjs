// Adapter: format jurnal tiap mesin -> skema sinyal ternormalisasi.
// Skema: {engine,id,ts,symbol,side,setup,level,locationKind,confirmTf,entryType,structuralStop,
//         entry,stop,stopPct,rr,rr1,touches,riskPct,state:'open'|'closed'|'void',r,exitTs}

const iso = ms => new Date(ms).toISOString();
const num = x => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const pctDist = (a, b) => (a > 0 && b > 0 ? Math.abs(a - b) / a * 100 : null);
const rrOf = (entry, stop, tp) => { const r = Math.abs(entry - stop); return r > 0 && tp != null ? +(Math.abs(tp - entry) / r).toFixed(2) : null; };
const round = (x, d = 3) => (x == null ? null : +x.toFixed(d));

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

function base(engine, o) {
  const stopPct = o.stopPct ?? pctDist(o.entry, o.stop);
  return {
    engine, id: String(o.id), ts: o.ts, symbol: o.symbol, side: o.side, setup: o.setup, level: o.level ?? null,
    locationKind: o.locationKind ?? null, confirmTf: tf(o.confirmTf), entryType: o.entryType ?? null,
    structuralStop: o.structuralStop ?? true, entry: o.entry, stop: o.stop, stopPct: round(stopPct, 3),
    rr: o.rr ?? null, rr1: o.rr1 ?? null, touches: o.touches ?? null, riskPct: o.riskPct ?? null,
    state: o.state, r: o.state === 'closed' ? round(o.r, 3) : null, exitTs: o.exitTs ?? null,
  };
}

// ---------- sc (v1): data/journal.json ----------
export function adaptSc(files) {
  const rows = JSON.parse(files.journal);
  return rows.map(r => {
    const side = String(r.arah).toLowerCase();
    const h = String(r.hasil);
    const state = h === 'menunggu' ? 'open' : h === 'tidak terisi' ? 'void' : num(r.R) != null ? 'closed' : 'void';
    const sweep = r.setup === 'sweep';
    const high = /swing high/i.test(r.alasan || '');
    return base('sc', {
      id: r.id, ts: iso(r.t0 ?? Date.parse(r.waktu)), symbol: r.aset, side,
      setup: sweep ? (high ? 'failed_breakout' : 'sweep_reclaim') : 'pullback',
      level: sweep ? `Swing ${high ? 'High' : 'Low'} 15m` : 'EMA20 15m', locationKind: sweep ? 'key_level' : 'indicator',
      confirmTf: '15m', entryType: 'confirm_close', entry: r.entry, stop: r.sl,
      rr: rrOf(r.entry, r.sl, r.tp), rr1: rrOf(r.entry, r.sl, r.tp), state, r: num(r.R), exitTs: r.tx ? iso(r.tx) : null,
    });
  });
}

// ---------- scv2: branch data / journal.json ----------
const T2 = { T1: null, T2: 'breakout_retest', T3: 'support_scalp', T4: 'pullback' };
export function adaptScv2(files) {
  return JSON.parse(files.journal).map(t => {
    const setup = t.trigger === 'T1' ? reversal(t.side) : (T2[t.trigger] ?? 'unknown');
    const st = t.status;
    const state = st === 'CLOSED' ? 'closed' : (st === 'PENDING' || st === 'OPEN') ? 'open' : 'void';
    let loc = locFromLevel(t.level);
    if (t.trigger === 'T3') loc = 'key_level'; // zona Fib 0.75-0.786 = level kunci Eliz
    if (t.trigger === 'T4') loc = 'indicator';
    return base('scv2', {
      id: t.id, ts: t.ts, symbol: t.symbol, side: t.side, setup, level: t.level, locationKind: loc,
      confirmTf: t.tf, entryType: /MARKET/i.test(t.entry_type || '') ? 'market' : 'limit',
      entry: t.entry, stop: t.stop, stopPct: num(t.stop_pct), rr: num(t.rr_tp2) ?? num(t.rr_tp1), rr1: num(t.rr_tp1),
      riskPct: num(t.risk_pct), state, r: num(t.r), exitTs: t.exit_ts,
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
      entry: s.entry, stop: s.sl, stopPct: num(s.sl_pct), rr: num(s.rr2), rr1: num(s.rr1),
      state: closed ? 'closed' : 'open', r: num(s.r), exitTs: s.closed_at,
    });
  });
}

// ---------- scv4: <pages>/history.json ----------
const TF4 = { T1: '15m', T2: '1h', T3: '15m', T4: '1h' }; // sesuai scalp/triggers.py (T1,T3 pada df15; T2,T4 pada df1h)
export function adaptScv4(files) {
  const sigs = JSON.parse(files.history).signals || [];
  return sigs.map(s => {
    const setup = s.trigger === 'T1' ? reversal(s.direction) : (T2[s.trigger] ?? 'unknown');
    const state = s.status === 'INVALID' ? 'void' : ['OPEN', 'TP1_OPEN'].includes(s.status) ? 'open' : 'closed';
    return base('scv4', {
      id: s.id, ts: s.time, symbol: s.symbol, side: s.direction, setup, level: s.level_label,
      locationKind: s.trigger === 'T3' ? 'key_level' : s.trigger === 'T4' ? 'indicator' : locFromLevel(s.level_label),
      confirmTf: TF4[s.trigger] ?? null, entryType: s.trigger === 'T2' ? 'limit' : 'confirm_close',
      entry: s.entry, stop: s.stop, rr: rrOf(s.entry, s.stop, s.tp2), rr1: rrOf(s.entry, s.stop, s.tp1),
      state, r: num(s.r), exitTs: s.closed_at,
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
      confirmTf: '5m', entryType: 'limit', entry: d.entry, stop: d.stop, stopPct: num(d.risk_pct),
      rr: num(d.rr2), rr1: num(d.rr1), touches: num(d.level?.touches),
      state: status === 'CLOSED' ? 'closed' : status === 'EXPIRED' ? 'void' : 'open', r, exitTs: exit ? iso(exit) : null,
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
      id: s.id, ts: s.createdAt, symbol: s.symbol, side, setup, level: s.setupName,
      locationKind: setup === 'momentum' ? 'indicator' : 'range_edge', confirmTf: '15m', entryType: 'limit',
      entry, stop: s.initialStopLoss, stopPct: num(s.stopDistancePct), rr: num(s.rr), rr1: rrOf(entry, s.initialStopLoss, s.tp1),
      riskPct: s.sizing ? s.sizing.riskAmountUsdt / s.sizing.baseEquityUsdt * 100 : null,
      state, r, exitTs: s.closedAt,
    });
  };
  return [...(j.activeSignals || []).map(s => conv(s, true)), ...(j.closedSignals || []).map(s => conv(s, false))];
}

export const ADAPTERS = { sc: adaptSc, scv2: adaptScv2, scv3: adaptScv3, scv4: adaptScv4, scv5: adaptScv5, scv6: adaptScv6 };
