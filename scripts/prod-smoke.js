#!/usr/bin/env node

const DEFAULT_APP_URL = 'https://nagumaguma.github.io/dm-solitaire/index.html';
const DEFAULT_API_BASE = 'https://dm-solitaire-production.up.railway.app';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function readTextResponse(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  return { res, text };
}

async function readJsonResponse(url) {
  const { res, text } = await readTextResponse(url);
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${url} did not return JSON: ${error.message}`);
  }
  return { res, data };
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const appUrl = String(process.env.DM_PROD_APP_URL || DEFAULT_APP_URL).trim();
  const apiBase = trimTrailingSlash(process.env.DM_PROD_API_BASE || DEFAULT_API_BASE);

  console.log(`[prod] app=${appUrl}`);
  console.log(`[prod] api=${apiBase}`);

  const pingUrl = `${apiBase}/ping`;
  const ping = await readJsonResponse(pingUrl);
  assertOk(ping.res.ok, `/ping failed with HTTP ${ping.res.status}`);
  assertOk(ping.data.status === 'ok', `/ping returned unexpected status: ${JSON.stringify(ping.data)}`);
  console.log(`[prod] ping ok build=${ping.data.build || '-'} baseUrl=${ping.data.baseUrl || '-'}`);

  const app = await readTextResponse(appUrl);
  assertOk(app.res.ok, `app HTML failed with HTTP ${app.res.status}`);
  assertOk(app.text.includes('window.DM_API_BASE'), 'app HTML does not contain DM_API_BASE setup');
  if (!process.env.DM_PROD_APP_URL) {
    assertOk(app.text.includes(DEFAULT_API_BASE), `app HTML does not reference default API ${DEFAULT_API_BASE}`);
  }
  console.log('[prod] app html ok');

  if (process.env.DM_PROD_CHECK_SEARCH === '1') {
    const query = encodeURIComponent(process.env.DM_PROD_SEARCH_QUERY || 'Bolmeteus');
    const search = await readJsonResponse(`${apiBase}/search?q=${query}&page=1`);
    assertOk(search.res.ok, `/search failed with HTTP ${search.res.status}`);
    assertOk(Array.isArray(search.data.cards), '/search response does not contain cards array');
    console.log(`[prod] search ok cards=${search.data.cards.length}`);
  }
}

main().catch((error) => {
  console.error(`[prod] failed: ${error.message}`);
  process.exit(1);
});
