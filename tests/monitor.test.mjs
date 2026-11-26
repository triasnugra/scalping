import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess, evaluate, rank, heatmap, DEFAULTS } from '../site/quality.mjs';
import { ADAPTERS } from '../scripts/adapters.mjs';
import { generateDemo } from '../scripts/demo.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const good = { setup: 'sweep_reclaim', locationKind: 'range_edge', confirmTf: '15m', entryType: 'limit', structuralStop: true, stopPct: .6, rr: 2.5, touches: 1 };

test('bobot Quality Score berjumlah 100%', () => {
  assert.ok(Math.abs(Object.values(DEFAULTS.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('sweep+reclaim di tepi range, 15m, stop ketat = High Quality', () => {
  const a = assess(good); assert.equal(a.hq, true); assert.equal(a.forced, false);
});
test('momentum/market entry = forced & bukan HQ', () => {
  const a = assess({ ...good, setup: 'momentum', locationKind: 'indicator', entryType: 'market' });
  assert.equal(a.hq, false); assert.equal(a.forced, true); assert.ok(a.flags.includes('CHASING'));
});
test('stop longgar, tengah range, konfirmasi 1H, level jenuh -> bukan HQ', () => {
  assert.equal(assess({ ...good, stopPct: 2.8 }).hq, false);
  assert.equal(assess({ ...good, locationKind: 'mid_range' }).hq, false);
  assert.equal(assess({ ...good, confirmTf: '1h' }).hq, false);
  assert.equal(assess({ ...good, touches: 4 }).hq, false);
});
test('evaluate: skor 0-100, ranking & verdict valid, data kosong aman', () => {
  const d = generateDemo(Date.parse('2026-11-26T00:00:00Z'));
  const ids = [...new Set(d.map(s => s.engine))]; assert.equal(ids.length, 6);
  const ev = rank(ids.map(id => ({ id, ...evaluate(d.filter(s => s.engine === id)) })));
  for (const e of ev) { assert.ok(e.score >= 0 && e.score <= 100); assert.ok(['AKTIFKAN', 'OPTIMIZE', 'PAUSE'].includes(e.verdict.action)); }
  assert.deepEqual(ev.map(e => e.rank).sort(), [1, 2, 3, 4, 5, 6]);
  const empty = evaluate([]); assert.equal(empty.score, null);
  const hm = heatmap(ev[0].sigs, 7); assert.equal(hm.flat().reduce((a, c) => a + c.n, 0), ev[0].n);
});
test('hqOnly tidak mengubah Quality Score', () => {
  const d = generateDemo(Date.parse('2026-11-26T00:00:00Z')).filter(s => s.engine === 'scv2');
  assert.equal(evaluate(d).score, evaluate(d, {}, { hqOnly: true }).score);
});
test('adapter sc/scv3/scv5/scv6 pada jurnal nyata', () => {
  const a = ADAPTERS.sc({ journal: fx('sc.journal.json') }); assert.equal(a.length, 5);
  assert.equal(a.filter(s => s.state === 'closed').length, 5); assert.equal(a[0].setup, 'failed_breakout');
  const b = ADAPTERS.scv3({ signals: fx('scv3.signals.json') }); assert.ok(b.some(s => s.setup === 'momentum' && s.entryType === 'market'));
  const c = ADAPTERS.scv5({ journal: fx('scv5.journal.jsonl') }); assert.equal(c.length, 4); assert.equal(c.filter(s => s.state === 'void').length, 1);
  const d = ADAPTERS.scv6({ journal: fx('scv6.journal.json') }); assert.ok(d.length >= 10 && d.some(s => s.rr > 10));
  for (const s of [...a, ...b, ...c, ...d]) { assert.ok(s.ts && Date.parse(s.ts) > 0); assert.ok(s.stopPct > 0); assert.ok(['long', 'short'].includes(s.side)); }
});
test('adapter scv2 & scv4 (skema dari kode sumber)', () => {
  const j2 = [{ id: 'a', ts: '2026-11-20T10:00:00+00:00', symbol: 'SOLUSDT', side: 'short', trigger: 'T1', tf: '15m', level: 'RANGE_HIGH', entry: 80, entry_type: 'LIMIT', stop: 80.6, stop_pct: .75, rr_tp1: 1.6, rr_tp2: 3, risk_pct: .75, status: 'CLOSED', r: 1.4, exit_ts: '2026-11-20T11:00:00+00:00' }];
  const s2 = ADAPTERS.scv2({ journal: JSON.stringify(j2) })[0]; assert.equal(s2.setup, 'failed_breakout'); assert.equal(s2.locationKind, 'range_edge'); assert.equal(s2.r, 1.4);
  const h4 = { signals: [{ id: 'b', symbol: 'ETH', direction: 'long', trigger: 'T2', level_label: 'Range High H1', time: '2026-11-20T10:00:00+00:00', entry: 100, stop: 99, tp1: 101.5, tp2: 103, status: 'TP1_OPEN', r: .4 }] };
  const s4 = ADAPTERS.scv4({ history: JSON.stringify(h4) })[0]; assert.equal(s4.setup, 'breakout_retest'); assert.equal(s4.state, 'open'); assert.equal(s4.confirmTf, '1h'); assert.equal(s4.stopPct, 1);
});
