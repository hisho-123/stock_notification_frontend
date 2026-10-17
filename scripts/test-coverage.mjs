import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import libCoverage from 'istanbul-lib-coverage';
import { root, readJSON, reportCoverage } from './coverage.mjs';

await rm(resolve(root, 'coverage/vitest'), { recursive: true, force: true });
const run = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--coverage', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
try {
  await reportCoverage(
    libCoverage.createCoverageMap(
      await readJSON(resolve(root, 'coverage/vitest/coverage-final.json')),
    ),
    resolve(root, 'coverage/vitest'),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
if (run.error) {
  console.error(run.error);
  process.exitCode = 1;
}
if (run.status !== 0) process.exitCode = run.status ?? 1;
