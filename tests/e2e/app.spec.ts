import { type Page, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';

const stub = `http://127.0.0.1:${process.env.E2E_API_PORT || '18080'}`;
async function config(request: APIRequestContext, value: Record<string, number>) {
  await request.post(`${stub}/__test/config`, { data: value });
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('cell', { name: 'S&P 500', exact: false })).toBeVisible();
}
async function settingsPage(page: Page) {
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  await expect(page.getByRole('button', { name: '10%を削除' })).toBeVisible();
}
async function addThreshold(page: Page, value: string) {
  await page.getByLabel('通知率を追加（%）').fill(value);
  await page.getByRole('button', { name: '＋ 追加' }).click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
test.beforeEach(async ({ request }) => {
  await request.post(`${stub}/__test/reset`);
});

test('HTTPS Cookie/Origin/CSRFで3画面を操作し、204ログアウトでCookieを破棄する', async ({
  page,
  context,
  request,
}, info) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('login.png'), fullPage: true });
  await login(page);
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name.startsWith('__Host-'))).toHaveLength(2);
  for (const cookie of cookies)
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
  await expect(page.getByText('250.1234567890123456789')).toBeVisible();
  await expect(page.getByText('価格取得に失敗', { exact: false })).toBeVisible();
  await expect(page.getByText('LINE通知に失敗', { exact: false })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'IBM' })).toContainText('停止中');
  await expect(page.getByRole('row').filter({ hasText: 'IBM' })).toContainText(
    '価格データが10日以上前',
  );
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('assets.png'), fullPage: true });
  await page.getByLabel('銘柄コード', { exact: true }).fill(' tsla ');
  await page.getByLabel('銘柄コード', { exact: true }).press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'Tesla, Inc.' })).toContainText('監視中');
  await page.getByRole('button', { name: '^GSPCの監視を停止', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'S&P 500' })).toContainText('停止中');
  await page.getByRole('button', { name: '^GSPCの監視を再開', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'S&P 500' })).toContainText('監視中');
  await settingsPage(page);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true });
  await addThreshold(page, '35');
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('設定を保存しました');
  await page.reload();
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).filter((c) => c.name.startsWith('__Host-'))).toHaveLength(0);
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  const changes = requests.filter((r: { method: string }) => r.method !== 'GET');
  for (const change of changes) {
    expect(change.origin).toBe(new URL(page.url()).origin);
    if (!change.path.endsWith('/login')) expect(change).toMatchObject({ csrf: true, cookie: true });
  }
  expect(changes.find((r: { method: string }) => r.method === 'PATCH').path).toBe(
    '/api/v1/assets/9007199254740993',
  );
});

test('ログイン失敗でID保持・パスワード消去、429では待機後に再試行できる', async ({
  page,
  request,
}) => {
  await page.goto('/assets');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('IDまたはパスワードが違います');
  await expect(page.getByLabel('ID', { exact: true })).toHaveValue('owner');
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
  await config(request, { loginLimited: 1 });
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('あと');
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled({
    timeout: 5000,
  });
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByLabel('パスワード', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/assets$/);
});

test('初期セッション確認の通信失敗を未認証と混同せず再試行できる', async ({ page, request }) => {
  await config(request, { sessionFailures: 1 });
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'ログイン状態を確認できませんでした' }),
  ).toBeVisible();
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
});

