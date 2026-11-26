import { SETUPS, FLAGS, merge, DEFAULTS, evaluate, rank, heatmap, periodStart } from './quality.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (x, d = 0, suf = '') => (x == null || Number.isNaN(x) ? '–' : x.toFixed(d) + suf);
const sg = (x, d = 2) => (x == null ? '–' : (x > 0 ? '+' : '') + x.toFixed(d));
const cls = s => (s == null ? 'mut' : s >= 70 ? 'good' : s >= 50 ? 'warn' : 'bad');
const SESS = { asia: 'Asia', london: 'London', ny: 'New York' };
const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const S = { period: '30d', hqOnly: false, tz: 7, sel: null, sort: { k: 'score', dir: -1 }, hmEngine: 'all', hmMetric: 'net' };
let DATA, CFG = {}, E = [];

const COLS = [
  ['rank', '#', e => e.rank],
  ['name', 'Nama Mesin', e => e.meta.name],
  ['n', 'Total Sinyal', e => e.shown],
  ['hqPct', '% Sinyal HQ', e => e.hqPct],
  ['wr', 'Win Rate Overall', e => e.view.wr],
  ['wrHq', 'Win Rate Setup Berkualitas', e => e.hqCore.wr],
  ['rr', 'Avg R:R', e => e.view.avgRR],
  ['stop', 'Avg Stop (%)', e => e.view.avgStop],
  ['mcl', 'Max Loss Beruntun', e => e.view.mcl],
  ['forced', '% Forced', e => e.forcedPct],
  ['score', 'Quality Score', e => e.score],
  ['verdict', 'Rekomendasi', e => e.verdict.action],
];

async function load() {
  DATA = await (await fetch('data/signals.json', { cache: 'no-cache' })).json();
  try { CFG = await (await fetch('data/quality.json', { cache: 'no-cache' })).json(); } catch { CFG = {}; }
  $('#updated').textContent = 'Diperbarui ' + new Date(DATA.generated).toLocaleString('id-ID');
  $('#hmEngine').innerHTML = '<option value="all">Semua mesin</option>' + DATA.engines.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  S.sel = null;
  render();
}

function compute() {
  const now = Date.now(), from = periodStart(S.period, now, S.tz);
  E = rank(DATA.engines.map(meta => {
    const L = DATA.signals.filter(s => s.engine === meta.id && Date.parse(s.ts) >= from);
    return { meta, ...evaluate(L, CFG, { hqOnly: S.hqOnly }) };
  }));
}

function render() {
  compute();
  banner(); strip(); cards(); table(); detail(); heat();
}

function banner() {
  const d = DATA.engines.filter(e => e.status === 'demo').map(e => e.id), s = DATA.engines.filter(e => e.status === 'stale').map(e => e.id);
  let h = '';
  if (d.length) h += `<div class="banner">⚠ <b>DATA DUMMY</b> untuk: ${d.join(', ')}. Mesin ini belum terhubung ke repo sumber — jangan dipakai sebagai dasar keputusan. Atur <code>owner</code>/<code>repo</code> di <code>config/engines.json</code> dan token <code>ENGINES_TOKEN</code> bila repo privat.</div>`;
  if (s.length) h += `<div class="banner" style="border-color:var(--warn);color:#ffe2a8;background:rgba(242,180,65,.07)">⏱ Data <b>STALE</b> (memakai deploy sebelumnya) untuk: ${s.join(', ')}.</div>`;
  $('#banner').innerHTML = h;
}

function strip() {
  $('#strip').innerHTML = DATA.engines.map(e => `<span class="chip st-${e.status}" title="${esc(e.message)}"><i>●</i> <b>${esc(e.id)}</b> ${e.status.toUpperCase()} · ${e.count}</span>`).join('');
}

