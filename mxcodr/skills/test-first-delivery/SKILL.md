---
name: test-first-delivery
description: "The order of work when building or changing app functionality — failing test first, then the implementation, then green, and nothing counts as done until the whole suite passes. Use before adding, changing or fixing any feature in a Mendix app, including bug fixes."
---

# Test-first delivery

This skill is not about how to write a test — [test-app](../../../.ai-context/skills/test-app/SKILL.md) has
the browser vocabulary, [test-microflows](../../../.ai-context/skills/test-microflows/SKILL.md) the logic
tests, and [verify-with-oql](../../../.ai-context/skills/verify-with-oql/SKILL.md) the data assertions.

It is about **when**, and about what "finished" means. A feature that has been
built but not proven is not finished, and the person who finds out is the user,
clicking through the app.

This file is the whole discipline. The `reference/` files next to it hold the detail
behind single lines; read one when its line is the thing you are doing (table at the end).

## The loop, in one screen

```bash
# 0. say what "working" means: one sentence in the user's words; too vague for one? ask
# 1. write tests/verify-<feature>.test.sh with a `# covers:` header -- ONE scenario call;
#    a script without `scenario()` hangs for the full timeout. Logic with no screen goes
#    in tests/*.test.mdl (`mxcli test`, skill test-microflows): extra, the gate skips it.
#    The exec of a new page or ACT_ microflow waits for this header (precheck TEST01)
# 2. RUN IT AND WATCH IT FAIL, for the right reason; quote the FAIL line and read it --
#    it names the error, locator, URL and user, so do not rerun or screenshot by hand
bash tests/gate.sh --only <feature> --boot-if-needed
# 3. implement the smallest MDL that satisfies the criterion. A hook runs
#    tests/precheck.sh (mx check on a scratch copy) and blocks an exec that would break the
#    build or stop half-way -- do not call it by hand; under Codex, call it yourself
./mxcli check <script>.mdl -p <app>.mpr --references && ./mxcli exec ...
# 4. iterate on that ONE script until green (~2s a run) -- always through the gate,
#    never `bash tests/verify-x.test.sh`: the gate keeps the browser and the session
#    warm and it is where the timeout and the facts-on-failure live. Under --watch
#    nothing needs a restart by hand; the gate waits for the change to land. Nothing
#    applied it? --restart. Stop the app (before `mxcli fix widgets`)? --stop
bash tests/gate.sh --only <feature>
#    did the fix break another test? --changed runs the tests the change touched (never DONE)
bash tests/gate.sh --changed
# 5. the whole gate: suite + mx check + catalog + coverage + naming + layout + security, ends DONE / NOT DONE.
#    Scripts run alphabetically and keep their rows: verify-000-reset restores the seed,
#    exact counts go in verify-001-. A test that changes a seeded row owns that row
bash tests/gate.sh
```

Every step in prose, with a worked example: [reference/loop.md](reference/loop.md).

```text
journey: open_app() does the one page.goto; reopen_app() starts over; any other goto
throws. menu() proves the page arrived. dismiss_dialog() before the next click;
await_message(/sent/i), never page.waitForTimeout.
```

What a test script can call, so there is no need to read `tests/lib.sh` to find out
(one session spent its first minute grepping it). A complete script is in
[reference/scenario.md](reference/scenario.md).

```bash
export TEST_USER=demo_customer       # optional, BEFORE lib.sh: sign in as this user (default
                                     # demo_administrator); its password comes from
                                     # tests/credentials.env: TEST_PASSWORD_demo_customer=...
                                     # (DESCRIBE DEMO USER masks it -- write down what you set)
source "$(dirname "$0")/lib.sh"      # after the `# covers:` header
# shell:  result=$(scenario '<js body>')   field "$result" key   fields "$result" a b   fail "msg"
#         values into the body: SV_PW="$pw" scenario '... vars.PW ...'  (never splice '"$pw"')
#         oql "SELECT ..."   oql_count Entity ["where"]   oql_value Entity Attr "where"
#         await_row Entity "where" [seconds]            (entity names without module)
# inside a scenario body: await open_app()  menu('Invoices', 'invoiceGrid')
#         fill('txtName', 'x')  pick_combo('cmbCustomer', 'Northwind')
#         row_action('invoiceGrid', 'INV-1', 'btnSend')  await_message(/sent/i)
#         dismiss_dialog()  page_text()  reopen_app()   -- plus Playwright's `page`
# just looking, not asserting: bash tests/peek.sh 'Invoices' [widget] (no test file, no record)
# every helper, with its arguments: the header of tests/scenario-helpers.js (JS) and
#         tests/lib.sh (shell) -- the header only, the bodies add nothing a test needs
```

Three things about the gate that a test has to match, so there is no need to read
`tests/gate.sh` to find them (three sessions did):

- **The module a test queries** comes from its own `# covers:` line -- the module of
  the first element named there. `oql_count Invoice` then means that module's Invoice.
  `MODULE=...` before sourcing `lib.sh` overrides it.
