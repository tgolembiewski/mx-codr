// The starter kit for Playwright tests of a Mendix app: every helper, its signature and what it does. The code is in
// tests/mx-impl.ts; you need only this file. In a spec: import { test, expect } from './mx'; (that line adds the
// per-test session check). The app's own pages, users and flows go in tests/helpers.ts: import { signIn, signOut, oql } from './mx';
// Never edit this file or tests/mx-impl.ts to silence a check (a leaked session, a failed sign-in): fix the test.
import type { Page, Locator, APIRequestContext } from '@playwright/test';
import * as kit from './mx-impl';

/** @playwright/test's test, plus an automatic check after each test: a session the test left alive on the server fails
 * that test, naming it and the session's user. */
export const test = kit.test;
/** @playwright/test's expect. */
export const expect = kit.expect;

/** tests/.env as read (KEY=value lines). */
export const env: Record<string, string> = kit.env;
/** The demo users' password: DEMO_PASSWORD from the environment, else tests/.env (never in a spec). */
export const PASSWORD: string = kit.PASSWORD;
/** The app's address: APP_URL, else http://127.0.0.1:8080 (the config's baseURL: page.goto('/p/orders') is relative). */
export const BASE: string = kit.BASE;

/** Signs in on /login.html and waits 20 s for homeMarker (a selector only that role's home shows) or "Sign in failed.";
 * a failure names the sessions alive on the server. Keeps the CSRF token for signOut; a second signIn on a page signs out first. */
export const signIn: (page: Page, user: string, homeMarker: string, password?: string) => Promise<void> = kit.signIn;
/** Ends the session on the server (clearing cookies or closing the page leaves it alive), also from a refused page that
 * shows the login form; leaves the app for about:blank first. Throws, naming the page, when it cannot. Call it in test.afterEach.
 * In a film it holds the screen at least 5 s before leaving it (MXCODR_FILM_HOLD_MS); a normal run does not wait. */
export const signOut: (page: Page) => Promise<void> = kit.signOut;
/** Sessions alive on the server (System.Session); mx.teardown.ts prints `sessions left: N` after every run and fails it when N > 0. */
export const sessionsLeft: () => number = kit.sessionsLeft;

/** One read of the running app as administrator (it sees every row): rows keyed by alias, every value a string
 * (Booleans 'true'/'false', a null column ''). Put every column a test needs in one query. */
export const oql: (query: string) => Record<string, string>[] = kit.oql;
/** A Basic-auth request context for the app's published REST and OData services; such a call creates no session. */
export const apiContext: (user: string, password?: string) => Promise<APIRequestContext> = kit.apiContext;
/** `MARK-<time>`: a value no seeded row carries, so a test filters, opens and asserts on exactly its own record. */
export const marker: (prefix?: string) => string = kit.marker;

/** A Data Grid 2 row ([role=row], the header row too) of the grid widget named `grid`, by its text. */
export const rowOf: (page: Page, grid: string, text: string | RegExp) => Locator = kit.rowOf;
/** The row's n-th cell ([role=gridcell]), counted from 0. */
export const cell: (row: Locator, n: number) => Locator = kit.cell;
/** Types into a grid's text filter, presses Enter and waits for a row with the text (the grid first shows its unfiltered page). */
export const filterGrid: (page: Page, filterWidget: string, text: string) => Promise<void> = kit.filterGrid;
/** Clicks the Combobox, types, then picks the option from its lazy menu. */
export const pickCombo: (page: Page, widget: string, option: string | RegExp) => Promise<void> = kit.pickCombo;
/** fill, then Tab: Mendix commits an input on blur, and a click on Save straight after a fill can save the old value. */
export const fillInput: (page: Page, widget: string, value: string) => Promise<void> = kit.fillInput;
/** The newest message dialog's text (.mx-dialog-body); a validation message under a field is not a dialog. */
export const dialogText: (page: Page) => Promise<string> = kit.dialogText;
/** Clicks the newest message dialog's first button. */
export const dismissDialog: (page: Page) => Promise<void> = kit.dismissDialog;
/** The navigation menu's item texts. */
export const menuItems: (page: Page) => Promise<string[]> = kit.menuItems;

/** A recorded button call: its operation id and parameters ({ <parameter>: { guid } } names an object by its id). */
export type Operation = kit.Operation;
/** Runs trigger (a real click) and returns the runtimeOperation call the button POSTed to /xas/ (never the microflow's name). */
export const captureOperation: (page: Page, trigger: () => Promise<void>) => Promise<Operation> = kit.captureOperation;
/** Replays an operation as the user signed in on page (params replace the recorded ones). A refusal is HTTP 560 with
 * 'failed for security reasons' in the body; 560 without it is a crash or the session limit; 200 is the flow's own answer. */
export const forgeOperation: (page: Page, op: Operation, params?: Record<string, unknown>) => Promise<{ status: number; body: string }> = kit.forgeOperation;
/** Reads objects by id as the signed-in user would (strict mode blocks mx.data.get); an attribute the role may not read is left out. */
export const retrieveByIds: (page: Page, ids: string[], attributes: string[]) => Promise<{ status: number; body: string }> = kit.retrieveByIds;
