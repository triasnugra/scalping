// Kalender event makro (FOMC / CPI) dari data/events.json. Fungsi murni: dipakai browser dan Node.
// Data dijaga manual (sumber resmi dicantumkan di tiap baris). Bila semua event sudah lewat, monitor memberi peringatan.

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const TZ = { 7: 'WIB', 8: 'WITA', 9: 'WIT', 0: 'UTC' };
const p2 = n => String(n).padStart(2, '0');

export const valid = list => (Array.isArray(list) ? list : []).filter(e => e && e.utc && Number.isFinite(Date.parse(e.utc)));

export function nextEvent(list, nowMs) {
  return valid(list).filter(e => Date.parse(e.utc) > nowMs).sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc))[0] ?? null;
}

// Event yang sedang berada di jendela risiko: dari `sebelumJam` sebelum rilis sampai `sesudahJam` sesudahnya.
export function activeWindow(list, nowMs, sebelumJam = 2, sesudahJam = 1) {
  return valid(list).find(e => { const t = Date.parse(e.utc); return nowMs >= t - sebelumJam * 36e5 && nowMs <= t + sesudahJam * 36e5; }) ?? null;
}

export function countdown(ms) {
  if (ms < 0) return 'sedang berlangsung';
  const j = ms / 36e5;
  if (j < 1) return 'kurang dari 1 jam lagi';
  if (j < 48) return `sekitar ${Math.round(j)} jam lagi`;
  return `sekitar ${Math.round(j / 24)} hari lagi`;
}

// Satu kalimat: jenis, nama, tanggal & jam menurut zona pilihan, jam resmi ET, hitung mundur.
export function eventSentence(list, nowMs, tz = 7) {
  const e = nextEvent(list, nowMs);
  if (!e) return 'Tidak ada event FOMC/CPI mendatang di data/events.json: perbarui kalender event.';
  const t = Date.parse(e.utc), d = new Date(t + tz * 36e5);
  const tgl = `${HARI[d.getUTCDay()]} ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()} pukul ${p2(d.getUTCHours())}.${p2(d.getUTCMinutes())} ${TZ[tz] ?? 'UTC'}`;
  return `Event terdekat: ${e.type} (${e.name}), ${tgl}${e.et ? ` [${e.et}]` : ''}, ${countdown(t - nowMs)}.`;
}
