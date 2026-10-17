import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import sourceMaps from 'istanbul-lib-source-maps';
import instrument from 'istanbul-lib-instrument';

export const root = resolve(import.meta.dirname, '..');
export const isSource = (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|d)\.(ts|tsx)$/.test(file);
export const isPriority = (file) =>
  !['main.tsx', 'router.tsx', 'types.ts'].includes(relative(resolve(root, 'src'), file));
export const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
export async function writeJSON(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
export async function completeBaseline(baseline, directory = resolve(root, 'src')) {
  const data = structuredClone(baseline);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) Object.assign(data, await completeBaseline(data, file));
    else if (isSource(file) && !data[file]) {
      // 未importの新規ファイルも母数に含め、読み込んだファイルだけの100%を防ぐ。
      const parser = instrument.createInstrumenter({
        parserPlugins: ['typescript', 'jsx'],
        esModules: true,
      });
      parser.instrumentSync(await readFile(file, 'utf8'), file);
      data[file] = parser.lastFileCoverage();
    }
  }
  return data;
}
export function mergeDocuments(records, baseline) {
  const documents = new Map();
  for (const record of records) {
    if (!record.documents || Object.keys(record.documents).length === 0)
      throw new Error('カバレッジ文書がありません');
    for (const [id, coverage] of Object.entries(record.documents)) {
      if (!coverage || Object.keys(coverage).length === 0) throw new Error(`計測データ欠落: ${id}`);
      // 文書ごとの最新の累積値だけを採用し、pagehideと最終回収の二重加算を防ぐ。
      documents.set(id, coverage);
    }
  }
  const map = libCoverage.createCoverageMap({});
  // Istanbulのmergeは入力オブジェクトも変更するため、PC別・合算で生データを使い回さない。
  for (const coverage of documents.values()) map.merge(structuredClone(coverage));
  for (const [file, coverage] of Object.entries(baseline)) {
    if (!map.files().includes(file)) map.addFileCoverage(structuredClone(coverage));
  }
  return map;
}
export function missingCoverage(map) {
  return map
    .files()
    .sort()
    .flatMap((file) => {
      const { s, b, statementMap, branchMap } = map.fileCoverageFor(file).toJSON();
      return [
        ...Object.entries(s)
          .filter(([, count]) => count === 0)
          .map(([id]) => ({
            file: relative(root, file),
            kind: 'statement',
            line: statementMap[id].start.line,
          })),
        ...Object.entries(b).flatMap(([id, counts]) =>
          counts.flatMap((count, arm) =>
            count === 0
              ? [
                  {
                    file: relative(root, file),
                    kind: branchMap[id].type,
                    line: branchMap[id].locations[arm]?.start.line ?? branchMap[id].loc.start.line,
                    arm,
                  },
                ]
              : [],
          ),
        ),
      ];
    });
}
export async function reportCoverage(map, directory) {
  await mkdir(directory, { recursive: true });
  const context = libReport.createContext({ dir: directory, coverageMap: map });
  for (const name of ['html', 'json', 'json-summary', 'lcovonly', 'text-summary'])
    reports.create(name).execute(context);
  const missing = missingCoverage(map);
  await writeJSON(resolve(directory, 'uncovered.json'), missing);
  await writeFile(
    resolve(directory, 'uncovered.md'),
    '# 未到達の文・分岐\n\n' +
      (missing.length
        ? '| ファイル | 行 | 種類 | 分岐番号 |\n| --- | --- | --- | --- |\n' +
          missing
            .map((item) => `| ${item.file} | ${item.line} | ${item.kind} | ${item.arm ?? '—'} |`)
            .join('\n')
        : '未到達なし。') +
      '\n',
  );
  return map.getCoverageSummary().toJSON();
}
export async function reportE2E() {
  const directory = resolve(root, 'coverage/e2e');
  const baseline = await completeBaseline(
    await readJSON(resolve(root, '.coverage-dist/coverage-baseline.json')),
  );
  const files = (await readdir(resolve(directory, 'raw'))).filter((file) => file.endsWith('.json'));
  if (!files.length) throw new Error('E2Eの計測結果がありません');
  const records = await Promise.all(files.map((file) => readJSON(resolve(directory, 'raw', file))));
  const summaries = {};
  for (const project of ['desktop', 'mobile', 'combined']) {
    const selected =
      project === 'combined' ? records : records.filter((record) => record.project === project);
    if (!selected.length) throw new Error(`${project}の計測結果がありません`);
    const map = await sourceMaps
      .createSourceMapStore()
      .transformCoverage(mergeDocuments(selected, baseline));
    for (const file of map.files()) {
      if (!file.startsWith(resolve(root, 'src') + '/') || !isSource(file))
        map.filter((name) => name !== file);
    }
    if (!map.files().length) throw new Error(`${project}の本番ソースへの対応付けに失敗しました`);
    summaries[project] = await reportCoverage(map, resolve(directory, project));
    const priority = libCoverage.createCoverageMap(map.toJSON());
    priority.filter(isPriority);
    summaries[`${project}-priority`] = await reportCoverage(
      priority,
      resolve(directory, project, 'priority'),
    );
  }
  await writeJSON(resolve(directory, 'summary.json'), summaries);
  await writeFile(
    resolve(directory, 'summary.md'),
    '# E2Eカバレッジ\n\nC0＝Statements、C1＝Branches。Vitestとは合算しない。重点範囲の100%は改善目標。\n\n| 対象 | C0 | C1 |\n| --- | --- | --- |\n' +
      Object.entries(summaries)
        .map(
          ([name, value]) =>
            `| ${name} | ${value.statements.pct}% (${value.statements.covered}/${value.statements.total}) | ${value.branches.pct}% (${value.branches.covered}/${value.branches.total}) |`,
        )
        .join('\n') +
      '\n',
  );
}