test('検索・全ソート・一覧更新、失敗時の直前一覧保持と再試行', async ({ page, request }) => {
  await login(page);
  await page.getByLabel('検索', { exact: true }).fill('apple');
  await page.getByLabel('検索', { exact: true }).press('Enter');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('AAPL');
  await page.getByLabel('検索', { exact: true }).fill('%_');
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '一致する監視対象がありません' })).toBeVisible();
  await page.getByRole('button', { name: '検索を解除' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  for (const sort of [
    'created_at',
    'code',
    'name',
    'highest_value',
    'latest_value',
    'decline_rate',
    'latest_fetched_at',
    'monitoring_enabled',
    'last_notified_threshold',
  ]) {
    await page.getByLabel('ソート項目').selectOption(sort);
    await expect(page.getByRole('button', { name: '一覧更新' })).toBeEnabled();
  }
  await page.getByRole('columnheader', { name: '下落率', exact: true }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: '下落率', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('columnheader', { name: '下落率', exact: true }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: '下落率', exact: true })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await config(request, { listFailures: 1 });
  await page.getByRole('button', { name: '一覧更新' }).click();
  await expect(page.getByRole('alert')).toContainText('直前の一覧を表示');
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('追加エラー・古い価格の停止登録・通信断による成否不明を扱う', async ({ page, request }) => {
  await login(page);
  const input = page.getByLabel('銘柄コード', { exact: true });
  for (const [code, message] of [
    ['AAPL', '登録済み'],
    ['NOPE', '価格を取得できません'],
    ['PROVIDER', '有効な価格を取得できません'],
    ['TIMEOUT', 'タイムアウト'],
  ]) {
    await input.fill(code);
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(input).toHaveValue(code);
  }
  await input.fill('STALE');
  await input.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: '停止状態で登録しました' }),
  ).toBeVisible();
  const stale = page.getByRole('row').filter({ hasText: 'STALE' });
  await expect(stale).toContainText('0.00%');
  await expect(stale).toContainText('停止中');
  await page.getByRole('button', { name: 'STALEの監視を再開' }).click();
  await expect(stale).toContainText('監視中');
  await expect(stale).toContainText('価格データが10日以上前');
  await config(request, { createDisconnects: 1 });
  await input.fill('TSLA');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('登録の成否が不明');
  await expect(page.getByRole('row').filter({ hasText: 'Tesla, Inc.' })).toBeVisible();
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  expect(
    requests.filter(
      (r: { method: string; body?: { code: string } }) =>
        r.method === 'POST' && r.body?.code === 'TSLA',
    ),
  ).toHaveLength(1);
});

test('削除の取消・Esc・フォーカス復帰、失敗と204成功、削除済み404を扱う', async ({
  page,
  request,
}) => {
  await login(page);
  const remove = page.getByRole('button', { name: 'AAPLを削除', exact: true });
  await remove.click();
  await expect(page.getByRole('dialog')).toContainText(
    '再登録時は最高値と通知済み状態が新しくなります',
  );
  await expect(page.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await page.getByRole('button', { name: '取消' }).click();
  await config(request, { deleteFailures: 1 });
  await remove.click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('削除できませんでした');
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(remove).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await config(request, { rowMissing: 1 });
  await page.getByRole('button', { name: 'NVDAの監視を停止' }).click();
  await expect(page.getByRole('alert')).toContainText('削除済み');
  await expect(page.getByRole('row').filter({ hasText: 'NVIDIA' })).toHaveCount(0);
});

test('通知設定の取得失敗・入力検証・保存失敗と再保存・空配列禁止', async ({ page, request }) => {
  await login(page);
  await config(request, { settingsFailures: 1 });
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('設定を取得できません');
  await expect(page.getByLabel('通知率を追加（%）')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('button', { name: '10%を削除' })).toBeVisible();
  for (const raw of ['10', '0', '100', '1.5']) {
    await addThreshold(page, raw);
    await expect(page.getByRole('alert')).toBeVisible();
  }
  await addThreshold(page, '35');
  await config(request, { saveFailures: 1 });
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('alert')).toContainText('編集中の値を保持');
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
  for (const value of [10, 15, 20, 25, 30, 35])
    await page.getByRole('button', { name: `${value}%を削除` }).click();
  await expect(page.getByText('通知率を1件以上追加してください。')).toBeVisible();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
});

test('未保存確認はリンク・履歴・再読み込み・ログアウトに対応し、失敗時は編集を保持する', async ({
  page,
  request,
}) => {
  await login(page);
  await settingsPage(page);
  await addThreshold(page, '35');
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '編集を続ける' }).click();
  const dialogEvent = page.waitForEvent('dialog');
  const reload = page.evaluate(() => {
    window.location.reload();
  });
  const confirmation = await dialogEvent;
  expect(confirmation.type()).toBe('beforeunload');
  await confirmation.dismiss();
  await reload;
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await config(request, { logoutFailures: 1 });
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('button', { name: '破棄してログアウト' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ログアウトできません');
  await page.getByRole('button', { name: '編集を続ける' }).click();
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await page.getByRole('button', { name: '破棄して戻る' }).click();
  await expect(page).toHaveURL(/\/assets$/);
});

