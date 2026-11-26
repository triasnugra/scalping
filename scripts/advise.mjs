// Mesin notifikasi: mengubah hasil evaluasi menjadi daftar peringatan dan REKOMENDASI UPGRADE per mesin.
// Prinsip (dari monitortn): jujur soal sampel kecil, ambang = hipotesis, jangan ubah mesin selama forward test
// tanpa memulai protokol baru. Setiap alert punya kunci stabil `mesin:KODE` agar notifikasi tidak berulang.
import { nextEvent } from '../site/events.mjs';

const f = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : (+x).toFixed(d));
const PROTOKOL = 'Ubah di mesin hanya lewat protokol forward test baru; jangan mengubah mesin yang sedang diuji tanpa mencatatnya.';

// E: [{meta, ev, an}] ; ctx: {M, cfg, regime, events, now, elizAge}
export function buildAlerts(E, ctx) {
  const { M, cfg, events, now, elizAge } = ctx, out = [];
  const add = (engine, code, level, kategori, title, detail, aksi, notify = true) =>
    out.push({ key: `${engine}:${code}`, engine, code, level, kategori, title, detail, aksi, notify: notify && level !== 'info' });

  for (const { meta, ev, an } of E) {
    const id = meta.id;
    // ---- kesehatan sumber data ----
    if (meta.status === 'error') add(id, 'SUMBER_ERROR', 'merah', 'data', 'Jurnal mesin tidak terbaca', meta.message, 'Periksa nama repo/branch/path di config/engines.json, atau secret ENGINES_TOKEN bila repo privat.');
    else if (meta.status === 'stale') add(id, 'SUMBER_STALE', 'kuning', 'data', 'Memakai data lama (STALE)', meta.message, 'Cek tab Actions repo mesin: workflow scan mungkin mati atau repo menjadi privat.');
    else if (meta.status === 'demo') add(id, 'SUMBER_DEMO', 'merah', 'data', 'Tampil DATA DUMMY', meta.message, 'Hubungkan sumber data asli atau set allowDemo=false di config/engines.json.');
    else if (meta.lastTs && (now - meta.lastTs) / 36e5 > M.jurnalDiamJam) add(id, 'JURNAL_DIAM', 'kuning', 'data', 'Tidak ada sinyal baru', `Sinyal terakhir ${f((now - meta.lastTs) / 36e5, 0)} jam lalu (batas ${M.jurnalDiamJam} jam). Bisa berarti memang tidak ada setup, bisa juga workflow mesin mati.`, 'Buka tab Actions repo mesin sekali untuk memastikan workflow masih berjalan.');
    if (!ev || ev.n === 0) continue;

    const n = ev.n, nC = ev.full.closedN, minS = M.minSinyalAlert, minC = M.minSelesaiAlert;

    // ---- disiplin "No trigger, no trade" ----
    if (n >= minS) {
      if (ev.forcedPct >= 25) add(id, 'FORCED', ev.forcedPct >= 40 ? 'merah' : 'kuning', 'upgrade', 'Terlalu banyak sinyal forced', `${f(ev.forcedPct, 0)}% sinyal tanpa trigger jelas / tengah range / mengejar harga (n=${n}).`, 'Wajibkan trigger (sweep+reclaim, deviation, breakout+retest, Fib 0,75) sebelum sinyal terbit; buang entry di tengah range. ' + PROTOKOL);
      if (ev.chasePct >= 15) add(id, 'CHASING', 'kuning', 'upgrade', 'Entry mengejar harga', `${f(ev.chasePct, 0)}% entry berupa momentum / market entry di luar level.`, 'Ganti market entry dengan limit di level + konfirmasi close 15m; matikan setup momentum/squeeze. ' + PROTOKOL);
      const noConf = ev.sigs.filter(s => s.a.flags.includes('NO_CONFIRM_LTF')).length / n * 100;
      if (noConf >= 30) add(id, 'NO_CONFIRM', 'kuning', 'upgrade', 'Tanpa konfirmasi 5m/15m', `${f(noConf, 0)}% sinyal tanpa konfirmasi 5m/15m (1H atau tidak tercatat).`, 'Catat dan tunggu close 15m (atau 5m) sebagai konfirmasi; simpan TF konfirmasi di jurnal agar bisa dinilai. ' + PROTOKOL);
      const wide = ev.sigs.filter(s => s.a.flags.includes('WIDE_STOP')).length / n * 100;
      if ((ev.full.avgStop ?? 0) > cfg.hqMaxStopPct || wide >= 30) add(id, 'WIDE_STOP', 'kuning', 'upgrade', 'Stop terlalu longgar untuk scalping', `Stop rata-rata ${f(ev.full.avgStop, 2)}%; ${f(wide, 0)}% sinyal di atas ${cfg.hqMaxStopPct}%.`, `Letakkan stop struktural tepat di balik sweep/level; tolak sinyal bila stop > ${cfg.hqMaxStopPct}%. ` + PROTOKOL);
      const fake = ev.sigs.filter(s => s.a.flags.includes('FAKE_RR')).length / n * 100;
      if (fake >= 20) add(id, 'FAKE_RR', 'kuning', 'upgrade', 'Target R:R tidak realistis', `${f(fake, 0)}% sinyal punya target > ${cfg.maxSaneRR ?? 10}R; rata-rata R:R tampilan mesin tidak bisa dipercaya.`, 'Batasi TP final ke target struktural terdekat dan pakai TP bertahap (TP1 + geser SL ke BE). ' + PROTOKOL);
      if (ev.rapidPct >= 20) add(id, 'REENTRY', 'kuning', 'upgrade', 'Re-entry cepat di simbol yang sama', `${f(ev.rapidPct, 0)}% sinyal masuk ulang < ${cfg.cooldownMin} menit di simbol yang sama.`, `Tambah cooldown ${cfg.cooldownMin} menit per simbol dan hentikan simbol itu setelah 2 SL beruntun. ` + PROTOKOL);
      if (ev.spd >= cfg.spdMax) add(id, 'OVERTRADE', 'merah', 'upgrade', 'Overtrading', `${f(ev.spd, 1)} sinyal/hari (batas disiplin ${cfg.spdOk}/hari, maksimal ${cfg.spdMax}).`, `Tambah batas harian (${M.dailyCap}/hari) dan skor minimum, seperti tnv2c2. @eliz883: tidak harus trading tiap hari. ` + PROTOKOL);
      else if (ev.spd > cfg.spdOk && n >= 15) add(id, 'OVERTRADE', 'kuning', 'upgrade', 'Frekuensi di atas batas disiplin', `${f(ev.spd, 1)} sinyal/hari (batas disiplin ${cfg.spdOk}/hari).`, `Pertimbangkan batas harian ${M.dailyCap}/hari dan skor minimum. ` + PROTOKOL);
      const unf = ev.sigs.filter(s => s.state === 'void').length / n * 100;
      if (n >= 15 && unf >= 40) add(id, 'UNFILLED', 'kuning', 'upgrade', 'Banyak limit tidak terisi', `${f(unf, 0)}% sinyal tidak terisi: entry limit terlalu jauh atau kedaluwarsa terlalu cepat.`, 'Batasi jarak entry ke harga (mis. maks 0,75R) atau perpanjang masa order. ' + PROTOKOL);
    }

    // ---- hasil, dinilai setelah biaya ----
    if (nC >= minC) {
      const exp = ev.full.expR, conf = nC < 30 ? ' (sampel masih kecil)' : '';
      if (exp != null && exp < -0.15) add(id, 'NEG_EXP', 'merah', 'upgrade', 'Expectancy bersih negatif', `${f(exp, 2)}R/trade setelah biaya ${cfg.costPct}% (n=${nC})${conf}.`, 'Pause mesin untuk uang nyata; telaah setup/sesi yang merugi di Detail mesin sebelum mengubah apa pun. ' + PROTOKOL);
      const th = an.th;
      if (th?.ok && th.be != null) {
        if (th.be < cfg.costPct) add(id, 'BIAYA', 'merah', 'upgrade', 'Edge habis oleh biaya', `Biaya impas ${f(th.be, 2)}% lebih kecil dari asumsi ${cfg.costPct}%: profit mentah tidak cukup menutup biaya.`, 'Uji biaya nyata (fee tier, slippage); lebarkan stop atau naikkan target agar biaya < 25% dari 1R. ' + PROTOKOL);
        else if (th.be < cfg.costPct * 1.5) add(id, 'BIAYA', 'kuning', 'upgrade', 'Edge tipis terhadap biaya', `Biaya impas ${f(th.be, 2)}% hanya ${f(th.be / cfg.costPct, 1)}x asumsi biaya ${cfg.costPct}%.`, 'Selisih fee/slippage kecil bisa menghapus profit: uji biaya nyata sebelum uang sungguhan.');
      }
      if (th?.ok && nC >= 30 && th.top3 != null && th.top3 > 0.5) add(id, 'KONSENTRASI', 'kuning', 'upgrade', 'Hasil terkonsentrasi', `3 trade teratas = ${f(th.top3 * 100, 0)}% dari total untung; R/trade tanpa 3 teratas ${f(th.meanEx3, 2)}.`, 'Jangan percaya angka rata-rata; tunggu lebih banyak trade.', false);
      if (ev.hqCore.closedN >= 10 && ev.hqCore.expR < 0) add(id, 'HQ_NEG', 'kuning', 'upgrade', 'Filter kualitas belum menghasilkan edge', `Expectancy bersih sinyal HQ ${f(ev.hqCore.expR, 2)}R (n=${ev.hqCore.closedN}).`, 'Kriteria HQ belum memisahkan hasil: telaah ulang syarat HQ dan jenis setup. ' + PROTOKOL);
      const bad = ev.bySetup.find(x => x.closedN >= 8 && x.expR <= -.3);
      if (bad) add(id, 'SETUP_RUGI:' + bad.key, 'kuning', 'upgrade', `Setup ${bad.label} merugi`, `${f(bad.expR, 2)}R/trade bersih (n=${bad.closedN}).`, `Matikan atau perketat setup ${bad.label}. ` + PROTOKOL);
      const bs = ev.bySession.find(x => x.closedN >= 8 && x.expR <= -.3);
      if (bs) add(id, 'SESI_RUGI:' + bs.key, 'kuning', 'upgrade', `Sesi ${({ asia: 'Asia', london: 'London', ny: 'New York' })[bs.key]} merugi`, `${f(bs.expR, 2)}R/trade bersih (n=${bs.closedN}).`, 'Pertimbangkan filter sesi: jangan trading di sesi ini sampai ada bukti. ' + PROTOKOL);
      const L = an.dir.long, S = an.dir.short;
      if (L.selesai >= 15 && S.selesai >= 15 && ((L.exp ?? 0) < 0 && (S.exp ?? 0) > 0.3 || (S.exp ?? 0) < 0 && (L.exp ?? 0) > 0.3)) add(id, 'ARAH', 'kuning', 'upgrade', 'Hasil bertumpu pada satu arah', `LONG ${f(L.exp, 2)}R (n=${L.selesai}) vs SHORT ${f(S.exp, 2)}R (n=${S.selesai}): kemungkinan bergantung rezim pasar.`, 'Pertimbangkan filter searah tren makro; uji lintas rezim.', false);
    }

    // ---- vonis keseluruhan ----
    if (ev.verdict.action === 'PAUSE') add(id, 'PAUSE', ev.verdict.confidence === 'rendah' ? 'kuning' : 'merah', 'upgrade', 'Rekomendasi: PAUSE', `Skor ${f(ev.score, 0)}. ${ev.verdict.reasons.join(' ')} Keyakinan data: ${ev.verdict.confidence}.`, 'Hentikan mesin untuk keputusan uang nyata sampai penyebab di atas diperbaiki.');
    if (nC < 20 && n >= 5) add(id, 'SAMPEL_KECIL', 'info', 'info', 'Sampel kecil', `Baru ${nC} trade selesai: skor dan vonis belum signifikan secara statistik.`, 'Tunggu data; jangan ubah mesin.', false);
  }

  // ---- data pendukung ----
  const ne = nextEvent(events, now);
  if (!ne) add('monitor', 'EVENT_HABIS', 'kuning', 'data', 'Kalender event FOMC/CPI habis', 'Tidak ada event mendatang di data/events.json.', 'Perbarui data/events.json dari federalreserve.gov dan bls.gov/schedule/news_release/cpi.htm.');
  if (elizAge != null && elizAge > M.elizMaxHari) add('monitor', 'ELIZ_BASI', 'info', 'data', 'Postingan @eliz883 sudah lama', `Postingan terakhir di monitor ${f(elizAge, 0)} hari lalu.`, 'Tambahkan postingan terbaru ke data/eliz-posts.json.', false);

  const order = { merah: 0, kuning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || a.key.localeCompare(b.key));
}
