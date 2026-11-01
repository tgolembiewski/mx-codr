// A starter kit for Playwright tests of a Mendix app: sign-in and sign-out, dialogs, grids, OQL and
// forged calls. Plain @playwright/test; it is yours now, edit or delete it. Put the app's own pages, users
// and flows in tests/helpers.ts beside it: import { signIn, signOut, oql } from './mx';
// In a spec, take test and expect from here, not from @playwright/test: import { test, expect } from './mx';
// that one line adds the per-test session check below.
// Each helper's comment names the Mendix fact it relies on, so a helper that fails is a one-line fix.
// Measured on Mendix 11.12 with Atlas 3 and Data Grid 2.
import { test as base, expect, request, Page, Locator, APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The app folder: this file lives in <app>/tests/ (Playwright compiles tests as CommonJS, so __dirname is set).
const APP = path.resolve(__dirname, '..');

// Demo-user passwords are not in the model (DESCRIBE DEMO USER masks them): tests/.env or the environment, never in source.
export const env: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const file = path.join(__dirname, '.env');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
})();
// The demo users' password: DEMO_PASSWORD from the environment, else from tests/.env.
export const PASSWORD = process.env.DEMO_PASSWORD ?? env.DEMO_PASSWORD ?? '';
// The app's address: APP_URL, else Mendix's default port 8080 (the same value as baseURL in the config).
export const BASE = process.env.APP_URL ?? env.APP_URL ?? 'http://127.0.0.1:8080';

// ---- server data by OQL -----------------------------------------------------------------------

// One app folder holds exactly one .mpr; ./mxcli oql needs it with -p.
function mprFile(): string {
  const mprs = fs.readdirSync(APP).filter(f => f.endsWith('.mpr'));
  if (mprs.length !== 1) throw new Error(`expected one .mpr in ${APP}, found ${mprs.length}`);
  return mprs[0];
}

// `./mxcli oql --json` reads the running app as administrator (it sees every row) through the admin API, and
// prints a JSON array of objects keyed by the column aliases: every value a string ("5", "4200", dates as
// "Sun Oct 18 03:40:33 CEST 2026") except Booleans (true/false, made 'true'/'false' here); a null column is
// left out of its object. Put every column a test needs in one query: one server read per test.
export function oql(query: string): Record<string, string>[] {
  const bin = fs.existsSync(path.join(APP, 'mxcli.exe')) ? './mxcli.exe' : './mxcli';
  const out = execFileSync(bin, ['oql', '-p', mprFile(), '--json', query], { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let data: unknown; // stdout holds only the JSON; the row count goes to stderr
  try { data = JSON.parse(out); } catch { throw new Error(`oql: not JSON: ${out.slice(0, 200)}`); }
  if (!Array.isArray(data)) throw new Error(`oql: expected a JSON array of rows, got: ${out.slice(0, 200)}`);
  return data.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`oql: expected rows as objects, got: ${out.slice(0, 200)}`);
    return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v == null ? '' : String(v)]));
  });
}

// Sessions alive on the server, stale ones included (System.Session: ID, SessionId, LastActive, createdDate in
// lower case; its user by s/System.Session_User). The trial runtime allows six, then a sign-in fails.
export function sessionsLeft(): number {
  const [row] = oql('select count(s.ID) as N from System.Session as s');
  return Number(row?.N ?? Object.values(row ?? {})[0] ?? NaN);
}

// Each live session's ID and its user's name ('' for an anonymous one), in one read.
function sessionRows(): { id: string; user: string }[] {
  return oql('select s.ID as ID, u.Name as UserName from System.Session as s left join s/System.Session_User/System.User as u')
    .map(r => ({ id: r.ID, user: r.UserName ?? '' }));
}

// ---- the per-test session check ------------------------------------------------------------------

// The sessions seen after the last test, kept as the next test's "before" while the next test is in the same
// file and describe block (no beforeAll ran in between). A failed test restarts the worker, which resets it.
let lastSeen: { scope: string; ids: Set<string> } | undefined;
let checkOff = false;

