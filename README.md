# Monitor Scalping (msc)

Gabungan **monitor scalping** (Quality Score "No trigger, no trade") dan **monitortn** (uji swing: R bersih, Van Tharp, kondisi pasar, keputusan sinyal, audit, laporan untuk Claude). Statis (HTML + JS tanpa dependensi), data dikumpulkan dan dipublikasikan oleh **GitHub Actions → GitHub Pages**. Situs: `https://triasnugra.github.io/msc/`

## Pasang

1. Buat repo `msc`, upload **seluruh isi folder ini** (pastikan `.github/workflows/monitor.yml` ikut).
2. **Settings → Pages → Source: GitHub Actions.**
3. Periksa `config/engines.json`: `owner`, nama `repo`, `branch`, `path` tiap mesin. Aktif: `sc, scv2, scv5, scv6, sctn`. `scv3`/`scv4` ada tetapi `enabled:false`; ubah ke `true` bila ingin dipantau.
4. Repo mesin privat? Buat fine-grained PAT (Contents: Read) → **Settings → Secrets → Actions → `ENGINES_TOKEN`**.
5. **Actions → Monitor Scalping (msc) → Run workflow.** Setelah itu berjalan tiap 15 menit dan setiap push ke `main`.
6. Notifikasi Telegram (opsional): secret `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID`.

Pratinjau lokal: `npm run demo` lalu `npx serve site` (data dummy, tanpa internet).

## Apa yang digabungkan

| Dari monitortn (swing) | Di msc (scalping) |
|---|---|
| R bersih setelah biaya, biaya impas, sensitivitas biaya | Dipakai di **semua** angka (`costPct` di `config/quality.json`). Pada stop kecil biaya sangat berpengaruh |
| Uji Van Tharp (SQN, distribusi R, 3 trade teratas) | Per mesin di Detail |
| Level unik, N efektif | Per mesin di Detail |
| Syarat layak uang nyata (trade, minggu, CI95 bootstrap, PF) | Ambang di `config/monitor.json` (`validasi`), disesuaikan untuk scalping |
| Kondisi pasar (volume altcoin, ATR) | Disesuaikan: ATR **1 jam**, volume altcoin, mode RANGE/TREND 15m |
| Konfirmasi 4H/12H → SIAP/TUNGGU/BATAL/HINDARI | Diganti konfirmasi **close 15m**, ditambah BASI (umur sinyal) dan HINDARI saat jendela event |
| Audit keputusan, uji batas harian, uji akhir pekan | Sama (hipotesis) |
| Kecocokan @eliz883, laporan untuk Claude (3 hari + live, tanggal lapor) | Sama; postingan 4 file digabung di `data/eliz-posts.json` |
| Peringatan + aksi | Menjadi **Notifikasi upgrade** per mesin |
| *Tidak diambil:* rantai hash v1 (`signals-core`), EUR/USD, diagnostik candle harian bolong, rekonstruksi laporan | Spesifik mesin swing |

Dari scalping tetap: Quality Score, High Quality, forced, heatmap, equity, adapter, status LIVE/STALE/ERROR, filter periode/zona waktu.

## Fitur baru

- **Event FOMC/CPI**: satu kalimat di atas dashboard dari `data/events.json` (sumber: federalreserve.gov dan bls.gov, sudah diisi sampai Juni 2027). Bila semua event habis, muncul notifikasi untuk memperbarui file. Jendela risiko (2 jam sebelum, 1 jam sesudah) membuat sinyal terbuka berstatus HINDARI.
- **Jurnal riwayat** tiap mesin dengan kolom: Mesin, Koin, Arah, Entry, SL, TP, Harga, Jarak ke entry, Tgl, Keputusan monitor, Catatan, Hasil, R bersih. Tabel "Sinyal terbuka" memakai kolom yang sama.
- **Notifikasi upgrade**: kartu di dashboard + judul tab `(n)` + tombol notifikasi browser (hanya saat halaman terbuka) + **GitHub Issue otomatis** untuk alert baru (masuk email/aplikasi GitHub; satu issue per alert, tutup issue bila sudah dibaca) + Telegram opsional.

## Asumsi dan keterbatasan (baca)

- **sctn**: format jurnal tidak ada di upload. Adapter berasumsi sama dengan tn/sc (`aset, arah, entry, sl, tp, hasil, R`). Setup ditebak dari teks `alasan`, TF konfirmasi tidak diketahui (dinilai konservatif). Bila statusnya ERROR/aneh, kirim contoh `journal.json` sctn.
- R mesin dianggap **mentah** dan dipotong biaya, kecuali scv5 (`r_net`, dianggap sudah bersih). Mesin lain bisa saja sudah memasukkan biaya; cek `rNet` di `scripts/adapters.mjs`.
- scv6: jurnal tidak membedakan limit belum terisi vs berjalan; sinyal aktifnya diperlakukan seperti menunggu.
- Semua ambang (validasi, batas harian 3/hari, ATR, retest, jendela event) adalah **hipotesis**, bukan fakta. Sampel kecil tidak bermakna.
- Riwayat (laporan harian, audit, status pasar) tersimpan di deploy Pages sebelumnya, tanpa commit. Bila Pages tidak terbaca (bukan 404), build sengaja berhenti agar riwayat tidak hilang. Riwayat dimulai sejak deploy pertama.
- Firebase (tanggal lapor lintas perangkat) memakai proyek `monitortn` dan aturan yang sudah ada; id berakhiran `0100` agar tidak bentrok. Bila gagal, otomatis memakai penyimpanan lokal browser.
- Cron GitHub best-effort; repo tanpa aktivitas 60 hari menonaktifkan jadwal otomatis. Alat evaluasi, bukan nasihat keuangan.

## Struktur

```
.github/workflows/monitor.yml   tes → build → notifikasi → deploy (cron */15)
config/engines.json             sumber data mesin
config/quality.json             bobot Quality Score + biaya
config/monitor.json             validasi, batas harian, pasar, event, notifikasi
data/events.json                kalender FOMC/CPI (perbarui manual)
data/eliz-posts.json            postingan @eliz883 (tambahkan yang baru)
scripts/                        adapters, collect, overlay, advise, report, notify, build, demo
site/                           index.html, app.js, quality.mjs, analytics.mjs, events.mjs
tests/                          12 tes (node --test), build penuh dengan Binance palsu
firestore.rules                 aturan Firebase (sudah dipakai monitortn)
```
