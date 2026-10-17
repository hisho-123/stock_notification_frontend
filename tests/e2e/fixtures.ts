import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CoverageMapData } from 'istanbul-lib-coverage';

interface CoverageWindow extends Window {
  __coverage__?: CoverageMapData;
  __stockCoverageDocument?: string;
}
export const test = base.extend({
  page: async ({ page }, use, info) => {
    if (process.env.E2E_COVERAGE !== '1') {
      await use(page);
      return;
    }
    await page.addInitScript(
      ({ origin }) => {
        if (location.origin !== origin) return;
        const target = window as CoverageWindow;
        const id = crypto.randomUUID();
        target.__stockCoverageDocument = id;
        // pagehideは実際の離脱時だけ発火するため、beforeunloadの取消で累積値を二重計上しない。
        window.addEventListener('pagehide', () => {
          const documents = JSON.parse(sessionStorage.getItem('__stockCoverage') ?? '{}');
          documents[id] = target.__coverage__;
          sessionStorage.setItem('__stockCoverage', JSON.stringify(documents));
        });
      },
      { origin: new URL(info.project.use.baseURL!).origin },
    );
    async function collect() {
      if (page.isClosed()) throw new Error('最終回収前にページが閉じられました');
      const documents = await page.evaluate(() => {
        const target = window as CoverageWindow;
        if (!target.__coverage__ || !target.__stockCoverageDocument)
          throw new Error('Istanbul計測データがありません');
        const documents = JSON.parse(sessionStorage.getItem('__stockCoverage') ?? '{}');
        documents[target.__stockCoverageDocument] = target.__coverage__;
        return documents;
      });
      const directory = resolve('coverage/e2e/raw');
      await mkdir(directory, { recursive: true });
      await writeFile(
        resolve(directory, `${info.project.name}-${info.testId}-${info.retry}.json`),
        JSON.stringify({ project: info.project.name, test: info.title, documents }),
      );
    }
    try {
      await use(page);
    } finally {
      await collect();
    }
  },
});
export { expect };