// `test` and `expect` for specs: @playwright/test's own, plus an automatic fixture that fails a test which
// leaves a session alive, naming the test and the users of its extra sessions. A fixture's teardown runs after
// test.afterEach, so the signOut there has already ended the browser session when it counts. Cost: one oql
// read per test, two for the first test of a block (to be measured). When oql cannot read the app the check is off for the run, and mx.teardown.ts still counts.
export const test = base.extend<{ sessionCheck: void }>({
  sessionCheck: [async ({}, use, testInfo) => {
    const scope = testInfo.titlePath.slice(0, -1).join(' > ');
    let before = lastSeen?.scope === scope ? lastSeen.ids : undefined;
    lastSeen = undefined;
    if (!before && !checkOff) {
      try { before = new Set(sessionRows().map(r => r.id)); } catch (e) {
        checkOff = true;
        console.log(`per-test session check off: oql failed (${(e as Error).message.split('\n')[0]})`);
      }
    }
    await use();
    if (!before || checkOff) return;
    let after: { id: string; user: string }[];
    try { after = sessionRows(); } catch { return; }
    const extra = after.filter(r => !before.has(r.id));
    if (extra.length === 0) { lastSeen = { scope, ids: new Set(after.map(r => r.id)) }; return; }
    const users = extra.map(r => r.user || '(anonymous)').join(', ');
    throw new Error(`"${testInfo.title}" left ${extra.length} session(s) alive on the server, user(s): ${users}. `
      + 'End a browser session with signOut(page) in test.afterEach; never silence this check, fix the test.');
  }, { auto: true }],
});
// Playwright's expect, so a spec takes both from one import.
export { expect };

// ---- sign in and out ---------------------------------------------------------------------------

const csrf = new WeakMap<Page, string>();
const signedOut = new WeakSet<Page>();

// The CSRF token of the session a request context's cookies carry: POST /xas/ {action:'get_session_data'} answers
// it as csrftoken (to verify). Undefined when there is no session cookie (XASSESSIONID) or no token in the answer.
async function readToken(req: APIRequestContext): Promise<string | undefined> {
  const { cookies } = await req.storageState();
  if (!cookies.some(c => c.name === 'XASSESSIONID')) return undefined;
  const res = await req.post('/xas/', { headers: { 'content-type': 'application/json' }, data: { action: 'get_session_data', params: {} } }).catch(() => undefined);
  const body = await res?.json().catch(() => undefined);
  return typeof body?.csrftoken === 'string' && body.csrftoken ? body.csrftoken : undefined;
}

// POST /xas/ {action:'logout', params:{}} with the X-Csrf-Token header deletes the session (measured); without the
// header it answers 200 {} and the session stays, without params it answers 560. So a 200 proves nothing: the
// per-test check counts the sessions.
async function postLogout(req: APIRequestContext, token: string) {
  await req.post('/xas/', { headers: { 'x-csrf-token': token, 'content-type': 'application/json' }, data: { action: 'logout', params: {} } });
}

// The login page has #usernameInput, #passwordInput and #loginButton; after sign-in the session's CSRF token
// is mx.session.getConfig('csrftoken'), kept here so signOut can end a session whose page lost window.mx.
// `homeMarker` is a selector only that role's home page shows. At the session limit the page stays on the login
// form and shows "Sign in failed." (the runtime logs "Maximum number of sessions exceeded"); a warm sign-in
// takes about 1 s, so both outcomes are awaited for 20 s and a failure names the sessions alive.
export async function signIn(page: Page, user: string, homeMarker: string, password: string = PASSWORD) {
  // a second signIn on a page still signed in would replace the session cookie and orphan the first session
  if (csrf.has(page)) await signOut(page);
  const started = Date.now();
  await page.goto('/login.html');
  await page.locator('#usernameInput').fill(user);
  await page.locator('#passwordInput').fill(password);
  await page.locator('#loginButton').click();
  const home = page.locator(homeMarker).first();
  const failed = page.getByText('Sign in failed').first();
  await expect(home.or(failed)).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
  if (!(await home.isVisible())) {
    const refused = await failed.isVisible();
    let alive = 'an unknown number of';
    try { alive = String(sessionsLeft()); } catch { /* oql failed: the count stays unknown */ }
    const cause = alive !== '0' && alive !== 'an unknown number of'
      ? `a test leaked its session (signOut in test.afterEach; restart the runtime with ./mxcli run restart -p ${mprFile()})`
      : refused ? 'not a leak: check the user name and its password' : `not a leak: check the home marker ${homeMarker}`;
    throw new Error(`sign-in as ${user} ${refused ? 'failed ("Sign in failed.")' : 'did not complete in 20 s'}; ${alive} sessions alive on the server: ${cause}`);
  }
  const took = Date.now() - started;
  if (took > 5_000) console.log(`signIn took ${took} ms (${user})`);
  csrf.set(page, await page.evaluate(() => (window as any).mx.session.getConfig('csrftoken')));
  signedOut.delete(page);
}

