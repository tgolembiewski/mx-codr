// signOut's branches in the kit's tests/mx.ts, run without an app or a browser: the TypeScript is stripped by
// Node itself (node:module stripTypeScriptTypes, Node >= 22.13), @playwright/test and node:child_process are
// swapped for fakes, and a fake page records what signOut asks of the browser and the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

const strip = nodeModule.stripTypeScriptTypes;
const skip = strip ? false : 'needs Node >= 22.13 (node:module stripTypeScriptTypes)';

const FAKES = `
export const Page = undefined, Locator = undefined, APIRequestContext = undefined;
export const request = { newContext: async o => ({ options: o }) };
export const expect = () => ({ toBeVisible: async () => {} });
expect.poll = () => ({ toBeGreaterThan: async () => {} });
export const test = { extend: fixtures => ({ fixtures }) };
// ./mxcli oql: the rows in globalThis.oqlRows (sessions as { ID, UserName }), each call counted
export const execFileSync = () => {
  if (!globalThis.oqlRows) throw new Error('no app in this test');
  globalThis.oqlCalls = (globalThis.oqlCalls ?? 0) + 1;
  return JSON.stringify(globalThis.oqlRows);
};
`;

async function loadKit() {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxkit-'));
  const dir = path.join(app, 'tests'); // the kit lives in <app>/tests/ and finds the one .mpr in <app>
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'fakes.mjs'), FAKES);
  const src = strip(fs.readFileSync(new URL('../overlay/templates/tests/mx-impl.ts', import.meta.url), 'utf8'))
    .replace(/from '@playwright\/test'/, "from './fakes.mjs'")
    .replace(/from 'node:child_process'/, "from './fakes.mjs'");
  fs.writeFileSync(path.join(app, 'App.mpr'), '');
  fs.writeFileSync(path.join(dir, 'mx.mjs'), `const __dirname = ${JSON.stringify(dir)};\n${src}`);
  return import(pathToFileURL(path.join(dir, 'mx.mjs')).href);
}
const kit = skip ? null : await loadKit();

// A page that shows the app (window.mx) or the login form, with the session cookie and the server answers given.
// guest: the app lets anonymous users in (project security off, or a guest role), so mx.logout() ends the session
// and the app it reloads at once starts a new anonymous one (measured on Mendix 11.12.1); s.alive counts the
// page's sessions on the server.
function fakePage({ app = true, login = !app, cookie = true, sessionToken, url = 'http://127.0.0.1:8080/p/x', guest = false } = {}) {
  const s = { calls: [], waits: [], login, home: app, cookie, alive: cookie ? 1 : 0 };
  const appWindow = () => ({ mx: { logout: () => {
    s.calls.push('mx.logout'); s.alive--;
    if (guest) { s.win = appWindow(); s.alive++; return; } // the reloaded app: a new anonymous session
    s.win = {}; s.login = true; s.cookie = false;
  }, session: { getConfig: () => 'T-signin' } } });
  s.win = app ? appWindow() : {};
  const visible = sel => (sel === '#usernameInput' ? s.login : sel === '.home' ? s.home : false);
  const loc = sel => ({
    first() { return this; }, or() { return this; },
    fill: async () => {}, click: async () => { if (sel === '#loginButton') page.showApp(); },
    waitFor: async () => { s.waits.push(sel); if (!visible(sel)) throw new Error(`timeout: ${sel}`); },
    isVisible: async () => visible(sel),
  });
  let at = url;
  const page = {
    calls: s.calls, waits: s.waits, alive: () => s.alive,
    showApp() { s.win = appWindow(); s.login = false; s.home = true; if (!s.cookie) s.alive++; s.cookie = true; },
    locator: loc, getByText: () => loc('failed'),
    // leaving for about:blank stops the app's client: nothing of it runs or reloads there
    goto: async u => { if (u === 'about:blank') { s.calls.push('goto about:blank'); s.win = {}; s.login = false; s.home = false; } at = u; },
    url: () => at,
    waitForFunction: async fn => { s.waits.push('mx'); globalThis.window = s.win; if (!fn()) throw new Error('timeout'); },
    evaluate: async (fn, arg) => { globalThis.window = s.win; return fn(arg); },
    request: {
      storageState: async () => ({ cookies: s.cookie ? [{ name: 'XASSESSIONID', value: 'x' }] : [] }),
      post: async (u, o) => {
        s.calls.push(`POST ${u} ${o.data.action}${o.headers['x-csrf-token'] ? ' ' + o.headers['x-csrf-token'] : ''}`);
        if (o.data.action === 'logout') { assert.deepEqual(o.data.params, {}, 'logout needs params, else 560'); if (o.headers['x-csrf-token'] && s.cookie) s.alive--; s.cookie = false; }
        return { json: async () => (o.data.action === 'get_session_data' && sessionToken ? { csrftoken: sessionToken } : {}) };
      },
    },
  };
  return page;
}

