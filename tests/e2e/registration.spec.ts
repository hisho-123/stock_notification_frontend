import type { Page, APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
const stub = `http://127.0.0.1:${process.env.E2E_API_PORT || '18080'}`;
const token = 'A'.repeat(43);
async function config(request: APIRequestContext, value: Record<string, number>) {
  await request.post(`${stub}/__test/config`, { data: value });
}
async function fill(page: Page, id = ' new-user ') {
  await page.getByLabel('ログインID', { exact: true }).fill(id);
  await page.getByLabel('パスワード', { exact: true }).fill(' password ');
}
async function open(page: Page) {
  await page.goto(`/register#token=${token}`);
  await expect(page.getByLabel('ログインID', { exact: true })).toBeEnabled();
}
test.beforeEach(async ({ request }) => {
  await request.post(`${stub}/__test/reset`);
});

test('LINEの専用URLで登録し、新ユーザーの空一覧・初期設定へ自動ログインする', async ({
  page,
  request,
}, info) => {
  const response = await page.goto(`/register#token=${token}`);
  expect(response?.headers()['cache-control']).toBe('no-store');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByLabel('ログインID', { exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '本文へ移動' }).focus();
  await page.getByRole('link', { name: '本文へ移動' }).press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#token=${token}$`));
  await expect(page.getByLabel('ログインID', { exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('register.png'), fullPage: true });
  await fill(page);
  await page.getByLabel('パスワード', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
  await page.getByRole('link', { name: '通知設定', exact: true }).click();
  for (const value of [10, 15, 20, 25, 30])
    await expect(page.getByRole('button', { name: `${value}%を削除` })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/LINE公式アカウントを友だち追加/)).toBeVisible();
  await page.getByLabel('ID', { exact: true }).fill(' new-user ');
  await page.getByLabel('パスワード', { exact: true }).fill(' password ');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  for (const entry of requests.filter((r: { path: string }) =>
    /\/(register|validate)$/.test(r.path),
  )) {
    expect(entry.csrf).toBe(false);
    expect(entry.query).not.toContain(token);
    expect(entry.body).toBeUndefined();
  }
});
test('認証済みの登録成功で旧データ・未保存入力・Cookieセッションを置換する', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByText('S&P 500', { exact: true })).toBeVisible();
  const oldCookie = (await context.cookies()).find((c) => c.name === '__Host-stock_session')?.value;
  await page.getByLabel('銘柄コード', { exact: true }).fill('UNSAVED');
  await open(page);
  await expect(page.getByText('登録後は新しいユーザーでログインします。')).toBeVisible();
  await fill(page, 'new-user');
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
  await expect(page.getByLabel('銘柄コード', { exact: true })).toHaveValue('');
  expect((await context.cookies()).find((c) => c.name === '__Host-stock_session')?.value).not.toBe(
    oldCookie,
  );
  await page.goBack();
  await expect(page).not.toHaveURL(/\/register/);
  await expect(page.getByText('S&P 500', { exact: true })).toHaveCount(0);
});
test('確認失敗だけを再試行し、ID重複でパスワードを消して同じURLで再登録する', async ({
  page,
  request,
}) => {
  await config(request, { validateFailures: 1 });
  await page.goto(`/register#token=${token}`);
  await expect(page.getByRole('alert')).toContainText('確認できません');
  await page.getByRole('button', { name: '確認を再試行' }).click();
  await expect(page.getByLabel('ログインID', { exact: true })).toBeEnabled();
  await fill(page, 'owner');
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('使用されています');
  await expect(page.getByLabel('ログインID', { exact: true })).toHaveValue('owner');
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
  await fill(page, 'new-user');
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
});
test('欠落・失効URLを拒否し、送信時の試行制限後は確認だけを行う', async ({ page, request }) => {
  await page.goto('/register');
  await expect(page.getByRole('alert')).toContainText('LINEトークで「登録」');
  await expect(page.getByLabel('ログインID', { exact: true })).toBeDisabled();
  await page.goto(`/register#token=${'Z'.repeat(43)}`);
  await expect(page.getByRole('alert')).toContainText('この登録URLは利用できません');
  await config(request, { registerLimited: 1 });
  await open(page);
  await fill(page);
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('あと2秒');
  await expect(page.getByLabel('ログインID', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  expect(requests.filter((r: { path: string }) => r.path.endsWith('/register'))).toHaveLength(1);
});
for (const committed of [true, false]) {
  test(`登録応答消失はSession照合で復旧し、自動再送しない（Cookie発行=${committed}）`, async ({
    page,
    request,
  }) => {
    await config(request, committed ? { registerLostResponses: 1 } : { registerFailures: 1 });
    await open(page);
    await fill(page);
    await page.getByRole('button', { name: '登録', exact: true }).click();
    if (committed) {
      await expect(page).toHaveURL(/\/assets$/);
      await expect(page.getByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
    } else {
      await expect(page.getByRole('alert')).toContainText('登録が完了している場合');
      await expect(page.getByRole('button', { name: '登録', exact: true })).toBeDisabled();
      await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
    }
    const requests = await (await request.get(`${stub}/__test/requests`)).json();
    expect(requests.filter((r: { path: string }) => r.path.endsWith('/register'))).toHaveLength(1);
  });
}
test('認証済みの成否不明では旧ユーザーで成功とせず、新IDのログインフォームへ進む', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.getByLabel('ID', { exact: true }).fill('owner');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await config(request, { registerFailures: 1 });
  await open(page);
  await fill(page, 'new-user');
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('登録が完了している場合');
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'ログインへ' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('ID', { exact: true })).toBeVisible();
  const requests = await (await request.get(`${stub}/__test/requests`)).json();
  expect(requests.filter((r: { path: string }) => r.path.endsWith('/auth/logout'))).toHaveLength(0);
  expect(requests.filter((r: { path: string }) => r.path.endsWith('/auth/register'))).toHaveLength(
    1,
  );
});
