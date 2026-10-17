import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function assertProductionBuild(directory) {
  const files = await readdir(directory, { recursive: true });
  const scripts = files.filter((file) => file.endsWith('.js'));
  if (!scripts.length) throw new Error('本番ビルドのJavaScriptがありません');
  if (files.includes('coverage-baseline.json'))
    throw new Error('本番ビルドに計測用manifestが含まれています');
  for (const file of scripts) {
    if (/__coverage__|__VITEST_COVERAGE__/.test(await readFile(resolve(directory, file), 'utf8'))) {
      throw new Error(`本番ビルドに計測コードが含まれています: ${file}`);
    }
  }
}
if (import.meta.main) await assertProductionBuild(resolve('dist'));
