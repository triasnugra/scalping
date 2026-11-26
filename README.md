# 🎯 Scalp Quality Monitor

Dashboard untuk **mengevaluasi 6 mesin analisis scalping** (`sc`, `scv2`, `scv3`, `scv4`, `scv5`, `scv6`) berdasarkan **disiplin “No trigger, no trade”**, bukan profit atau frekuensi mentah. Statis (HTML + JS tanpa dependensi), data dikumpulkan & di-deploy otomatis oleh **GitHub Actions → GitHub Pages**.

## Pasang (semua lewat web GitHub)

1. Buat repo baru (mis. `scalp-monitor`), **upload seluruh isi folder ini** (pastikan `.github/workflows/deploy.yml` ikut).
2. **Settings → Pages → Source: GitHub Actions.**
3. Buka `config/engines.json`. Kosongkan `owner` jika 6 repo mesin ada di akun yang sama dengan repo ini (otomatis memakai pemilik repo). Pastikan nama `repo` tiap mesin sesuai (default: `sc`, `scv2`, … `scv6`).
4. **Repo mesin privat?** Buat *fine-grained PAT* (akses **Contents: Read** ke 6 repo mesin) → simpan di **Settings → Secrets → Actions** dengan nama `ENGINES_TOKEN`. Repo publik tidak perlu token.
5. **Actions → Deploy Scalp Quality Monitor → Run workflow.** Dashboard: `https://<user>.github.io/<repo>/`. Setelah itu berjalan tiap 15 menit.

Pratinjau lokal: `npm run demo` lalu `npx serve site` (buka lewat server, bukan klik dua kali file).

### Dari mana data tiap mesin dibaca

| Mesin | Sumber (`config/engines.json`) | Catatan |
|---|---|---|
| sc | `data/journal.json` (main) | |
| scv2 | `journal.json` di **branch `data`** | state di-force-push oleh workflow scan scv2 |
| scv3 | `state/signals.json` (main) | |
| scv4 | `https://<owner>.github.io/scv4/history.json` | hanya ada di Pages, bukan di repo → Pages scv4 harus publik/aktif |
| scv5 | `data/journal.jsonl` (main) | event berantai-hash di-*replay* menjadi sinyal |
| scv6 | `data/journal.json` (main) | |

Status per mesin tampil di bagian atas dashboard: **LIVE** (berhasil dibaca) · **STALE** (gagal, memakai deploy sebelumnya) · **DEMO** (gagal & `allowDemo: true` → data dummy, ada banner peringatan) · **ERROR**. Set `"allowDemo": false` bila kamu tidak mau data dummy pernah tampil.

## Struktur

```
.github/workflows/deploy.yml   tes → collect → deploy Pages (cron */15)
config/engines.json            sumber data 6 mesin
config/quality.json            bobot & ambang (menimpa default di quality.mjs)
scripts/adapters.mjs           6 adapter: format jurnal tiap mesin → skema sinyal seragam
scripts/collect.mjs            fetch (live → stale → demo) → site/data/signals.json
scripts/demo.mjs               generator data dummy realistis (seed tetap)
site/quality.mjs               LOGIKA PENILAIAN (dipakai browser & tes)
site/app.js, site/index.html   dashboard
tests/                         8 tes (node --test), termasuk adapter pada jurnal nyata
```

Penilaian dihitung **di browser** dari sinyal ternormalisasi, sehingga filter periode, zona waktu, dan toggle HQ langsung memperbarui semua angka tanpa build ulang.

## Skema sinyal ternormalisasi

`engine, id, ts, symbol, side(long|short), setup, level, locationKind(range_edge|key_level|indicator|mid_range|none), confirmTf(5m|15m|1h|null), entryType(limit|confirm_close|market), structuralStop, entry, stop, stopPct, rr, rr1, touches, riskPct, state(open|closed|void), r, exitTs`

`setup` ∈ `failed_breakout · sweep_reclaim · breakout_retest · support_scalp · pullback · momentum · unknown`. `void` = limit tidak terisi / dibatalkan (dihitung sebagai sinyal, tidak sebagai trade selesai).

## Logika Quality Score

```
Score = 35% Trigger & Invalidation + 20% Struktur/Level + 15% Stop + 15% WR setup berkualitas + 10% Sampel & Konsistensi + 5% Patience
```

| Komponen | Cara hitung (0–100) |
|---|---|
| **Trigger & Invalidation** (rata-rata semua sinyal) | 65% kejelasan trigger = basis setup (Failed Breakout/Sweep+Reclaim 100 · Breakout+Retest 95 · S/R Scalp 85 · Pullback 60 · Momentum 30 · tanpa trigger 0) × faktor TF konfirmasi (15m 1,0 · 5m 0,85 · 1H 0,7 · tak tercatat 0,45) × 0,85 jika market entry; + 35% kualitas invalidation (stop struktural 0,15–1,5% = 100). **Sinyal forced dibatasi maks 40.** |
| **Struktur** | tepi range 100 · level kunci (Monday/PDH/PDL/swing/Fib 0,75) 90 · indikator 55 · tanpa level 30 · tengah range 5; −25 bila level diuji ≥3x |
| **Stop** | ≤0,5% = 100, turun linear ke 0 di 3,5%; <0,15% = 50 |
| **WR setup berkualitas** | WR trade HQ dikoreksi Bayesian (prior 40%, bobot 6 trade), dipetakan 30%→0 … 65%→100 |
| **Sampel & Konsistensi** | 50% jumlah trade selesai (target 50) + 30% porsi kuartal waktu dengan expectancy ≥0 + 20% penalti loss beruntun >3 |
| **Patience** | 60% (1−%forced) + 20% frekuensi (≤3/hari penuh → 0 di ≥12/hari) + 20% (1−%re-entry <60 mnt di simbol sama) |

