---
name: durable-tests
description: "What deserves a test and how to keep it: plain `@playwright/test` under `tests/` on the starter kit `tests/mx.ts` (sign-in and sign-out that never leak a session, dialogs, grids, one OQL read per test, forged calls), one worker, the whole suite early; a flow per role, both sides of every rule, row isolation per scoped entity, every published service, every delete behaviour, every upload, values and orders not page opens. Use after the model compiles and the app boots with its seed, before you call a feature finished."
---

# Durable tests

Every check you make of the running app becomes a test you can run again. A feature that has been built
but not proven is not finished, and the person who finds out is the user, clicking through the app.

## Finishing: what done means

Before you say the work is finished, in this order:

1. **Close the suite against the request.** Print a table `requirement -> test that asserts it`, one row
   per requirement of the person's request (the request file the installer stored, or the prompt), taken
   sentence by sentence. A row without a test is work not done: write that test first, both sides of
   every rule (allowed and refused).
2. **Run the whole suite once, shuffled**: `npx playwright test --shuffle` in `tests/`, in the foreground,
   with a tool timeout longer than the run. Show its output passing, with `sessions left: 0` as its last
   line; the random order proves the tests do not depend on order. If a test stays red, say which and why.
3. **Never silence the kit.** A leaked session fails the test that leaked it, by name, and the run's last
   line. Fix that test; never edit `tests/mx.ts` or `tests/mx.teardown.ts` to ignore a user, count fewer
   sessions or skip a check.

Do not end the turn while a run is pending. A run that hangs is stopped by its own PID or Ctrl-C, never
by a name pattern.

This skill is about what to test and how to keep it. The browser vocabulary is in mxcli's `test-app`
skill, data checks by OQL in `verify-with-oql`, and logic tests in `test-microflows`.

## Order of work

1. Build the domain model, security, the flows and the seed (an after-startup microflow), checking each
   script with `./mxcli check` before `exec`, and `./mxcli docker check -p App.mpr` once it compiles.
2. Boot it: `./mxcli run --local` (`./mxcli run status`, `./mxcli run stop`). After a change,
   `./mxcli exec x.mdl -p App.mpr && ./mxcli run wait -p App.mpr` returns when the change is applied
   (exit 0) or the build failed (exit 1); entity and association changes make it restart the runtime
   itself. No `sleep` after it, and none after `./mxcli run restart -p App.mpr` either: `./mxcli run wait
   -p App.mpr` after it is enough.
3. Then feature by feature: write its tests and make them pass. A failing test is either the app or the
   test being wrong; find out which before changing anything.
4. Right after the first whole green run, the finishing steps above. Microflow tests, notes and tidying
   are optional and come after.
5. A bug fix is the one exception: first a test that fails on the bug, then the fix, then green.

Run one spec file while you work on it (`npx playwright test orders.spec.ts` in `tests/`). **After the second
spec file is green, run the whole suite once, and again after every third file**: leaks, coupling between
tests and order dependence show only across files, and found late they cost a long failing run. After each
file's first green run, `./mxcli oql -p App.mpr --json "select count(s.ID) as N from System.Session as s"`
answers `[{"N":"0"}]`, or that file leaks a session.

**Give the command that runs tests a timeout longer than the run.** A 60-test suite takes about 3 min;
an agent's shell tool often stops waiting at 120 s and moves the command to the background, where its
output is lost. macOS has no `timeout` command; set the tool's own timeout instead.

## Setup

- `tests/` holds the starter kit the installer put there, yours to change: `mx.ts` (the helpers below),
  `mx.teardown.ts` and `playwright.config.ts` (`workers: 1`, `fullyParallel: false`: one runtime, one
  database, a trial licence of six sessions; `baseURL` from `APP_URL`, so every `page.goto` is relative,
  `/p/orders`). If it is missing, write the same yourself.