// Clearing cookies or closing the page or its context leaves the session alive on the server. A page the role may not open
// shows the login form (login.html?messageCode=403#/<page>) with no window.mx while the session lives on: that one is
// ended by POST /xas/ {action:'logout'} with the token kept at sign-in; any other page by mx.logout().
// Without a token from signIn (a sign-in of your own, another page object) it still ends the session: mx.logout()
// when the page has window.mx, else the logout POST with a token read for the page's cookies; it returns quietly
// only when the page has no session cookie or this helper signed it out and no app page opened since, and
// otherwise throws, naming the page. Call it in test.afterEach, and before a second signIn in the same test.
export async function signOut(page: Page) {
  const kept = csrf.get(page);
  csrf.delete(page);
  const hasCookie = async () => (await page.request.storageState()).cookies.some(c => c.name === 'XASSESSIONID');
  if (!kept && !(await hasCookie())) return; // never signed in (or the cookie is gone): nothing this page can end
  const loginForm = page.locator('#usernameInput');
  await Promise.race([
    loginForm.waitFor({ timeout: 20_000 }),
    page.waitForFunction(() => typeof (window as any).mx?.logout === 'function', undefined, { timeout: 20_000 }),
  ]).catch(() => undefined);
  const hasMx = await page.evaluate(() => typeof (window as any).mx?.logout === 'function').catch(() => false);
  if (!kept && !hasMx && signedOut.has(page)) return; // signed out here before, and no app page since
  if (kept && await loginForm.isVisible()) {
    await postLogout(page.request, kept);
  } else if (hasMx) {
    // logout navigates away, which can destroy the evaluation before it returns; the login form shows the result
    await page.evaluate(() => (window as any).mx.logout()).catch((e: Error) => {
      if (!/context was destroyed|navigat/i.test(e.message)) throw e;
    });
    await loginForm.waitFor({ timeout: 20_000 }).catch(() => undefined);
  } else {
    const token = kept ?? await readToken(page.request);
    if (token) {
      await postLogout(page.request, token);
    } else {
      throw new Error(`signOut: could not end the session of the page at ${page.url()}: no window.mx and no CSRF token to log out with`);
    }
  }
  signedOut.add(page);
}

// Published REST and OData services take Basic authentication with the user's name and password. Such a call
// creates no session on the server and sets no cookie (measured on Mendix 11.12, 401s included), so a context
// needs only dispose() and the session checks have nothing to ignore.
export async function apiContext(user: string, password: string = PASSWORD): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') },
  });
}

// A value no seeded row can carry, so a test filters, opens and asserts on exactly its own record.
export function marker(prefix = 'MARK'): string {
  return `${prefix}-${Date.now()}`;
}

// ---- widgets ------------------------------------------------------------------------------------

// Data Grid 2: rows are [role=row] (the header row too, so filter by text); `grid` is the widget name.
export function rowOf(page: Page, grid: string, text: string | RegExp): Locator {
  return page.locator(`.mx-name-${grid} [role=row]`).filter({ hasText: text }).first();
}

// Data Grid 2: cells are [role=gridcell]; n counts from 0 and skips no hidden column.
export function cell(row: Locator, n: number): Locator {
  return row.locator('[role=gridcell]').nth(n);
}

// A Data Grid 2 text filter applies on Enter, and the grid first shows its unfiltered first page: wait for a
// row with the text before using it.
export async function filterGrid(page: Page, filterWidget: string, text: string) {
  const input = page.locator(`.mx-name-${filterWidget} input`).first();
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('[role=row]').filter({ hasText: text }).first()).toBeVisible();
}

