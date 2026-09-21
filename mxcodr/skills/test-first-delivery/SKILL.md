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
# 0. say what "working" means, in the user's words
# 1. write tests/verify-<feature>.test.sh with a `# covers:` header -- ONE scenario call
# 2. RUN IT AND WATCH IT FAIL -- the step that proves the test can fail at all
bash tests/gate.sh --only <feature> --boot-if-needed
#    (the gate records that red run in .mxcli/red-first/; that record is the proof,
#     so there is no need to break the feature later to see the test notice)
# 3. implement the smallest MDL that satisfies the criterion
./mxcli check <script>.mdl -p <app>.mpr --references && ./mxcli exec ...
# 4. iterate on that ONE script until green (~2s a run) -- always through the gate,
#    never `bash tests/verify-x.test.sh`: the gate keeps the browser and the session
#    warm and it is where the timeout and the facts-on-failure live
bash tests/gate.sh --only <feature>
# 5. the whole gate: suite + mx check + lint + coverage + naming + layout + security, ends DONE / NOT DONE
bash tests/gate.sh
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
# shell:  scenario '<js body>'   field "$result" key   fields "$result" a b   fail "msg"
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
   change it as its own visible step, and say so.
3. **Iterate on one script, never the whole suite.** A red loop is ~2s per run; a suite
   is ~25s, and one session spent 8 of its 10 minutes of test time on suite reruns.
4. **Done is the full gate printing `DONE`**, quoted as output — not "should work".

## When to use this skill

Whenever you are about to change what the app *does*: adding a page, a button, a
microflow, an action; changing existing behaviour; fixing a bug; being asked to "just
quickly" add something — that is when the step gets skipped. Not for pure refactors
that change no behaviour, and not for model-only chores (renames, folder moves,
documentation).

## The loop, step by step

**0. State the acceptance criterion.** One sentence, in the user's words: *"Clicking
Send reminder on an overdue invoice bumps its reminder count and tells me it was
sent."* No criterion means no test, and no test means no work; if the request is too
vague for one, ask.

**1. Write the failing test first.** One script per feature, `tests/verify-<feature>.test.sh`,
starting with a `covers:` header naming the model elements it exercises — the gate's
coverage check reads it, so "everything is tested" is a fact rather than a claim:

```bash
#!/usr/bin/env bash
# covers: InvoiceDesk.Invoice_Overview, InvoiceDesk.ACT_Invoice_SendReminder
set -euo pipefail
```

A `verify-*.test.sh` is a browser test and only a browser test: the gate hands it to
`mxcli playwright verify`, which waits for a browser result, so a script that never
calls `scenario()` hangs for the full timeout. Logic with no screen in front of it goes
in a `tests/*.test.mdl` run with `mxcli test` (skill `test-microflows`) — an extra
check, not a substitute: the gate does not run those and coverage counts only
`verify-*.test.sh`.

**2. Run it and watch it fail.** `bash tests/gate.sh --only <feature> --boot-if-needed`.
Quote the failure and read it — the line is self-contained (the Playwright error, the
locator, the URL, who was signed in):

```
FAIL: browser scenario failed: Error: page.click: Timeout 8000ms exceeded. | Call log: |
- waiting for locator('.mx-name-btnDoesNotExist') [on http://localhost:8081/index.html, signed in as demo_administrator]
```

Read that instead of re-running by hand, screenshotting or probing the runtime. If the
test goes green here, the test is wrong — fix the test, not the app. It also has to
fail **for the right reason** (the missing button, not a stale row count). The gate
keeps this red run in `.mxcli/red-first/`; breaking the feature on purpose is only for
a test the gate flags as `went green without ever being red here`.

**3. Implement.** The smallest MDL that satisfies the criterion:
`./mxcli check mdlsource/<script>.mdl -p <app>.mpr --references`, then `./mxcli exec`.
A hook runs `bash tests/precheck.sh <script>.mdl` first (the build's own `mx check` on a
scratch copy, ~6s) and blocks an exec that would break the build or stop half-way -- do not
call it by hand; under Codex, where there is no such hook, call it yourself.

**4. Run that one test until it is green.** `bash tests/gate.sh --only <feature>` —
one script, warm browser, signed-in session, ~2-3s. Never the suite while iterating:
a test that passes alone and fails in the suite is a test-isolation bug (sign-in
identity, or a seeded row another test changed), not a reason to rerun the suite.