test('guest app (security off): signOut ends the anonymous session and leaves none behind', { skip }, async () => {
  const page = fakePage({ guest: true }); // the spec opened an app page without signing in
  await kit.signOut(page);
  assert.equal(page.alive(), 0, 'no session left on the server (mx.logout() alone left the reloaded app\'s new one)');
  assert.ok(!page.calls.includes('mx.logout'), 'the app is not logged out in place: its reload starts a new anonymous session');
});

test('guest app, signed in: signOut ends the session and the app does not start an anonymous one', { skip }, async () => {
  const page = fakePage({ guest: true });
  await kit.signIn(page, 'u', '.home', 'p');
  await kit.signOut(page);
  assert.equal(page.alive(), 0);
});

test('normal case: signed in on an app page, signOut leaves the app and POSTs logout with the session\'s token', { skip }, async () => {
  const page = fakePage();
  await kit.signIn(page, 'u', '.home', 'p');
  await kit.signOut(page);
  assert.deepEqual(page.calls, ['goto about:blank', 'POST /xas/ logout T-signin']);
  assert.equal(page.alive(), 0);
});

test('refused page: the login form with no window.mx, signOut POSTs logout with the token kept at signIn', { skip }, async () => {
  const p = fakePage();
  await kit.signIn(p, 'u', '.home', 'p');
  p.calls.length = 0;
  // the role may not open the page: the login form shows and window.mx is gone, the session lives on
  const login = fakePage({ app: false });
  p.locator = login.locator; p.evaluate = login.evaluate; p.waitForFunction = login.waitForFunction;
  await kit.signOut(p);
  assert.deepEqual(p.calls, ['goto about:blank', 'POST /xas/ logout T-signin']);
});

test('no token from signIn but an app page: the logout POST with window.mx\'s token', { skip }, async () => {
  const page = fakePage();
  await kit.signOut(page);
  assert.deepEqual(page.calls, ['goto about:blank', 'POST /xas/ logout T-signin']);
});

test('no token, no window.mx, a session cookie: the token is read for the cookie and logout POSTed with it', { skip }, async () => {
  const page = fakePage({ app: false, sessionToken: 'T-read' });
  await kit.signOut(page);
  assert.deepEqual(page.calls, ['POST /xas/ get_session_data', 'goto about:blank', 'POST /xas/ logout T-read']);
});

test('no token, no window.mx, a session cookie and no token to read: it throws, naming the page', { skip }, async () => {
  const page = fakePage({ app: false, url: 'http://127.0.0.1:8080/login.html?messageCode=403' });
  await assert.rejects(kit.signOut(page), /could not end the session of the page at http:\/\/127\.0\.0\.1:8080\/login\.html\?messageCode=403/);
});

test('no session cookie at all (the test never signed in): it returns at once, without a call or a wait', { skip }, async () => {
  const page = fakePage({ app: false, cookie: false });
  await kit.signOut(page);
  assert.deepEqual(page.calls, []);
  assert.deepEqual(page.waits, [], 'no 20 s wait for a login form or window.mx on a page without a session');
});

// The per-test session check (these three run in this order: the last one switches it off), called as Playwright calls an auto fixture: (fixtures, use, testInfo).
const check = kit?.test.fixtures.sessionCheck[0];
const info = (title, ...describe) => ({ title, titlePath: ['a.spec.ts', ...describe, title] });
const run = async (testInfo, body = () => {}) => check({}, async () => { await body(); }, testInfo);

test('session check: a session the test left alive fails it, naming the test and the users', { skip }, async () => {
  globalThis.oqlRows = [{ ID: '1', UserName: 'kept' }];
  await assert.rejects(
    run(info('leaks twice', 'L2'), () => { globalThis.oqlRows.push({ ID: '2', UserName: 'someone' }, { ID: '3' }); }),
    /"leaks twice" left 2 session\(s\) alive on the server, user\(s\): someone, \(anonymous\)/);
});

