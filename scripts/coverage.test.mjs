import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { completeBaseline, mergeDocuments, missingCoverage, reportCoverage } from './coverage.mjs';
import { assertProductionBuild } from './assert-production-build.mjs';

function fixture(path, count = 0) {
  const loc = { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } };
  return {
    path,
    statementMap: { 0: loc },
    s: { 0: count },
    fnMap: {},
    f: {},
    branchMap: { 0: { type: 'if', loc, locations: [loc, loc] } },
    b: { 0: [count, 0] },
  };
}
test('文書の最新スナップショットだけを採用し、別文書の実行を加算する', () => {
  const file = resolve('src/example.ts');
  const records = [
    { documents: { a: { [file]: fixture(file, 1) } } },
    { documents: { a: { [file]: fixture(file, 2) }, b: { [file]: fixture(file, 3) } } },
  ];
  const original = structuredClone(records);
  const map = mergeDocuments(records, {});
  assert.equal(map.fileCoverageFor(file).s[0], 5);
  assert.deepEqual(map.fileCoverageFor(file).b[0], [5, 0]);
  assert.deepEqual(records, original);
  assert.equal(mergeDocuments(records, {}).fileCoverageFor(file).s[0], 5);
  assert.deepEqual(
    missingCoverage(map).map((item) => [item.kind, item.line, item.arm]),
    [['if', 2, 1]],
  );
});
test('未取得ファイルの0カウンタを母数へ含め、欠落データを正常扱いしない', () => {
  const file = resolve('src/loaded.ts'),
    absent = resolve('src/unloaded.ts');
  const baseline = { [absent]: fixture(absent) };
  const map = mergeDocuments([{ documents: { a: { [file]: fixture(file, 1) } } }], baseline);
  assert.equal(map.getCoverageSummary().statements.pct, 50);
  assert.throws(() => mergeDocuments([{ documents: {} }], {}), /文書がありません/);
  assert.throws(() => mergeDocuments([{ documents: { a: {} } }], {}), /計測データ欠落/);
  assert.equal(baseline[absent].s[0], 0);
});
test('未importのTS・TSXも計上し、型宣言とテストは母数から除く', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'coverage-baseline-'));
  try {
    await mkdir(resolve(dir, 'nested'));
    await writeFile(resolve(dir, 'unused.ts'), 'export const unused: number = 1;');
    await writeFile(resolve(dir, 'nested/view.tsx'), 'export const View = () => <div>view</div>;');
    await writeFile(resolve(dir, 'ignored.test.ts'), 'throw new Error();');
    await writeFile(resolve(dir, 'ignored.d.ts'), 'declare const value: number;');
    const baseline = await completeBaseline({}, dir);
    assert.equal(Object.keys(baseline).length, 2);
    for (const coverage of Object.values(baseline))
      assert.ok(Object.values(coverage.s).every((count) => count === 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('HTML・JSON・LCOVと未到達位置を同じカウンタから出力する', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'coverage-report-'));
  try {
    const file = resolve(dir, 'source.ts');
    await writeFile(file, '\nif (value) return;\n');
    const map = mergeDocuments([{ documents: { a: { [file]: fixture(file, 1) } } }], {});
    const summary = await reportCoverage(map, resolve(dir, 'report'));
    assert.equal(summary.statements.pct, 100);
    assert.equal(summary.branches.pct, 50);
    for (const name of [
      'index.html',
      'coverage-final.json',
      'coverage-summary.json',
      'lcov.info',
      'uncovered.json',
      'uncovered.md',
    ]) {
      assert.ok((await readFile(resolve(dir, 'report', name), 'utf8')).length);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('本番成果物への計測コード・manifest混入と、成果物欠落を拒否する', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'coverage-production-'));
  try {
    await assert.rejects(assertProductionBuild(directory), /JavaScriptがありません/);
    await writeFile(resolve(directory, 'app.js'), 'console.log("production");');
    await assertProductionBuild(directory);
    await writeFile(resolve(directory, 'app.js'), 'globalThis.__coverage__ = {};');
    await assert.rejects(assertProductionBuild(directory), /計測コード/);
    await writeFile(resolve(directory, 'app.js'), 'console.log("production");');
    await writeFile(resolve(directory, 'coverage-baseline.json'), '{}');
    await assert.rejects(assertProductionBuild(directory), /manifest/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