// The Combobox menu is lazy: click input.widget-combobox-input and type, then click the .widget-combobox-menu li.
export async function pickCombo(page: Page, widget: string, option: string | RegExp) {
  const root = page.locator(`.mx-name-${widget}`);
  const input = root.locator('input.widget-combobox-input');
  await input.click();
  if (typeof option === 'string') await input.fill(option);
  await root.locator('.widget-combobox-menu li').filter({ hasText: option }).first().click();
}

// Mendix commits an input on blur: fill, then Tab, or a click on Save straight after can save the old value.
export async function fillInput(page: Page, widget: string, value: string) {
  const el = page.locator(`.mx-name-${widget} input, .mx-name-${widget} textarea`).first();
  await el.fill(value);
  await el.press('Tab');
}

// A message dialog is .mx-dialog with its text in .mx-dialog-body (the newest is the last); an error dialog
// also has the class mx-dialog-error. A validation message under a field is not a dialog.
export async function dialogText(page: Page): Promise<string> {
  const body = page.locator('.mx-dialog .mx-dialog-body').last();
  await body.waitFor();
  return (await body.innerText()).trim();
}

// The dialog's buttons are .mx-dialog-footer .btn; the first one closes a message dialog.
export async function dismissDialog(page: Page) {
  await page.locator('.mx-dialog .mx-dialog-footer .btn').first().click();
}

// The navigation menu's items are .mx-navigationtree a (seen on Atlas_Default).
export async function menuItems(page: Page): Promise<string[]> {
  const items = await page.locator('.mx-navigationtree a').allInnerTexts();
  return items.map(t => t.trim()).filter(t => t.length > 0);
}

// ---- calls the client makes, recorded and forged ---------------------------------------------------

// A recorded button call: the operation's id and its parameters ({ <parameter>: { guid } } names an object by its id).
export type Operation = { operationId: string; params: Record<string, unknown> };

// A button that runs a microflow POSTs to /xas/ with action 'runtimeOperation', an operationId and params,
// never the microflow's name. Page loads send runtimeOperation too; only a button's call carries
// validationGuids. Runs `trigger` (a real click) and returns the last such call.
export async function captureOperation(page: Page, trigger: () => Promise<void>): Promise<Operation> {
  const seen: Operation[] = [];
  const onRequest = (r: { url(): string; method(): string; postData(): string | null }) => {
    if (!r.url().includes('/xas/') || r.method() !== 'POST') return;
    try {
      const body = JSON.parse(r.postData() ?? '{}');
      if (body.action === 'runtimeOperation' && body.validationGuids !== undefined) seen.push({ operationId: body.operationId, params: body.params });
    } catch { /* not JSON */ }
  };
  page.on('request', onRequest);
  try {
    await trigger();
    await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    page.off('request', onRequest);
  }
  return seen[seen.length - 1];
}

// Replays an operation as the user signed in on `page`, with the session's CSRF token. A refusal is HTTP 560
// with 'failed for security reasons' in the body; 560 without it is a crash or the session limit; 200 is the
// flow's own answer. `params` replaces the recorded ones (another object: { <parameter>: { guid } }).
export async function forgeOperation(page: Page, op: Operation, params?: Record<string, unknown>) {
  return page.evaluate(async ({ operationId, params }) => {
    const res = await fetch('/xas/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': (window as any).mx.session.getConfig('csrftoken') },
      body: JSON.stringify({ action: 'runtimeOperation', operationId, params, validationGuids: [], changes: {}, objects: [] }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 2000) };
  }, { operationId: op.operationId, params: params ?? op.params });
}

// Strict mode disables mx.data.get (NotAllowedInStrictModeError); a hand-made read by id is retrieve_by_ids
// over /xas/. An attribute the role may not read is omitted from the answer, not sent empty.
export async function retrieveByIds(page: Page, ids: string[], attributes: string[]) {
  return page.evaluate(async ({ ids, attributes }) => {
    const schema = { attributes: Object.fromEntries(attributes.map(a => [a, {}])) };
    const res = await fetch('/xas/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': (window as any).mx.session.getConfig('csrftoken') },
      body: JSON.stringify({ action: 'retrieve_by_ids', params: { ids, schema } }),
    });
    return { status: res.status, body: await res.text() };
  }, { ids, attributes });
}
