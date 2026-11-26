import { SETUPS, FLAGS, merge, DEFAULTS, evaluate, rank, heatmap, periodStart } from './quality.mjs';
import { analyze, netR } from './analytics.mjs';
import { eventSentence } from './events.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (x, d = 0, suf = '') => (x == null || Number.isNaN(x) ? '–' : x.toFixed(d) + suf);
const sg = (x, d = 2) => (x == null ? '–' : (x > 0 ? '+' : '') + x.toFixed(d));
const pc = x => (x == null ? '–' : Math.round(x * 100) + '%');
const cls = s => (s == null ? 'mut' : s >= 70 ? 'good' : s >= 50 ? 'warn' : 'bad');
const SESS = { asia: 'Asia', london: 'London', ny: 'New York' };
const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* abaikan */ } } };

const S = { period: '30d', hqOnly: false, tz: 7, sel: null, sort: { k: 'score', dir: -1 }, hmEngine: 'all', hmMetric: 'net', jeng: null };
let DATA, CFG = {}, MON, OV = {}, AL = { alerts: [] }, EV = [], LAP = { log: [] }, E = [], ANN = {}, ALLAN = {};
let remote = {}, fbOnline = null, fbMsg = 'Memuat status penyimpanan…', LK = [];

const COLS = [
  ['rank', '#', e => e.rank],
  ['name', 'Nama mesin', e => e.meta.name],
  ['n', 'Total sinyal', e => e.shown],
  ['hqPct', '% HQ', e => e.hqPct],
  ['wr', 'Win rate', e => e.view.wr],
  ['wrHq', 'WR setup HQ', e => e.hqCore.wr],
  ['exp', 'R bersih/trade', e => e.view.expR],
  ['pf', 'PF', e => e.view.pf],
  ['sqn', 'SQN', e => e.an.th.sqn],
  ['rr', 'Avg R:R', e => e.view.avgRR],
  ['stop', 'Avg stop', e => e.view.avgStop],
  ['mcl', 'Loss beruntun', e => e.view.mcl],
  ['forced', '% forced', e => e.forcedPct],
  ['score', 'Quality score', e => e.score],
  ['verdict', 'Rekomendasi', e => e.verdict.action],
  ['ready', 'Layak uang nyata', e => (e.anAll.ready.layak ? 1 : 0)],
];

async function jget(name, opt = false) {
  try { const r = await fetch('data/' + name + '?' + Date.now(), { cache: 'no-cache' }); if (!r.ok) throw new Error(name + ' HTTP ' + r.status); return await r.json(); }
  catch (e) { if (opt) return null; throw e; }
}

async function load() {
  [DATA, CFG, MON] = await Promise.all([jget('signals.json'), jget('quality.json'), jget('monitor.json')]);
  [OV, AL, EV, LAP] = await Promise.all([jget('overlay.json', true), jget('alerts.json', true), jget('events.json', true), jget('laporan.json', true)]);
  OV ||= {}; AL ||= { alerts: [] }; EV ||= []; LAP ||= { log: [] };
  const cfg = merge(DEFAULTS, CFG);
  for (const m of DATA.engines) { // anotasi seluruh riwayat (tanpa filter periode) untuk jurnal dan syarat layak uang nyata
    const L = DATA.signals.filter(s => s.engine === m.id), ev = evaluate(L, CFG);
    ev.sigs.forEach(s => { ANN[m.id + '|' + s.id] = s.a; });
    ALLAN[m.id] = analyze(L, cfg.costPct, MON.validasi);
  }
  S.jeng = DATA.engines[0]?.id ?? null;
  $('#updated').textContent = 'Diperbarui ' + new Date(DATA.generated).toLocaleString('id-ID');
  $('#hmEngine').innerHTML = '<option value="all">Semua mesin</option>' + DATA.engines.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  render(); notifyBrowser(); initFirebase();
}

function compute() {
  const now = Date.now(), from = periodStart(S.period, now, S.tz), cost = merge(DEFAULTS, CFG).costPct;
  E = rank(DATA.engines.map(meta => {
    const L = DATA.signals.filter(s => s.engine === meta.id && Date.parse(s.ts) >= from), ev = evaluate(L, CFG, { hqOnly: S.hqOnly });
    return { meta, ...ev, an: analyze(ev.viewSigs ?? [], cost, MON.validasi), anAll: ALLAN[meta.id] };
  }));
}

function render() {
  compute();
  eventLine(); banner(); strip(); regime(); cards(); alertsView(); table(); pend(); detail(); journal(); heat(); hypo(); eliz(); lap();
}

// ---------- atas ----------
function eventLine() { $('#event').innerHTML = '📅 ' + esc(eventSentence(EV, Date.now(), S.tz)); }

function banner() {
  const d = DATA.engines.filter(e => e.status === 'demo').map(e => e.id), s = DATA.engines.filter(e => e.status === 'stale').map(e => e.id), r = DATA.engines.filter(e => e.status === 'error').map(e => e.id);
  let h = '';
  if (d.length) h += `<div class="banner">⚠ <b>DATA DUMMY</b> untuk: ${d.join(', ')}. Jangan dipakai sebagai dasar keputusan.</div>`;
  if (s.length) h += `<div class="banner" style="border-color:var(--warn);color:#ffe2a8;background:rgba(242,180,65,.07)">⏱ Data <b>STALE</b> (memakai deploy sebelumnya) untuk: ${s.join(', ')}.</div>`;
  if (r.length) h += `<div class="banner" style="border-color:var(--bad);color:#ffb3bb;background:rgba(239,91,107,.07)">✖ Jurnal <b>tidak terbaca</b>: ${r.join(', ')}. Lihat Notifikasi upgrade untuk penyebabnya.</div>`;
  const n = AL.alerts.filter(a => a.notify).length;
  if (n) h += `<div class="banner" style="border-color:var(--warn);color:#ffe2a8;background:rgba(242,180,65,.07)">🔔 <b>${n} notifikasi upgrade</b> aktif. Lihat bagian Notifikasi upgrade.</div>`;
  document.title = (n ? `(${n}) ` : '') + 'Monitor Scalping (msc)';
  $('#banner').innerHTML = h;
}