- **Coverage counts every page and every `ACT_` microflow** of the app's own modules,
  and each one has to appear on some `# covers:` line. A `SUB_` microflow, an entity or
  an enumeration is not counted -- naming one there instead is what makes the checker
  report "not in the model".
- **Inside a scenario, write regular expressions with character classes**: the body
  travels through the shell and JSON before it reaches the browser, so `\d` arrives as
  a literal `d`. Use `/INV-[0-9]+/`, not `/INV-\d+/`.

Non-negotiable, in order of how often they get skipped:

1. **The test fails before the implementation exists.** A test that has never been red
   may assert nothing at all; you cannot tell by reading it.
2. **Never edit a test to make it pass.** Wrong test means the criterion was wrong —
   agree the new one with the user, change the test as its own visible step. Silently
   relaxing an assertion turns a failing feature into a passing suite.
3. **Iterate on one script, never the whole suite.** A red loop is ~2s per run; a suite
   is ~25s, and one session spent 8 of its 10 minutes of test time on suite reruns.
4. **Done is the full gate printing `DONE`**, quoted as output — not "should work".

Use it whenever what the app *does* changes -- "just quickly" is when the step gets
skipped -- not for renames, folder moves or refactors that change no behaviour.

## Phone and offline profiles

`open_app()` opens the app's default (responsive) profile, and there is no helper for a
Phone or Offline profile, the service worker or true offline behaviour -- `tests/lib.sh`
has nothing to find on it. Test the shared logic and pages through the responsive
profile, and report the phone profile as not covered by a browser test rather than
writing one that only pretends to.

## The rules that make it bite

**Never delete, skip or comment out a red test to finish.** A red test is the work not
being done. Report it red.

**A bug fix gets a test too**, in the same order: red on the bug, fix, green.

**Assert on content, not existence.** `querySelector('.mx-name-x') !== null` passes on
an empty grid and on a page rendering an error. Assert text and the data behind it —
`await_row`, `oql_count`, `oql_value`.

**Count rows in the data, not in the grid.** A grid shows one page (`PageSize: 20`), so
"one order was added" read from its visible rows compared 20 with 20. Count with
`oql_count`; assert the grid by content, the row carrying the new order number. A test
that has to reload the page (`reopen_app()`, a menu round trip) to see what it just saved has
found a bug: fix the app (`commit ... refresh`), not the test.

**Every path, not the happy one.** Each rule: the allowed case AND the refused one. Each message
the app shows: four words of it asserted. A journey of several people: one test, `sign_in_as` each,
assert what each sees. Assert the object the test made, never a count of all rows. The gate's
`paths` step blocks DONE until each path has a test ([reference/paths.md](reference/paths.md)).

**Touching an untested feature means writing its test first.** That is how coverage
grows without a big-bang backfill.

## Reference — read when the line applies

| You are | Read |
|---|---|
| Wanting a step of the loop in prose, with its worked example | [reference/loop.md](reference/loop.md) |
| Writing the scenario body: a complete script, one-scenario rule, fill/blur, fast timeouts, signing in as another user, navigating with security off | [reference/scenario.md](reference/scenario.md) |
| Hitting sign-in failures, "Maximum number of sessions", startup or idempotence regressions, planning subagents, or wanting facts about the app in one call | [reference/facts.md](reference/facts.md) |
| Listing a feature's paths, or reading a `paths` finding | [reference/paths.md](reference/paths.md) |
| Debugging a suite that fails but `--only` passes, reading the gate's verdict, the coverage checker, red-first records and mutation testing | [reference/gate-and-suite.md](reference/gate-and-suite.md) |

## Validation checklist

- [ ] An acceptance criterion was stated before any code
- [ ] The test existed and **failed** before the implementation — for the right reason — and the failure was quoted
- [ ] Green on the app's clean seed: each test makes the data it needs ([facts](reference/facts.md))
- [ ] A test that changes seeded data uses a row no other test reads
- [ ] The test is one `scenario` call, not a chain of browser calls
- [ ] Allowed and refused paths tested; every message asserted; each user of a journey signs in
- [ ] The test declares a `# covers:` header naming real model elements
- [ ] `bash tests/gate.sh` ends in `DONE — every check passed`
- [ ] The result was reported as command output, not as a claim
