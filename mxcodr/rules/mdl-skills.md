# Project rules that are always in force

This project's own skills live in `.claude/skills/`, beside the mxcli skills `CLAUDE.md` lists.
Read **one** up front: `test-first-delivery`, before the first feature. The others are named
by the check that needs them -- a `layout` finding says `spacing-and-layout`, a `folders` finding
`module-structure` or `reuse-and-snippets`, a `naming` finding `naming-and-captions` -- and
each finding already carries its fix, so read a skill when a finding names it, one file per
command, not all of them at the start (measured: four skills read up front cost more context
than these rules and the syntax digest together, and the same findings came anyway).

Facts about this app come from one call, not from exploring by hand:

```bash
bash tests/orient.sh                            # structure, security, navigation, tests + covers, coverage, app state
bash tests/diagnose.sh <Entity> <user>          # row counts, sessions, access rules, associations, runtime errors
bash tests/peek.sh '<menu item>' [widget]       # a page's visible text and console errors -- writes no test
bash tests/film.sh --list | <name> | --all        # a video of a test's run; --all in the background (skill film-tests)
```

To look at a page, use `tests/peek.sh` -- never a throwaway script or `verify-zz-*` test of
your own. While you iterate, run one script at a time; the suite is for the end:

```bash
bash tests/gate.sh --boot-if-needed          # starts the app the way this project starts it
bash tests/gate.sh --only <feature>          # one script against the running app
bash tests/gate.sh --restart                 # the one way to restart; --stop the one way to stop
bash tests/gate.sh                           # "done" is this ending in DONE; --only ends in PASSED, never DONE
```

The gate boots, restarts and waits by itself: never boot the app or run `mxcli test` by hand.
Never wrap a harness command in `timeout` (macOS has none). Never hand-roll a wait for the app
or a reload (`sleep` before the gate is blocked). Microflow tests (`*.test.mdl`) are not run by
the gate and do not count for DONE; only `tests/verify-*.test.sh` do.