function strip() {
  $('#strip').innerHTML = DATA.engines.map(e => `<span class="chip st-${e.status}" title="${esc(e.message)}"><i>●</i> <b>${esc(e.id)}</b> ${e.status.toUpperCase()} · ${e.count}</span>`).join('');
}

function regime() {
  const g = OV.regime;
  if (!g) { $('#regime').innerHTML = '<div class="card" style="margin-bottom:14px"><h3>Kondisi pasar</h3><div class="sub">Tidak tersedia pada build ini (data Binance gagal diambil).</div></div>'; return; }
  const c = g.status === 'NORMAL' ? 'good' : g.status === 'SELEKTIF' ? 'warn' : 'bad';
  $('#regime').innerHTML = `<div class="card" style="margin-bottom:14px"><h3>Kondisi pasar saat build</h3><b class="${c}" style="font-size:18px">${esc(g.status)}</b> <span class="mut">${esc(g.flags.join('; ') || 'kondisi normal')}</span>
    <div class="sub">BTC ATR14 1 jam ${f(g.atr1h, 2, '%')} · volume altcoin ${f(g.volRatio, 2, 'x')} (median 7/60 hari, ${g.volN} koin) · mode 15m <b>${esc(g.mode ?? '–')}</b> (efficiency ratio ${f(g.er, 2)}) · sesi ${esc(SESS[g.sesi] ?? g.sesi)}<br>Mode RANGE paling cocok untuk setup tepi range ala @eliz883; TREND: hati-hati reversal melawan arah. Informasi, bukan pemicu entry.</div></div>`;
}

function cards() {
  const now = Date.now(), all = DATA.signals;
  const cnt = k => all.filter(s => Date.parse(s.ts) >= periodStart(k, now, S.tz)).length;
  const sigs = E.flatMap(e => e.sigs), n = sigs.length;
  const hqS = sigs.filter(s => s.a.hq), hqClosed = hqS.filter(s => s.state === 'closed' && s.r != null), cost = merge(DEFAULTS, CFG).costPct;
  const wrHq = hqClosed.length ? hqClosed.filter(s => netR(s, cost) > .05).length / hqClosed.length * 100 : null;
  const risk = n ? sigs.reduce((a, s) => a + (s.riskPct ?? 1), 0) / n : null;
  const stop = n ? sigs.filter(s => s.stopPct > 0).reduce((a, s, _, arr) => a + s.stopPct / arr.length, 0) : null;
  const forced = n ? sigs.filter(s => s.a.forced).length / n * 100 : null;
  const top = E.filter(e => e.rank).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const hqPct = n ? hqS.length / n * 100 : null, open = DATA.signals.filter(s => s.state === 'open').length;
  $('#cards').innerHTML = `
  <div class="card"><h3>Total sinyal</h3><div class="tri"><div><b>${cnt('today')}</b><span>hari ini</span></div><div><b>${cnt('7d')}</b><span>7 hari</span></div><div><b>${cnt('30d')}</b><span>30 hari</span></div></div><div class="sub">semua mesin · ${open} terbuka</div></div>
  <div class="card"><h3>% Sinyal High Quality</h3><div class="big ${hqPct >= 50 ? 'good' : hqPct >= 25 ? 'warn' : 'bad'}">${f(hqPct, 1, '%')}</div><div class="sub">${hqS.length} dari ${n} sinyal · trigger jelas + invalidation ketat</div></div>
  <div class="card"><h3>Average risk / trade</h3><div class="big">${f(risk, 2, '%')}</div><div class="sub">risiko akun · stop rata-rata ${f(stop, 2, '%')} · biaya ${cost}% pulang-pergi</div></div>
  <div class="card"><h3>Win rate setup berkualitas</h3><div class="big ${wrHq == null ? 'mut' : wrHq >= 45 ? 'good' : wrHq >= 35 ? 'warn' : 'bad'}">${f(wrHq, 1, '%')}</div><div class="sub">${hqClosed.length} trade HQ selesai (setelah biaya)</div></div>
  <div class="card"><h3>% Forced / tanpa trigger jelas</h3><div class="big ${forced <= 20 ? 'good' : forced <= 40 ? 'warn' : 'bad'}">${f(forced, 1, '%')}</div><div class="sub">gabungan semua mesin</div></div>
  <div class="card"><h3>Ranking Quality Score</h3><ul class="rk">${top.map(e => `<li><span>${e.rank}. ${esc(e.meta.id)}</span><b class="${cls(e.score)}">${f(e.score)}</b></li>`).join('') || '<li class="mut">Belum ada data</li>'}</ul></div>`;
}

// ---------- notifikasi upgrade ----------
function alertsView() {
  const A = AL.alerts, act = A.filter(a => a.level !== 'info'), inf = A.filter(a => a.level === 'info');
  const row = a => `<div class="al ${esc(a.level)}"><b class="${esc(a.level)}">${esc(a.level.toUpperCase())}</b> <b>${esc(a.engine)}</b> · ${esc(a.title)}${a.kategori === 'data' ? ' <span class="mut">(data)</span>' : ''}<small>${esc(a.detail)}</small><small>Saran: ${esc(a.aksi)}</small></div>`;
  $('#alerts').innerHTML = (act.length ? act.map(row).join('') : '<div class="card"><span class="good">Tidak ada notifikasi upgrade.</span> <span class="mut">Bukan berarti mesin bagus: lihat Quality Score dan syarat layak uang nyata.</span></div>')
    + (inf.length ? `<details><summary>${inf.length} catatan info</summary>${inf.map(row).join('')}</details>` : '')
    + `<div class="sub">Dihitung saat build dari ${MON.alertDays} hari terakhir, ambang di config/monitor.json. Semua adalah hipotesis; jangan mengubah mesin yang sedang forward test tanpa protokol baru.</div>`;
}