test('成否不明の設定保存を再取得で確認し、401は未保存確認を経ずログインへ戻す', async ({
  page,
  request,
}) => {
  await login(page);
  await settingsPage(page);
  await addThreshold(page, '35');
  await config(request, { saveDisconnects: 1 });
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('alert')).toContainText('保存済み設定を再取得');
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
  await addThreshold(page, '40');
  await request.post(`${stub}/__test/expire`);
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '40%を削除' })).toHaveCount(0);
});

test('ログインと銘柄入力の境界値、検索上限、初期失敗・空一覧を確認する', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByLabel('ID', { exact: true })).toBeFocused();
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('x'.repeat(73));
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByLabel('パスワード', { exact: true })).toBeFocused();
  await config(request, { listFailures: 1 });
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('一覧を取得できません');
  await config(request, { emptyAssets: 1 });
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
  const code = page.getByLabel('銘柄コード', { exact: true });
  for (const value of ['', 'A A', 'A'.repeat(65)]) {
    await code.fill(value);
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('1〜64文字');
  }
  await page.getByLabel('検索', { exact: true }).fill('x'.repeat(201));
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '200文字' })).toBeVisible();
  await page.getByLabel('検索', { exact: true }).fill('');
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '200文字' })).toHaveCount(0);
});

test('追加・行操作の処理中は重複要求を送らず、並び順ボタンも切り替わる', async ({
  page,
  request,
}) => {
  await login(page);
  await config(request, { createDelay: 600, toggleDelay: 600, deleteDelay: 600 });
  await page.getByLabel('銘柄コード', { exact: true }).fill('TSLA');
  await page.getByRole('button', { name: '＋ 追加', exact: true }).click();
  await expect(page.getByRole('button', { name: '取得中…' })).toBeDisabled();
  await page
    .getByLabel('銘柄コード', { exact: true })
    .evaluate((input) => input.closest('form')!.requestSubmit());
  await expect(page.getByRole('row').filter({ hasText: 'Tesla, Inc.' })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'TSLAの監視を停止' });
  await toggle.click();
  await expect(toggle).toBeDisabled();
  const box = (await toggle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'TSLAの監視を再開' })).toBeEnabled();
  await page.getByRole('button', { name: 'TSLAを削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('button', { name: '処理中…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '並び順を降順に変更' }).click();
  await expect(page.getByRole('button', { name: '並び順を昇順に変更' })).toBeEnabled();
  await page.getByRole('button', { name: '並び順を昇順に変更' }).click();
  await expect(page.getByRole('button', { name: '並び順を降順に変更' })).toBeEnabled();
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  expect(
    requests.filter(
      (r: { method: string; body?: { code?: string } }) =>
        r.method === 'POST' && r.body?.code === 'TSLA',
    ),
  ).toHaveLength(1);
  expect(requests.filter((r: { method: string }) => r.method === 'PATCH')).toHaveLength(1);
  expect(requests.filter((r: { method: string }) => r.method === 'DELETE')).toHaveLength(1);
});

