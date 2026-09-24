# Writing the scenario

Detail behind steps 1, 2 and 4 of [test-first-delivery](../SKILL.md): a complete script,
the one-scenario rule, and the habits that keep a browser test honest.

## Write it as one scenario

A test costs one process launch per browser call — **0.14s** each on a warm
machine, 0.66s measured cold, before any browser work happens. A test written as
twenty helper calls pays that twenty times over, and each call also re-resolves the
page; `verify-escalate` used to take 35.6s and roughly half of that was spawning.

So: **one `scenario` per test.** The whole flow runs in a single process, and the
assertions happen in the shell afterwards, where `mxcli oql` costs ~0.03s.

```bash
source "$(dirname "$0")/lib.sh"

number="TEST-$$"

scenario '
  await open_app();
  await page.click(".mx-name-btnNewInvoice");
  await page.waitForSelector(".mx-name-txtNumber");
  await fill("txtNumber", "'"$number"'");
  await pick_combo("cmbCustomer", "Northwind Traders");
  await page.click(".mx-name-btnSave");
  await page.waitForSelector(".mx-name-txtNumber", {state: "detached"});
  return {saved: true};
' > /dev/null

await_row Invoice "InvoiceNumber = '$number'" || fail "invoice $number was not stored"
```

Measured on this suite: **2m19s → 21s green** for 9 scripts, same coverage —
1.4–3.2s per script, `mxcli playwright verify` itself costing 1.7s per invocation
and `mxcli oql` 0.02s per assertion.

Rules that keep it that way:

- **Assert on the database, not the screen**, wherever the database can answer.
  `await_row` polls with OQL and costs nothing; a grid assertion depends on paging
  and sort order and belongs only in the test whose job is rendering.
- **A file the app generates is a row, not a download.** A PDF or export button in
  Mendix writes a `System.FileDocument` specialisation first and only then hands it to
  the browser -- as a download, or in a new tab when the action says "show in browser",
  in which case no download event ever fires. So click the button in the scenario and
  assert the row: `await_row InvoicePdf "HasContents = true"`. One session spent about
  forty minutes on the browser side instead -- `playwright-cli response-body`, a grep for
  `file?guid` through 48 GB of caches, a throwaway microflow test -- for an assertion that
  is one line against the database.
- **One scenario, one purpose.** A scenario that throws reports one failure for the
  whole flow, so keep the flow short enough that the message is unambiguous, and
  return named fields (`{header: true, missing: [...]}`) rather than one boolean.
- **Fill then blur.** Mendix commits an input on blur; `fill()` presses Tab for
  this reason. A fill followed straight by a click on Save can save the old value.
- **Let it fail fast.** The scenario sets an 8s action timeout, not Playwright's
  default 30s, because during development the failing case is the normal case.
- **Say who you are.** The runner can reuse one browser across scripts, so a test
  that assumes "not signed in" is really testing whoever the previous script signed
  in as. A test for a different user sets `TEST_USER`/`TEST_PASSWORD` before sourcing
  `lib.sh`, and `open_app` signs the old session out first. Sign out — do not just
  clear cookies: the server-side session survives that and the next sign-in hits the
  runtime's session cap, reported in the browser as a bare "Sign in failed".


## Three habits that quietly cost time or hide a failure

- **Never `page.waitForTimeout(1500)` to wait for a message.** `const text = await
  await_message(/reminder sent/i)` returns the moment the text is on screen and, when
  it never comes, fails saying what the page showed instead. A fixed pause is either
  too long every time or too short on a slow run. Match the *message*, not a word
  the page already shows — a button captioned "Unpaid" satisfies `/unpaid/i` before
  the message exists; `/has \d+ unpaid invoice/i` does not.
- **Booleans come back as `true`/`false`.** `field "$result" ok` prints JSON:
  `[ "$(field "$result" ok)" = "true" ]`. Read several keys in one call with
  `fields "$result" a b c` (one line each, in order).
