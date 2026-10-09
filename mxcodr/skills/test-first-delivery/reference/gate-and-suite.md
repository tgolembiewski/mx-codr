# The gate and the suite

Detail behind steps 4, 5 and 6 of [test-first-delivery](../SKILL.md): the red loop's
cost, what keeps the suite honest, and the coverage checker.

## The red loop

Run **one script**, not the suite, while you iterate. This is the single biggest
lever on a red loop: one session spent **8.3 of its 9.7 minutes of test time on ten
full-suite reruns** while debugging one script, because that script only failed in
the suite. If a test passes alone and fails in the suite, that is a test-isolation
bug — sign-in identity, or data left behind — and it is fixed in `tests/lib.sh`, not
by rerunning the suite until it makes sense.

Under the hood it is `mxcli playwright verify <script> --keep-open --timeout 90s`.
Three things decide how long the loop takes:

- `--keep-open` leaves the browser warm, so the next run skips the Chromium launch;
  under `--only` the session stays signed in too, so the next run skips the sign-in.
- `--timeout 90s` caps a script instead of the 2m default, and `tests/lib.sh` fires
  its own watchdog 5s earlier, so a hung browser call ends with a `FAIL:` line that
  names the cause rather than a bare kill. A failing test sits out its waits, which
  is why a red suite measured 8m55s against 2m19s green — during development the
  failing case is the normal case.
- Keep the app up in another terminal with hot reload, so a page or microflow
  change needs no restart:

  ```bash
  bash tests/gate.sh --boot-if-needed
  ```

  That starts the app the way this project starts it, which is not always
  `./mxcli run --local --watch` -- that command deadlocks on some machines, and
  where the installer had to choose another way, `tests/harness.env` records it in
  `MDL_BOOT_COMMAND` (the file exists only on such machines; do not go looking for
  it elsewhere). When the gate says the model changed after the runtime started,
  `bash tests/gate.sh --restart` stops this project's runtime, boots it again and
  runs the gate -- one command, not a pgrep-and-kill improvisation. To only stop it
  (before `mxcli fix widgets`, say): `bash tests/gate.sh --stop`.

  **Check which loop you are in before planning around it.** With `--watch` and a
  live model, **nothing needs a restart by hand**: logic and pages reload in about two
  seconds, and entity, association, module and security changes apply through an
  in-place runtime restart in about ten (`.mxcli/gate-boot.log` says `applied via
  reload` or `applied via restart`). Run the test straight after the exec -- the gate
  waits for the change to land. `--restart` is for when the gate says nothing applied it. Where the runtime serves a *built deployment* there
  is no hot reload at all: every model change costs a rebuild and a restart, one to
  two minutes. The red-green loop still works and `--only <feature>` is still the
  right command, but batch your model edits instead of making them one at a time,
  and trust the gate's stale-model warning to tell you when you are measuring an old
  build.
  A restart per iteration is 30-60s that this removes.


## The whole suite

A feature that reddens an existing test is not done. One suite run at the end, not
one per iteration: the suite is ~21s, but each shell round trip in a session costs
3–5s on top of whatever it runs, so the count of commands matters more than their
cost. This step is not optional, because "my change could not possibly have affected
that" is exactly the belief regressions live in.

Scripts run in **alphabetical order**, and every test that creates rows leaves them
behind. Two conventions keep the suite honest:

- `tests/verify-000-reset.test.sh` runs first and puts the data back to its seeded
  state through the app itself (a menu action calling a reset microflow, in this
  app). Every run starts from the same rows.
- Anything that asserts **exact counts** is named `verify-001-…`, so it runs right
  after the reset — the only moment those counts are true.
- **A test that changes a seeded row owns that row.** Nothing resets between scripts,
  so a test that reports `INV-A-004` paid changes what every later script sees: the
  overdue test after it, alphabetically, found `PaymentReported` instead of `Overdue`
  and failed only in the full run. Give such a test its own seeded row (add one to the
  reset, and name it for the test) or a row it creates itself — never a row another
  test reads. A test that passes with `--only` and fails in the suite is this, first.


## Done

Done means all four of these — and one command reports all four, because four
separate calls cost four round trips:

```bash
bash tests/gate.sh
```

```
== gate
   tests: Total: 9  Passed: 9  Failed: 0  Time: 19.5s
   mx check: 0 errors
   catalog: PASS  0 catalog finding(s) block, 0 warning(s)
   coverage InvoiceDesk: PASS  11/11 elements covered by 9 test script(s)
   DONE — every check passed
```

- [ ] The new test passes
- [ ] The whole suite passes
- [ ] `mx check` reports 0 errors
- [ ] `catalog` passes -- a grid filters itself (UI001), no anonymous read of every row (SEC007)
- [ ] Every page and `ACT_` microflow is covered (the gate runs the checker)
- [ ] `layout` passes — no two inline widgets touching (skill: `spacing-and-layout`)

Never report a feature as working on the strength of having written it. "Should
work" is not a result; paste what the runner printed.

## Check it

```bash
node tools/mdl-checks/check_test_coverage.cjs . <Module>
```

Lists every page and `ACT_` microflow in the module and fails on any without a
`# covers:` line in some `tests/verify-*.test.sh`, and on any `covers:` naming an
element that no longer exists. (In this repo the checker is
`mxcodr/checks/check_test_coverage.cjs`; `tools/mdl-checks/` is where `install.sh` puts
it in an installed project.)

A test reads JSON with `field`/`fields` and the database with `oql_count`/`oql_value`;
for arithmetic use `awk` or `node -e`. The harness runs on Node and installs no Python.

