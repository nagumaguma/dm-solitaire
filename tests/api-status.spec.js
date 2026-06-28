const { test, expect } = require('@playwright/test');

test('auth screen shows current API base and ping status', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  const status = page.locator('#api-status');
  await expect(status).toContainText('http://localhost:8765');
  await expect(status).toContainText('接続OK', { timeout: 10_000 });
});

test('login clearly reports API ping failure before auth failure', async ({ page }) => {
  await page.goto('/index.html?api=http://127.0.0.1:9');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#api-status')).toContainText('API未接続', { timeout: 10_000 });
  await expect(page.locator('#api-status')).toContainText('http://127.0.0.1:9');

  await page.locator('#login-username').fill('pw_api_status_user');
  await page.locator('#login-pin').fill('1234');
  await page.locator('#login-form button').click();

  await expect(page.locator('#error-msg')).toContainText('API未接続');
  await expect(page.locator('#error-msg')).toContainText('/ping');
});
