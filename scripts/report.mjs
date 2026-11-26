// "Laporan untuk Claude": ringkasan teks yang bisa disalin dari situs ke chat. Tanpa placeholder; semua angka dari data nyata.
import { eventSentence } from '../site/events.mjs';

const f = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : (+x).toFixed(d));
const pc = x => (x == null ? '-' : Math.round(x * 100) + '%');
const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

export function buildReport({ E, alerts, pending, regime, hypo, audit, eliz, ctx, updated }) {
  const { M, cfg, events, now } = ctx;
  let m = `# Laporan monitor msc untuk Claude (${updated})\n\n`;
  m += `${eventSentence(events, now, 7)}\n\n`;
  m += `Evaluasi ${M.alertDays} hari terakhir; semua R bersih setelah biaya pulang-pergi ${cfg.costPct}% kecuali mesin yang sudah mencatat R bersih (scv5). Batas harian uji ${M.dailyCap} sinyal.\n\n`;
  m += `## Kondisi pasar\n`;
  m += regime
    ? `- Status: ${regime.status}${regime.flags.length ? ' (' + regime.flags.join('; ') + ')' : ''}\n- Volume altcoin (median 7 hari / median 60 hari, ${regime.volN} koin): ${f(regime.volRatio)}x; ATR14 BTC 1 jam ${f(regime.atr1h)}%; mode 15m ${regime.mode ?? '-'} (efficiency ratio ${f(regime.er)}); sesi ${regime.sesi}\n`
    : '- tidak tersedia (data Binance gagal diambil)\n';
  m += `\n## Kinerja per mesin\n| Mesin | Data | Sinyal | Selesai | TP/SL/BE | Win | R bersih/trade | PF | SQN | Skor | Vonis (keyakinan) | Layak uang nyata |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const { meta, ev, an } of E) {
    if (!ev || !ev.n) { m += `| ${meta.id} | ${meta.status} | 0 | 0 | - | - | - | - | - | - | NO DATA | - |\n`; continue; }
    m += `| ${meta.id} | ${meta.status} | ${an.sm.sinyal} | ${an.sm.selesai} | ${an.sm.tp}/${an.sm.sl}/${an.sm.be} | ${pc(an.sm.win)} | ${f(an.sm.exp)} | ${f(an.sm.pf)} | ${f(an.th.sqn)} | ${f(ev.score, 0)} | ${ev.verdict.action} (${ev.verdict.confidence ?? '-'}) | ${an.ready.layak ? 'LAYAK' : 'BELUM'} |\n`;
  }
  m += `\n## Notifikasi upgrade\n`;
  const act = alerts.filter(a => a.level !== 'info');
  m += act.length ? act.map(a => `- [${a.level}] ${a.engine} ${a.code}: ${a.title}. ${a.detail} -> ${a.aksi}`).join('\n') + '\n' : '- tidak ada\n';
  m += `\n## Kelemahan per mesin (catatan otomatis)\n`;
  for (const { meta, ev } of E) if (ev && ev.n) m += `- ${meta.id}: ${ev.notes.join(' ')}\n`;
  m += `\n## Sinyal terbuka dan keputusan monitor\n| Mesin | Koin | Arah | Entry | SL | TP | Harga | Jarak ke entry | Tgl | Keputusan | Catatan |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  m += pending.length ? pending.map(r => `| ${r.e} | ${cell(r.sym)} | ${r.side} | ${r.entry} | ${r.sl} | ${r.tp ?? '-'} | ${r.px ?? '-'} | ${r.dist == null ? '-' : f(r.dist) + '%'} | ${String(r.ts).slice(0, 16).replace('T', ' ')} | ${r.kp} | ${cell(r.kn)} |`).join('\n') + '\n' : '| - | - | - | - | - | - | - | - | - | tidak ada sinyal terbuka | - |\n';
  m += `\n## Uji hipotesis (bukan aturan mesin; baca bila tiap grup ≥ 30)\n`;
  m += `- Batas harian: ${hypo.harian.map(g => `${g.g}: n=${g.n}, TP ${g.tp}, R ${f(g.r)}`).join(' · ') || 'belum ada data'}\n`;
  m += `- Akhir pekan: ${hypo.akhirPekan.map(g => `${g.g}: n=${g.n}, TP ${g.tp}, R ${f(g.r)}${g.se != null ? ' ± ' + f(g.se) : ''}`).join(' · ') || 'belum ada data'}\n`;
  m += `- Audit keputusan monitor: ${audit.grup.map(g => `${g.g}: n=${g.n}, TP ${g.tp}, R ${f(g.r)}`).join(' · ') || 'belum ada sinyal selesai'} (total keputusan tercatat ${audit.total})\n`;
  m += `- Volume vs @eliz883: postingan volume rendah ${eliz.uji.postVolumeRendah}, hari terukur ${eliz.uji.hariTerukur}, cocok ${eliz.uji.cocok}\n`;
  m += `\n## Postingan terbaru @eliz883 (ticker: ${eliz.tickers.join(', ') || '-'})\n`;
  m += eliz.posts.slice(0, 5).map(p => `- ${p.tgl}: ${String(p.teks).slice(0, 400)}`).join('\n') + '\n';
  m += `\n## Permintaan\nEvaluasi laporan ini, cocokkan dengan postingan @eliz883 di atas dan prinsip "No trigger, no trade", lalu buatkan full coding perbaikan (zip utuh siap commit lewat GitHub web UI). Prinsip: jangan ubah mesin selama forward test tanpa memulai protokol baru; jujur soal sampel kecil, biaya, dan rezim pasar. Unggah zip repo mesin terbaru bila perlu diverifikasi.\n`;
  return m;
}
