// Generator data dummy (deterministik, seed tetap). Profil dibuat dari perilaku nyata tiap mesin:
// sc = sweep+pullback ketat tapi WR rendah; scv2 = gate ketat & limit entry; scv3 = banyak squeeze (chasing);
// scv4 = konfirmasi 1H & stop lebar; scv5 = sabar (banyak limit tidak terisi); scv6 = frekuensi tinggi, R:R palsu.

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, w) => { let x = r() * Object.values(w).reduce((a, b) => a + b, 0); for (const [k, v] of Object.entries(w)) if ((x -= v) < 0) return k; return Object.keys(w)[0]; };

const SYMS = { BTCUSDT: 60000, ETHUSDT: 1800, SOLUSDT: 70, XRPUSDT: .95, LINKUSDT: 9.1, INJUSDT: 5.2, HBARUSDT: .054, SUIUSDT: 1.1, ARBUSDT: .21, PEPEUSDT: .0000037 };
const LEVELS = { range_edge: ['Range High H1', 'Range Low H1'], key_level: ['Monday High', 'Monday Low', 'PDH', 'PDL', 'PWL'], indicator: ['EMA20 15m', 'BB Lower', 'EMA flip 1H'], mid: ['Mid-range'] };

// setup: [bobot, locationKind, structuralStop, bias win-rate]
const PROFILES = {
  sc:   { n: 38, perDay: 1.1, wr: .30, stop: [.8, 2.0], rr: [1.8, 1.8], conf: { '15m': 1 }, entry: { confirm_close: 1 }, voidP: .1, hours: { asia: 3, london: 4, ny: 3 },
          setups: { sweep_reclaim: [.4, 'key_level', 1, 0], failed_breakout: [.3, 'key_level', 1, 0], pullback: [.3, 'indicator', 1, -.04] }, touches: .1, symbols: ['SOLUSDT', 'INJUSDT', 'PEPEUSDT', 'LINKUSDT', 'XRPUSDT'] },
  scv2: { n: 120, perDay: 2.2, wr: .47, stop: [.35, 1.3], rr: [1.8, 3.2], conf: { '15m': 6, '5m': 3, '1h': 1 }, entry: { limit: 8, confirm_close: 2 }, voidP: .22, hours: { asia: 2, london: 5, ny: 5 },
          setups: { sweep_reclaim: [.28, 'range_edge', 1, .06], failed_breakout: [.22, 'range_edge', 1, .08], breakout_retest: [.25, 'key_level', 1, .03], support_scalp: [.15, 'key_level', 1, .02], pullback: [.1, 'indicator', 1, -.05] }, touches: .08, symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT'] },
  scv3: { n: 260, perDay: 5.5, wr: .42, stop: [.7, 1.6], rr: [1.4, 3.8], conf: { '15m': 1 }, entry: { confirm_close: 1 }, voidP: .0, hours: { asia: 3, london: 3, ny: 4 },
          setups: { momentum: [.46, 'indicator', 1, -.07], failed_breakout: [.2, 'key_level', 1, .03], sweep_reclaim: [.16, 'key_level', 1, .03], breakout_retest: [.14, 'key_level', 1, 0], range_dev: [.04, 'range_edge', 1, .05] }, touches: .12, symbols: ['SOLUSDT', 'LINKUSDT', 'XRPUSDT', 'ETHUSDT', 'BTCUSDT', 'INJUSDT'] },
  scv4: { n: 95, perDay: 2.4, wr: .39, stop: [.6, 2.6], rr: [1.8, 3.0], conf: { '15m': 3, '1h': 6 }, entry: { confirm_close: 6, limit: 4 }, voidP: .05, hours: { asia: 3, london: 4, ny: 4 },
          setups: { sweep_reclaim: [.25, 'range_edge', 1, 0], failed_breakout: [.15, 'range_edge', 1, 0], breakout_retest: [.2, 'key_level', 1, -.02], support_scalp: [.15, 'key_level', 1, 0], pullback: [.25, 'indicator', 1, -.05] }, touches: .25, symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT'] },
  scv5: { n: 34, perDay: .8, wr: .44, stop: [.5, 1.4], rr: [1.85, 2.9], conf: { '5m': 1 }, entry: { limit: 1 }, voidP: .38, hours: { asia: 3, london: 4, ny: 3 },
          setups: { sweep_reclaim: [.35, 'range_edge', 1, .05], failed_breakout: [.3, 'range_edge', 1, .06], breakout_retest: [.2, 'key_level', 1, .02], support_scalp: [.15, 'range_edge', 1, -.03] }, touches: .12, symbols: ['ETHUSDT', 'HBARUSDT', 'SOLUSDT', 'INJUSDT', 'PEPEUSDT'] },
  scv6: { n: 330, perDay: 7.5, wr: .37, stop: [.27, 2.9], rr: [6, 58], conf: { '15m': 1 }, entry: { limit: 1 }, voidP: .05, hours: { asia: 3, london: 3, ny: 4 }, tp1R: [.9, 1.3],
          setups: { sweep_reclaim: [.78, 'range_edge', 1, -.02], failed_breakout: [.15, 'range_edge', 1, -.02], support_scalp: [.03, 'key_level', 1, 0], momentum: [.04, 'indicator', 1, -.08] }, touches: .45, symbols: ['ARBUSDT', 'INJUSDT', 'SUIUSDT', 'HBARUSDT', 'SOLUSDT', 'PEPEUSDT'] },
};

export function generateDemo(nowMs = Date.now(), days = 45) {
  const out = [];
  Object.entries(PROFILES).forEach(([engine, P], ei) => {
    const r = rng(1000 + ei * 7919);
    const N = Math.round(Math.min(P.n, P.perDay * days) * (.92 + r() * .16));
    const times = [];
    for (let i = 0; i < N; i++) {
      const day = Math.floor(r() * days), sess = pick(r, P.hours);
      const [a, b] = { asia: [0, 8], london: [8, 13], ny: [13, 22] }[sess];
      times.push(nowMs - day * 864e5 - (nowMs % 864e5) + (a + r() * (b - a)) * 36e5);
    }
    times.sort((x, y) => x - y);
    times.filter(t => t < nowMs - 1e5).forEach((t, i) => {
      const w = Object.fromEntries(Object.entries(P.setups).map(([k, v]) => [k, v[0]]));
      let setup = pick(r, w), [, loc, struct, bias] = P.setups[setup];
      if (setup === 'range_dev') setup = 'failed_breakout';
      const sym = P.symbols[Math.floor(r() * P.symbols.length)], px = SYMS[sym];
      const side = setup === 'failed_breakout' ? (r() < .75 ? 'short' : 'long') : (r() < .5 ? 'long' : 'short');
      if (loc === 'range_edge' && r() < (engine === 'scv6' ? .2 : .07)) loc = 'mid_range';
      const [lo, hi] = P.stop, stopPct = +(lo + Math.pow(r(), 1.5) * (hi - lo)).toFixed(2);
      const entry = +(px * (1 + (r() - .5) * .04)).toPrecision(6), risk = entry * stopPct / 100;
      const stop = +(side === 'long' ? entry - risk : entry + risk).toPrecision(6);
      const rr = +(P.rr[0] + r() * (P.rr[1] - P.rr[0])).toFixed(2), rr1 = P.tp1R ? +(P.tp1R[0] + r() * (P.tp1R[1] - P.tp1R[0])).toFixed(2) : +Math.min(rr, 1 + r() * .9).toFixed(2);
      const confirmTf = pick(r, P.conf), entryType = setup === 'momentum' && engine === 'scv3' ? 'market' : pick(r, P.entry);
      const touches = r() < P.touches ? 3 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
      const level = loc === 'mid_range' ? LEVELS.mid[0] : LEVELS[loc][Math.floor(r() * LEVELS[loc].length)];
      const age = nowMs - t;
      let state = r() < P.voidP ? 'void' : 'closed', rv = null, exitTs = null;
      if (state === 'closed' && age < 3 * 36e5 * (1 + r())) state = 'open';
      if (state === 'closed') {
        const clean = ['range_edge', 'key_level'].includes(loc) && ['15m', '5m'].includes(confirmTf) && stopPct <= 1.5;
        let p = P.wr + bias + (clean ? .07 : -.05) + (touches >= 3 ? -.08 : 0) + (stopPct > 2 ? -.05 : 0) + (loc === 'mid_range' ? -.12 : 0);
        p = Math.min(.8, Math.max(.12, p));
        const cost = Math.min(.5, .16 / stopPct + .02), u = r();
        if (u < p) rv = +(0.5 * Math.min(rr1, rr) + .5 * Math.min(rr, 4) * (.6 + r() * .6) - cost).toFixed(3);
        else if (u < p + .1) rv = +((r() - .3) * .25 - cost).toFixed(3);
        else rv = +(-1 - cost).toFixed(3);
        exitTs = new Date(t + (20 + r() * 400) * 6e4).toISOString();
      }
      out.push({
        engine, id: `${engine}-${sym}-${t}-${i}`, ts: new Date(t).toISOString(), symbol: sym, side, setup, level,
        locationKind: loc, confirmTf, entryType, structuralStop: r() > .03, entry, stop, stopPct,
        rr, rr1, touches, riskPct: engine === 'scv2' ? .75 : 1, state, r: rv, exitTs,
      });
    });
  });
  return out;
}