Keep the app up (`bash tests/gate.sh --boot-if-needed` starts it the way this project
starts it). Under `mxcli run --watch` **nothing needs a restart by hand**: logic and
pages reload in ~2s, entity, association, module and security changes apply through an
in-place runtime restart in ~10s, and the gate waits for the change to land. When the
gate says the model changed and nothing applied it: `bash tests/gate.sh --restart`. To
only stop the app (before `mxcli fix widgets`, say): `bash tests/gate.sh --stop`. Where
the runtime serves a built deployment there is no hot reload: batch model edits and
trust the gate's stale-model warning.

**5. Run the whole suite, from a known state.** `bash tests/gate.sh`, once, at the end.
Scripts run in alphabetical order and every test leaves its rows behind, so:
`verify-000-reset` runs first and restores the seeded data through the app; anything
asserting **exact counts** is `verify-001-…`. A test that changes a seeded row owns that row:
give it its own seeded row or one it creates, never a row another test reads. Two rules the harness enforces: `menu('Invoices', 'invoiceGrid')` proves
the page arrived (a silent nav click leaves every later assertion on the previous
page), and `page.goto` is how a journey starts, never how it recovers (`open_app()`
does the one goto, `reopen_app()` starts over, any other goto throws). Dismiss a *Show
message* dialog (`dismiss_dialog()`) before the next click; wait for a message with
`await_message(/reminder sent/i)`, never `page.waitForTimeout`.

**6. Only now is it done.** One command reports everything:

```
== gate
   tests: Total: 9  Passed: 9  Failed: 0  Time: 19.5s
   mx check: 0 errors
   lint: 53 issues: 0 errors, 31 warnings, 22 info
   coverage InvoiceDesk: PASS  11/11 elements covered by 9 test script(s)
   DONE — every check passed
```

Never report a feature as working on the strength of having written it. Paste what the
gate printed. When it prints `NOT DONE`, the cause of each failure is under the verdict.

## Phone and offline profiles

`open_app()` opens the app's default (responsive) profile, and there is no helper for a
Phone or Offline profile, the service worker or true offline behaviour -- `tests/lib.sh`
has nothing to find on it. Test the shared logic and pages through the responsive
profile, and report the phone profile as not covered by a browser test rather than
writing one that only pretends to.

## The rules that make it bite

**Never edit a test to make it pass.** If the test is wrong, the acceptance criterion
was wrong — say so, agree the new criterion with the user, change the test as its own
visible step. Silently relaxing an assertion converts a failing feature into a passing
suite, which is worse than no tests.

**Never delete, skip or comment out a red test to finish.** A red test is the work not
being done. Report it red.

**A bug fix gets a test too**, in the same order: red on the bug, fix, green.

**Assert on content, not existence.** `querySelector('.mx-name-x') !== null` passes on
an empty grid and on a page rendering an error. Assert row counts, text, and the data
behind it — `await_row`, `oql_count`, `oql_value`.

**Touching an untested feature means writing its test first.** That is how coverage
grows without a big-bang backfill.

## Reference — read when the line applies

| You are | Read |
|---|---|
| Writing the scenario body: a complete script, one-scenario rule, fill/blur, fast timeouts, signing in as another user, navigating with security off | [reference/scenario.md](reference/scenario.md) |
| Hitting sign-in failures, "Maximum number of sessions", startup or idempotence regressions, planning subagents, or wanting facts about the app in one call | [reference/facts.md](reference/facts.md) |
| Debugging a suite that fails but `--only` passes, reading the gate's verdict, the coverage checker, red-first records and mutation testing | [reference/gate-and-suite.md](reference/gate-and-suite.md) |

## Validation checklist

- [ ] An acceptance criterion was stated before any code
- [ ] The test existed and **failed** before the implementation — for the right reason — and the failure was quoted
- [ ] Exact-count assertions run right after `verify-000-reset`
- [ ] A test that changes seeded data uses a row no other test reads
- [ ] The test is one `scenario` call, not a chain of browser calls
- [ ] The test declares a `# covers:` header naming real model elements
- [ ] No test was edited, skipped or deleted to reach green
- [ ] The whole suite was run, not just the new test
- [ ] `bash tests/gate.sh` ends in `DONE — every check passed`
- [ ] The red loop iterated on **one** script, not on the whole suite
- [ ] The result was reported as command output, not as a claim
