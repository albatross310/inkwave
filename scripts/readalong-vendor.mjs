/** Copy installed parsing libraries for the lazy, same-origin static reader. */
import { createRequire } from 'node:module';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.join(root, 'public/readalong/vendor');
await mkdir(target, { recursive: true });
await cp(path.join(pdfRoot, 'cmaps'), path.join(target, 'cmaps'), { recursive: true });
for (const [source, name] of [['build/pdf.min.mjs', 'pdf.mjs'], ['build/pdf.worker.min.mjs', 'pdf.worker.mjs'], ['LICENSE', 'PDFJS-LICENSE']]) {
  await copyFile(path.join(pdfRoot, source), path.join(target, name));
}
const { version } = JSON.parse(await readFile(path.join(pdfRoot, 'package.json'), 'utf8'));
await writeFile(path.join(target, 'version.json'), JSON.stringify({ library: 'pdfjs-dist', version }) + '\n');
const katexRoot = path.dirname(require.resolve('katex/package.json'));
await copyFile(path.join(katexRoot, 'dist/katex.mjs'), path.join(target, 'katex.mjs'));
await copyFile(path.join(katexRoot, 'LICENSE'), path.join(target, 'KATEX-LICENSE'));
const { version: katexVersion } = JSON.parse(await readFile(path.join(katexRoot, 'package.json'), 'utf8'));
await writeFile(path.join(target, 'math-version.json'), JSON.stringify({ library: 'katex', version: katexVersion }) + '\n');
