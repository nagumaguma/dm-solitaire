const { test, expect } = require('@playwright/test');

const SEARCH_TERMS = [
  'ボルメテウス',
  'フェアリー・ライフ',
  'デドダム',
  'ドギラゴン'
];

async function enterAsGuest(page) {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  const desktopSearch = page.locator('#desktop-search-input');
  if (await desktopSearch.isVisible().catch(() => false)) return;

  const authScreen = page.locator('#auth-screen.active');
  if (await authScreen.isVisible().catch(() => false)) {
    await page.locator('.auth-tab', { hasText: 'ゲスト' }).click();
    await page.locator('#guest-form button').click();
  }

  await expect(desktopSearch).toBeVisible();
}

async function prepareEditableDeck(page) {
  await page.evaluate(() => {
    if (window.GameController && typeof window.GameController.setDeckEditingState === 'function') {
      window.GameController.setDeckEditingState('__pw_search_image_test__', []);
    } else {
      window._deckEditing = '__pw_search_image_test__';
      window._deckCards = [];
    }

    if (typeof window.renderDesktopDeckList === 'function') {
      window.renderDesktopDeckList();
    }
  });

  await expect(page.locator('#desktop-search-input')).toBeVisible();
}

async function runSearch(page, term) {
  const input = page.locator('#desktop-search-input');
  await input.fill(term);
  await page.evaluate((value) => window.desktopSearchCards(value), term);
  await expect(
    page.locator('#desktop-search-results .dl-search-tile').first(),
    `search results for ${term}`
  ).toBeVisible({ timeout: 20_000 });
}

function imageLooksTiedToCard(url, cardId, cardName) {
  const haystack = decodeURIComponent(String(url || '')).toLowerCase();
  const id = String(cardId || '').replace(/^src:/, '').toLowerCase();
  const name = String(cardName || '').toLowerCase();

  if (!haystack) return false;
  if (id && haystack.includes(encodeURIComponent(id).toLowerCase())) return true;
  if (id && haystack.includes(id)) return true;
  if (name && haystack.includes(encodeURIComponent(name).toLowerCase())) return true;
  if (name && haystack.includes(name)) return true;
  return false;
}

test.describe('search result image safety', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(`[browser console] ${msg.text()}`);
      }
    });

    await enterAsGuest(page);
    await prepareEditableDeck(page);
  });

  for (const term of SEARCH_TERMS) {
    test(`search results do not show untrusted wrong images: ${term}`, async ({ page }) => {
      await runSearch(page, term);

      const tiles = page.locator('#desktop-search-results .dl-search-tile');
      const count = await tiles.count();
      expect(count, `expected visible search rows for ${term}`).toBeGreaterThan(0);

      for (let i = 0; i < Math.min(count, 6); i += 1) {
        const tile = tiles.nth(i);
        const name = (await tile.locator('.dl-search-tile-name').innerText()).trim();
        const meta = (await tile.locator('.dl-search-tile-meta').innerText()).trim();
        const payload = await tile.getAttribute('data-card-json');
        const card = JSON.parse(decodeURIComponent(payload || '{}'));

        expect(name, `${term} result ${i} should show card name`).not.toBe('');
        expect(meta, `${term} result ${i} should show cost/id metadata`).toContain('Cost');
        expect(meta, `${term} result ${i} should show ID metadata`).toContain('ID ');
        expect(String(card.id || card.sourceId || ''), `${term} result ${i} should carry id/sourceId`).not.toBe('');

        const img = tile.locator('img.dl-search-card-image');
        const placeholder = tile.locator('.dl-search-card-image.placeholder');
        const hasImage = (await img.count()) > 0;
        const hasPlaceholder = (await placeholder.count()) > 0;

        expect(hasImage || hasPlaceholder, `${term} result ${i} should show either trusted image or NO IMG`).toBeTruthy();

        if (hasImage) {
          const src = await img.first().getAttribute('src');
          expect(
            imageLooksTiedToCard(src, card.sourceId || card.id, card.name || name),
            `${term} result ${i} image URL is not tied to id/name: ${src}`
          ).toBeTruthy();
        } else {
          await expect(placeholder.first(), `${term} result ${i} should prefer NO IMG over unsafe image`).toContainText('NO IMG');
        }
      }
    });
  }

  test('a NO IMG search result can still be added to the editing deck', async ({ page }) => {
    await runSearch(page, 'デドダム');

    const first = page.locator('#desktop-search-results .dl-search-tile').first();
    await expect(first.locator('.dl-search-card-image.placeholder')).toContainText('NO IMG');

    const before = await page.evaluate(() => Array.isArray(window._deckCards) ? window._deckCards.length : 0);
    const payload = await first.getAttribute('data-card-json');
    await page.evaluate((encoded) => window.addToDesktopDeck(decodeURIComponent(encoded)), payload);

    await expect.poll(
      async () => page.evaluate(() => Array.isArray(window._deckCards) ? window._deckCards.length : 0),
      { message: 'deck card count should increase after adding a NO IMG search result' }
    ).toBeGreaterThan(before);

    const added = await page.evaluate(() => window._deckCards[window._deckCards.length - 1]);
    expect(String(added.name || ''), 'added card should keep card name').not.toBe('');
    expect(String(added.id || added.sourceId || ''), 'added card should keep id/sourceId').not.toBe('');
    expect(String(added.imageUrl || added.img || added.thumb || ''), 'unsafe direct add should not inject fallback image').toBe('');
  });
});
