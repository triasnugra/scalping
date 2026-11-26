import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assess, evaluate, rank, heatmap, DEFAULTS } from '../site/quality.mjs';
import { netR, tharp, levels, summarize, readiness, hipotesisHarian } from '../site/analytics.mjs';
import { eventSentence, nextEvent, activeWindow } from '../site/events.mjs';
import { ADAPTERS, finalize, inferSetup } from '../scripts/adapters.mjs';
import { generateDemo } from '../scripts/demo.mjs';
import { buildAlerts } from '../scripts/advise.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const good = { setup: 'sweep_reclaim', locationKind: 'range_edge', confirmTf: '15m', entryType: 'limit', structuralStop: true, stopPct: .6, rr: 2.5, touches: 1 };
const demo = () => generateDemo(Date.parse('2026-11-26T00:00:00Z')).map(finalize).map(s => ({ ...s, rNet: true }));

test('bobot Quality Score berjumlah 100%', () => {
  assert.ok(Math.abs(Object.values(DEFAULTS.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('sweep+reclaim di tepi range, 15m, stop ketat = High Quality; momentum = forced', () => {
  assert.equal(assess(good).hq, true);
  const a = assess({ ...good, setup: 'momentum', locationKind: 'indicator', entryType: 'market' });
  assert.equal(a.hq, false); assert.equal(a.forced, true);
  assert.equal(assess({ ...good, stopPct: 2.8 }).hq, false);
  assert.equal(assess({ ...good, confirmTf: '1h' }).hq, false);
});
test('R bersih: biaya dipotong sekali, rNet tidak dipotong lagi', () => {
  assert.ok(Math.abs(netR({ r: 1, stopPct: 1 }, .2) - .8) < 1e-9);
  assert.equal(netR({ r: 1, stopPct: 1, rNet: true }, .2), 1);
  assert.equal(netR({ r: 1 }, .2), 1);
  assert.equal(netR({ r: null, stopPct: 1 }, .2), null);
});
test('biaya menurunkan expectancy mesin (evaluate memakai R bersih)', () => {
  const L = demo().filter(s => s.engine === 'scv2').map(s => ({ ...s, rNet: false }));
  assert.ok(evaluate(L, { costPct: 0 }).full.expR > evaluate(L, { costPct: .5 }).full.expR);
});
test('evaluate: skor 0-100, vonis valid, ranking, data kosong aman', () => {
  const d = demo(), ids = [...new Set(d.map(s => s.engine))]; assert.equal(ids.length, 6);
  const ev = rank(ids.map(id => ({ id, ...evaluate(d.filter(s => s.engine === id)) })));
  for (const e of ev) { assert.ok(e.score >= 0 && e.score <= 100); assert.ok(['AKTIFKAN', 'OPTIMIZE', 'PAUSE'].includes(e.verdict.action)); }
  assert.deepEqual(ev.map(e => e.rank).sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(evaluate([]).score, null);
  assert.equal(heatmap(ev[0].sigs, 7).flat().reduce((a, c) => a + c.n, 0), ev[0].n);
});
test('Tharp, level unik, layak uang nyata', () => {
  const L = demo().filter(s => s.engine === 'scv6');
  const t = tharp(L, .2); assert.ok(t.ok && t.n > 30 && Number.isFinite(t.sqn)); assert.equal(t.biaya, null); // semua rNet pada demo
  const raw = L.map(s => ({ ...s, rNet: false })), t2 = tharp(raw, .2);
  assert.ok(t2.biaya.length === 6 && t2.be != null);
  const lv = levels(raw, .2); assert.ok(lv.ok && lv.u <= lv.n && lv.neff <= lv.n + 1e-9);
  const sm = summarize(raw, .2), r = readiness(sm, { minTrades: 100000, minWeeks: 1, minPF: 1 });
  assert.equal(r.layak, false); assert.equal(r.items.length, 4);
});
test('batas harian membagi sinyal dalam/lewat batas', () => {
  const g = hipotesisHarian(demo(), 3, .2); assert.ok(g.length >= 1); assert.ok(g.every(x => x.n > 0));
});
test('event: kalimat, event berikut, jendela risiko', () => {
  const ev = JSON.parse(readFileSync(new URL('../data/events.json', import.meta.url), 'utf8')), now = Date.parse('2026-11-26T08:00:00Z');
  assert.equal(nextEvent(ev, now).type, 'FOMC');
  const s = eventSentence(ev, now, 7); assert.match(s, /FOMC/); assert.match(s, /Kamis 10 Des 2026 pukul 02\.00 WIB/);
  assert.match(eventSentence(ev, Date.parse('2026-12-09T12:00:00Z'), 7), /CPI|FOMC/);
  assert.ok(activeWindow(ev, Date.parse('2026-12-09T18:00:00Z'), 2, 1)); assert.equal(activeWindow(ev, now, 2, 1), null);
  assert.match(eventSentence([], now), /perbarui/);
});
test('adapter sc/sctn/scv3/scv5/scv6 pada jurnal nyata', () => {
  const a = ADAPTERS.sc({ journal: fx('sc.journal.json') }); assert.equal(a.length, 5); assert.equal(a[0].setup, 'failed_breakout');
  const n = ADAPTERS.sctn({ journal: fx('sc.journal.json') }); assert.equal(n.length, 5); assert.equal(n[0].engine, 'sctn');
  const b = ADAPTERS.scv3({ signals: fx('scv3.signals.json') }); assert.ok(b.some(s => s.setup === 'momentum' && s.entryType === 'market'));
  const c = ADAPTERS.scv5({ journal: fx('scv5.journal.jsonl') }); assert.equal(c.length, 4); assert.ok(c.every(s => s.state !== 'closed' || s.rNet === true));
  const d = ADAPTERS.scv6({ journal: fx('scv6.journal.json') }); assert.ok(d.some(s => s.rr > 10) && d.some(s => s.state === 'open' && s.phase === 'unknown' && s.pair === 'HBARUSDT' && s.tp > 0));
  for (const s of [...a, ...n, ...b, ...c, ...d]) { assert.ok(Date.parse(s.ts) > 0); assert.ok(s.stopPct > 0); assert.ok(['long', 'short'].includes(s.side)); assert.ok(s.outcome); }
  assert.equal(inferSetup('sweep swing high lalu reject', 'short').setup, 'failed_breakout');
  assert.throws(() => ADAPTERS.sctn({ journal: '{}' }));
});
test('adapter scv2 & scv4', () => {
  const j2 = [{ id: 'a', ts: '2026-11-20T10:00:00+00:00', symbol: 'SOLUSDT', side: 'short', trigger: 'T1', tf: '15m', level: 'RANGE_HIGH', entry: 80, entry_type: 'LIMIT', stop: 80.6, stop_pct: .75, rr_tp1: 1.6, rr_tp2: 3, risk_pct: .75, status: 'PENDING' }];
  const s2 = ADAPTERS.scv2({ journal: JSON.stringify(j2) })[0]; assert.equal(s2.setup, 'failed_breakout'); assert.equal(s2.phase, 'pending'); assert.equal(s2.outcome, 'menunggu');
  const h4 = { signals: [{ id: 'b', symbol: 'ETH', direction: 'long', trigger: 'T2', level_label: 'Range High H1', time: '2026-11-20T10:00:00+00:00', entry: 100, stop: 99, tp1: 101.5, tp2: 103, status: 'TP1_OPEN', r: .4 }] };
  const s4 = ADAPTERS.scv4({ history: JSON.stringify(h4) })[0]; assert.equal(s4.state, 'open'); assert.equal(s4.phase, 'running'); assert.equal(s4.confirmTf, '1h');
});
test('notifikasi upgrade: sumber error, kalender habis, mesin forced', () => {
  const M = JSON.parse(readFileSync(new URL('../config/monitor.json', import.meta.url), 'utf8'));
  const cfg = { ...DEFAULTS, costPct: .2 }, now = Date.parse('2030-01-01T00:00:00Z');
  const E = [{ meta: { id: 'x', status: 'error', message: 'gagal' }, ev: null, an: null }];
  const al = buildAlerts(E, { M, cfg, events: [], now, elizAge: null });
  assert.ok(al.some(a => a.key === 'x:SUMBER_ERROR' && a.notify)); assert.ok(al.some(a => a.key === 'monitor:EVENT_HABIS'));
  const L = demo().filter(s => s.engine === 'scv3'), ev = evaluate(L), an = { th: tharp(L, .2), dir: { long: { selesai: 0 }, short: { selesai: 0 } } };
  const al2 = buildAlerts([{ meta: { id: 'scv3', status: 'live' }, ev, an }], { M, cfg, events: [], now: Date.parse('2026-11-26T00:00:00Z'), elizAge: null });
  assert.ok(al2.some(a => a.engine === 'scv3' && a.kategori === 'upgrade')); assert.ok(new Set(al2.map(a => a.key)).size === al2.length);
});
test('build penuh dari fixture lokal + Binance palsu', async () => {
  const { installMock } = await import('./mock-binance.mjs'), restore = installMock();
  const L = join(tmpdir(), 'msc-local'), O = join(tmpdir(), 'msc-out');
  rmSync(L, { recursive: true, force: true }); rmSync(O, { recursive: true, force: true });
  for (const [repo, path, src] of [['sc', 'data/journal.json', 'sc.journal.json'], ['sctn', 'data/journal.json', 'sc.journal.json'], ['scv5', 'data/journal.jsonl', 'scv5.journal.jsonl'], ['scv6', 'data/journal.json', 'scv6.journal.json']]) {
    mkdirSync(join(L, repo + '-main', path, '..'), { recursive: true }); cpSync(new URL(`./fixtures/${src}`, import.meta.url), join(L, repo + '-main', path));
  }
  restore();
  // subproses tidak mewarisi mock: sediakan lewat --import
  const hook = join(tmpdir(), 'msc-hook.mjs');
  await import('node:fs').then(fs => fs.writeFileSync(hook, `import { installMock } from '${new URL('./mock-binance.mjs', import.meta.url).href}'; installMock();`));
  execFileSync('node', ['--import', hook, 'scripts/build.mjs'], { env: { ...process.env, LOCAL_DIR: L, OUT_DIR: O, FAKE_NOW: '2026-11-26T08:00:00Z' }, stdio: 'pipe' });
  const j = n => JSON.parse(readFileSync(join(O, 'data', n), 'utf8'));
  const sig = j('signals.json'), ov = j('overlay.json'), al = j('alerts.json'), lp = j('laporan.json');
  assert.ok(sig.signals.length > 20); assert.ok(sig.engines.some(e => e.id === 'scv2' && e.status === 'error'));
  assert.ok(ov.regime && ['NORMAL', 'SELEKTIF', 'TIDAK TRADING'].includes(ov.regime.status));
  assert.ok(ov.pending.length >= 1 && ov.pending[0].kp); assert.ok(Array.isArray(al.alerts));
  assert.match(lp.live, /Permintaan/); assert.ok(!/\[[A-Z ]{3,}\]/.test(lp.live.replace(/\[(merah|kuning|info)\]/g, '')), 'tidak boleh ada placeholder kurung siku');
  assert.ok(existsSync(join(O, 'data', 'decisions.json')));
});