test('session check: a clean test passes; the next test in the same block reuses the count, another block reads again', { skip }, async () => {
  globalThis.oqlRows = [{ ID: '1', UserName: 'kept' }];
  globalThis.oqlCalls = 0;
  await run(info('clean', 'B'), () => { globalThis.oqlRows.push({ ID: '9', UserName: 'gone' }); globalThis.oqlRows.pop(); });
  assert.equal(globalThis.oqlCalls, 2, 'before and after');
  await run(info('clean too', 'B'));
  assert.equal(globalThis.oqlCalls, 3, 'one read: the last test\'s after is this one\'s before');
  await run(info('other block', 'C'));
  assert.equal(globalThis.oqlCalls, 5, 'a new describe block may have run beforeAll: read before again');
});

test('session check: when oql cannot read the app the check is off, and the test is not failed for it', { skip }, async () => {
  globalThis.oqlRows = undefined;
  await run(info('no app', 'D'));
  globalThis.oqlRows = [{ ID: '1' }];
  await run(info('still off', 'E'), () => { globalThis.oqlRows.push({ ID: '2' }); });
});

test('signOut twice: the second finds nothing to end; a second signIn ends the first session first', { skip }, async () => {
  const page = fakePage();
  await kit.signIn(page, 'u', '.home', 'p');
  await kit.signOut(page);
  page.calls.length = 0;
  await kit.signOut(page);
  assert.deepEqual(page.calls, []);
  page.showApp();
  await kit.signIn(page, 'u', '.home', 'p');
  await kit.signIn(page, 'v', '.home', 'p');
  assert.deepEqual(page.calls, ['goto about:blank', 'POST /xas/ logout T-signin'], 'the first session is ended before the second signIn');
});

test('apiContext is a plain Basic-auth context: Basic auth creates no session (measured), nothing to end', { skip }, async () => {
  const ctx = await kit.apiContext('someone', 'secret');
  assert.equal(ctx.options.extraHTTPHeaders.Authorization, 'Basic ' + Buffer.from('someone:secret').toString('base64'));
  assert.equal(typeof kit.test.fixtures.sessionCheck[0], 'function');
  assert.deepEqual(kit.test.fixtures.sessionCheck[1], { auto: true });
});

// A film sets MXCODR_FILM_HOLD_MS (tests/film.mjs's wrapper): signOut holds the screen before it leaves it, unless
// the film held that page at its test's end already (the wrapper's set) or the page is blank; a normal run never waits.
async function timedSignOut(page) {
  const t = Date.now();
  await kit.signOut(page);
  return Date.now() - t;
}
test('a film: signOut holds the screen MXCODR_FILM_HOLD_MS before leaving it; a normal run does not wait', { skip }, async () => {
  const before = process.env.MXCODR_FILM_HOLD_MS;
  try {
    delete process.env.MXCODR_FILM_HOLD_MS;
    let page = fakePage();
    await kit.signIn(page, 'u', '.home', 'p');
    assert.ok(await timedSignOut(page) < 150, 'no variable: no wait');
    process.env.MXCODR_FILM_HOLD_MS = '400';
    page = fakePage();
    await kit.signIn(page, 'u', '.home', 'p');
    assert.ok(await timedSignOut(page) >= 390, 'held before leaving');
    assert.deepEqual(page.calls, ['goto about:blank', 'POST /xas/ logout T-signin'], 'then signed out as always');
    // held by the film at the test's end already: not again
    page = fakePage();
    await kit.signIn(page, 'u', '.home', 'p');
    (globalThis[Symbol.for('mxcodr.film.held')] ??= new WeakSet()).add(page);
    assert.ok(await timedSignOut(page) < 150, 'held once');
    // a page already on about:blank has nothing to show
    page = fakePage();
    await kit.signIn(page, 'u', '.home', 'p');
    await page.goto('about:blank');
    assert.ok(await timedSignOut(page) < 150, 'a blank page is not held');
    // never signed in: returns at once as before
    page = fakePage({ app: false, cookie: false });
    assert.ok(await timedSignOut(page) < 150);
  } finally {
    if (before === undefined) delete process.env.MXCODR_FILM_HOLD_MS; else process.env.MXCODR_FILM_HOLD_MS = before;
  }
});
