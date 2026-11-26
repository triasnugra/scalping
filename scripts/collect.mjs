#!/usr/bin/env node
// Ambil jurnal 6 mesin -> normalisasi -> site/data/signals.json (+ quality.json).
// Urutan per mesin: LIVE (GitHub) -> STALE (data deploy sebelumnya) -> DEMO (data dummy) -> ERROR.
// Opsi: --demo (paksa dummy semua)   env: GH_TOKEN (repo privat), GITHUB_OWNER, PREV_PAGES_URL, LOCAL_DIR (uji lokal)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from './adapters.mjs';
import { generateDemo } from './demo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'data');
const FORCE_DEMO = process.argv.includes('--demo');
const TOKEN = process.env.GH_TOKEN || '';

async function http(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'scalp-monitor', ...headers }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/\/\/[^@]*@/, '//')}`);
  return res.text();
}

async function readSource(src, owner, eng) {
  if (process.env.LOCAL_DIR) return readFile(join(process.env.LOCAL_DIR, `${eng.repo}-main`, src.path), 'utf8');
  if (src.url) return http(src.url.replace('{owner}', owner).replace('{repo}', eng.repo));
  const base = `${owner}/${eng.repo}`;
  if (TOKEN) {
    return http(`https://api.github.com/repos/${base}/contents/${src.path}?ref=${src.branch}`,
      { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw+json' });
  }
  return http(`https://raw.githubusercontent.com/${base}/${src.branch}/${src.path}`);
}

async function previous() {
  const base = process.env.PREV_PAGES_URL;
  if (!base) return [];
  try { return JSON.parse(await http(`${base.replace(/\/$/, '')}/data/signals.json`)).signals || []; } catch { return []; }
}

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'engines.json'), 'utf8'));
const owner = cfg.owner || process.env.GITHUB_OWNER || process.env.GITHUB_REPOSITORY_OWNER || '';
const prev = await previous();
const demoAll = generateDemo();
const signals = [], engines = [];

for (const eng of cfg.engines) {
  const meta = { id: eng.id, name: eng.name, repo: `${owner}/${eng.repo}`, status: 'error', message: '' };
  let list = null;
  if (!FORCE_DEMO) {
    try {
      const files = {};
      for (const s of eng.sources) files[s.key] = await readSource(s, owner, eng);
      list = ADAPTERS[eng.adapter](files);
      meta.status = 'live'; meta.message = `${list.length} sinyal dibaca`;
    } catch (e) {
      meta.message = `Gagal ambil data: ${e.message}`;
      const old = prev.filter(s => s.engine === eng.id);
      if (old.length) { list = old; meta.status = 'stale'; meta.message += ' — memakai data deploy sebelumnya'; }
    }
  }
  if (!list && (FORCE_DEMO || cfg.allowDemo)) {
    list = demoAll.filter(s => s.engine === eng.id);
    meta.status = 'demo'; meta.message = (FORCE_DEMO ? 'Mode demo dipaksa' : meta.message) + ' — DATA DUMMY';
  }
  list ||= [];
  meta.count = list.length;
  signals.push(...list); engines.push(meta);
  console.log(`${eng.id.padEnd(5)} ${meta.status.padEnd(5)} ${String(meta.count).padStart(4)}  ${meta.message}`);
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'signals.json'), JSON.stringify({ generated: new Date().toISOString(), engines, signals }));
await writeFile(join(OUT, 'quality.json'), await readFile(join(ROOT, 'config', 'quality.json'), 'utf8'));
console.log(`Selesai: ${signals.length} sinyal -> site/data/signals.json`);