async function notifyBrowser() {
  const btn = $('#notif'), keys = AL.alerts.filter(a => a.notify).map(a => a.key);
  if (!('Notification' in window)) { btn.style.display = 'none'; return; }
  const on = LS.get('msc:notif') === '1' && Notification.permission === 'granted';
  btn.textContent = on ? '🔔 Notifikasi browser: aktif' : '🔔 Notifikasi browser';
  if (!on) return;
  const seen = new Set((LS.get('msc:seen') || '').split('|').filter(Boolean)), fresh = keys.filter(k => !seen.has(k));
  if (fresh.length) { try { new Notification(`Monitor scalping: ${fresh.length} notifikasi upgrade baru`, { body: fresh.slice(0, 4).join('\n') }); } catch { /* abaikan */ } }
  LS.set('msc:seen', keys.join('|'));
}
$('#notif').onclick = async () => {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  LS.set('msc:notif', p === 'granted' ? '1' : ''); LS.set('msc:seen', '');
  notifyBrowser();
};

// ---------- perbandingan ----------
function table() {
  const { k, dir } = S.sort, col = COLS.find(c => c[0] === k) || COLS.find(c => c[0] === 'score');
  const rows = [...E].sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  const th = COLS.map(([key, label]) => `<th data-k="${key}" class="${S.sort.k === key ? 'on' : ''}">${label}${S.sort.k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = rows.map(e => `<tr class="row ${S.sel === e.meta.id ? 'sel' : ''}" data-id="${e.meta.id}">
    <td class="n">${e.rank ?? '–'}</td>
    <td class="l"><b>${esc(e.meta.name)}</b> <span class="chip st-${e.meta.status}" style="padding:0 6px"><i>●</i> ${e.meta.status}</span></td>
    <td class="n">${e.shown}${S.hqOnly ? ` <span class="mut">/ ${e.n}</span>` : ''}</td>
    <td class="n ${e.hqPct >= 50 ? 'good' : e.hqPct < 25 ? 'bad' : ''}">${f(e.hqPct, 1, '%')}</td>
    <td class="n">${f(e.view.wr, 1, '%')}</td>
    <td class="n">${f(e.hqCore.wr, 1, '%')} <span class="mut">(${e.hqCore.closedN})</span></td>
    <td class="n ${e.view.expR < 0 ? 'bad' : e.view.expR > 0 ? 'good' : ''}">${sg(e.view.expR)}</td>
    <td class="n">${f(e.view.pf, 2)}</td>
    <td class="n">${f(e.an.th.sqn, 2)}${e.an.th.ok && e.an.th.n < 30 ? ' <span class="warn">(N&lt;30)</span>' : ''}</td>
    <td class="n">${f(e.view.avgRR, 2)}${e.view.avgRR1 != null ? ` <span class="mut">/ ${f(e.view.avgRR1, 2)}</span>` : ''}</td>
    <td class="n ${e.view.avgStop > 1.5 ? 'bad' : e.view.avgStop <= 1 ? 'good' : ''}">${f(e.view.avgStop, 2, '%')}</td>
    <td class="n ${e.view.mcl >= 5 ? 'bad' : ''}">${e.view.mcl}</td>
    <td class="n ${e.forcedPct >= 40 ? 'bad' : e.forcedPct <= 15 ? 'good' : ''}">${f(e.forcedPct, 1, '%')}</td>
    <td><span class="pill p-${cls(e.score)}">${f(e.score)}</span></td>
    <td><span class="tag p-${e.verdict.cls}">${e.verdict.action}</span></td>
    <td class="${e.anAll.ready.layak ? 'ok' : 'no'}">${e.anAll.ready.layak ? 'LAYAK' : 'BELUM'}</td></tr>`).join('');
  $('#tbl').innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`;
}

// ---------- sinyal terbuka ----------
const tfmt = (iso, mode = 'dt') => { const d = new Date(Date.parse(iso) + S.tz * 36e5).toISOString(); return mode === 'dt' ? d.slice(5, 16).replace('T', ' ') : d.slice(0, 10); };
const TZN = { 7: 'WIB', 8: 'WITA', 9: 'WIT', 0: 'UTC' };
const dfull = iso => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + S.tz * 36e5).toISOString().slice(0, 16).replace('T', ' ') : '–');
const dur = (a, b) => { const m = Math.round((Date.parse(b) - Date.parse(a)) / 6e4); if (!Number.isFinite(m) || m < 0) return '–'; return m < 60 ? m + ' mnt' : m < 2880 ? (m / 60).toFixed(1) + ' jam' : (m / 1440).toFixed(1) + ' hari'; };
const kcls = kp => 'k-' + String(kp).split(' ')[0];
function pend() {
  const P = OV.pending || [];
  const body = P.length ? P.map(r => `<tr><td class="l"><b>${esc(r.e)}</b></td><td class="l">${esc(r.sym)}</td><td class="l ${r.side === 'long' ? 'good' : 'bad'}">${r.side === 'long' ? 'LONG' : 'SHORT'}</td><td class="n">${esc(r.entry)}</td><td class="n">${esc(r.sl)}</td><td class="n">${esc(r.tp ?? '–')}</td><td class="n">${esc(r.px ?? '–')}</td><td class="n">${r.dist == null ? '–' : f(r.dist, 2, '%')}</td><td class="l num">${dfull(r.ts)}</td><td class="n">${dur(r.ts, new Date().toISOString())}</td><td class="l"><b class="${kcls(r.kp)}">${esc(r.kp)}</b></td><td class="l" style="white-space:normal;min-width:240px">${esc(r.kn)}</td></tr>`).join('')
    : '<tr><td colspan="12" class="mut l">Tidak ada sinyal terbuka dari mesin dengan data LIVE.</td></tr>';
  $('#pend').innerHTML = `<thead><tr><th class="l">Mesin</th><th class="l">Koin</th><th class="l">Arah</th><th>Entry</th><th>SL</th><th>TP</th><th>Harga</th><th>Jarak ke entry</th><th class="l">Tgl analisis (${TZN[S.tz]})</th><th>Umur</th><th class="l">Keputusan monitor</th><th class="l">Catatan</th></tr></thead><tbody>${body}</tbody>`;
}

