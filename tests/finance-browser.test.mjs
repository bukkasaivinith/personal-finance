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

async function startFixture(t, mapKey = '') {
  process.env.VITE_SUPABASE_URL = api;
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test_value';
  process.env.VITE_MAPTILER_KEY = mapKey;
  const privateSentinel = 'FOR-BROWSER-TEST-ONLY_PRIVATE_SENTINEL';
  process.env.VITE_UNUSED_PRIVATE_SENTINEL = privateSentinel;
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'finance-routing-test-'));
  t.after(async () => {
    if ((await realpath(root)).startsWith(join(temp, 'finance-routing-test-'))) await rm(root, { recursive: true, force: true });
  });
  await build({ logLevel: 'error', build: { outDir: root, emptyOutDir: false } });
  const output = await readdir(root, { recursive: true });
  assert.ok(output.every((file) => !/athlete-voice|ort-wasm/i.test(file)));
  const emitted = output.filter((file) => /\.(?:html|mjs|js|css|map)$/.test(file));
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

async function newPage(browser, transactions = [transaction], savingsActivity = { openings: [], movements: [] }, athlete, finance) {
  const page = await browser.newPage({ serviceWorkers: 'allow' });
  const rpcCalls = [];
  const rpcPaths = [];
  const policyViolations = [];
  let ledgerError = false;
  let rejectSavingsWrite = false;
  const ledger = [...transactions];
  const savings = new Map(savingsActivity.openings.map((entry) => [entry.id, entry]));
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
    const savingsPage = (rows) => json(rows, 200, {
      'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0',
      'access-control-expose-headers': 'content-range',
    });
    if (finance && request.method() === 'GET') {
      if (url.pathname === '/rest/v1/transaction_types') {
        return savingsPage(finance.types.filter(({ is_standard }) => !url.searchParams.has('is_standard') || is_standard));
      }
      if (url.pathname === '/rest/v1/accounts') return savingsPage(finance.accounts);
      if (url.pathname === '/rest/v1/categories') return savingsPage(finance.categories);
      if (url.pathname === '/rest/v1/category_transaction_types') return savingsPage(finance.links);
      if (url.pathname === '/rest/v1/recurring_entries') return savingsPage(finance.recurring);
    }
    if (finance && url.pathname === '/rest/v1/transactions' && request.method() === 'POST') {
      if (finance.rejectWrite) return json({ code: '42501', message: 'Fixture rejected the save' }, 403);
      const input = request.postDataJSON();
      const type = finance.types.find(({ id }) => id === input.transaction_type_id);
      assert.ok(type.is_standard);
      ledger.push({ ...transaction, ...input, id: 'saved-' + ledger.length, transaction_kind: type.kind, transaction_type_name: type.kind });
      return json(null, 201);
    }
    if (url.pathname === '/rest/v1/savings_entries') {
      if (request.method() === 'GET') {
        assert.equal(url.searchParams.get('user_id'), 'eq.' + fixtureId);
        return savingsPage([...savings.values()]);
      }
      if (rejectSavingsWrite) return json({ code: '42501', message: 'Fixture rejected the change' }, 403);
      const input = request.postDataJSON();
      const id = input.id ?? url.searchParams.get('id')?.slice(3);
      assert.equal(input.user_id ?? url.searchParams.get('user_id'), input.id ? fixtureId : 'eq.' + fixtureId);
      savings.set(id, { ...savings.get(id), ...input, id, balance: input.amount, last_activity_at: new Date().toISOString() });
      return json({ id });
    }
    if (url.pathname === '/rest/v1/savings_accounts') {
      const id = url.searchParams.get('id')?.slice(3);
      return json(id ? savings.get(id) : [...savings.values()]);
    }
    if (url.pathname === '/rest/v1/savings_movements' && url.searchParams.has('user_id')) {
      assert.equal(url.searchParams.get('user_id'), 'eq.' + fixtureId);
      assert.ok(url.searchParams.get('select').includes('savings_entries!inner(name)'));
      return savingsPage(savingsActivity.movements);
    }
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      rpcCalls.push(name);
      rpcPaths.push([name, new URL(request.frame().url()).pathname]);
      if (name === 'is_finance_workspace_owner' || name === 'validate_current_single_device_session') return json(true);
      if (name === 'get_current_finance_profile') return json([{ id: fixtureId, email: user.email, first_name: 'Fixture', last_name: 'Owner' }]);
      if (name === 'get_finance_transaction_page') {
        if (ledgerError) return json({ code: 'XX000', message: 'PRIVATE_FIXTURE_DATABASE_DIAGNOSTIC' }, 500);
        assert.equal(request.headers().authorization, 'Bearer ' + token);
        const input = request.postDataJSON();
        return json(input?.p_after_id ? [] : ledger.filter((row) => !input?.p_scheduled_only || row.transaction_source === 'scheduled'));
      }
      if (name === 'get_finance_transaction_usage') return json({ types: { [fixtureId]: 1 }, categories: {} });
      if (name === 'get_ipo_portfolio') return json({ applications: [], demat_accounts: [], allotment_date_supported: true });
      if (name === 'ipo_finance_links') return json({ accounts: [], investments: [] });
      if (athlete) {
        if (name === 'athlete_get_dashboard') return json({ activities: [athlete.activity, athlete.otherActivity].filter(Boolean) });
        if (name === 'athlete_get_activity_page') {
          assert.equal(request.postDataJSON().p_activity_id, athlete.activity.id);
          return json({ activity: athlete.activity, distance_unit: 'km', timezone: 'Asia/Kolkata', details: athlete.details, media: athlete.media });
        }
        if (name === 'athlete_get_activity_media') {
          return json(athlete.bytes.get(request.postDataJSON().p_media_id));
        }
        if (name === 'athlete_save_workout') {
          const { p_activity_id, p_payload, p_details } = request.postDataJSON();
          assert.equal(p_activity_id, athlete.activity.id);
          if (athlete.rejectUpload) return json({ code: '42501', message: 'Fixture rejected the upload' }, 403);
          Object.assign(athlete.activity, p_payload);
          athlete.details = { ...athlete.details, ...p_details, metrics: { ...athlete.details.metrics, ...p_details.metrics } };
          return json(p_activity_id);
        }
        if (name === 'athlete_add_activity_media' || name === 'athlete_save_activity_with_media') {
          const { p_activity_id, p_batch_id, p_media, p_payload, p_details } = request.postDataJSON();
          assert.equal(p_activity_id, athlete.activity.id);
          if (athlete.rejectUpload) return json({ code: '42501', message: 'Fixture rejected the upload' }, 403);
          if (p_payload) Object.assign(athlete.activity, p_payload);
          if (p_details) athlete.details = { ...athlete.details, ...p_details, metrics: { ...athlete.details.metrics, ...p_details.metrics } };
          for (const { data, name, mime } of p_media) {
            assert.ok(mime === 'image/jpeg' || mime === 'application/octet-stream');
            const id = `attachment-${athlete.media.length + 1}`;
            athlete.media.push({ id, batch_id: p_batch_id, name, mime, created_at: athlete.activity.created_at });
            athlete.bytes.set(id, data);
          }
          return json(p_payload ? p_activity_id : null);
        }
        if (name === 'athlete_combine_activities') {
          const { p_keep_id, p_other_id } = request.postDataJSON();
          assert.equal(p_keep_id, athlete.activity.id);
          assert.equal(p_other_id, athlete.otherActivity.id);
          if (athlete.rejectUpload) return json({ code: '42501', message: 'Fixture rejected the merge' }, 403);
          athlete.media.push(...athlete.otherMedia);
          athlete.otherActivity = undefined;
          return json(p_keep_id);
        }
      }
      return json(null);
    }
    return json([], 200, { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' });
  });
  return { page, rpcCalls, rpcPaths, policyViolations, failLedger: () => { ledgerError = true; },
    setSavingsWriteRejected: (rejected) => { rejectSavingsWrite = rejected; } };
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
  await waitForHeading(page, 'Dashboard');

  await page.goto(origin + '/athlete-hub');
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add activity' }).getByRole('button', { name: 'Read screenshots', exact: true }).waitFor();
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

