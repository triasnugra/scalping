#!/usr/bin/env node
// Build monitor msc: kumpulkan jurnal -> kondisi pasar & keputusan sinyal -> evaluasi kualitas + analitik (R bersih)
// -> notifikasi upgrade -> laporan untuk Claude -> tulis site/data/*.json (dibaca dashboard statis).
// Opsi: --demo (data dummy)   Env: GH_TOKEN, LOCAL_DIR, PREV_PAGES_URL, FAKE_NOW, OUT_DIR
import fs from 'node:fs';
import { collectAll } from './collect.mjs';
import { loadPrev } from './net.mjs';
import { marketRegime, allPrices, decide, tagEliz, updateAudit } from './overlay.mjs';
import { buildAlerts } from './advise.mjs';
import { buildReport } from './report.mjs';
import { evaluate, merge, DEFAULTS } from '../site/quality.mjs';
import { analyze, netR, rankPerDay, hipotesisHarian, hipotesisAkhirPekan } from '../site/analytics.mjs';
import { nextEvent } from '../site/events.mjs';

const rd = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const DAY = 864e5, FORCE_DEMO = process.argv.includes('--demo');
const ENG = rd('config/engines.json'), QJ = rd('config/quality.json'), M = rd('config/monitor.json'), EVENTS = rd('data/events.json');
let EZ = []; try { EZ = rd('data/eliz-posts.json'); } catch { /* opsional */ }
const LOCAL = process.env.LOCAL_DIR || '', TOKEN = process.env.GH_TOKEN || '', PREV = LOCAL || FORCE_DEMO ? '' : (process.env.PREV_PAGES_URL || '');
const NOW = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : Date.now();
const OUT = (process.env.OUT_DIR || 'site') + '/data';
const cfg = merge(DEFAULTS, QJ), cost = cfg.costPct;
const updated = new Date(NOW).toISOString(), today = updated.slice(0, 10);
const extra = []; // alert tambahan dari kegagalan lapisan opsional

// ---- 1. data mesin ----
const prevSignals = (await loadPrev(PREV, 'signals.json', { signals: [] })).signals || [];
const { engines, signals } = await collectAll(ENG, { token: TOKEN, local: LOCAL, forceDemo: FORCE_DEMO, prev: prevSignals, now: NOW });
const since = NOW - M.alertDays * DAY;

// ---- 2. evaluasi tiap mesin (jendela alertDays) ----
const E = engines.map(meta => {
  const all = signals.filter(s => s.engine === meta.id), list = all.filter(s => Date.parse(s.ts) >= since);
  return { meta, ev: evaluate(list, QJ), an: analyze(list, cost, M.validasi), anAll: analyze(all, cost, M.validasi) };
});

// ---- 3. kondisi pasar, harga, keputusan sinyal terbuka ----
let regime = null, prices = {};
if (!FORCE_DEMO) {
  try { regime = await marketRegime(M, NOW); } catch (e) { extra.push({ code: 'PASAR_GAGAL', title: 'Kondisi pasar tidak terambil', detail: e.message, aksi: 'Cek akses Binance (data-api.binance.vision) dari GitHub Actions.' }); }
  try { prices = await allPrices(); } catch (e) { extra.push({ code: 'HARGA_GAGAL', title: 'Harga Binance tidak terambil', detail: e.message, aksi: 'Cek akses Binance dari GitHub Actions.' }); }
}
const rank = rankPerDay(signals), live = new Set(engines.filter(e => e.status === 'live' || (FORCE_DEMO && e.status === 'demo')).map(e => e.id));
const open = signals.filter(s => s.state === 'open' && live.has(s.engine));
const pending = await decide(open, { M, regime, prices, events: EVENTS, now: NOW, rank, offline: FORCE_DEMO });

// ---- 4. audit keputusan & riwayat pasar (disimpan di deploy Pages sebelumnya) ----
const byId = new Map(signals.map(s => [`${s.engine}|${s.id}`, s]));
const { decisions, audit } = updateAudit(await loadPrev(PREV, 'decisions.json', []), pending, byId, today, s => netR(s, cost));
let hist = await loadPrev(PREV, 'regime-history.json', []);
if (regime) hist = hist.filter(h => h.d !== today).concat({ d: today, status: regime.status, vr: regime.volRatio, mode: regime.mode, atr1h: regime.atr1h }).slice(-400);