function cards() {
  const now = Date.now(), all = DATA.signals;
  const cnt = k => all.filter(s => Date.parse(s.ts) >= periodStart(k, now, S.tz)).length;
  const sigs = E.flatMap(e => e.sigs), n = sigs.length;
  const hqS = sigs.filter(s => s.a.hq), hqClosed = hqS.filter(s => s.state === 'closed' && s.r != null);
  const wrHq = hqClosed.length ? hqClosed.filter(s => s.r > .05).length / hqClosed.length * 100 : null;
  const risk = n ? sigs.reduce((a, s) => a + (s.riskPct ?? 1), 0) / n : null;
  const stop = n ? sigs.filter(s => s.stopPct > 0).reduce((a, s, _, arr) => a + s.stopPct / arr.length, 0) : null;
  const forced = n ? sigs.filter(s => s.a.forced).length / n * 100 : null;
  const top = E.filter(e => e.rank).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const hqPct = n ? hqS.length / n * 100 : null;
  $('#cards').innerHTML = `
  <div class="card"><h3>Total sinyal</h3><div class="tri"><div><b>${cnt('today')}</b><span>hari ini</span></div><div><b>${cnt('7d')}</b><span>7 hari</span></div><div><b>${cnt('30d')}</b><span>30 hari</span></div></div><div class="sub">semua mesin, tidak terpengaruh filter periode</div></div>
  <div class="card"><h3>% Sinyal High Quality</h3><div class="big ${hqPct >= 50 ? 'good' : hqPct >= 25 ? 'warn' : 'bad'}">${f(hqPct, 1, '%')}</div><div class="sub">${hqS.length} dari ${n} sinyal · trigger jelas + invalidation ketat</div></div>
  <div class="card"><h3>Average risk / trade</h3><div class="big">${f(risk, 2, '%')}</div><div class="sub">risiko akun · stop rata-rata ${f(stop, 2, '%')} dari harga</div></div>
  <div class="card"><h3>Win rate setup berkualitas</h3><div class="big ${wrHq == null ? 'mut' : wrHq >= 45 ? 'good' : wrHq >= 35 ? 'warn' : 'bad'}">${f(wrHq, 1, '%')}</div><div class="sub">${hqClosed.length} trade HQ selesai</div></div>
  <div class="card"><h3>% Forced / tanpa trigger jelas</h3><div class="big ${forced <= 20 ? 'good' : forced <= 40 ? 'warn' : 'bad'}">${f(forced, 1, '%')}</div><div class="sub">gabungan semua mesin</div></div>
  <div class="card"><h3>Ranking Quality Score</h3><ul class="rk">${top.map(e => `<li><span>${e.rank}. ${esc(e.meta.id)}</span><b class="${cls(e.score)}">${f(e.score)}</b></li>`).join('') || '<li class="mut">Belum ada data</li>'}</ul></div>`;
}

function table() {
  const { k, dir } = S.sort, col = COLS.find(c => c[0] === k) || COLS[10];
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
    <td class="n">${f(e.view.avgRR, 2)}${e.view.avgRR1 != null ? ` <span class="mut">/ ${f(e.view.avgRR1, 2)}</span>` : ''}</td>
    <td class="n ${e.view.avgStop > 1.5 ? 'bad' : e.view.avgStop <= 1 ? 'good' : ''}">${f(e.view.avgStop, 2, '%')}</td>
    <td class="n ${e.view.mcl >= 5 ? 'bad' : ''}">${e.view.mcl}</td>
    <td class="n ${e.forcedPct >= 40 ? 'bad' : e.forcedPct <= 15 ? 'good' : ''}">${f(e.forcedPct, 1, '%')}</td>
    <td><span class="pill p-${cls(e.score)}">${f(e.score)}</span></td>
    <td><span class="tag p-${e.verdict.cls}">${e.verdict.action}</span></td></tr>`).join('');
  $('#tbl').innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`;
  $('#tbl').insertAdjacentHTML('afterend', '');
}

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

