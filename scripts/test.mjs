import { createRequire } from 'node:module';
import { readdir, readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = require('typescript');
// Compile core helpers and test fixtures to CommonJS, then run Node's test runner.
const files = ['src/lib/types.ts','src/lib/epub-selection.ts','src/lib/reader-trace.ts','src/lib/reading-preferences.ts','src/lib/auth-actions.ts','src/lib/reader-chrome.ts','src/lib/epub-pages.ts','src/lib/epub-scroll.ts','src/lib/retention.ts','src/lib/locations.ts','src/lib/sync.ts','src/lib/export.ts','src/server/validate-book.ts','src/app/api/sample/route.ts', ...(await readdir('tests')).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`)];
// An isolated output prevents stale compiled helpers from masking missing inputs.
await mkdir('work', { recursive: true });
const workDir = path.resolve('work');
const buildDir = await mkdtemp(path.join(workDir, 'test-run-'));
try {
  for (const file of files) {
    const result = ts.transpileModule(await readFile(file, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    if (result.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n' }));
    const target = path.join(buildDir, file.replace(/\.ts$/, '.js')); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, result.outputText);
  }
  const tests = files.filter(f => f.startsWith('tests/')).map(f => path.join(buildDir, f.replace(/\.ts$/, '.js')));
  const nativeTests = (await readdir('tests')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
  const result = spawnSync(process.execPath, ['--test', ...tests, ...nativeTests], { stdio: 'inherit' }); process.exitCode = result.status ?? 1;
} finally {
  const relative = path.relative(workDir, path.resolve(buildDir));
  if (relative.startsWith('test-run-') && !relative.includes(path.sep)) await rm(buildDir, { recursive: true, force: true });
}