test('finance entry screens use three fixed types and preserve legacy records', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const status = { is_active: true, deleted_at: null };
  const finance = {
    types: [
      ...['income', 'expense', 'transfer'].map((kind) => ({ id: 'standard-' + kind, kind, is_standard: true })),
      { id: 'old-groceries', kind: 'expense', is_standard: false },
    ],
    accounts: ['Bank account', 'Cash wallet'].map((name, index) => ({
      id: 'account-' + index, name, opening_balance: 0, opening_balance_date: '2026-01-01', is_liability: false, ...status,
    })),
    categories: [
      { id: 'groceries', name: 'Grocery category', parent_id: null, ...status },
      { id: 'salary', name: 'Salary category', parent_id: null, ...status },
    ],
    links: [
      { category_id: 'groceries', transaction_type_id: 'standard-expense' },
      { category_id: 'groceries', transaction_type_id: 'old-groceries' },
      { category_id: 'salary', transaction_type_id: 'standard-income' },
    ],
    recurring: [{
      id: 'recurring-groceries', name: 'Weekly groceries', transaction_type_id: 'old-groceries', category_id: 'groceries',
      amount: 10, account_id: 'account-0', frequency: 'weekly', interval_value: 1, interval_unit: 'week',
      next_date: '2027-01-10', end_date: null, is_active: true,
    }],
    rejectWrite: true,
  };
  const { page } = await newPage(browser, [{ ...transaction, transaction_type_id: 'old-groceries', transaction_type_name: 'Legacy custom type' }],
    undefined, undefined, finance);
  await page.goto(origin + '/transactions');
  await signIn(page);
  await waitForHeading(page, 'Transactions');
  const legacy = page.getByRole('row').filter({ hasText: 'Fixture <draft> & tea' });
  await legacy.getByRole('cell', { name: 'Expense', exact: true }).waitFor();
  assert.equal(await page.getByText('Legacy custom type', { exact: true }).count(), 0);

  await page.getByRole('button', { name: 'Add transaction', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'Add transaction' });
  const type = form.getByRole('combobox', { name: 'Type', exact: true });
  await type.click();
  assert.deepEqual(await page.getByRole('listbox').getByRole('option').allTextContents(), ['Income', 'Expense', 'Transfer between accounts']);
  await page.getByRole('option', { name: 'Transfer between accounts', exact: true }).click();
  assert.equal(await form.getByRole('combobox', { name: 'Category' }).count(), 0);
  await form.getByRole('combobox', { name: 'To account' }).waitFor();
  await type.click();
  await page.getByRole('option', { name: 'Income', exact: true }).click();
  const category = form.getByRole('combobox', { name: 'Category', exact: true });
  await category.click();
  await page.getByRole('option', { name: 'Salary category', exact: true }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'Grocery category', exact: true }).count(), 0);
  await category.press('Escape');
  await type.click();
  await page.getByRole('option', { name: 'Expense', exact: true }).click();
  await category.click();
  await page.getByRole('option', { name: 'Grocery category', exact: true }).click();
  await form.getByRole('combobox', { name: 'Account', exact: true }).click();
  await page.getByRole('option', { name: 'Bank account', exact: true }).click();
  await form.getByLabel('Amount (₹)').fill('20');
  await form.getByLabel('Description').fill('New groceries');
  await form.getByRole('button', { name: 'Save transaction' }).click();
  await form.getByText('This operation is unavailable for your account.').waitFor();
  finance.rejectWrite = false;
  await form.getByRole('button', { name: 'Save transaction' }).click();
  await form.waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'New groceries' }).getByRole('cell', { name: 'Expense', exact: true }).waitFor();

  await page.goto(origin + '/setup');
  await waitForHeading(page, 'Categories');
  assert.equal(await page.getByRole('button', { name: 'Add type' }).count(), 0);
  await page.getByRole('button', { name: 'Add category' }).click();
  const categoryForm = page.getByRole('dialog', { name: 'Create category' });
  assert.deepEqual((await categoryForm.getByRole('checkbox').all()).length, 2);
  await categoryForm.getByRole('checkbox', { name: 'Income', exact: true }).waitFor();
  await categoryForm.getByRole('checkbox', { name: 'Expense', exact: true }).waitFor();

  await page.goto(origin + '/recurring');
  await page.getByRole('button', { name: 'View recurring entries' }).click();
  await page.locator('.recurring-card').filter({ hasText: 'Weekly groceries' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const recurringForm = page.getByRole('dialog', { name: 'Edit recurring entry' });
  assert.equal(await recurringForm.getByRole('combobox', { name: 'Type', exact: true }).textContent(), 'Expense');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(origin + '/mobile');
  await waitForHeading(page, 'New Transaction');
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Income', 'Expense', 'Transfer between accounts']);
  assert.ok(await page.getByRole('tablist', { name: 'Transaction kind' }).evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth));
  assert.equal(await page.getByRole('combobox', { name: 'Transaction type' }).count(), 0);
});

