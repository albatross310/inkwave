import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { install } from '../../scripts/readalong-install.mjs';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkwave-readalong-test-'));
  await mkdir(path.join(dir, 'src/components'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'inkwave', type: 'module' }));
  await writeFile(path.join(dir, 'src/components/OptionsMenu.tsx'), "import { OpfsInspector } from './OpfsInspector'\nconst items = [\n    { label: 'Storage', run: () => setInspector(true) },\n]\n");
  await writeFile(path.join(dir, 'vite.config.ts'), "    server.middlewares.use('/api/summarise', webhook(() => import('./api/summarise.mjs')))\n");
  await writeFile(path.join(dir, 'vercel.json'), JSON.stringify({ rewrites: [{ source: '/((?!api/).*)', destination: '/__spa-fallback.html' }], headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }] }));
  git(dir, 'init', '-q'); git(dir, 'add', '.'); git(dir, '-c', 'user.name=Reader Test', '-c', 'user.email=reader-test@example.test', 'commit', '-qm', 'Fixture only');
  return dir;
}
test('installer dry-run is read-only, apply adds real code, and reapply is idempotent', async () => {
  const dir = await fixture();
  try {
    const intended = await install(dir); assert.ok(intended.length > 10);
    assert.equal(git(dir, 'status', '--porcelain').trim(), '');
    await assert.rejects(access(path.join(dir, 'api/readalong.mjs')));
    await install(dir, true);
    assert.match(await readFile(path.join(dir, 'src/components/OptionsMenu.tsx'), 'utf8'), /label: 'Read along'/);
    assert.match(await readFile(path.join(dir, 'public/readalong/app.mjs'), 'utf8'), /renderSelection/);
    assert.equal((await install(dir, false, true)).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('installer never clobbers unrelated dirty work', async () => {
  const dir = await fixture();
  try {
    await writeFile(path.join(dir, 'important-draft.txt'), 'Keep this exact text');
    await assert.rejects(install(dir, true), /Working tree has changes/);
    assert.equal(await readFile(path.join(dir, 'important-draft.txt'), 'utf8'), 'Keep this exact text');
    await assert.rejects(access(path.join(dir, 'api/readalong.mjs')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Git linked worktrees use Git-resolved backup location, not a .git directory assumption', async () => {
  const dir = await fixture(), worktree = dir + '-worktree';
  try {
    git(dir, 'worktree', 'add', '-qb', 'reader-fixture', worktree);
    await install(worktree, true);
    assert.match(await readFile(path.join(worktree, 'vite.config.ts'), 'utf8'), /api\/readalong/);
    assert.match(await readFile(path.join(worktree, '.git'), 'utf8'), /^gitdir:/);
  } finally { await rm(worktree, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});
