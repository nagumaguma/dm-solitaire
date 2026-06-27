const { test, expect } = require('@playwright/test');

async function enterAsGuest(page) {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  const desktopRoot = page.locator('#app-desktop.active');
  if (await desktopRoot.isVisible().catch(() => false)) return;

  const authScreen = page.locator('#auth-screen.active');
  if (await authScreen.isVisible().catch(() => false)) {
    await page.locator('.auth-tab', { hasText: '\u30b2\u30b9\u30c8' }).click();
    await page.locator('#guest-form button').click();
  }

  await expect(page.locator('#app-desktop.active')).toBeVisible();
}

async function startSyntheticGame(page) {
  await page.evaluate(() => {
    const cards = Array.from({ length: 40 }, (_, index) => ({
      id: `pw_card_${index}`,
      sourceId: `pw_card_${index}`,
      name: `PW Test Card ${index}`,
      cost: index % 8,
      type: '\u30af\u30ea\u30fc\u30c1\u30e3\u30fc',
      civilization: '\u81ea\u7136',
      count: 1
    }));

    window._ol = null;
    window._vs = null;
    window._olOpponent = null;
    window._deckEditing = '__pw_dm_operation_ui__';
    window._deckCards = cards;
    window.playDesktopDeckGame();
  });

  await expect(page.locator('.dg-full-root')).toBeVisible();
}

test('desktop battle screen exposes DM manual-operation controls', async ({ page }) => {
  await enterAsGuest(page);
  await startSyntheticGame(page);

  await expect(page.locator('.dg-btn.draw')).toContainText('\u30c9\u30ed\u30fc');
  await expect(page.locator('.dg-btn.end')).toContainText('\u30bf\u30fc\u30f3\u7d42\u4e86');
  await expect(page.locator('.dg-btn.deck-reveal')).toContainText('N\u679a\u516c\u958b');
  await expect(page.locator('.dg-btn.deck-peek')).toContainText('N\u679a\u898b\u308b');
  await expect(page.locator('.dg-btn.mana-untap')).toContainText('\u30de\u30ca\u5168\u30a2\u30f3\u30bf\u30c3\u30d7');

  await page.locator('#desktop-hand-zone .dg-card-chip.hand').first().click();
  const handPicker = page.locator('#desktop-hand-picker');
  await expect(handPicker).toContainText('\u624b\u672d \u2192 \u30d0\u30c8\u30eb\u30be\u30fc\u30f3');
  await expect(handPicker).toContainText('\u624b\u672d \u2192 \u30de\u30ca\u30be\u30fc\u30f3');
  await expect(handPicker).toContainText('\u624b\u672d \u2192 \u5893\u5730');
  await expect(handPicker).toContainText('\u624b\u672d \u2192 \u30b7\u30fc\u30eb\u30c9\u8ffd\u52a0');

  await handPicker.locator('button', { hasText: '\u624b\u672d \u2192 \u5893\u5730' }).click();
  await expect(page.locator('.dg-v2-pile-btn.grave .dg-v2-pile-cnt')).toHaveText('1');
});

test('desktop zone menu keeps shield and external-zone manual moves visible', async ({ page }) => {
  await enterAsGuest(page);
  await startSyntheticGame(page);

  await page.evaluate(() => {
    const event = {
      preventDefault() {},
      stopPropagation() {},
      pageX: 24,
      pageY: 24
    };
    window.openDesktopCardZoneMenu(event, 'shields', 0);
  });

  const menu = page.locator('#desktop-card-zone-menu.open');
  await expect(menu).toContainText('\u30b7\u30fc\u30eb\u30c9 \u306e\u64cd\u4f5c');
  await expect(menu).toContainText('\u8868\u5411\u304d\u306b\u3059\u308b');
  await expect(menu).toContainText('\u30b7\u30fc\u30eb\u30c9 \u2192 \u624b\u672d');
  await expect(menu).toContainText('\u30b7\u30fc\u30eb\u30c9 \u2192 \u516c\u958b\u30be\u30fc\u30f3');
  await expect(menu).toContainText('\u8d85\u6b21\u5143\u30be\u30fc\u30f3\u3078');
  await expect(menu).toContainText('\u8d85GR\u30be\u30fc\u30f3\u3078');
  await expect(menu).toContainText('\u7279\u6b8a\u30be\u30fc\u30f3\u3078');
});