test('Analytics offers only filters matching the other selections and selected dates', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), 15, 12);
  if (today > now) today.setMonth(today.getMonth() - 1);
  const date = (day) => new Date(today.getFullYear(), today.getMonth(), day).toLocaleDateString('sv-SE');
  const bank = { account_id: 'bank', account_name: 'Bank' };
  const cash = { account_id: 'cash', account_name: 'Cash' };
  const rows = [
    { ...bank, name: 'Grocery purchase', transaction_type_id: 'groceries', transaction_type_name: 'Groceries', category_id: 'food', category_name: 'Food', transaction_date: date(15) },
    { ...bank, name: 'Electricity payment', transaction_type_id: 'bills', transaction_type_name: 'Bills', category_id: 'household', category_name: 'Household', transaction_date: date(14) },
    { ...cash, name: 'Cinema ticket', transaction_type_id: 'leisure', transaction_type_name: 'Leisure', category_id: 'movies', category_name: 'Movies', transaction_date: date(15) },
    { ...cash, name: 'Cash wage', transaction_type_id: 'wages', transaction_type_name: 'Wages', transaction_kind: 'income', transaction_date: date(15) },
    { ...cash, name: 'Cash deposit', transaction_type_id: 'deposit', transaction_type_name: 'Deposit', transaction_kind: 'transfer', to_account_id: bank.account_id, to_account_name: bank.account_name, transaction_date: date(15) },
  ].map((row, index) => ({ ...transaction, ...row, id: 'analytics-' + index }));
  const { page } = await newPage(browser, rows);
  await page.clock.setFixedTime(today);
  await page.goto(origin + '/analytics');
  await signIn(page);

  const filter = (name) => page.getByRole('combobox', { name, exact: true });
  const menuOptions = () => page.getByRole('listbox').getByRole('option');
  async function checkMenu(name, expected, choice) {
    const select = filter(name);
    await select.click();
    assert.deepEqual(await menuOptions().allTextContents(), ['All', ...expected]);
    if (choice) await page.getByRole('option', { name: choice, exact: true }).click();
    else await select.press('Escape');
  }

  await checkMenu('Account', ['Bank', 'Cash'], 'Bank');
  await checkMenu('Category', ['Food', 'Household', 'Uncategorised']);
  await checkMenu('Type', ['Expense', 'Transfer between accounts'], 'Expense');
  await checkMenu('Category', ['Food', 'Household'], 'Household');
  await checkMenu('Account', ['Bank']);
  await checkMenu('Type', ['Expense']);
  const statement = page.locator('.finance-analytics-table');
  await statement.getByText('Electricity payment').waitFor();
  assert.equal(await statement.locator('tbody tr').count(), 1);

  await page.getByRole('button', { name: 'Daily', exact: true }).click();
  assert.equal(await filter('Account').textContent(), 'Bank');
  assert.equal(await filter('Category').textContent(), 'All');
  assert.equal(await filter('Type').textContent(), 'Expense');
  await checkMenu('Type', ['Expense', 'Transfer between accounts']);
  await statement.getByText('Grocery purchase').waitFor();
  assert.equal(await statement.locator('tbody tr').count(), 1);

  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await checkMenu('Category', ['Food', 'Household']);
  await checkMenu('Account', ['Bank', 'Cash'], 'All');
  await checkMenu('Type', ['Income', 'Expense', 'Transfer between accounts']);
});

