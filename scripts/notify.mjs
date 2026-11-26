// Notifikasi upgrade: membuat GitHub Issue (masuk email/aplikasi GitHub) untuk alert BARU, dan opsional Telegram.
// Berjalan di Actions setelah build. Gagal = hanya log, tidak menggagalkan deploy.
// Satu issue per kunci alert (judul stabil). Tutup issue = sudah dibaca; issue yang sama tidak dibuat ulang selama judulnya ada.
import fs from 'node:fs';

const TOKEN = process.env.GITHUB_TOKEN, REPO = process.env.GITHUB_REPOSITORY;
const TG = process.env.TELEGRAM_BOT_TOKEN, TGC = process.env.TELEGRAM_CHAT_ID;
const MAX = 5, LABEL = 'upgrade-monitor';
const dir = process.env.OUT_DIR || 'site';

const alerts = JSON.parse(fs.readFileSync(`${dir}/data/alerts.json`, 'utf8')).alerts.filter(a => a.notify);
if (!alerts.length) { console.log('notify: tidak ada alert yang perlu dikirim'); process.exit(0); }

const title = a => `[msc] ${a.engine}: ${a.code.replace(/[:_]/g, ' ')} — ${a.title}`;
const gh = (path, opt = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  ...opt, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) }, signal: AbortSignal.timeout(20000),
});

let fresh = [];
if (TOKEN && REPO) {
  try {
    await gh('/labels', { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'd93f0b', description: 'Notifikasi upgrade dari monitor msc' }) }).catch(() => {});
    const have = new Set();
    for (let p = 1; p <= 5; p++) {
      const r = await gh(`/issues?labels=${LABEL}&state=all&per_page=100&page=${p}`);
      if (!r.ok) throw new Error('daftar issue HTTP ' + r.status);
      const j = await r.json(); j.forEach(i => have.add(i.title)); if (j.length < 100) break;
    }
    fresh = alerts.filter(a => !have.has(title(a))).slice(0, MAX);
    const site = `https://${process.env.GITHUB_REPOSITORY_OWNER}.github.io/${REPO.split('/')[1]}/`;
    for (const a of fresh) {
      const body = `**${a.level.toUpperCase()}** · ${a.kategori}\n\n${a.detail}\n\n**Saran:** ${a.aksi}\n\nDashboard: ${site}\n\n_Tutup issue ini bila sudah ditangani/dibaca. Alert dengan judul yang sama tidak dibuat ulang._`;
      const r = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: title(a), body, labels: [LABEL] }) });
      console.log(r.ok ? `notify: issue dibuat — ${title(a)}` : `notify: gagal buat issue (${r.status}) — ${title(a)}`);
    }
  } catch (e) { console.log('notify: GitHub gagal —', e.message); }
} else console.log('notify: GITHUB_TOKEN/GITHUB_REPOSITORY tidak ada, issue dilewati');

if (TG && TGC && fresh.length) {
  try {
    const text = `Monitor scalping msc: ${fresh.length} notifikasi upgrade baru\n\n` + fresh.map(a => `• [${a.level}] ${a.engine} — ${a.title}\n  ${a.detail}`).join('\n\n');
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TGC, text: text.slice(0, 3900) }), signal: AbortSignal.timeout(20000) });
    console.log(r.ok ? 'notify: Telegram terkirim' : 'notify: Telegram gagal HTTP ' + r.status);
  } catch (e) { console.log('notify: Telegram gagal —', e.message); }
}