**Sinyal High Quality** harus memenuhi *semua*: setup berbasis trigger · konfirmasi 5m/15m · di tepi range atau level kunci · bukan chasing · stop struktural 0,15–1,5% · level belum jenuh (<3 sentuhan) · R:R realistis 1,5–10 · skor sinyal ≥75.
**Forced** = tanpa trigger jelas, entry tengah range, mengejar harga (momentum/market entry di luar level), atau tidak di level penting.
Semua angka bisa diubah di `config/quality.json`.

**Rekomendasi otomatis** (ambang di `verdict`): **AKTIFKAN** bila skor ≥70, forced ≤20%, expectancy HQ ≥0 dan ≥15 trade HQ selesai · **PAUSE** bila skor <45, forced ≥50%, atau (≥20 trade, expectancy < −0,15R dan expectancy HQ <0) · selain itu **OPTIMIZE**. Kolom “keyakinan data” menjadi *rendah* bila trade selesai <20.

## Asumsi pemetaan (penting, periksa bila mesinmu berubah)

- **sc**: `sweep` → Sweep+Reclaim (long) / Failed Breakout (short, sweep swing high); `pullback` ke EMA20 → Pullback (lokasi indikator, tidak bisa HQ). Konfirmasi 15m.
- **scv2 / scv4**: T1 → Sweep+Reclaim/Failed Breakout · T2 → Breakout+Retest · T3 (Fib 0,75/0,786) → S/R Scalp · T4 (flip EMA/trendline) → Pullback. scv2 memakai `tf` dari jurnal; scv4 tidak menyimpan TF, diasumsikan dari kode: T1/T3=15m, **T2/T4=1H** (karena itu T2/T4 scv4 tidak bisa HQ).
- **scv3**: `range_deviation`/`level_sweep` → reversal; `breakout_retest`; `squeeze_expansion` → **Momentum** (market entry di close ekspansi = chasing).
- **scv5**: `DEVIATION` → reversal (limit, tunggu retest); `BREAKOUT_RETEST`; `RANGE_EDGE` → S/R Scalp; konfirmasi 5m (engine memakai data 5m).
- **scv6**: `LIQUIDITY_SWEEP_RECLAIM`/`DEVIATION_REJECTION_SHORT` → reversal; `ELIZ_FIB_075_BOUNCE` → S/R Scalp; `EMA_FLIP_SQUEEZE` → Momentum.
- “Average Risk per trade” = risiko akun (%) bila dicatat mesin, selain itu asumsi 1%. “Average R:R” = target akhir (maks 10 agar outlier tidak merusak rata-rata); angka kecil di sebelahnya = R:R ke TP1.

## Rekomendasi operasional

**Data dummy** (`allowDemo`, profil dibuat dari perilaku nyata tiap mesin): scv5 & scv2 → **AKTIFKAN** (HQ 63–88%, forced <10%, expectancy HQ positif) · scv3 → **OPTIMIZE** (±48% forced karena squeeze market-entry; matikan/ubah setup Momentum) · scv6 → **OPTIMIZE (mendekati PAUSE)** (R:R palsu 6–58R, 3% HQ, frekuensi ±8/hari) · sc & scv4 → **PAUSE** (expectancy negatif; scv4 konfirmasi di 1H & stop lebar).

**Data nyata dari 6 zip yang diupload** (dibaca lewat adapter yang sama): scv6 punya 57 trade selesai, win rate 37%, expectancy −0,20R, loss beruntun 16x, dan target R:R sampai 58R → **PAUSE** (skor mentah tinggi karena stop ketat & trigger sweep jelas, tetapi hasil dan R:R tidak bisa dipercaya). sc (5 trade), scv3 (8 sinyal), scv5 (3 trade) → **sampel terlalu kecil**, belum layak diaktifkan; scv5 paling disiplin (limit di level, konfirmasi 5m, 1 dari 4 sinyal tidak terisi — tidak mengejar harga). scv2 & scv4 tidak punya jurnal di zip (state ada di branch `data`/Pages), jadi tampil DEMO sampai dihubungkan.

## Keterbatasan

- Kualitas dinilai dari **metadata yang dicatat mesin** (setup, level, TF, stop); mesin tidak menyimpan semua (mis. jumlah sentuhan level hanya ada di scv5). Field kosong dinilai netral-konservatif.
- Skor bukan bukti edge. Gunakan bersama syarat sampel (≥30–50 trade selesai/mesin). Bukan nasihat keuangan.
- Cron GitHub best-effort (bisa telat); repo tanpa aktivitas 60 hari menonaktifkan jadwal otomatis.