- **Put both values in the `fail` message.** `fail "expected 4 customers, found $n"`
  — the raw compared values, so a wrong assertion (a stray space, a number as a
  string) is visible from the one line the runner reprints.


## Prove the page arrived; never reload mid-journey

- **Prove the page arrived.** `menu('Invoices', 'invoiceGrid')` waits for the widget that
  proves arrival. A nav click that silently does nothing otherwise leaves every later
  assertion measuring the *previous* page — which reads as a defect that does not exist.
  With one argument, `menu()` still checks that *something* happened (page changed, or a
  dialog opened), because a menu item can be a microflow action rather than a page.
- **`page.goto` is how a journey starts, never how it recovers.** A mid-scenario reload
  wipes client state, hides carry-over between steps, and with security on it silently
  signs the session out — after which the suite carries on as if navigation worked.
  `open_app()` does the one legitimate goto; `reopen_app()` starts a fresh journey on
  purpose. Any other goto throws.

A Mendix *Show message* renders a modal with an OK button, and it swallows the next
click. Dismiss it (`dismiss_dialog` in `tests/lib.sh`) before acting again; reuse the
helpers there — `open_app`, `fill`, `pick_combo`, `row_action`, `menu`,
`await_message`, `dismiss_dialog`, `page_text` — rather than reinventing them per test.


## Reading the failure

**Quote the failure, and read it — the line is self-contained.** `mxcli playwright
verify` reprints only the last stderr line of a script, so `lib.sh` folds the whole
cause into it: the Playwright error, the locator it waited for, the URL it was on and
who was signed in.

```
FAIL: browser scenario failed: Error: page.click: Timeout 8000ms exceeded. | Call log: |
- waiting for locator('.mx-name-btnDoesNotExist') [on http://localhost:8081/index.html, signed in as demo_administrator]
```

Read that instead of re-running the script by hand, screenshotting, or probing the
runtime — those rounds are the expensive part of a red loop, not the test.

**This red run is the proof that the test can fail, and the gate keeps it.** The
first failing `--only` run of a script writes `.mxcli/red-first/<script>`. Mutation
testing — breaking the feature on purpose to see the test go red — is worth doing
for exactly one kind of test: one that went green without ever having been red here.
The gate names such a test when it first passes (`went green without ever being red
here`). For every other test the record already answers the question; one session
spent 15 minutes breaking every feature for every test, and proved nothing the red
runs had not. When you do mutate, run the mutant through `bash tests/gate.sh --only
<feature>` like any other run, and undo the mutation before going on.

 This is the only step that catches a test
asserting nothing: a test written after the implementation, or one that checks a
selector exists without checking what it renders, passes just as happily against a
broken app. If it goes green here, the test is wrong — fix the test, not the app.

It also has to fail **for the right reason**. A reset test in this app first failed
on "found 14 invoices" instead of on the missing menu item — because the helper that
clicked the menu swallowed the JavaScript error and carried on. `scenario()` cannot
swallow one: a throw in the body is re-raised carrying the page and the signed-in
user, and a run that returned no result at all — a closed browser, most often —
fails with what playwright-cli actually said. If you call `playwright-cli` directly
instead, check its output, because a throw inside the page prints an error and exits 0:

```bash
playwright-cli eval "() => { ... ; return true }" | grep -q true || fail "could not click"
```


## Navigating with security off

With `Security Level: Off`, direct `/p/<PageName>` URLs redirect to the home page —
a test that navigates that way silently asserts against the wrong page. Click your
own named widgets instead (`.mx-name-*` comes from the widget name in MDL), and wait
for the client rather than sleeping a fixed number of seconds — `open_app` already
waits for `.mx-page`, and inside a scenario every wait is Playwright's:

```js
await page.waitForSelector('.mx-name-invoiceGrid');
```

Check the level before assuming: `./mxcli -p <app>.mpr -c "SHOW PROJECT SECURITY"`.

