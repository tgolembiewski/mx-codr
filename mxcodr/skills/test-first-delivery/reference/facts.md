# Facts, sessions and limits

Detail behind [test-first-delivery](../SKILL.md): what a browser test alone will not
catch, how to ask the app for facts in one call, and the session cap of a developer
licence.

## Things a browser test alone will not catch

Two failure modes this app has already hit. Cover them deliberately:

- **Startup regressions.** An after-startup microflow that returns `false` aborts
  the runtime — the app never comes up. No page-loading test can see it, because
  there is no page. A feature that touches startup logic needs a test that
  **restarts** the app and asserts it came back.
- **Idempotence.** Seeding, imports and anything that "creates if missing" must be
  tested across a restart: run it twice, assert the second run changed nothing.

## Parallelise facts, never the app

Three shell calls asking three questions cost more than the questions: a call has a
~1.9s median in an agent session, the queries inside it 0.02s. So the harness asks
everything at once, in parallel:

```bash
bash tests/orient.sh        # ~0.3s: structure, security, navigation, tests + covers, coverage, app state
bash tests/diagnose.sh Invoice demo_customer   # ~0.2s: row counts, sessions, access rules, associations, runtime errors
```

Reach for `orient.sh` before building. `diagnose.sh` you rarely need to run yourself:
`gate.sh` runs it for you whenever a test fails, and prints the facts under the
failure. It also warns when the model changed after the runtime started — security
and entity changes do not hot-apply, and a stale runtime fails a correct fix — and
names the fix: `bash tests/gate.sh --restart`. `docs/brain/`, where it exists, is
still where the *decisions* live; these report state only.

`gate.sh` does the same internally: `mx check`, catalog, coverage, naming and layout need neither the app
nor the browser, so they run while the suite runs (~37s serial becomes ~27s), and with
`--boot-if-needed` they run while the runtime is still booting.

**Tests themselves never run in parallel.** One runtime, one database, one browser:
`verify-000-reset` rewrites the shared data every other script depends on, the `001`
tests assert exact counts, and the licence caps concurrent sessions. Isolation would
mean one app instance per lane — 30s+ of boot each — to turn a 27s suite into maybe
15s, while adding a class of flakiness that costs far more to diagnose.

**If you fan out subagents, only one may touch the app.** Running tests, executing
MDL and signing in all mutate state that is global to the runtime, and two agents
doing it at once produce failures that belong to neither. Reads, static checks and
drafting MDL are safe to parallelise; anything that writes is one lane.

## Session limits on a developer licence

A developer/trial runtime caps concurrent sessions — measured on this app, the 7th
live session was refused, and the runtime logged 60 refusals in one evening:

```
WARNING - Core: Maximum number of sessions exceeded! (You are currently using a trial license)
```

It reaches the browser as a sign-in that never completes, so it reads as a broken
feature rather than a licence limit. Everything counts towards the cap: each test
browser, each developer tab on the app, each CLI login, until it times out.

Credentials live in **`tests/credentials.env`**, not in `lib.sh` — the password is not
in the `.mpr` and `SHOW DEMO USERS` reports names and roles only, so nothing can
discover it. The **user** belongs there too: the canonical tests drive the staff
screens, and which role may open those is a per-app decision. Get it wrong and five
tests go red the moment security is switched on, all of them really saying "this user
cannot see the button".

```
TEST_USER=demo_collector
TEST_PASSWORD=SomePass12345
TEST_PASSWORD_demo_customer=OtherPass12345
```

A refused sign-in fails in about a second, quoting what the login page said, rather
than waiting out the 20s page timeout.

An app with `Security Level: Off` needs no file at all; if one is present anyway, the
first scenario says so rather than waiting 20s for a login page that cannot appear.

The harness covers its own share and names the rest:

- `open_app` signs the previous session out before signing in, so scripts take one
  session in turn rather than stacking.
- `lib.sh` signs out when the script ends, so a warm `--keep-open` browser does not
  hold one between runs. `KEEP_SESSION=1` keeps it, for poking at a page by hand.
- A failing scenario appends the refusal to its failure line when the runtime logged
  one in the last two minutes.
- `gate.sh` lists who is already signed in, and stops before running the suite if the
  runtime has just refused a session (`ALLOW_BUSY_SESSION=1` overrides).

If tests fail on sign-in anyway: close the app's browser tabs, or restart the runtime,
which clears every session at once.


## Data the tests leave behind

Every click commits: a browser test's data stays in the database. With `MDL_DB_RESET=session` in
`tests/harness.env` (the person's switch) the gate rolls the database back to the start of the
session after its first DONE (`bash tests/db-snapshot.sh status` says what is pending). Everything
written since goes back with it, so data the app itself needs belongs in its after-startup seed
microflow, never in a one-off `exec` or a test. A test still makes its own rows and asserts on them:
within a session the data piles up run after run.

**The suite passes on the app's clean seed.** Drop the database, boot, and every test is green
again -- or it was only passing on leftovers. So:
- a test that needs a state (an order numbered past 9999, a cancelled order, an overdue invoice)
  creates it itself, through the app, at its start; it never checks that the state is "already
  there" and fails when it is not;
- what the app itself needs (a reference table, an external table it reads, a fixed record) the app
  creates in its after-startup microflow, idempotently -- never a `.sql` file or a `psql` insert run
  by hand: a new database, a colleague's machine or a CI run will not have it;
- a fixture repaired by hand to make a red test green is the bug, not the fix.
