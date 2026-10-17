import { spawnSync } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, reportE2E } from './coverage.mjs';

const directory = resolve(root, 'coverage/e2e');
await rm(directory, { recursive: true, force: true });
await mkdir(resolve(directory, 'raw'), { recursive: true });
const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'coverage'],
  { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/playwright/cli.js'), 'test', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', env: { ...process.env, E2E_COVERAGE: '1' } },
);
try {
  await reportE2E();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
if (run.error) {
  console.error(run.error);
  process.exitCode = 1;
}
if (run.status !== 0) process.exitCode = run.status ?? 1;