test('Analytics charts investments and savings and appends statement rows on scroll', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), 15, 12);
  if (today > now) today.setMonth(today.getMonth() - 1);
  const date = (day, monthsAgo = 0) => new Date(today.getFullYear(), today.getMonth() - monthsAgo, day).toLocaleDateString('sv-SE');
  const ledger = [
    { ...transaction, id: 'salary', name: 'Salary', transaction_type_id: 'wages', transaction_type_name: 'Wages',
      transaction_kind: 'income', amount: 2000, transaction_date: date(15) },
    { ...transaction, id: 'investment', name: 'Investment capital', transaction_type_id: 'capital', transaction_type_name: 'Investment capital',
      investment_id: 'investment-record', transaction_source: 'investment', amount: 1000, transaction_date: date(15) },
    ...Array.from({ length: 52 }, (_, index) => ({
      ...transaction, id: 'older-' + index, name: 'Older expense ' + index, amount: 10, transaction_date: date(1, 1),
    })),
  ];
  const savingsId = 'savings-fund';
  const savingsAccount = { id: savingsId, name: 'Emergency fund', amount: 500, saved_on: date(10, 1) };
  const { page, rpcCalls } = await newPage(browser, ledger, {
    openings: [savingsAccount],
    movements: [
      { id: 'deposit', savings_entry_id: savingsId, direction: 'deposit', amount: 240, note: 'Top-up',
        recorded_at: date(14) + 'T20:30:00Z', savings_entries: { name: savingsAccount.name } },
      { id: 'withdrawal', savings_entry_id: savingsId, direction: 'withdrawal', amount: 80, note: '',
        recorded_at: date(15) + 'T04:00:00Z', savings_entries: { name: savingsAccount.name } },
    ],
  });
  await page.clock.setFixedTime(today);
  await page.goto(origin + '/analytics');
  await signIn(page);
  const statement = page.locator('.finance-analytics-table');
  await statement.getByRole('row').filter({ hasText: 'Savings deposit · Top-up' }).waitFor();
  assert.equal(await statement.locator('tbody tr').count(), 4);
  assert.ok((await statement.getByRole('row').filter({ hasText: 'Investment capital' }).textContent()).includes('Investments'));
  assert.ok((await statement.getByRole('row').filter({ hasText: 'Savings deposit · Top-up' }).textContent()).includes('Emergency fund (Savings)'));

  const plot = page.getByRole('region', { name: 'Transaction trend' });
  assert.equal(await plot.locator('.finance-chart-axis span').count(), 5);
  const plotDays = plot.getByRole('button');
  assert.equal(await plotDays.count(), 15);
  const bucket = plotDays.last();
  const tooltip = await bucket.getAttribute('aria-label');
  assert.match(tooltip, /Income ₹2,000, Expenses ₹1,000, Savings deposits ₹240, Savings withdrawals ₹80/);
  assert.match(await plotDays.nth(13).getAttribute('aria-label'), /Income ₹0, Expenses ₹0, Savings deposits ₹0, Savings withdrawals ₹0/);
  const layout = await bucket.evaluate((element) => {
    const bounds = (selector) => element.querySelector(selector).getBoundingClientRect();
    return {
      incomeHeight: bounds('.finance-chart-series-income').height,
      expenseHeight: bounds('.finance-chart-series-expense').height,
      barsBottom: bounds('.finance-chart-bar-group').bottom,
      labelTop: bounds('small').top,
    };
  });
  assert.ok(Math.abs(layout.incomeHeight - layout.expenseHeight * 2) < 1);
  assert.ok(layout.labelTop >= layout.barsBottom);

  await page.setViewportSize({ width: 390, height: 844 });
  await plot.getByText(/Amounts grouped across up to \d+ days/).waitFor();
  assert.ok(await plotDays.count() < 15);
  assert.match(await plotDays.last().getAttribute('aria-label'), /Income ₹2,000, Expenses ₹1,000, Savings deposits ₹240, Savings withdrawals ₹80/);
  assert.ok(await plot.locator('.finance-chart-plot').evaluate((element) =>
    element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= window.innerWidth));
  await page.setViewportSize({ width: 1280, height: 720 });
  await plot.getByText('Amounts by day', { exact: true }).waitFor();

  const readCount = rpcCalls.filter((name) => name === 'get_finance_transaction_page').length;
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await statement.getByRole('row').filter({ hasText: 'Savings opening balance' }).waitFor();
  const shownRows = statement.locator('tbody tr');
  const firstBatch = await shownRows.allTextContents();
  assert.equal(firstBatch.length, 25);
  assert.equal(await page.getByRole('button', { name: /^(Next|Previous)$/ }).count(), 0);

  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const csv = await readFile(await (await downloadReady).path(), 'utf8');
  assert.match(csv, /Savings opening balance/);
  assert.match(csv, /Savings withdrawal/);
  assert.match(csv, /Investment capital/);
  assert.equal(csv.match(/Older expense /g).length, 52);

  const scrollToBottom = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await scrollToBottom();
  await page.getByText('Showing 50 of 57', { exact: true }).waitFor();
  assert.deepEqual((await shownRows.allTextContents()).slice(0, 25), firstBatch);
  await scrollToBottom();
  await page.getByText('Showing 57 of 57', { exact: true }).waitFor();
  const allRows = await shownRows.allTextContents();
  assert.equal(allRows.length, 57);
  assert.equal(new Set(allRows).size, 57);
  assert.deepEqual(allRows.slice(0, 25), firstBatch);

  await page.getByRole('combobox', { name: 'Source', exact: true }).click();
  await page.getByRole('option', { name: 'Savings', exact: true }).click();
  assert.equal(await statement.locator('tbody tr').count(), 3);
  assert.equal(await plot.getByRole('list', { name: 'Chart legend' }).getByText('Income', { exact: true }).count(), 0);
  await page.getByRole('combobox', { name: 'Source', exact: true }).click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  assert.equal(await shownRows.count(), 25);
  assert.equal(rpcCalls.filter((name) => name === 'get_finance_transaction_page').length, readCount);

  await page.locator('.sidebar').getByRole('link', { name: 'Dashboard', exact: true }).click();
  await waitForHeading(page, 'Dashboard');
  assert.equal(new URL(page.url()).pathname, '/');
  const cashFlow = page.getByRole('region', { name: 'Cash flow', exact: true });
  const months = cashFlow.getByRole('button');
  await months.last().waitFor();
  assert.equal(await months.count(), 6);
  assert.equal(await cashFlow.locator('.finance-chart-axis span').count(), 5);
  assert.match(await months.last().getAttribute('aria-label'), /Income ₹2,000, Expenses ₹1,000$/);
  assert.match(await months.nth(4).getAttribute('aria-label'), /Income ₹0, Expenses ₹520$/);
  await months.nth(4).focus();
  await cashFlow.locator('.finance-chart-details').getByText('₹520', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await months.count(), 6);
  assert.ok(await cashFlow.locator('.finance-chart-plot').evaluate((element) =>
    element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= window.innerWidth));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(origin + '/transactions');
  await waitForHeading(page, 'Transactions');
  await page.getByText('Investment capital', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Savings withdrawal', { exact: true }).count(), 0);
});

