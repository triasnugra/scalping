// Ambil jurnal tiap mesin -> normalisasi. Urutan per mesin: LIVE (GitHub) -> STALE (deploy sebelumnya) -> DEMO (hanya bila allowDemo) -> ERROR.
// Env: GH_TOKEN (repo privat), LOCAL_DIR (uji lokal: <dir>/<repo>-main/<path>)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS, finalize } from './adapters.mjs';
import { generateDemo } from './demo.mjs';
import { http } from './net.mjs';

async function readSource(src, owner, eng, { token, local }) {
  if (local) return readFile(join(local, `${eng.repo}-main`, src.path), 'utf8');
  if (src.url) return http(src.url.replace('{owner}', owner).replace('{repo}', eng.repo));
  const base = `${owner}/${eng.repo}`;
  if (token) return http(`https://api.github.com/repos/${base}/contents/${src.path}?ref=${src.branch}`, { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json' });
  return http(`https://raw.githubusercontent.com/${base}/${src.branch}/${src.path}`);
}

export async function collectAll(cfg, { token = '', local = '', forceDemo = false, prev = [], now = Date.now(), log = console.log } = {}) {
  const owner = cfg.owner || process.env.GITHUB_REPOSITORY_OWNER || '';
  const demoAll = (forceDemo || cfg.allowDemo) ? generateDemo(now).map(finalize).map(s => ({ ...s, rNet: true })) : [];
  const signals = [], engines = [];
  for (const eng of cfg.engines.filter(e => e.enabled !== false)) {
    const meta = { id: eng.id, name: eng.name, repo: `${owner}/${eng.repo}`, status: 'error', message: '' };
    let list = null;
    if (!forceDemo) {
      try {
        const files = {};
        for (const s of eng.sources) files[s.key] = await readSource(s, owner, eng, { token, local });
        list = ADAPTERS[eng.adapter](files);
        meta.status = 'live'; meta.message = `${list.length} sinyal dibaca`;
      } catch (e) {
        meta.message = `Gagal ambil data: ${e.message}`;
        const old = prev.filter(s => s.engine === eng.id);
        if (old.length) { list = old; meta.status = 'stale'; meta.message += ' — memakai data deploy sebelumnya'; }
      }
    }
    if (!list && (forceDemo || cfg.allowDemo)) {
      list = demoAll.filter(s => s.engine === eng.id);
      meta.status = 'demo'; meta.message = (forceDemo ? 'Mode demo dipaksa' : meta.message) + ' — DATA DUMMY';
    }
    list ||= [];
    meta.count = list.length;
    meta.lastTs = list.reduce((m, s) => Math.max(m, Date.parse(s.ts) || 0), 0) || null;
    signals.push(...list); engines.push(meta);
    log(`${eng.id.padEnd(5)} ${meta.status.padEnd(5)} ${String(meta.count).padStart(4)}  ${meta.message}`);
  }
  return { engines, signals };
}