// ---- 5. uji hipotesis & Eliz ----
const utcD = t => { const x = String(t); return new Date(/(Z|[+-]\d\d:\d\d)$/.test(x) ? x : x + '+07:00').toISOString().slice(0, 10); }; // tanggal tanpa zona dianggap WIB
const byDay = Object.fromEntries(hist.map(h => [h.d, h]));
const vrPosts = [...new Set(EZ.filter(p => tagEliz(p.teks).includes('volume_rendah')).map(p => utcD(p.tgl)))];
const terukur = vrPosts.filter(d => byDay[d]?.vr != null).map(d => ({ d, vr: byDay[d].vr, flag: byDay[d].vr < M.pasar.volRendah }));
const tick = new Set(); EZ.slice(-30).forEach(p => [...String(p.teks).matchAll(/\$([A-Z]{2,10})/g)].forEach(x => tick.add(x[1])));
const last7 = signals.filter(s => Date.parse(s.ts) >= NOW - 7 * DAY).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
const eliz = {
  posts: EZ.slice(-10).reverse(), tickers: [...tick], lastPost: EZ.at(-1)?.tgl ?? null,
  cocok: [...tick].map(t => ({ t, sinyal: engines.map(e => ({ e: e.id, n: last7.filter(s => s.engine === e.id && s.symbol.toUpperCase().startsWith(t)).slice(0, 3).map(s => `${s.side} ${s.ts.slice(5, 10)} ${s.outcome}`) })) })),
  uji: { postVolumeRendah: vrPosts.length, hariTerukur: terukur.length, cocok: terukur.filter(x => x.flag).length, rinci: terukur,
    catatan: 'Ambang volume 0,9 adalah hipotesis. Riwayat harian dimulai sejak deploy pertama monitor ini (tanpa rekonstruksi). Tanggal tanpa zona dianggap WIB.' },
};
const elizAge = eliz.lastPost ? (NOW - Date.parse(utcD(eliz.lastPost))) / DAY : null;
const hypo = { harian: hipotesisHarian(signals, M.dailyCap, cost), akhirPekan: hipotesisAkhirPekan(signals, cost) };

// ---- 6. notifikasi upgrade ----
const alerts = buildAlerts(E, { M, cfg, events: EVENTS, now: NOW, elizAge });
for (const x of extra) alerts.push({ key: 'monitor:' + x.code, engine: 'monitor', code: x.code, level: 'kuning', kategori: 'data', notify: true, ...x });

// ---- 7. laporan untuk Claude (satu per tanggal WIB; hari ini diperbarui terus, lalu membeku) ----
const md = buildReport({ E, alerts, pending, regime, hypo, audit, eliz, ctx: { M, cfg, events: EVENTS, now: NOW }, updated });
const wibD = iso => new Date(new Date(iso).getTime() + 7 * 36e5).toISOString().slice(0, 10);
const hari = wibD(updated), hariId = hari.replace(/-/g, '') + '0100'; // 12 digit sesuai firestore.rules; akhiran 0100 agar tidak bentrok dengan monitortn (0000)
let LG = await loadPrev(PREV, 'laporan-log.json', []);
const cur = LG.find(x => x.d === hari);
if (cur) { cur.t = updated; cur.md = md; } else LG.push({ id: hariId, d: hari, t: updated, md });
const batas = new Date(Date.parse(hari) - (M.laporanHari + 1) * DAY).toISOString().slice(0, 10);
LG = LG.filter(x => x.d >= batas).sort((a, b) => (a.d < b.d ? -1 : 1));

// ---- 8. tulis keluaran ----
fs.mkdirSync(OUT, { recursive: true });
const W = (n, o) => fs.writeFileSync(`${OUT}/${n}`, typeof o === 'string' ? o : JSON.stringify(o));
W('signals.json', { generated: updated, engines, signals });
W('quality.json', QJ); W('monitor.json', M); W('events.json', EVENTS);
W('overlay.json', { updated, regime, pending, audit, hypo, eliz, elizAge, cap: M.dailyCap });
W('alerts.json', { updated, alerts });
W('laporan.json', { updated, hariIni: hari, hariId, live: md, log: LG.map(x => (x.d === hari ? { ...x, md: '' } : x)) });
W('laporan-log.json', LG); W('decisions.json', decisions); W('regime-history.json', hist);
fs.mkdirSync(OUT.replace(/\/data$/, ''), { recursive: true });
fs.writeFileSync(`${OUT.replace(/\/data$/, '')}/.nojekyll`, '');
const ne = nextEvent(EVENTS, NOW);
console.log(`OK ${engines.length} mesin, ${signals.length} sinyal, ${open.length} terbuka, ${alerts.filter(a => a.notify).length} alert notifikasi, event berikut: ${ne ? ne.type + ' ' + ne.utc : '-'}`);