test('監視変更の拒否・通信断と、削除の拒否・通信断・削除済みを扱う', async ({ page, request }) => {
  await login(page);
  await config(request, { toggleFailures: 1 });
  await page.getByRole('button', { name: '^GSPCの監視を停止', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('監視状態を変更できません');
  await config(request, { toggleDisconnects: 1 });
  await page.getByRole('button', { name: '^GSPCの監視を停止', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('結果を確認');
  await expect(page.getByRole('button', { name: '^GSPCの監視を再開', exact: true })).toBeEnabled();
  await config(request, { deleteForbidden: 1 });
  await page.getByRole('button', { name: 'AAPLを削除', exact: true }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('拒否');
  await config(request, { deleteDisconnects: 1 });
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('対象の有無');
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: 'AAPLを削除', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'NVDAを削除', exact: true }).click();
  await config(request, { rowMissing: 1 });
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('削除済み');
});

test('保存応答と再取得の両方が失敗しても編集を保持し、保存中は送信を重ねない', async ({
  page,
  request,
}) => {
  await login(page);
  await settingsPage(page);
  await addThreshold(page, '35');
  await config(request, { saveDisconnects: 1, settingsFailures: 1 });
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('alert')).toContainText('再取得にも失敗');
  await expect(page.getByRole('button', { name: '35%を削除' })).toBeVisible();
  await config(request, { saveDelay: 600 });
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
  await page
    .getByRole('button', { name: '保存中…' })
    .evaluate((button) => button.closest('form')!.requestSubmit());
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  expect(requests.filter((r: { method: string }) => r.method === 'PUT')).toHaveLength(2);
  expect(requests.filter((r: { path: string }) => r.path.endsWith('/logout'))).toHaveLength(0);
});

test('再読み込みの取消・確定と保存内容復元を検証し、計測を前後の文書で保持する', async ({
  page,
}) => {
  await login(page);
  await settingsPage(page);
  await addThreshold(page, '35');
  const initial =
    process.env.E2E_COVERAGE === '1'
      ? await page.evaluate(
          () => (window as Window & { __stockCoverageDocument?: string }).__stockCoverageDocument,
        )
      : undefined;
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('button', { name: '35%を削除' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '10%を削除' })).toBeVisible();
  if (initial) {
    expect(
      await page.evaluate(
        (id) => Object.hasOwn(JSON.parse(sessionStorage.getItem('__stockCoverage')!), id),
        initial,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as Window & { __stockCoverageDocument?: string }).__stockCoverageDocument,
      ),
    ).not.toBe(initial);
  }
  await config(page.request, { logoutFailures: 1 });
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ログアウトできません');
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('セッション期限・別名ルート・未知URLからの復旧を確認する', async ({ page, request }) => {
  // CIの処理速度に依存させず、ブラウザ時計だけで期限の境界を越える。
  await config(request, { sessionTtlMs: 60_000 });
  await page.clock.install();
  await login(page);
  await page.clock.fastForward(61_000);
  await expect(page).toHaveURL(/\/login$/);
  await config(request, { sessionTtlMs: 86400000 });
  // ブラウザ時計だけを進めているため、サーバー側の期限到達もスタブで同期する。
  await request.post(`${stub}/__test/expire`);
  await login(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/assets$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/assets$/);
  await page.goto('/missing');
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  await page.getByRole('link', { name: '監視対象へ', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
});

test('通信断・不正JSONから復旧し、一覧からのログアウト失敗と401を扱う', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.route('**/api/v1/auth/login', (route) => route.abort('failed'), { times: 1 });
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('通信に失敗');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await page.route(
    '**/api/v1/settings/notifications',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'invalid' }),
    { times: 1 },
  );
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('応答を確認できません');
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('button', { name: '10%を削除' })).toBeVisible();
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await config(request, { logoutFailures: 1, logoutDelay: 400 });
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログアウト中…' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('ログアウトできません');
  await request.post(`${stub}/__test/expire`);
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('読み込み要求の取消、IME入力、保存による離脱確認の解除を検証する', async ({
  page,
  request,
}) => {
  await login(page);
  const search = page.getByLabel('検索', { exact: true });
  expect(
    await search.evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
  ).toBe(false);
  await config(request, { settingsDelay: 400 });
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  await expect(page.getByLabel('通知率を追加（%）')).toBeDisabled();
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await expect(page.getByRole('button', { name: '一覧更新' })).toBeEnabled();
  await config(request, { listDelay: 400 });
  await page.getByRole('button', { name: '一覧更新' }).click();
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  await expect(page.getByRole('button', { name: '10%を削除' })).toBeVisible();
  await addThreshold(page, '35');
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // モーダル中の背面操作はUIから不可能なので、保存による保留解除はVitestで確認する。
  await page.getByRole('button', { name: '編集を続ける' }).click();
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled();
  await page.getByRole('link', { name: '監視対象', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
});