**What each check code wants, and its fix: `tests/checks/<step>.md`**, the file the gate names for the step that failed; `tests/CHECKS.md` says which file holds a code (layout codes such
as `USER01`, `NAV01`, `EDGE01`, catalog `UI001`, precheck `SCRIPT01`, `RUNTIME01`, `VIS01`). Each
rule is a card in `tests/rulebook/<CODE>.md` (level, exceptions: the person's, never yours). Read
that, never `tests/gate/*.sh` or the checkers: the page says in one line what a code requires.

**The syntax digest is already in your context** under Claude Code, Cursor, OpenCode and Pi
(anywhere else: `cat tools/mdl-checks/syntax-digest.md` once, after orient.sh). It holds the
topic indexes -- what `./mxcli syntax`, `syntax microflow`, `syntax page` list -- and the
pitfalls that cost sessions the most time, so go straight to the leaf: `./mxcli syntax
microflow.show-page`, several per command, never the index again.
**Do not probe syntax by writing variant files** and running precheck on each:
`./mxcli check <file> -p <app>.mpr --references` answers in 0.4s and writes nothing. Never `exec` a probe into the model (a session
left `ZZ_Probe1`..`3` behind). Keep `tests/precheck.sh` for the script you are about to exec:
under Claude, Cursor, OpenCode and Pi a hook runs it before every `mxcli exec` and blocks a
failing one -- do not call it by hand there; under Codex call it yourself. It applies the
script to a scratch copy and runs `mx check`, so build-only errors (reserved names, a broken
XPath, a missing member) and a script that would stop half-way surface first. Only a Marketplace
module built for another Mendix version gets past it (CE4271); the boot catches that one.
Never run `mx check` yourself while the app is up: it re-saves the `.mpr` under the suite.

What neither the digest nor `./mxcli syntax` says -- this harness's own rules:

```
DesignProperties: ('Spacing': ('margin-right': 'S', 'margin-bottom': 'S'))
  -- two inline widgets side by side collide without it (layout SPACE01); never Class: or CSS for spacing
layoutgrid pageGrid { row rowTop { column colTop (DesktopWidth: 12) { ... } } }
  -- everything on a page goes inside one layoutgrid, the Back / signed-in row too (EDGE01)
datagrid dg (...) { column colStatus (attribute: "Status") { dropdownfilter fltStatus } }
  -- a grid filters itself, one filter inside its column: textfilter, numberfilter, datefilter,
  --   dropdownfilter on an enumeration or over an association (dropdownfilter fltCustomer
  --   (Association: Mod.Order_Customer, datasource: database Mod.Customer, CaptionAttribute: Name)).
  --   Never a filter bar of your own over a helper entity (UI001); the column keeps its Attribute (GRID01)
show message '{1}' type info objects [$Obj/Name + ' saved'];   validation feedback $Obj/Attr message 'Name is required';
```

Users who sign in need no login screen of your own (two sessions lost 15-25 minutes building one):

- **Security on is the whole login**: at `PROTOTYPE` or `PRODUCTION` the runtime serves its own
  sign-in page (`login.html`). **Build at `PRODUCTION` from the first script**, `StrictMode: TRUE` -- `PROTOTYPE`
  ignores the XPath on access rules, so a test goes green on an app that leaks; the gate's
  `security` check fails below Production. Every entity a page reads then needs a rule for
  that role, or the page comes up empty.
- **A user is an `Administration.Account`** with a user role that includes `Administration.User`:
  `create user role Customer (Invoicing.Customer, Administration.User);`. Accounts are managed
  with the Administration module's own pages; a change to them goes in `AdministrationExt`.
- **Demo users are the seeded logins**, with a password the policy accepts:
  `create demo user 'demo_customer' password 'Customer1234!' entity Administration.Account (Customer);`
- **Never grant your own module roles on `Administration.*` entities** (CE0007). Link your
  entity to `Administration.Account` and constrain *your* rule with XPath on that link, full
  names, the token quoted -- `CurrentUser()` and `$currentUser` pass `mxcli check` and fail the
  build (CE0161):
  `grant read * on entity Invoicing.Invoice to Invoicing.Customer where [Invoicing.Invoice_Customer/Invoicing.Customer/Invoicing.Customer_Account = '[%CurrentUser%]'];`
  The link crosses modules, so `on delete set null;` -- a PREVENT rule on it stops the runtime at
  startup with `None.get`.
- The shape of a signed-in app -- Log out, a menu and home page per role, Users and My account,
  the signed-in user top right, Back top left, icons, one layout, `MyFirstModule` gone -- is
  what the `layout` check enforces: `tests/checks/layout.md` names each code and its fix, the skill
  `spacing-and-layout` has the snippets.
- **Brand colours or a logo:** skill `theme-styling` and `./mxcli theme` (`create`, `apply`). A
  colour set only in `custom-variables.scss` is overwritten by Atlas; the top bar logo is
  Atlas_Core's image, replaced from the theme (Atlas's `$brand-logo`), never inside that
  Marketplace module.
- **Tests sign in as that user:** `export TEST_USER=demo_customer` before sourcing `tests/lib.sh`,
  and `TEST_PASSWORD_demo_customer=...` in `tests/credentials.env`.

Three names are reserved by the platform and quoting does not help:
**`Owner`, `Type`, `Default`** -- rename them (CE7247 at boot; `./mxcli syntax keywords`, skill `check-syntax`).

Keep every `mdlsource/*.mdl` re-runnable (`create or modify`, `create entity if not
exists`): `mxcli exec` stops at the first failing statement and leaves the model half-applied;
after a failed exec, fix the script and exec it again. Each document is **created in one script
only** (precheck `SCRIPT01`), one `exec` per script by its own path. A new page or `ACT_`
microflow waits for its test (precheck `TEST01`): write the test first, then exec. Never read or edit `mprcontents/`
or the `.mpr` by hand: `DESCRIBE` and `SHOW` read the model, MDL changes it. A test that passes
alone and fails in the suite is a test-isolation bug, fixed in `tests/lib.sh`, never by rerunning
the suite.

**`tests/harness.env` is the person's.** So are the harness's own files: a hook blocks
editing them and setting a gate switch inline. When a check stands in your way, meet it or
report it.

**Ask before any git command that writes** (`init`, `add`, `commit`, `checkout`, `branch`,
`merge`, `reset`, `stash`, `clean`, `push`), here and in any other folder; reading (`git status`,
`git log`, `git diff`) is free.

When you record a decision in the project brain, carry what proved it -- the error message, the
command, the measurement; a guess is written as one. On Windows the binary is `./mxcli.exe`;
everything else here is unchanged.
