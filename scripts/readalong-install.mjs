#!/usr/bin/env node
/** Conservative integration installer. Dry-run unless --apply; never commits or deploys. */
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function patchMenu(text) {
  if (text.includes("label: 'Read along'")) {
    if (!text.includes("import { openReadAlong } from '../readalong/launch'")) throw new Error('Existing Read along item has a different implementation; review manually.');
    return text;
  }
  const anchor = "import { OpfsInspector } from './OpfsInspector'";
  const entry = "    { label: 'Storage', run: () => setInspector(true) },";
  for (const a of [anchor, entry]) if (text.split(a).length !== 2) throw new Error('OptionsMenu has changed. Apply the menu addition manually after review.');
  return text.replace(anchor, `${anchor}\nimport { openReadAlong } from '../readalong/launch'`).replace(entry, `    { label: 'Read along', run: () => { setMenuOpen(false); openReadAlong() } },\n${entry}`);
}
export function patchVite(text) {
  if (text.includes("server.middlewares.use('/api/readalong'")) return text;
  const anchor = "    server.middlewares.use('/api/summarise', webhook(() => import('./api/summarise.mjs')))";
  if (text.split(anchor).length !== 2) throw new Error('Vite middleware has changed. Add the readalong handler manually after review.');
  return text.replace(anchor, `${anchor}\n    // @ts-expect-error - untyped Node-only ESM module\n    server.middlewares.use('/api/readalong', webhook(() => import('./api/readalong.mjs')))`);
}
export const READER_CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; form-action 'none'";
export function patchVercel(raw) {
  const config = JSON.parse(raw);
  const old = '/((?!api/).*)', updated = '/((?!api/|readalong/).*)';
  const rewrite = config.rewrites?.find(r => r.source === old || r.source === updated);
  if (!rewrite || rewrite.destination !== '/__spa-fallback.html') throw new Error('Unexpected Vercel rewrite; review before changing it.');
  rewrite.source = updated;
  config.functions ||= {};
  config.functions['api/readalong.mjs'] = { ...config.functions['api/readalong.mjs'], maxDuration: 300 };
  if (!Array.isArray(config.headers)) throw new Error('Unexpected Vercel headers.');
  // Only the trusted reader may be framed. Preserve DENY on all other routes.
  const all = config.headers.find(h => h.source === '/(.*)');
  const frameRules = all?.headers?.filter(h => h.key.toLowerCase() === 'x-frame-options') || [];
  if (frameRules.length) {
    if (frameRules.some(h => h.value !== 'DENY')) throw new Error('Existing frame policy differs; review manually.');
    all.headers = all.headers.filter(h => h.key.toLowerCase() !== 'x-frame-options');
    config.headers.push({ source: '/((?!readalong/).*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] });
  } else if (!config.headers.some(h => h.source === '/((?!readalong/).*)')) throw new Error('Cannot establish existing anti-framing protection.');
  const target = '/readalong/(.*)';
  const rule = { source: target, headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Content-Security-Policy', value: READER_CSP }, { key: 'Cache-Control', value: 'no-cache' }] };
  const index = config.headers.findIndex(h => h.source === target);
  if (index >= 0) config.headers[index] = rule; else config.headers.push(rule);
  return JSON.stringify(config, null, 2) + '\n';
}
async function listFiles(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in package: ${file}`);
    if (entry.isDirectory()) results.push(...await listFiles(file)); else results.push(file);
  }
  return results;
}
async function safeTarget(repo, relative) {
  let current = repo;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink destination: ${current}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
export async function install(repo, apply = false, permitDirty = false) {
  repo = path.resolve(repo);
  const packageInfo = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  if (packageInfo.name !== 'inkwave') throw new Error('Target is not the Inkwave repository.');
  // A user's working tree is not disposable. Do not stash, reset, checkout, commit or push it.
  if (!permitDirty) {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    if (status.trim()) throw new Error('Working tree has changes. Review/commit them first, or have Codex apply the small additions manually.');
  }
  const patches = [ ['src/components/OptionsMenu.tsx', patchMenu], ['vite.config.ts', patchVite], ['vercel.json', patchVercel] ];
  const writes = [];
  for (const [relative, patch] of patches) {
    const target = await safeTarget(repo, relative), old = await readFile(target, 'utf8'), next = patch(old);
    if (next !== old) writes.push({ target, relative, old, next });
  }
  const candidates = [
    ...(await listFiles(path.join(bundle, 'public/readalong'))),
    path.join(bundle, 'api/readalong.mjs'), path.join(bundle, 'src/readalong/launch.ts'),
    ...(await listFiles(path.join(bundle, 'tests/readalong'))),
    path.join(bundle, 'scripts/readalong-dev.mjs'), path.join(bundle, 'scripts/readalong-install.mjs'),
    path.join(bundle, 'scripts/readalong-vendor.mjs'),
    path.join(bundle, 'docs/READALONG.md'),
  ];
  for (const source of candidates) {
    const relative = path.relative(bundle, source), target = await safeTarget(repo, relative), next = await readFile(source);
    let old;
    try { old = await readFile(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (old && !old.equals(next)) throw new Error(`Existing file differs: ${relative}. Nothing was written. Review manually.`);
    if (!old) writes.push({ target, relative, old: null, next });
  }
  console.log(`${apply ? 'Applying' : 'Dry run:'} ${writes.length} file changes\n${writes.map(w => `  ${w.old === null ? '+' : '~'} ${w.relative}`).join('\n')}`);
  if (!apply || !writes.length) return writes;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const gitPath = execFileSync('git', ['rev-parse', '--git-path', `inkwave-readalong-backups/${stamp}`], { cwd: repo, encoding: 'utf8' }).trim();
  const backup = path.resolve(repo, gitPath);
  // Preflight is complete. Back up existing files before any modifications.
  await mkdir(backup, { recursive: true });
  for (const w of writes) if (w.old !== null) { const b = path.join(backup, w.relative); await mkdir(path.dirname(b), { recursive: true }); await writeFile(b, w.old); }
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(writes.map(w => ({ path: w.relative, added: w.old === null })), null, 2));
  for (const w of writes) {
    await mkdir(path.dirname(w.target), { recursive: true });
    if (w.old !== null) { const current = await readFile(w.target); if (!current.equals(Buffer.from(w.old))) throw new Error(`File changed during installation: ${w.relative}. Stop and review the backup manifest.`); }
    await writeFile(w.target, w.next, { flag: w.old === null ? 'wx' : 'w' });
  }
  console.log(`Applied locally. Existing-file backups: ${backup}\nNo commit, push or deployment was made. Run the validations in CODEX_START_HERE.md.`);
  return writes;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!repo) { console.error('Usage: node scripts/readalong-install.mjs /path/to/inkwave [--apply]'); process.exitCode = 1; }
  else install(repo, process.argv.includes('--apply')).catch(e => { console.error(e.message); process.exitCode = 1; });
}
