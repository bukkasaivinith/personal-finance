import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const api = 'https://workspace-fixture.invalid';
const fixtureId = 'a0000000-0000-4000-8000-000000000001';
const expires = Math.floor(Date.now() / 1000) + 3600;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const user = { id: fixtureId, email: 'owner@example.test', aud: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: fixtureId, session_id: fixtureId, exp: expires, role: 'authenticated' }) + '.fixture';
const model = {
  access_token: token, refresh_token: 'fixture-refresh-value', expires_in: 3600, expires_at: expires, token_type: 'bearer', user,
};
const transaction = {
  id: fixtureId, user_id: fixtureId, name: 'Fixture <draft> & tea', transaction_type_id: fixtureId,
  transaction_type_name: 'Groceries', transaction_kind: 'expense', category_id: null, category_name: null,
  amount: 12.5, transaction_date: '2026-11-10', transaction_time: null, account_id: fixtureId,
  account_name: 'Fixture account', to_account_id: null, to_account_name: null, recurring_entry_id: null,
  investment_id: null, transaction_source: 'manual', visible_transfer_direction: null,
};

async function startFixture(t) {
  process.env.VITE_SUPABASE_URL = api;
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test_value';
  const privateSentinel = 'FOR-BROWSER-TEST-ONLY_PRIVATE_SENTINEL';
  process.env.VITE_UNUSED_PRIVATE_SENTINEL = privateSentinel;
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'finance-routing-test-'));
  t.after(async () => {
    if ((await realpath(root)).startsWith(join(temp, 'finance-routing-test-'))) await rm(root, { recursive: true, force: true });
  });
  await build({ logLevel: 'error', build: { outDir: root, emptyOutDir: false } });
  const emitted = (await readdir(root, { recursive: true })).filter((file) => /\.(?:html|mjs|js|css|map)$/.test(file));
  for (const file of emitted) {
    const contents = await readFile(join(root, file), 'utf8');
    assert.ok(!contents.includes(privateSentinel), file);
    assert.ok(!file.endsWith('.map'), file);
  }
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const rewrite = new RegExp('^' + config.rewrites[0].source + '$');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path === '/' || rewrite.test(path) ? '/index.html' : path));
    for (const header of config.headers[0].headers) res.setHeader(header.key, header.value);
    if (file.startsWith(root + sep)) {
      try {
        const payload = await readFile(file);
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(payload);
        return;
      } catch {
        // This request did not match a built asset.
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch({
    channel: process.env.FINANCE_TEST_BROWSER ?? 'chrome',
    headless: true,
    args: ['--disable-background-networking'],
  });
  t.after(() => browser.close());
  return { browser, origin: 'http://127.0.0.1:' + server.address().port };
}

async function newPage(browser) {
  const page = await browser.newPage({ serviceWorkers: 'allow' });
  const rpcCalls = [];
  const rpcPaths = [];
  const policyViolations = [];
  let ledgerError = false;
  await page.addInitScript(() => {
    window.__financePolicyViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => window.__financePolicyViolations.push(event.effectiveDirective));
  });
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) policyViolations.push(message.text());
  });
  await page.route('https://**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== api) return route.abort();
    const json = (data, status = 200, extra = {}) => route.fulfill({
      status, json: data, headers: { 'access-control-allow-origin': '*', ...extra },
    });
    if (request.method() === 'OPTIONS') return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*',
      },
    });
    if (url.pathname.endsWith('/token')) {
      const input = request.postDataJSON();
      if (input?.email === 'limited@example.test') return json({ msg: 'rate limit', code: 'over_request_rate_limit' }, 429);
      return json(model);
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname.endsWith('/user')) return json(user);
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      rpcCalls.push(name);
      rpcPaths.push([name, new URL(request.frame().url()).pathname]);
      if (name === 'is_finance_workspace_owner' || name === 'validate_current_single_device_session') return json(true);
      if (name === 'get_current_finance_profile') return json([{ id: fixtureId, email: user.email, first_name: 'Fixture', last_name: 'Owner' }]);
      if (name === 'get_finance_transaction_page') {
        if (ledgerError) return json({ code: 'XX000', message: 'PRIVATE_FIXTURE_DATABASE_DIAGNOSTIC' }, 500);
        assert.equal(request.headers().authorization, 'Bearer ' + token);
        return json(request.postDataJSON()?.p_after_id ? [] : [transaction]);
      }
      if (name === 'get_finance_transaction_usage') return json({ types: { [fixtureId]: 1 }, categories: {} });
      if (name === 'get_ipo_portfolio') return json({ applications: [], demat_accounts: [], allotment_date_supported: true });
      if (name === 'ipo_finance_links') return json({ accounts: [], investments: [] });
      return json(null);
    }
    return json([], 200, { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' });
  });
  return { page, rpcCalls, rpcPaths, policyViolations, failLedger: () => { ledgerError = true; } };
}