function histo(bins) {
  const mx = Math.max(1, ...bins.map(b => b.n)), w = 560, h = 190, bw = (w - 20) / bins.length;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%">${bins.map((b, i) => {
    const bh = b.n / mx * (h - 44), hh = b.hq / mx * (h - 44), x = 10 + i * bw;
    return `<rect x="${x + 4}" y="${h - 22 - bh}" width="${bw - 8}" height="${bh}" rx="3" fill="#3a4a6e"/><rect x="${x + 4}" y="${h - 22 - hh}" width="${bw - 8}" height="${hh}" rx="3" fill="var(--good)"/>
    <text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle">${b.label}</text><text x="${x + bw / 2}" y="${h - 26 - bh}" text-anchor="middle" style="fill:var(--txt)">${b.n || ''}</text>`;
  }).join('')}</svg><div class="legend"><i style="background:#3a4a6e"></i>semua sinyal<i style="background:var(--good)"></i>High Quality</div>`;
}

function detail() {
  const e = E.find(x => x.meta.id === S.sel);
  if (!e) { $('#detail').innerHTML = ''; return; }
  const W = merge(DEFAULTS, CFG).weights, labels = { trigger: 'Trigger & Invalidation', structure: 'Struktur Range / Level', stop: 'Ketatnya Stop Loss', winrate: 'Win Rate Setup Berkualitas', sample: 'Sampel & Konsistensi', patience: 'Patience' };
  const comp = e.components ? Object.keys(W).map(k => `<div>${labels[k]} <span class="mut">${(W[k] * 100).toFixed(0)}%</span></div><div class="bar"><i style="width:${e.components[k]}%;background:var(--${cls(e.components[k]) === 'mut' ? 'acc' : cls(e.components[k])})"></i></div><div class="num" style="text-align:right">${f(e.components[k])} <span class="mut">→ ${f(e.components[k] * W[k], 1)}</span></div>`).join('') : '<div class="sub">Belum ada sinyal.</div>';
  const setups = e.bySetup.map(x => `<tr><td class="l">${esc(x.label)}</td><td class="n">${x.n}</td><td class="n">${f(x.hqPct, 0, '%')}</td><td class="n">${x.closedN}</td><td class="n">${f(x.wr, 0, '%')}</td><td class="n ${x.expR < 0 ? 'bad' : x.expR > 0 ? 'good' : ''}">${sg(x.expR)}</td><td class="n">${f(x.avgStop, 2, '%')}</td></tr>`).join('');
  const sess = e.bySession.map(x => `<tr><td class="l">${SESS[x.key]}</td><td class="n">${x.n}</td><td class="n">${f(x.hqPct, 0, '%')}</td><td class="n">${x.closedN}</td><td class="n">${f(x.wr, 0, '%')}</td><td class="n ${x.expR < 0 ? 'bad' : x.expR > 0 ? 'good' : ''}">${sg(x.expR)}</td><td class="n ${x.hqExp < 0 ? 'bad' : x.hqExp > 0 ? 'good' : ''}">${sg(x.hqExp)} <span class="mut">(${x.hqN})</span></td></tr>`).join('');
  const tf = ms => new Date(ms + S.tz * 36e5).toISOString().slice(5, 16).replace('T', ' ');
  const last = e.last10.map(s => {
    const out = s.state === 'closed' ? `<b class="${s.r > .05 ? 'good' : s.r < -.05 ? 'bad' : 'mut'}">${sg(s.r)}R</b>` : s.state === 'open' ? '<span class="warn">OPEN</span>' : '<span class="mut">tidak terisi</span>';
    const fl = s.a.flags.filter(c => c !== 'RAPID_REENTRY' || true).slice(0, 4).map(c => `<span class="fl">${esc(FLAGS[c])}</span>`).join('');
    return `<tr><td class="l num">${tf(s.t)}</td><td class="l">${esc(s.symbol)} <span class="${s.side === 'long' ? 'good' : 'bad'}">${s.side === 'long' ? 'L' : 'S'}</span></td><td class="l">${esc(SETUPS[s.setup]?.label ?? s.setup)}</td><td class="n">${f(s.stopPct, 2, '%')}</td><td class="n">${f(s.rr, 1)}</td><td class="n">${out}</td><td class="l">${s.a.hq ? '<span class="ok">✓ HQ</span>' : '<span class="no">✗</span>'} <span class="mut">${f(s.a.q)}</span></td><td class="l" style="white-space:normal;min-width:220px">${s.a.hq ? '<span class="mut">memenuhi semua kriteria</span>' : fl}</td></tr>`;
  }).join('');
  const rec = { AKTIFKAN: 'Layak diaktifkan', OPTIMIZE: 'Perlu di-optimize', PAUSE: 'Sebaiknya di-pause', 'NO DATA': 'Belum ada data' }[e.verdict.action];
  $('#detail').innerHTML = `
  <h2>Detail: ${esc(e.meta.name)} <small>${esc(e.meta.repo)} · status ${e.meta.status}</small></h2>
  <div class="grid">
    <div class="card full"><div class="hd">
      <div><h3>Quality Score</h3><div class="score ${cls(e.score)}">${f(e.score, 1)}</div><div class="sub">Rank #${e.rank ?? '–'} dari ${E.length}</div></div>
      <div style="flex:1;min-width:260px"><span class="tag p-${e.verdict.cls}" style="font-size:13px;padding:4px 10px">${e.verdict.action}</span> <b>${rec}</b> <span class="mut">(keyakinan data: ${e.verdict.confidence ?? '–'})</span>
        <ul class="n">${e.verdict.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
      <div class="sub" style="min-width:200px">Trade selesai: <b class="num" style="color:var(--txt)">${e.full.closedN}</b> · Expectancy ${sg(e.full.expR)}R<br>Total ${sg(e.full.totalR, 1)}R · PF ${f(e.full.pf, 2)} · Max DD ${f(e.full.maxDD, 1)}R<br>Expectancy HQ ${sg(e.hqCore.expR)}R (n=${e.hqCore.closedN}) · ${f(e.spd, 1)} sinyal/hari</div>
    </div></div>
    <div class="card"><h3>Rincian skor (nilai → kontribusi)</h3><div class="cmp">${comp}</div></div>
    <div class="card"><h3>Catatan kelemahan mesin</h3><ul class="n">${e.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
    <div class="card"><h3>Breakdown jenis setup ${S.hqOnly ? '(HQ saja)' : ''}</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Setup</th><th>Sinyal</th><th>% HQ</th><th>Selesai</th><th>WR</th><th>Exp (R)</th><th>Avg stop</th></tr></thead><tbody>${setups}</tbody></table></div></div>
    <div class="card"><h3>Performa per sesi (UTC: Asia 22–08 · London 08–13 · NY 13–22)</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Sesi</th><th>Sinyal</th><th>% HQ</th><th>Selesai</th><th>WR</th><th>Exp (R)</th><th>Exp HQ (R)</th></tr></thead><tbody>${sess}</tbody></table></div></div>
    <div class="card"><h3>Equity curve — sinyal High Quality saja (kumulatif R)</h3>${lineChart([{ pts: e.full.equity, color: '#56627f', dash: 1 }, { pts: e.hqCore.equity, color: '#2ecc8f' }])}<div class="legend"><i style="background:#2ecc8f"></i>HQ saja<i style="background:#56627f"></i>semua sinyal (pembanding)</div></div>
    <div class="card"><h3>Distribusi jarak stop loss (% dari entry)</h3>${histo(e.stopDist)}</div>
    <div class="card full"><h3>10 sinyal terakhir & penilaian kualitas</h3><div class="wrap" style="border:0"><table><thead><tr><th class="l">Waktu</th><th class="l">Simbol</th><th class="l">Setup</th><th>Stop</th><th>R:R</th><th>Hasil</th><th class="l">Standar</th><th class="l">Alasan</th></tr></thead><tbody>${last || '<tr><td colspan="8" class="mut">Tidak ada sinyal.</td></tr>'}</tbody></table></div></div>
  </div>`;
}

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

// ---------- events ----------
$('#period').onchange = e => { S.period = e.target.value; render(); };
$('#tz').onchange = e => { S.tz = +e.target.value; render(); };
$('#hqOnly').onchange = e => { S.hqOnly = e.target.checked; render(); };
$('#hmEngine').onchange = e => { S.hmEngine = e.target.value; heat(); };
$('#hmMetric').onchange = e => { S.hmMetric = e.target.value; heat(); };
$('#tbl').addEventListener('click', ev => {
  const th = ev.target.closest('th'), tr = ev.target.closest('tr.row');
  if (th) { const k = th.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' || k === 'stop' || k === 'forced' || k === 'rank' || k === 'mcl' ? 1 : -1) }; table(); }
  else if (tr) { S.sel = tr.dataset.id; table(); detail(); $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

load().catch(err => { $('#banner').innerHTML = `<div class="banner" style="border-color:var(--bad);color:#ffb3bb">Gagal memuat data/signals.json: ${esc(err.message)}. Jika membuka file langsung, jalankan server lokal: <code>npx serve site</code></div>`; });