test('Athlete Hub opens a private activity page with a chart, a route, and expandable screenshots', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t, 'fixture-map-key');
  const photo = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJWQAAAAASUVORK5CYII=';
  const activity = {
    id: fixtureId, kind: 'run', activity_date: '2026-11-20', duration_seconds: 1200, distance_meters: 3000,
    average_heart_rate: 155, calories: 200, elevation_meters: 20, cadence: 160, effort: 7,
    notes: 'Evening track workout', source: 'samsung_health', created_at: '2026-11-20T14:00:00Z',
  };
  const fixture = {
    activity,
    details: { metrics: { elapsedSeconds: 1200, totalCalories: 220, steps: 3200, maxHeartRate: 172, maxCadence: 170,
      averageSpeed: 7.4, maximumSpeed: 9.8, averagePace: 482, bestPace: 401, lowestElevation: 582,
      highestElevation: 591, totalAscent: 50, totalDescent: 130, vo2Max: 44.4, sweatLoss: 775,
      temperature: 23, humidity: 52, windSpeed: 18, verticalOscillation: 9.6, stiffness: 35, flightTime: 196, groundContact: 185, regularity: .93 },
      asymmetry: 'Great',
      zones: [{ zone: 3, minimum: 142, maximum: 161, seconds: 6, percent: 40 },
        { zone: 4, minimum: 162, maximum: 181, seconds: 9, percent: 60 }],
      laps: [{ number: 1, seconds: 5, heartRate: 161 }, { number: 2, seconds: 5, heartRate: 162 }, { number: 3, seconds: 5 }],
      samples: [{ seconds: 0, heartRate: 140, latitude: 17, longitude: 78 }, { seconds: 15, heartRate: 172, latitude: 17.0003, longitude: 78 }] },
    media: [{ id: 'screenshot-1', batch_id: 'initial', name: 'workout.png', mime: 'image/png', created_at: activity.created_at }],
    bytes: new Map([['screenshot-1', photo]]),
    rejectUpload: false,
  };
  const { page, rpcCalls } = await newPage(browser, undefined, undefined, fixture);
  const tileRequests = [];
  let rejectImagery = false;
  await page.route('https://api.maptiler.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/maps/')) tileRequests.push({ url, referer: request.headers().referer });
    return rejectImagery
      ? route.abort()
      : route.fulfill({ contentType: 'image/png', body: Buffer.from(photo, 'base64') });
  });
  const activityUrl = origin + '/athlete-hub/activities/' + fixtureId;
  await page.goto(activityUrl);
  assert.equal(await page.getByRole('heading', { name: 'Workout summary' }).count(), 0);
  assert.ok(!rpcCalls.includes('athlete_get_activity_page'));
  assert.equal(tileRequests.length, 0);
  await signIn(page);
  await waitForHeading(page, 'Workout summary');
  assert.ok(!rpcCalls.includes('athlete_get_dashboard'));
  const charts = page.getByRole('group', { name: 'Chart metric' });
  const overview = page.getByRole('img', { name: 'All workout trends chart' });
  await overview.waitFor();
  const colors = await overview.locator('.activity-chart-line').evaluateAll((paths) => paths.map((path) => path.style.stroke));
  assert.equal(new Set(colors).size, 2);
  assert.equal(await charts.getByRole('button', { name: 'Speed', exact: true }).count(), 0);
  assert.equal(await page.getByText(/^(Average speed|Maximum speed|Temperature|Humidity|Wind speed|Vertical oscillation|Stiffness|Flight time|Ground contact|Regularity|Asymmetry rating)$/).count(), 0);
  await page.getByText('Reported average pace', { exact: true }).waitFor();
  const recordedMetrics = page.locator('.athlete-activity-page .workout-summary');
  const verifyMetricGrid = async () => {
    const layout = await recordedMetrics.evaluate((grid) => {
      const cards = [...grid.children];
      const boxes = cards.map((card) => card.getBoundingClientRect());
      return {
        count: cards.length,
        rows: new Set(boxes.map(({ top }) => Math.round(top))).size,
        sameSize: boxes.every(({ width, height }) =>
          Math.abs(width - boxes[0].width) < 1 && Math.abs(height - boxes[0].height) < 1),
        fits: grid.scrollWidth <= grid.clientWidth && grid.getBoundingClientRect().right <= window.innerWidth
          && cards.every((card) => card.scrollWidth <= card.clientWidth),
      };
    });
    assert.equal(layout.count, 13);
    assert.ok(layout.sameSize && layout.fits, JSON.stringify(layout));
    return layout.rows;
  };
  const desktopMetricRows = await verifyMetricGrid();
  assert.ok(desktopMetricRows > 1);
  const lapRows = page.locator('.workout-table tbody tr');
  await lapRows.nth(0).getByRole('cell', { name: 'Zone 3' }).waitFor();
  await lapRows.nth(1).getByRole('cell', { name: 'Zone 4' }).waitFor();
  assert.equal(await lapRows.nth(2).getByRole('cell').nth(3).textContent(), '—');
  await overview.press('End');
  const tooltip = page.getByRole('tooltip');
  await tooltip.getByText('Heart rate 172 bpm', { exact: true }).waitFor();
  await tooltip.getByText('Pace 7:30 min/km', { exact: true }).waitFor();
  await overview.press('Escape');
  const routeMap = page.getByRole('img', { name: 'GPS route with start and finish' });
  await routeMap.waitFor();
  const gpsPath = routeMap.locator('path.activity-route-path:not(.activity-route-halo)');
  const pathBefore = await gpsPath.getAttribute('d');
  const satellite = page.getByRole('button', { name: 'Satellite', exact: true });
  const waitForSatelliteTiles = () => page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.activity-route-tiles img')];
    return tiles.length > 0 && tiles.every((tile) => tile.naturalWidth > 0);
  });
  await waitForSatelliteTiles();
  assert.equal(await satellite.getAttribute('aria-pressed'), 'true');
  assert.ok(tileRequests.length > 0);
  for (const { url, referer } of tileRequests) {
    assert.match(url.pathname, /^\/maps\/satellite-v4\/\d+\/\d+\/\d+\.jpg$/);
    assert.equal(url.searchParams.get('key'), 'fixture-map-key');
    assert.equal(referer, origin + '/');
  }
  await page.getByRole('link', { name: '© MapTiler' }).waitFor();
  assert.equal(await gpsPath.getAttribute('d'), pathBefore);
  assert.equal(await routeMap.locator('.activity-route-grid').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await routeMap.evaluate((map) => map.getBoundingClientRect().right <= window.innerWidth));
  assert.ok(await verifyMetricGrid() > desktopMetricRows);
  await page.setViewportSize({ width: 1280, height: 720 });
  await satellite.click();
  assert.equal(await page.locator('.activity-route-tiles img').count(), 0);
  assert.equal(await satellite.getAttribute('aria-pressed'), 'false');
  assert.ok(await routeMap.locator('.activity-route-grid').count() > 0);
  rejectImagery = true;
  await page.reload();
  await page.getByText('Satellite imagery couldn’t load. Showing the GPS route.').waitFor();
  assert.equal(await satellite.getAttribute('aria-pressed'), 'false');
  assert.ok(await routeMap.locator('.activity-route-grid').count() > 0);
  assert.equal(await gpsPath.getAttribute('d'), pathBefore);
  rejectImagery = false;
  await satellite.click();
  await waitForSatelliteTiles();
  assert.equal(await satellite.getAttribute('aria-pressed'), 'true');
  await charts.getByRole('button', { name: 'Heart rate', exact: true }).click();
  await page.getByRole('img', { name: 'Heart rate chart in bpm' }).waitFor();
  const heartRateChart = page.getByRole('img', { name: 'Heart rate chart in bpm' });
  const chartBounds = await heartRateChart.boundingBox();
  const hoverChart = (fraction) => heartRateChart.hover({ position: { x: chartBounds.width * fraction, y: chartBounds.height / 2 } });
  await hoverChart(.1);
  await tooltip.getByText('0:00 elapsed', { exact: true }).waitFor();
  await tooltip.getByText('Heart rate 140 bpm', { exact: true }).waitFor();
  await hoverChart(.95);
  await tooltip.getByText('0:15 elapsed', { exact: true }).waitFor();
  await tooltip.getByText('Heart rate 172 bpm', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Workout charts' }).hover();
  await tooltip.waitFor({ state: 'hidden' });
  await heartRateChart.press('End');
  await tooltip.getByText('Heart rate 172 bpm', { exact: true }).waitFor();
  assert.equal(await page.getByRole('slider', { name: 'Explore workout timeline' }).count(), 0);
  assert.equal(await page.getByText('Zoom to a time range').count(), 0);
  await charts.getByRole('button', { name: 'Pace', exact: true }).click();
  await page.getByRole('img', { name: 'Pace chart in min/km' }).waitFor();
  await tooltip.getByText('Pace 7:30 min/km', { exact: true }).waitFor();
  await page.getByRole('img', { name: 'Pace chart in min/km' }).press('Escape');
  await tooltip.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('img', { name: 'workout.png' }).count(), 0);
  assert.ok(!rpcCalls.includes('athlete_get_activity_media'));
  await page.getByText('1 screenshot', { exact: true }).click();
  const image = page.getByRole('img', { name: 'workout.png' });
  await image.waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="workout.png"]')?.naturalWidth > 0);
  const screenshotDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download workout.png' }).click();
  assert.equal((await screenshotDownload).suggestedFilename(), 'workout.png');
  await page.getByText('1 screenshot', { exact: true }).click();

  await page.getByText('Attach screenshots', { exact: true }).click();
  const files = page.getByLabel('Choose screenshots');
  const screenshot = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 20;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await files.setInputFiles({ name: 'new-map.png', mimeType: 'image/png', buffer: Buffer.from(screenshot, 'base64') });
  fixture.rejectUpload = true;
  await page.getByRole('button', { name: 'Save screenshot group' }).click();
  await page.getByRole('alert').getByText('This operation is unavailable for your account.').waitFor();
  fixture.rejectUpload = false;
  await page.getByRole('button', { name: 'Save screenshot group' }).click();
  await page.getByText('Screenshot group saved.', { exact: true }).waitFor();
  await page.reload();
  await waitForHeading(page, 'Workout summary');
  assert.equal(await page.locator('.activity-screenshot-group').count(), 2);
  assert.equal(await page.locator('.activity-screenshot-group img').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('.activity-visuals').evaluate((element) =>
    element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= window.innerWidth));
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('link', { name: 'Back to activities' }).click();
  await waitForHeading(page, 'Activity history');
  assert.equal(await page.getByRole('button', { name: 'Speak activity' }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Details', exact: true }).count(), 0);
  const activityRow = page.locator('.athlete-linked-activity').first();
  await activityRow.getByRole('button', { name: 'Edit', exact: true }).click();
  const editActivity = page.getByRole('dialog', { name: 'Edit activity' });
  await editActivity.getByRole('button', { name: 'Cancel', exact: true }).click();
  const deletePrompt = page.waitForEvent('dialog').then(async (dialog) => {
    await dialog.dismiss();
    return dialog.message();
  });
  await activityRow.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.match(await deletePrompt, /Delete this run/);
  const activityDateCell = await activityRow.locator('.athlete-timeline-date').boundingBox();
  await page.mouse.click(activityDateCell.x + 5, activityDateCell.y + 5);
  await waitForHeading(page, 'Workout summary');
  assert.equal(page.url(), activityUrl);

  delete fixture.details.samples;
  await page.reload();
  await waitForHeading(page, 'Workout summary');
  await page.getByText('This activity has no saved GPS points.', { exact: false }).waitFor();
  assert.equal(await satellite.count(), 0);
  assert.equal(await page.locator('.activity-route-tiles img').count(), 0);
  await page.getByText('Workout file not uploaded.', { exact: true }).waitFor();
  const start = Date.parse(activity.created_at);
  const points = Array.from({ length: 121 }, (_, index) => (
    '<trkpt lat="' + (17 + index * .00022483) + '" lon="78"><ele>' + (12 + index / 10) + '</ele>'
    + '<time>' + new Date(start + index * 10_000).toISOString() + '</time>'
    + '<extensions><t:TrackPointExtension><t:hr>' + (index === 120 ? 176 : 140)
    + '</t:hr><t:cad>160</t:cad></t:TrackPointExtension></extensions></trkpt>'
  ));
  const gpx = '<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
    + '<trk><trkseg>' + points.join('') + '</trkseg></trk></gpx>';
  const attachWorkout = async (xml) => {
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach workout file' }).click();
    await (await picker).setFiles({ name: 'samsung-run.gtx', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  };
  await attachWorkout(gpx.replaceAll('2026-11-20', '2026-11-19'));
  await page.getByText(/This file is dated .* Open the activity for that date/).waitFor();
  assert.ok(!rpcCalls.includes('athlete_save_activity_with_media'));
  await attachWorkout(gpx);
  const review = page.getByRole('dialog', { name: 'Attach workout data' });
  fixture.rejectUpload = true;
  await review.getByRole('button', { name: 'Attach file' }).click();
  await review.getByText('This operation is unavailable for your account.').waitFor();
  assert.equal(fixture.details.samples, undefined);
  fixture.rejectUpload = false;
  await review.getByRole('button', { name: 'Attach file' }).click();
  await review.waitFor({ state: 'hidden' });
  await page.reload();
  await charts.getByRole('button', { name: 'Heart rate', exact: true }).click();
  await page.getByRole('img', { name: 'Heart rate chart in bpm' }).waitFor();
  await heartRateChart.press('End');
  await tooltip.getByText('Heart rate 176 bpm', { exact: true }).waitFor();
  await charts.getByRole('button', { name: 'Cadence', exact: true }).click();
  await page.getByRole('img', { name: 'Cadence chart in spm' }).waitFor();
  await charts.getByRole('button', { name: 'Elevation', exact: true }).click();
  await page.getByRole('img', { name: 'Elevation chart in m' }).waitFor();
  await page.getByRole('img', { name: 'GPS route with start and finish' }).waitFor();
  assert.equal(await page.locator('.activity-screenshot-group').count(), 2);
  assert.equal(fixture.details.metrics.steps, 3200);
  assert.equal(fixture.activity.notes, 'Evening track workout');
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download samsung-run.gtx' }).click();
  const original = await originalDownload;
  assert.equal(original.suggestedFilename(), 'samsung-run.gtx');
  assert.equal(await readFile(await original.path(), 'utf8'), gpx);

  await page.getByRole('link', { name: 'Back to activities' }).click();
  await waitForHeading(page, 'Activity history');
  assert.equal(await page.getByRole('button', { name: 'Read screenshots', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Import workout file', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Add activity' });
  await draft.getByRole('button', { name: 'Read screenshots', exact: true }).waitFor();
  await draft.getByRole('button', { name: 'Import workout file', exact: true }).waitFor();
  await draft.getByLabel('Notes (optional)').fill('My manual workout note');
  await draft.getByLabel('Workout file', { exact: true }).setInputFiles({
    name: 'session.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx),
  });
  await draft.getByText('session.gpx', { exact: true }).waitFor();
  const workoutScreenshot = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 230;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '32px sans-serif';
    context.fillText('Workout duration', 28, 65);
    context.fillText('19:50', 28, 112);
    context.fillText('3.00 km', 28, 165);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: 'workout-summary.png', mimeType: 'image/png', buffer: Buffer.from(workoutScreenshot, 'base64'),
  });
  await waitForHeading(page, 'Confirm understood details');
  await page.getByRole('checkbox', { name: /I have checked the detected details/ }).check();
  await page.getByRole('button', { name: 'Add info' }).click();
  const screenshotReview = draft;
  await screenshotReview.getByText('1 screenshot ready', { exact: true }).waitFor();
  assert.equal(await draft.getByLabel('Notes (optional)').inputValue(), 'My manual workout note');
  await screenshotReview.getByRole('combobox', { name: 'Save to' }).click();
  await page.getByRole('option', { name: /Evening track workout/ }).click();
  await screenshotReview.getByRole('button', { name: 'Update existing activity' }).click();
  await screenshotReview.waitFor({ state: 'hidden' });
  const savedActivity = page.getByRole('link', { name: /Open Run on/ });
  await savedActivity.first().waitFor();
  assert.equal(await savedActivity.count(), 1);
  assert.ok(rpcCalls.includes('athlete_save_activity_with_media'));
  assert.equal(fixture.activity.notes, 'My manual workout note');
  assert.ok(fixture.media.some((entry) => entry.name === 'session.gpx' && entry.mime === 'application/octet-stream'));

  fixture.otherActivity = { ...activity, id: 'a0000000-0000-4000-8000-000000000002', activity_date: '2026-11-19', notes: 'Screenshot copy' };
  fixture.otherMedia = [{ ...fixture.media[0], id: 'other-screenshot', batch_id: 'other-batch' }];
  await savedActivity.press('Enter');
  await page.getByRole('button', { name: 'Combine activities', exact: true }).click();
  const combine = page.getByRole('dialog', { name: 'Combine activities' });
  await combine.getByRole('combobox', { name: 'Other activity' }).click();
  await page.getByRole('option', { name: /Screenshot copy/ }).click();
  fixture.rejectUpload = true;
  const submit = combine.getByRole('button', { name: 'Combine into this activity' });
  await submit.click();
  await combine.getByRole('alert').getByText('This operation is unavailable for your account.').waitFor();
  fixture.rejectUpload = false;
  await submit.click();
  await combine.waitFor({ state: 'hidden' });
  await page.reload();
  await overview.waitFor();
  assert.equal(await page.locator('.activity-screenshot-group').count(), 4);
  await page.getByRole('link', { name: 'Back to activities' }).click();
  await waitForHeading(page, 'Activity history');
  assert.equal(await page.getByRole('link', { name: /Open Run on/ }).count(), 1);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const recentActivity = page.locator('.athlete-activity-list .athlete-linked-activity').first();
  await recentActivity.locator('.athlete-activity-icon').scrollIntoViewIfNeeded();
  const icon = await recentActivity.locator('.athlete-activity-icon').boundingBox();
  await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await waitForHeading(page, 'Workout summary');
  assert.equal(page.url(), activityUrl);
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

test('a savings account emoji can be added, changed, and removed across reloads', { timeout: 120000 }, async (t) => {
  const { browser, origin } = await startFixture(t);
  const { page, setSavingsWriteRejected } = await newPage(browser);
  await page.goto(origin + '/savings');
  await signIn(page);
  await page.getByRole('button', { name: 'New savings account' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Name', { exact: true }).fill('Holiday');
  await modal.getByRole('button', { name: 'Add emoji (optional)', exact: true }).click();
  await modal.getByRole('button', { name: 'Travel and flights', exact: true }).click();
  await modal.getByRole('button', { name: 'Hide emoji picker' }).click();
  await modal.getByLabel('Opening amount (₹)').fill('1500');
  await modal.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Cash', exact: true }).click();
  const save = modal.getByRole('button', { name: 'Save account' });
  await save.click();
  const account = page.getByRole('button', { name: /Holiday/ }).filter({ has: page.locator('.account-icon') });
  await account.getByText('✈️').waitFor();
  await page.reload();
  await account.getByText('✈️').waitFor();
  await account.click();
  await page.getByRole('heading', { name: 'Holiday', exact: true }).getByText('✈️').waitFor();
  await page.getByRole('button', { name: 'Back to savings' }).click();

  const edit = page.getByRole('button', { name: 'Edit Holiday' });
  await edit.click();
  await modal.getByRole('button', { name: 'Change emoji' }).click();
  const search = modal.getByRole('searchbox', { name: 'Search all savings account emojis' });
  await search.fill('mountain');
  await modal.getByRole('button', { name: 'mountain', exact: true }).click();
  setSavingsWriteRejected(true);
  await save.click();
  await modal.getByRole('alert').getByText('This operation is unavailable for your account.').waitFor();
  await account.getByText('✈️').waitFor();
  setSavingsWriteRejected(false);
  await save.click();
  await modal.waitFor({ state: 'hidden' });
  await page.reload();
  await account.getByText('⛰️').waitFor();

  await edit.click();
  await modal.getByRole('button', { name: 'Change emoji' }).click();
  await modal.getByRole('button', { name: 'Remove savings account emoji' }).click();
  await save.click();
  await modal.waitFor({ state: 'hidden' });
  await page.reload();
  await account.waitFor();
  assert.equal(await account.locator('.savings-emoji').count(), 0);
});
