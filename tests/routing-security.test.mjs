import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createMemoryRouter, matchRoutes } from 'react-router';

const bundle = await build({
  stdin: {
    contents: "export * from './src/lib/navigation'; export * from './src/lib/public-config'; export * from './src/lib/public-api-error'; export * from './src/lib/session-identity';",
    resolveDir: process.cwd(),
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { viewPaths, financePageRoutes, mobilePath, browserConfig, publicApiError, browserSessionId } =
  await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('the route map covers every page with a distinct exact URL', () => {
  assert.deepEqual(viewPaths, {
    overview: '/', transactions: '/transactions', accounts: '/accounts', savings: '/savings',
    analytics: '/analytics', goals: '/goals', recurring: '/recurring', investments: '/investments',
    'ipo-portfolio': '/investments/ipo', 'ipo-demats': '/investments/ipo/demats',
    athlete: '/athlete-hub', 'athlete-activity': '/athlete-hub/activities/:activityId', setup: '/setup', settings: '/settings',
  });
  assert.equal(mobilePath, '/mobile');
  for (const [id, path] of Object.entries(viewPaths)) {
    assert.equal(matchRoutes(financePageRoutes, path)?.[0].route.id, id);
  }
  assert.equal(matchRoutes(financePageRoutes, '/investments/private-id'), null);
  assert.equal(matchRoutes(financePageRoutes, '/athlete-hub/activities/a0000000-0000-4000-8000-000000000001')?.[0].route.id, 'athlete-activity');
});

test('React Router restores the prior path and safe query values with Back and Forward', async (t) => {
  const router = createMemoryRouter(financePageRoutes, { initialEntries: ['/analytics?period=month'] });
  t.after(() => router.dispose());
  await router.navigate('/investments/ipo/demats');
  assert.equal(router.state.matches[0].route.id, 'ipo-demats');
  await router.navigate(-1);
  assert.equal(router.state.location.pathname, '/analytics');
  assert.equal(router.state.location.search, '?period=month');
  await router.navigate(1);
  assert.equal(router.state.location.pathname, '/investments/ipo/demats');
});

test('frontend configuration rejects privileged credentials without exposing the value', () => {
  const input = { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'sb_publishable_test_value' };
  assert.match(browserConfig(input, false).connectPolicy, /https:\/\/example\.invalid/);
  assert.doesNotMatch(browserConfig(input, false).connectPolicy, /huggingface|hf\.co/);
  assert.throws(() => browserConfig({ ...input, VITE_SUPABASE_URL: 'http://example.invalid' }, false), /HTTPS/);
  const token = (role) => 'fixture.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixture';
  assert.equal(browserConfig({ ...input, VITE_SUPABASE_ANON_KEY: token('anon') }, false).key, token('anon'));
  const secret = token('service_role');
  assert.throws(() => browserConfig({ ...input, VITE_SUPABASE_ANON_KEY: secret }, false),
    (error) => error.message.includes('publishable key') && !error.message.includes(secret));
});

test('session identity survives token refresh and unknown API errors use a clean message', () => {
  const payload = Buffer.from(JSON.stringify({ session_id: 'fixture-session' })).toString('base64url');
  assert.equal(browserSessionId('fixture.' + payload + '.signature1'), browserSessionId('fixture.' + payload + '.signature2'));
  assert.equal(browserSessionId('invalid'), null);
  assert.equal(publicApiError({ code: 'XX000', message: 'internal database diagnostic' }, 'Could not load records.').message, 'Could not load records.');
  assert.equal(publicApiError({ code: 'P0001', message: 'Choose an account.' }, 'Could not load records.').message, 'Choose an account.');
});

test('the hosting fallback serves page requests and excludes APIs and static files', async () => {
  const hosting = JSON.parse(await readFile('vercel.json', 'utf8'));
  const target = new RegExp('^' + hosting.rewrites[0].source + '$');
  for (const path of [...Object.values(viewPaths), mobilePath, '/missing-page']) assert.ok(target.test(path), path);
  for (const path of ['/api', '/api/missing', '/sw.js', '/manifest.webmanifest', '/assets/missing.js', '/athlete-ocr/missing']) {
    assert.equal(target.test(path), false, path);
  }
  const headers = Object.fromEntries(hosting.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.match(headers['Content-Security-Policy'], /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.match(headers['Permissions-Policy'], /microphone=\(\)/);
});

test('the service worker leaves external requests alone and bypasses caches for origin API reads', async () => {
  const events = new Map();
  const reads = [];
  vm.runInNewContext(await readFile('public/sw.js', 'utf8'), {
    self: { addEventListener: (name, callback) => events.set(name, callback), location: { origin: 'https://finance.invalid' } },
    URL,
    fetch: (request, options) => { reads.push(options.cache); return Promise.resolve(request); },
  });
  const request = (url) => events.get('fetch')({ request: { method: 'GET', url }, respondWith: () => {} });
  request('https://example.supabase.co/rest/v1/transactions');
  request('https://finance.invalid/assets/app.js');
  request('https://finance.invalid/api/records');
  assert.deepEqual(reads, ['no-store']);
});
