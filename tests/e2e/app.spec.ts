import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, person: '珠珠' | '小花') {
  await page.goto('/');
  await page.getByRole('radio', { name: person }).check();
  await page.getByLabel('密码').fill(person === '珠珠' ? 'zhuzhu' : 'xiaohua');
  await page.getByRole('button', { name: `以${person}身份进入` }).click();
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
}

test('today view keeps identity and person filter separate', async ({ page }) => {
  await login(page, '珠珠');
  await expect(page.getByText('全身力量 · A')).toBeVisible();
  await page.getByRole('button', { name: '小花', exact: true }).click();
  await expect(page.locator('.person-tabs .active')).toHaveText('小花');
  await expect(page.locator('.account-menu strong')).toHaveText('珠珠');
  await expect(page.locator('.exercise-row').first()).toBeVisible();
});

test('agent composer sends through assistant-ui and displays an honest dev reply', async ({ page }) => {
  await login(page, '小花');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const composer = page.getByPlaceholder('给饲养员发消息…');
  await composer.fill('请告诉我当前能力状态');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText(/开发环境的明确替身回复/).last()).toBeVisible({ timeout: 20_000 });
  const assistantMessage = page.locator('.assistant-message').last();
  await expect(assistantMessage.locator('.message-meta strong')).toHaveText('饲养员');
  await expect(assistantMessage.locator('.avatar')).toHaveText('饲');
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止' })).toBeHidden();
});

test('mobile primary surfaces do not overflow horizontally', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await login(page, '珠珠');
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByPlaceholder('给饲养员发消息…')).toBeVisible();
});