- Install with `npm install` in `tests/` (the kit's `package.json` pins `@playwright/test` 1.64.1; do not
  install another version).
- Your own pages, users, home markers and flows go in `tests/helpers.ts`, which imports the kit:
  `import { signIn, signOut, oql } from './mx';`. A spec takes `test` and `expect` from the kit, not from
  `@playwright/test`: `import { test, expect } from './mx';`. That one line adds the per-test session check.
- Passwords of demo users are not in the model (`DESCRIBE DEMO USER` masks them); put them in
  `tests/.env` as `DEMO_PASSWORD=...` (the kit reads it), never in a spec.
- Before the first selector or expected value, read `reference/mendix-dom.md`: how Mendix renders
  logins, dialogs, grids, comboboxes, decimals, member access and refusals.

| `tests/mx.ts` export | What it does, and the Mendix fact behind it |
|---|---|
| `signIn(page, user, homeMarker, password?)` | Signs in on `/login.html` and waits 20 s for `homeMarker` (something only that role's home shows) or "Sign in failed."; a failure names the sessions alive on the server. Keeps the CSRF token for `signOut`. |
| `signOut(page)` | Ends the session on the server, also from a refused page (login form shown, no `window.mx`, session alive) and without a token from `signIn`; throws, naming the page, when it cannot. Call it in `test.afterEach`; a second `signIn` on the same page signs out first. |
| `test`, `expect` | `@playwright/test`'s own, plus an automatic check after each test: a session the test left alive fails that test, naming it and the session's user. |
| `sessionsLeft()` | Sessions alive on the server (`System.Session`); `mx.teardown.ts` prints `sessions left: N` after every run and fails the run when N > 0. |
| `oql(query)` | One `./mxcli oql --json` read of the running app as administrator: an array of row objects keyed by alias, every value a string (Booleans `'true'`/`'false'`); needs the app running. Put every column a test needs in one query. |
| `apiContext(user, password?)` | A Basic-auth request context for published REST and OData services; such a call creates no session. |
| `marker(prefix?)` | `MARK-<time>`: a value no seeded row carries. |
| `rowOf(page, grid, text)`, `cell(row, n)` | A Data Grid 2 row by its text, and its n-th cell (from 0). |
| `filterGrid(page, filterWidget, text)` | Types into a grid's text filter, presses Enter and waits for a row with the text. |
| `pickCombo(page, widget, option)` | Clicks the Combobox, types, then picks from its lazy menu. |
| `fillInput(page, widget, value)` | `fill` then Tab: Mendix commits an input on blur. |
| `dialogText(page)`, `dismissDialog(page)` | The newest message dialog's text, and its first button. |
| `menuItems(page)` | The navigation menu's item texts. |
| `captureOperation(page, trigger)`, `forgeOperation(page, op, params?)` | Records the call a button sends, and replays it as the signed-in user (section "Proving a refusal"). |
| `retrieveByIds(page, ids, attributes)` | Reads objects by id as the signed-in user would (strict mode blocks `mx.data.get`). |
| `env`, `PASSWORD`, `BASE` | `tests/.env` as read, `DEMO_PASSWORD`, the app's address. |

Two traps leak sessions, and the kit's pair covers both: clearing cookies or closing the page leaves the
session alive on the server, and a page the role may not open shows the login form while the session
lives on. Past six sessions a sign-in fails, which reads as a broken feature. The per-test check names
the test that leaked; fix it. If the limit is hit, run `./mxcli run restart -p App.mpr` and then
`./mxcli run wait -p App.mpr`. Never stop browsers or test runners by
name (`pkill -f chromium`, `killall`): that kills the person's own browsers and test runs too. Stop
only a PID you started.

```ts
const [order] = oql(`select o.Status as Status, o.ApprovalStatus as Approval from Shop."Order" as o where o.Number = '${number}'`);
expect(order).toEqual({ Status: 'Created', Approval: 'Pending' });
```

No regular expressions over the text table, and no helper per column.

**When a locator times out or an expected value differs, read `reference/mendix-dom.md` before writing an
explore spec.** Most such failures are a rendering fact listed there.

Widgets are found by `.mx-name-<widget name>`, never by generated ids or row positions. Type with
`locator.fill()` and then press Tab: Mendix commits an input on blur, and a click on Save straight
after a fill can save the old value. From `test-app`, take the vocabulary but not its
`querySelector(...) !== null` checks: those prove that a widget exists, not what it shows.

## What deserves a test

When the app has one of these, test it this way. Each line is a test or a few, not a page visit.

- **A role.** Sign in as a user of that role and assert, as that user, something only it sees: its
  home page, its menu, a value. Every role a demo user holds, with a positive assertion each.
- **A main flow per role.** Signed in as that role, walk the screens from the start to the result,
  click the button that does the work, and assert both what the user sees and the row in the data.
- **A rule.** Both sides: the allowed case as the permitted role, and the refused case (next section).
  A limit, a status order, a required field, an owner check each has two sides.
- **A row-scoped entity** (read access constrained to the current user, or a path to it). As each role
  it is scoped for, on a data widget of that entity (grid, list view, gallery), assert that its own row
  is shown and that another user's row is not:

  ```ts
  await expect(page.locator('.mx-name-MyOrders_OrderGrid')).toContainText(ownNumber);
  await expect(page.locator('.mx-name-MyOrders_OrderGrid')).not.toContainText(foreignNumber);
  ```

  An OQL query cannot prove isolation: it reads as administrator and sees every row.
- **A workflow user task.** For each outcome (approve, reject ...): start the workflow as one person,
  sign out, sign in as the person the task targets and choose the outcome, sign back in as the first
  and assert what they now see. One test per outcome, and one where a user the task does not target
  is refused.
- **A published REST or OData service.** Each operation called with `request` as a user who may, the
  answer asserted (status and content), and once without credentials, asserted refused (401 or 403).
- **A delete with a non-default behaviour.** Cascade: delete through the app, then count the other
  entity's rows by OQL and assert they are gone. Prevent: delete a row that still has references and
  assert the message the app shows, and that the row is still there.
- **An upload.** On the page that holds the file or image entity, `setInputFiles` on
  `.mx-name-<uploader> input[type=file]` with a fixture under `tests/fixtures/`, save, then a positive
  assertion: the stored name shown, the image visible, the row in the data.
- **A message the app can show** (a success notice, a validation error, a refusal). Walk the path that
  shows it and assert four words of it in a row, or all of a shorter one. Refusals as well as successes.
- **A computed value, a total, an order, a format.** Assert the request's own number, caption, order
  or format as a literal, never a value read back from the app's data: "6 bars" checked against the
  rows the page happens to have passes on any page. Seed the data so the literal can be met. A control
  the request calls disabled is asserted disabled, not absent.
- **Startup and seeding.** A change to the after-startup microflow: restart the runtime and assert it
  came back. Anything that creates if missing: run it twice, assert the second run changed nothing.

## Proving a refusal

Attempt the forbidden action as the role that must not do it, and assert that the server refuses.
Test the allowed side as the permitted role in the same file. From cheapest to dearest:

1. **A URL.** Open the page's URL as the wrong role. Mendix answers a page the user may not open with
   the login page; assert that (`#usernameInput` visible) and that the page's content is not shown.
2. **An API request.** A REST or OData call as the wrong role or without credentials, asserted 401 or
   403, and the data unchanged.
3. **A microflow.** A hidden button proves nothing by itself; the server must refuse the call too. Under
   strict mode the Mendix 11 client refuses the older `mx.data.action`; a button sends a
   `runtimeOperation` request to `/xas/` with an operation id. Record that request where the button is
   offered (the permitted role, or an object in the allowed state), replay it from the refused side,
   and assert, by OQL, that nothing changed. HTTP 560 alone is not a refusal: a crash and the session
   limit answer 560 too. Assert the status and `failed for security reasons` in the body, and replay the
   same call as the permitted role (200), since an unknown operation id gets the same security answer.
   A flow that refuses by its own logic answers 200; skill `app-security` has the table of answers.

   With the kit: as the permitted role, `const op = await captureOperation(page, () => button.click())`
   records the POST to `/xas/` (`action: 'runtimeOperation'`, `operationId`, `params` such as
   `{ Order: { guid } }`); then sign out, sign in as the refused role and `forgeOperation(page, op)`.

Some refusals cannot be forged: a flow granted only to a scoped role, on an object that role can never
read, has no object to pass. The isolation test is the proof there.

Never add a button, widen access or lower security so a test can see a message. That makes the app
worse to make a test easier; the stronger test is the button absent plus the server refusing the call.

## The rules that keep a suite honest

**Never edit a test to make it pass.** If the test is wrong, the criterion was wrong: say so, agree the
new one, and change the test as its own visible step. Quietly relaxing an assertion turns a failing
feature into a passing suite.

**Never delete, skip or comment out a red test to finish.** A red test is work not done. Report it red.

**A bug fix gets a test first**: red on the bug, then the fix, then green.

**Assert content, not existence.** A widget that exists passes on an empty grid and on a page showing an
error. Assert the text, the value and the row behind it.

**Count rows in the data, not in the grid.** A grid shows one page of rows, so "one order was added"
read from its visible rows compares 20 with 20. Count with OQL, as a before and after inside the test,
or count only the rows carrying the test's own marker.

**A test owns its record.** It creates what it checks, with a marker no seeded row can carry
(`MARK-${Date.now()}` in a number, name or title), and filters, opens and asserts on exactly that
marker. A prefix or a common word also matches seeded rows. After typing into a filter, wait for the
row with the marker: the grid first shows its unfiltered first page.

**Every test passes alone and in any order.** A spec file sets up the data it needs itself (in
`beforeAll`), never relying on another file having run first. A test that resets or deletes data lives in
its own file and restores the seed afterwards. Assert relative to what the test itself created or read
just before (a count before and after, a row it made), never a fixed number of rows in the database.

**The suite passes on a clean seed.** Drop the database, boot, and every test is still green. A test
that needs a state (a cancelled order, an overdue invoice) creates it through the app at its start.
What the app itself needs lives in its after-startup microflow, idempotent, never in a one-off
`exec`, a hand-run SQL insert or a test.

**A test that must reload to see what it just saved has found a bug.** Fix the app (commit with
refresh), not the test.

**Dates.** A page shows and takes local time; the database and OQL hold UTC. Find the row a test made
by its own text, never by its time, and check a time on the page.

## What a test must not be

A passing test that proves nothing is worse than none: it hides the gap. A test must not:

- make no assertion at all;
- end on an action (a click, a fill, a navigation, a microflow run) with no assertion after it; a final
  sign-out or close is cleanup;
- accept either of two messages with `expect(a.or(b))`: neither rule is then shown alone;
- wait a fixed time (`waitForTimeout`) and then assert only absence (`not.`, `toHaveCount(0)`,
  `toBeHidden`) with no positive assertion in that state: an empty or still-loading page passes it;
- wrap an `expect` in `.catch(...)`: it can never fail;
- assert the absence of `.mx-name-X` when no page or snippet has a widget named X.

Assert what the state does show, then what it must not show:

```ts
await page.goto(`/p/order/${id}`);
await expect(page.locator('#usernameInput')).toBeVisible();      // the refusal
await expect(page.getByText('Internal note')).toHaveCount(0);
```

## Microflow tests

Optional, never mandatory. Use them only for logic no screen reaches (a calculation called by a
scheduled event, an import). mxcli's `test-microflows` has the format. A behaviour a user sees is
tested in the browser.