// ---------- grafik ----------
function lineChart(series, w = 560, h = 210) {
  const pts = series.flatMap(s => s.pts);
  if (!pts.length) return '<div class="sub" style="padding:40px 0;text-align:center">Belum ada trade selesai pada seri ini.</div>';
  const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t)) || t0 + 1;
  const lo = Math.min(0, ...pts.map(p => p.r)), hi = Math.max(0.5, ...pts.map(p => p.r)), P = { l: 38, r: 10, t: 10, b: 20 };
  const X = t => P.l + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (w - P.l - P.r), Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (h - P.t - P.b);
  const grid = [lo, 0, hi].map(v => `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#222d44" ${v === 0 ? 'stroke-dasharray="3 3"' : ''}/><text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}R</text>`).join('');
  const lines = series.map(s => s.pts.length ? `<polyline fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="4 3" opacity=".6"' : ''} points="${s.pts.map(p => `${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ')}"/>` : '').join('');
  const fmt = t => new Date(t + S.tz * 36e5).toISOString().slice(5, 10);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">${grid}${lines}<text x="${P.l}" y="${h - 4}">${fmt(t0)}</text><text x="${w - P.r}" y="${h - 4}" text-anchor="end">${fmt(t1)}</text></svg>`;
}

function histo(bins, lab = ['semua sinyal', 'High Quality']) {
  const mx = Math.max(1, ...bins.map(b => b.n)), w = 560, h = 190, bw = (w - 20) / bins.length;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%">${bins.map((b, i) => {
    const bh = b.n / mx * (h - 44), hh = (b.hq ?? 0) / mx * (h - 44), x = 10 + i * bw;
    return `<rect x="${x + 4}" y="${h - 22 - bh}" width="${bw - 8}" height="${bh}" rx="3" fill="#3a4a6e"/>${b.hq != null ? `<rect x="${x + 4}" y="${h - 22 - hh}" width="${bw - 8}" height="${hh}" rx="3" fill="var(--good)"/>` : ''}
    <text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle">${b.label}</text><text x="${x + bw / 2}" y="${h - 26 - bh}" text-anchor="middle" style="fill:var(--txt)">${b.n || ''}</text>`;
  }).join('')}</svg><div class="legend"><i style="background:#3a4a6e"></i>${lab[0]}${lab[1] ? `<i style="background:var(--good)"></i>${lab[1]}` : ''}</div>`;
}

// ---------- detail mesin ----------
function detail() {
  const e = E.find(x => x.meta.id === S.sel);
  if (!e) { $('#detail').innerHTML = ''; return; }
  const cost = merge(DEFAULTS, CFG).costPct, W = merge(DEFAULTS, CFG).weights;
  const labels = { trigger: 'Trigger & Invalidation', structure: 'Struktur Range / Level', stop: 'Ketatnya Stop Loss', winrate: 'Win Rate Setup Berkualitas', sample: 'Sampel & Konsistensi', patience: 'Patience' };
  const comp = e.components ? Object.keys(W).map(k => `<div>${labels[k]} <span class="mut">${(W[k] * 100).toFixed(0)}%</span></div><div class="bar"><i style="width:${e.components[k]}%;background:var(--${cls(e.components[k]) === 'mut' ? 'acc' : cls(e.components[k])})"></i></div><div class="num" style="text-align:right">${f(e.components[k])} <span class="mut">→ ${f(e.components[k] * W[k], 1)}</span></div>`).join('') : '<div class="sub">Belum ada sinyal.</div>';
  const setups = (e.bySetup || []).map(x => `<tr><td class="l">${esc(x.label)}</td><td class="n">${x.n}</td><td class="n">${f(x.hqPct, 0, '%')}</td><td class="n">${x.closedN}</td><td class="n">${f(x.wr, 0, '%')}</td><td class="n ${x.expR < 0 ? 'bad' : x.expR > 0 ? 'good' : ''}">${sg(x.expR)}</td><td class="n">${f(x.avgStop, 2, '%')}</td></tr>`).join('');
  const sess = (e.bySession || []).map(x => `<tr><td class="l">${SESS[x.key]}</td><td class="n">${x.n}</td><td class="n">${f(x.hqPct, 0, '%')}</td><td class="n">${x.closedN}</td><td class="n">${f(x.wr, 0, '%')}</td><td class="n ${x.expR < 0 ? 'bad' : x.expR > 0 ? 'good' : ''}">${sg(x.expR)}</td><td class="n ${x.hqExp < 0 ? 'bad' : x.hqExp > 0 ? 'good' : ''}">${sg(x.hqExp)} <span class="mut">(${x.hqN})</span></td></tr>`).join('');
  const last = (e.last10 || []).map(s => {
    const out = s.state === 'closed' ? `<b class="${netR(s, cost) > .05 ? 'good' : netR(s, cost) < -.05 ? 'bad' : 'mut'}">${sg(netR(s, cost))}R</b>` : s.state === 'open' ? '<span class="warn">OPEN</span>' : '<span class="mut">tidak terisi</span>';
    const fl = s.a.flags.slice(0, 4).map(c => `<span class="fl">${esc(FLAGS[c])}</span>`).join('');
    return `<tr><td class="l num">${dfull(s.ts)}</td><td class="l num">${s.state === 'closed' ? dfull(s.exitTs) : '–'}</td><td class="l">${esc(s.symbol)} <span class="${s.side === 'long' ? 'good' : 'bad'}">${s.side === 'long' ? 'L' : 'S'}</span></td><td class="l">${esc(SETUPS[s.setup]?.label ?? s.setup)}</td><td class="n">${f(s.stopPct, 2, '%')}</td><td class="n">${f(s.rr, 1)}</td><td class="n">${out}</td><td class="l">${s.a.hq ? '<span class="ok">✓ HQ</span>' : '<span class="no">✗</span>'} <span class="mut">${f(s.a.q)}</span></td><td class="l" style="white-space:normal;min-width:220px">${s.a.hq ? '<span class="mut">memenuhi semua kriteria</span>' : fl}</td></tr>`;
  }).join('');
  const rec = { AKTIFKAN: 'Layak diaktifkan', OPTIMIZE: 'Perlu di-optimize', PAUSE: 'Sebaiknya di-pause', 'NO DATA': 'Belum ada data' }[e.verdict.action];
  const th = e.an.th, lv = e.anAll.lv, rd = e.anAll.ready, mine = AL.alerts.filter(a => a.engine === e.meta.id && a.level !== 'info');
  const tharpBox = th.ok ? `<div class="sub">N=${th.n} · R bersih/trade ${sg(th.mean)} · SD ${f(th.sd, 2)} · SQN <b>${f(th.sqn, 2)}</b> (SQN100 ${f(th.sqn100, 2)}, ${esc(th.cls)})${th.n < 30 ? ' <span class="warn">N&lt;30: jangan ditafsirkan</span>' : ''}<br>3 trade teratas = ${th.top3 == null ? '–' : f(th.top3 * 100, 0, '%')} dari total untung · R/trade tanpa 3 teratas ${sg(th.meanEx3)}</div>
    ${th.biaya ? `<div class="sub">Sensitivitas biaya (${th.grossN} trade dengan R mentah): biaya impas <b class="${th.be < cost ? 'bad' : th.be < cost * 1.5 ? 'warn' : ''}">${f(th.be, 2, '%')}</b> pulang-pergi (asumsi ${cost}%).<br>${th.biaya.map(b => `biaya ${b.c}% → ${sg(b.r)}R`).join(' · ')}</div>` : '<div class="sub">Sensitivitas biaya tidak tersedia: R mesin ini sudah bersih biaya atau stop tidak tercatat.</div>'}
    <div class="sub">Distribusi R bersih: ${th.dist.map(d => `${d.l}: <b>${d.n}</b>`).join(' · ')}</div>` : '<div class="sub">Data belum cukup (butuh ≥ 2 trade selesai).</div>';
  const lvBox = lv.ok ? `<div class="sub">${lv.n} baris selesai = <b>${lv.u}</b> level unik (duplikat ${lv.dup}) · N efektif ${f(lv.neff, 0)} · R/level ${sg(lv.mean)} (SQN level ${f(lv.sqn, 2)}${lv.u < 30 ? ', N&lt;30' : ''}) · paling berulang ${esc(lv.big.sym)} ${esc(lv.big.side)} ${lv.big.n}x<br>Baris di level yang sama sering keluar bersamaan: bukan bukti independen. Seluruh riwayat, tanpa filter periode.</div>` : '<div class="sub">Belum ada trade selesai.</div>';
  $('#detail').innerHTML = `
  <h2>Detail: ${esc(e.meta.name)} <small>${esc(e.meta.repo)} · status ${e.meta.status}</small></h2>
  <div class="grid">
    <div class="card full"><div class="hd">
      <div><h3>Quality Score</h3><div class="score ${cls(e.score)}">${f(e.score, 1)}</div><div class="sub">Rank #${e.rank ?? '–'} dari ${E.length}</div></div>
      <div style="flex:1;min-width:260px"><span class="tag p-${e.verdict.cls}" style="font-size:13px;padding:4px 10px">${e.verdict.action}</span> <b>${rec}</b> <span class="mut">(keyakinan data: ${e.verdict.confidence ?? '–'})</span>
        <ul class="n">${e.verdict.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
      <div class="sub" style="min-width:200px">Trade selesai: <b class="num" style="color:var(--txt)">${e.full.closedN}</b> · R bersih/trade ${sg(e.full.expR)}<br>Total ${sg(e.full.totalR, 1)}R · PF ${f(e.full.pf, 2)} · Max DD ${f(e.full.maxDD, 1)}R<br>R bersih HQ ${sg(e.hqCore.expR)} (n=${e.hqCore.closedN}) · ${f(e.spd, 1)} sinyal/hari</div>
    </div></div>
    <div class="card"><h3>Rincian skor (nilai → kontribusi)</h3><div class="cmp">${comp}</div></div>
    <div class="card"><h3>Catatan kelemahan mesin</h3><ul class="n">${(e.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>${mine.length ? '<h3 style="margin-top:12px">Notifikasi upgrade mesin ini</h3>' + mine.map(a => `<div class="al ${esc(a.level)}"><b>${esc(a.title)}</b><small>${esc(a.aksi)}</small></div>`).join('') : ''}</div>
    <div class="card"><h3>Syarat layak uang sungguhan (seluruh riwayat, hipotesis)</h3><div class="chk">${rd.items.map(x => `<div><span class="${x[0] ? 'good' : 'bad'}">${x[0] ? '✔' : '✖'}</span> ${esc(x[1])}</div>`).join('')}</div><div class="sub">Ambang: config/monitor.json (validasi). Bila belum layak dan tetap trading, risiko maks 0,25% per trade.</div></div>
    <div class="card"><h3>Uji ala Van Tharp & biaya (periode terpilih)</h3>${tharpBox}</div>
    <div class="card full"><h3>Level unik (trade independen)</h3>${lvBox}</div>
    <div class="card"><h3>Breakdown jenis setup ${S.hqOnly ? '(HQ saja)' : ''}</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Setup</th><th>Sinyal</th><th>% HQ</th><th>Selesai</th><th>WR</th><th>R bersih</th><th>Avg stop</th></tr></thead><tbody>${setups}</tbody></table></div></div>
    <div class="card"><h3>Performa per sesi (UTC: Asia 22–08 · London 08–13 · NY 13–22)</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Sesi</th><th>Sinyal</th><th>% HQ</th><th>Selesai</th><th>WR</th><th>R bersih</th><th>R bersih HQ</th></tr></thead><tbody>${sess}</tbody></table></div></div>
    <div class="card"><h3>Equity curve bersih biaya — sinyal HQ (kumulatif R)</h3>${lineChart([{ pts: e.full.equity, color: '#56627f', dash: 1 }, { pts: e.hqCore.equity, color: '#2ecc8f' }])}<div class="legend"><i style="background:#2ecc8f"></i>HQ saja<i style="background:#56627f"></i>semua sinyal (pembanding)</div></div>
    <div class="card"><h3>Distribusi jarak stop loss (% dari entry)</h3>${histo(e.stopDist || [])}</div>
    <div class="card full"><h3>10 sinyal terakhir & penilaian kualitas</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Tgl analisis</th><th class="l">Tgl hasil</th><th class="l">Simbol</th><th class="l">Setup</th><th>Stop</th><th>R:R</th><th>Hasil</th><th class="l">Standar</th><th class="l">Alasan</th></tr></thead><tbody>${last || '<tr><td colspan="9" class="mut">Tidak ada sinyal.</td></tr>'}</tbody></table></div></div>
  </div>`;
}

// ---------- jurnal riwayat ----------
// Tgl hasil = waktu keluar menurut jurnal mesin. Order tidak terisi/kedaluwarsa diberi label; belum selesai = menunggu/berjalan.
function hasilTgl(s) {
  if (s.state === 'closed') return s.exitTs ? dfull(s.exitTs) : '<span class="mut">tidak dicatat mesin</span>';
  if (s.state === 'void') return s.exitTs ? dfull(s.exitTs) + ' <span class="mut">(tidak terisi/kedaluwarsa)</span>' : '<span class="mut">tidak terisi</span>';
  return `<span class="warn">${s.phase === 'running' ? 'berjalan' : 'belum selesai'}</span>`;
}
function journal() {
  $('#jtabs').innerHTML = DATA.engines.map(m => `<button class="${S.jeng === m.id ? 'on' : ''}" data-e="${m.id}">${esc(m.id)}</button>`).join('');
  const q = $('#jq').value.trim().toUpperCase(), P = new Map((OV.pending || []).map(r => [r.e + '|' + r.id, r]));
  const all = DATA.signals.filter(s => s.engine === S.jeng).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)), cost = merge(DEFAULTS, CFG).costPct;
  const rows = q ? all.filter(s => String(s.symbol).toUpperCase().includes(q)) : all.slice(0, 150);
  $('#jinfo').textContent = q ? `Menampilkan ${rows.length} baris "${q}" dari ${all.length}.` : `Menampilkan ${rows.length} baris terbaru dari ${all.length}; ketik koin untuk mencari semua baris. R = bersih setelah biaya.`;
  const body = rows.map(s => {
    const p = P.get(s.engine + '|' + s.id), a = ANN[s.engine + '|' + s.id];
    const mon = p ? `<b class="${kcls(p.kp)}">${esc(p.kp)}</b>` : a ? (a.hq ? '<span class="ok">✓ HQ</span>' : '<span class="no">✗</span>') + ` <span class="mut">${f(a.q)}</span>` : '–';
    const cat = p ? p.kn : a ? (a.hq ? 'memenuhi semua kriteria' : a.flags.slice(0, 3).map(c => FLAGS[c]).join('; ')) : '';
    const r = s.state === 'closed' ? netR(s, cost) : null;
    return `<tr><td class="l"><b>${esc(s.engine)}</b></td><td class="l">${esc(s.symbol)}</td><td class="l ${s.side === 'long' ? 'good' : 'bad'}">${s.side === 'long' ? 'LONG' : 'SHORT'}</td><td class="n">${esc(s.entry)}</td><td class="n">${esc(s.stop)}</td><td class="n">${esc(s.tp ?? '–')}</td><td class="n">${p?.px ?? '–'}</td><td class="n">${p?.dist == null ? '–' : f(p.dist, 2, '%')}</td><td class="l num">${dfull(s.ts)}</td><td class="l num">${hasilTgl(s)}</td><td class="n">${s.state === 'closed' || (s.state === 'void' && s.exitTs) ? dur(s.ts, s.exitTs) : s.state === 'open' ? dur(s.ts, new Date().toISOString()) + ' <span class="mut">(berjalan)</span>' : '–'}</td><td class="l">${mon}</td><td class="l" style="white-space:normal;min-width:240px">${esc(cat)}${s.note ? ' <span class="mut">· ' + esc(String(s.note).slice(0, 90)) + '</span>' : ''}</td><td class="l ${esc(s.outcome === 'TP' ? 'good' : s.outcome === 'SL' ? 'bad' : 'mut')}">${esc(s.outcome)}</td><td class="n ${r > 0 ? 'good' : r < 0 ? 'bad' : ''}">${r == null ? '–' : sg(r)}</td></tr>`;
  }).join('');
  $('#jtbl').innerHTML = `<thead><tr><th class="l">Mesin</th><th class="l">Koin</th><th class="l">Arah</th><th>Entry</th><th>SL</th><th>TP</th><th>Harga</th><th>Jarak ke entry</th><th class="l">Tgl analisis (${TZN[S.tz]})</th><th class="l">Tgl hasil (${TZN[S.tz]})</th><th>Durasi</th><th class="l">Keputusan monitor</th><th class="l">Catatan</th><th class="l">Hasil</th><th>R bersih</th></tr></thead><tbody>${body || '<tr><td colspan="15" class="mut l">Tidak ada baris.</td></tr>'}</tbody>`;
}

// ---------- heatmap ----------
function heat() {
  const sigs = S.hmEngine === 'all' ? E.flatMap(e => e.sigs) : (E.find(e => e.meta.id === S.hmEngine)?.sigs ?? []);
  const g = heatmap(sigs, S.tz), m = S.hmMetric;
  const val = c => m === 'net' ? c.hq - c.lq : m === 'ratio' ? (c.n ? c.hq / c.n * 100 : null) : c.n;
  const flat = g.flat().map(val).filter(v => v != null), mx = Math.max(1, ...flat.map(Math.abs));
  const color = v => {
    if (v == null || (m !== 'ratio' && v === 0)) return '#161f31';
    if (m === 'count') return `rgba(90,162,255,${.15 + .85 * v / mx})`;
    if (m === 'ratio') return `hsl(${v * 1.2},65%,${22 + v * .1}%)`;
    return v > 0 ? `rgba(46,204,143,${.18 + .82 * v / mx})` : `rgba(239,91,107,${.18 + .82 * -v / mx})`;
  };
  let h = '<div></div>' + Array.from({ length: 24 }, (_, i) => `<div class="lbl" style="justify-content:center;height:14px">${i % 3 === 0 ? i : ''}</div>`).join('');
  g.forEach((row, d) => {
    h += `<div class="lbl">${DAYS[d]}</div>`;
    row.forEach((c, hr) => { const v = val(c); h += `<div style="background:${color(v)};color:#fff" title="${DAYS[d]} ${String(hr).padStart(2, '0')}:00 · HQ ${c.hq} / non-HQ ${c.lq}">${c.n && m !== 'ratio' ? (m === 'net' ? sg(v, 0) : v) : ''}</div>`; });
  });
  $('#hm').innerHTML = h;
  $('#hmLegend').innerHTML = m === 'net' ? '<i style="background:var(--bad)"></i>lebih banyak sinyal buruk<i style="background:#161f31"></i>netral/kosong<i style="background:var(--good)"></i>lebih banyak sinyal HQ'
    : m === 'ratio' ? '<i style="background:hsl(0,65%,22%)"></i>0% HQ<i style="background:hsl(120,65%,32%)"></i>100% HQ' : '<i style="background:rgba(90,162,255,.9)"></i>lebih banyak sinyal';
}

// ---------- uji hipotesis & Eliz ----------
function hypo() {
  const H = OV.hypo; if (!H) { $('#hypo').innerHTML = ''; return; }
  const line = g => `${esc(g.g)}: n=${g.n}, TP ${g.tp}, R bersih/trade ${sg(g.r)}${g.se != null ? ' ± ' + f(g.se, 2) : ''}`;
  const A = OV.audit || { grup: [], total: 0, catatan: '' };
  $('#hypo').innerHTML = `<h2>Uji hipotesis <small>bukan aturan mesin; dibaca bila tiap grup ≥ 30 trade · dihitung saat build, seluruh riwayat</small></h2>
  <div class="grid">
    <div class="card"><h3>Batas harian (${OV.cap}/hari)</h3>${H.harian.map(g => `<div>${line(g)}</div>`).join('') || '<div class="sub">Belum ada data.</div>'}<div class="sub">Sinyal ke-${OV.cap + 1} dst pada hari yang sama dibanding sinyal dalam batas.</div></div>
    <div class="card"><h3>Akhir pekan vs hari kerja</h3>${H.akhirPekan.map(g => `<div>${line(g)}</div>`).join('') || '<div class="sub">Belum ada data.</div>'}<div class="sub">Hipotesis dari postingan @eliz883 (candle akhir pekan, order book tipis). Selisih &lt; 2 galat baku belum berarti.</div></div>
    <div class="card"><h3>Audit keputusan monitor</h3>${A.grup.map(g => `<div>${esc(g.g)}: n=${g.n}, TP ${g.tp}, R bersih/trade ${sg(g.r)}</div>`).join('') || '<div class="sub">Belum ada sinyal selesai yang keputusannya tercatat.</div>'}<div class="sub">${A.total} keputusan tercatat. ${esc(A.catatan)}</div></div>
  </div>`;
}

function eliz() {
  const Z = OV.eliz; if (!Z) { $('#eliz').innerHTML = ''; return; }
  const u = Z.uji, old = OV.elizAge != null && OV.elizAge > MON.elizMaxHari;
  $('#eliz').innerHTML = `<h2>@eliz883: kecocokan</h2><div class="card">${old ? `<div class="warn">Postingan terakhir di monitor ${Math.round(OV.elizAge)} hari lalu. Perbarui data/eliz-posts.json.</div>` : ''}Postingan terakhir: ${esc(Z.lastPost || '–')} · ticker disebut: ${esc(Z.tickers.join(', ') || '–')}
    <div class="wrap" style="border:0"><table>${Z.cocok.map(c => `<tr><td class="l">$${esc(c.t)}</td><td class="l">${c.sinyal.map(s => esc(s.e) + ': ' + esc(s.n.join('; ') || 'tidak ada sinyal 7 hari')).join(' | ')}</td></tr>`).join('')}</table></div>
    <div class="sub">Uji volume: postingan volume rendah ${u.postVolumeRendah}, hari terukur ${u.hariTerukur}, cocok ${u.cocok}. ${esc(u.catatan)}</div></div>`;
}

// ---------- laporan untuk Claude ----------
const wibHari = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
const selisih = d => Math.round((Date.parse(wibHari()) - Date.parse(d)) / 864e5);
const lapTanggal = id => (fbOnline === true ? (remote[id] || '') : (LS.get('lap:' + id) || ''));
function lapState(l) { const r = lapTanggal(l.id); if (r) return { c: 'hijau', r }; return { c: l.d && selisih(l.d) >= MON.laporanHari ? 'biru' : '', r: '' }; }
function lapKartu(l, judul, info, i, md) {
  const s = lapState(l), id = esc(l.id);
  return `<div class="card ${s.c}"><b>${judul}</b><br><small class="mut">${info}</small><br><b>${s.c === 'hijau' ? 'Sudah dilaporkan: ' + esc(s.r) : s.c === 'biru' ? 'BELUM dilaporkan; hari terakhir tampil' : 'Belum dilaporkan'}</b><br>
    <button data-copy="${i}">Salin laporan</button> <input type="date" id="d${id}" value="${esc(s.r || wibHari())}"><button data-save="${id}">Simpan tanggal lapor</button>${s.r ? `<button data-clear="${id}">Hapus</button>` : ''}
    <textarea readonly>${esc(md)}</textarea></div>`;
}
function lap() {
  if (!LAP.live) { $('#lap').innerHTML = ''; return; }
  LK = (LAP.log || []).filter(l => { const k = selisih(l.d); return k >= 1 && k <= MON.laporanHari; });
  let h = `<h2>Laporan untuk Claude</h2><div class="card"><small class="mut">Status penyimpanan: ${esc(fbMsg)}</small></div><small class="mut">Satu laporan per tanggal WIB: sampai ${MON.laporanHari} laporan harian (beku, tampil ${MON.laporanHari} hari) + 1 laporan live. Biru = belum dilaporkan sampai hari terakhir tampil; hijau = sudah dilaporkan. Salin ke chat Claude.</small><div class="kol">`;
  LK.forEach((l, i) => { h += lapKartu(l, `Laporan ${esc(l.d)}`, `Terakhir diperbarui ${esc(l.t.slice(0, 16).replace('T', ' '))} UTC · tampil sisa ${MON.laporanHari + 1 - selisih(l.d)} hari`, i, l.md); });
  h += lapKartu({ id: LAP.hariId, d: LAP.hariIni }, `LIVE (${esc(LAP.hariIni)})`, `Diperbarui ${esc(LAP.updated.slice(0, 16).replace('T', ' '))} UTC; menjadi laporan harian mulai besok`, 'live', LAP.live);
  $('#lap').innerHTML = h + '</div>';
}
async function writeTgl(id, v) {
  LS.set('lap:' + id, v);
  if (window.LapDB) {
    try { await window.LapDB.set(id, v); remote[id] = v; fbOnline = true; fbMsg = 'Tersimpan ke Firebase.'; }
    catch (e) { fbOnline = false; fbMsg = 'Gagal simpan ke Firebase (' + (e.code || e.message) + '). Tersimpan lokal saja.'; }
  }
  lap();
}
$('#lap').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.copy != null) navigator.clipboard.writeText(b.dataset.copy === 'live' ? LAP.live : LK[+b.dataset.copy].md);
  else if (b.dataset.save) { const v = document.getElementById('d' + b.dataset.save).value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) writeTgl(b.dataset.save, v); }
  else if (b.dataset.clear) writeTgl(b.dataset.clear, '');
});

// Firebase (opsional): tanggal lapor dibagi lintas perangkat. Memakai proyek & aturan monitortn yang sudah ada; id berakhiran 0100.
async function initFirebase() {
  const cfg = { apiKey: 'AIzaSyAKFgWdeXzNkeAqZn40ylzWB6oF3cML5EY', authDomain: 'monitortn.firebaseapp.com', projectId: 'monitortn', storageBucket: 'monitortn.firebasestorage.app', messagingSenderId: '767147872981', appId: '1:767147872981:web:ed61d90e2f9fab7108c85c' };
  try {
    const A = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'), F = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
    const db = F.getFirestore(A.initializeApp(cfg, 'msc'));
    F.onSnapshot(F.collection(db, 'laporan'),
      s => { const m = {}; s.forEach(x => { if (/0100$/.test(x.id)) m[x.id] = x.data().tanggal || ''; }); remote = m; fbOnline = true; fbMsg = 'Tersambung ke Firebase (realtime).'; lap(); },
      e => { fbOnline = false; fbMsg = 'Firebase tidak bisa dibaca (' + (e.code || e.message) + '). Memakai penyimpanan lokal browser.'; lap(); });
    window.LapDB = { set: (id, v) => F.setDoc(F.doc(db, 'laporan', id), { tanggal: v, diperbarui: F.serverTimestamp() }) };
  } catch (e) { fbOnline = false; fbMsg = 'Firebase gagal dimuat (' + e.message + '). Memakai penyimpanan lokal browser.'; lap(); }
}

// ---------- events ----------
$('#period').onchange = e => { S.period = e.target.value; render(); };
$('#tz').onchange = e => { S.tz = +e.target.value; render(); };
$('#hqOnly').onchange = e => { S.hqOnly = e.target.checked; render(); };
$('#hmEngine').onchange = e => { S.hmEngine = e.target.value; heat(); };
$('#hmMetric').onchange = e => { S.hmMetric = e.target.value; heat(); };
$('#jq').oninput = () => journal();
$('#jtabs').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { S.jeng = b.dataset.e; journal(); } });
$('#tbl').addEventListener('click', ev => {
  const th = ev.target.closest('th'), tr = ev.target.closest('tr.row');
  if (th) { const k = th.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (['name', 'stop', 'forced', 'rank', 'mcl'].includes(k) ? 1 : -1) }; table(); }
  else if (tr) { S.sel = tr.dataset.id; S.jeng = tr.dataset.id; table(); detail(); journal(); $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

load().catch(err => { $('#banner').innerHTML = `<div class="banner" style="border-color:var(--bad);color:#ffb3bb">Gagal memuat data: ${esc(err.message)}. Jika membuka file langsung, jalankan server lokal: <code>npx serve site</code>. Salin pesan ini ke Claude.</div>`; console.error(err); });