const waitForHeading = (page, name) => page.getByRole('heading', { name, exact: true }).first().waitFor();
async function signIn(page, email = user.email) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-do-not-use');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('production build opens protected routes, preserves history, clears sign-out, and serves static files', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const { page, rpcCalls, rpcPaths, policyViolations, failLedger } = await newPage(browser);
  const deepLink = await page.goto(origin + '/transactions');
  assert.equal(deepLink.headers()['x-content-type-options'], 'nosniff');
  await waitForHeading(page, 'Welcome back');
  assert.deepEqual(rpcCalls, []);
  assert.equal(new URL(page.url()).pathname, '/transactions');
  await signIn(page, 'limited@example.test');
  await page.getByText('Too many attempts. Please wait and try again.').waitFor();
  await signIn(page);
  await waitForHeading(page, 'Transactions');
  await page.getByText('Fixture <draft> & tea').first().waitFor();
  assert.equal(await page.locator('draft').count(), 0);

  await page.locator('.sidebar').getByRole('link', { name: 'Analytics', exact: true }).click();
  await waitForHeading(page, 'Analytics');
  assert.equal(new URL(page.url()).pathname, '/analytics');
  await page.reload();
  await waitForHeading(page, 'Analytics');
  await page.goBack();
  await waitForHeading(page, 'Transactions');
  await page.goForward();
  await waitForHeading(page, 'Analytics');

  rpcCalls.length = 0;
  await page.goto(origin + '/investments/ipo/demats');
  await waitForHeading(page, 'Demat account holders');
  await page.getByText('No demat accounts yet', { exact: false }).waitFor();
  assert.ok(rpcCalls.includes('get_ipo_portfolio'));
  assert.ok(!rpcPaths.some(([name, path]) => name === 'get_finance_transaction_page' && path === '/investments/ipo/demats'));
  assert.equal(await page.locator('.sidebar').getByRole('link', { name: 'Investments', exact: true }).getAttribute('aria-current'), 'page');

  rpcCalls.length = 0;
  await page.goto(origin + '/mobile');
  await waitForHeading(page, 'New Transaction');
  assert.ok(!rpcPaths.some(([name, path]) => name === 'get_finance_transaction_page' && path === '/mobile'));
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await waitForHeading(page, 'Overview');

  await page.goto(origin + '/athlete-hub');
  await page.getByRole('button', { name: 'Read screenshots', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 230;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '32px sans-serif';
    context.fillText('Workout duration', 28, 65);
    context.fillText('50:11', 28, 112);
    context.fillText('6.24 km', 28, 165);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await waitForHeading(page, 'Confirm understood details');
  assert.deepEqual(await page.evaluate(() => window.__financePolicyViolations), []);

  failLedger();
  await page.goto(origin + '/transactions');
  await waitForHeading(page, 'We could not load your records');
  assert.equal(await page.getByText('PRIVATE_FIXTURE_DATABASE_DIAGNOSTIC').count(), 0);
  await page.locator('.sidebar').getByRole('button', { name: 'Sign out' }).click();
  await waitForHeading(page, 'Welcome back');
  assert.equal(await page.locator('.sidebar').count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('auth-token')).length), 0);
  await page.goto(origin + '/unknown-route');
  await waitForHeading(page, 'Page not found');

  assert.equal((await fetch(origin + '/api/missing')).status, 404);
  assert.equal((await fetch(origin + '/assets/missing.js')).status, 404);
  assert.equal((await fetch(origin + '/manifest.webmanifest')).status, 200);
  assert.equal((await fetch(origin + '/sw.js')).status, 200);
  assert.deepEqual(await page.evaluate(() => window.__financePolicyViolations), []);
  assert.deepEqual(policyViolations, []);
});

test('a password recovery link opens the recovery form before the finance workspace', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const { page, rpcCalls } = await newPage(browser);
  const fragment = new URLSearchParams({ type: 'recovery', access_token: token, refresh_token: model.refresh_token, expires_in: '3600', token_type: 'bearer' });
  await page.goto(origin + '/#' + fragment);
  await waitForHeading(page, 'Choose a new password');
  assert.ok(!rpcCalls.includes('get_finance_transaction_page'));
  assert.equal(new URL(page.url()).hash, '');
});
