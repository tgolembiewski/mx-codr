# Project skills that are always in force

Six skills are installed in `.claude/skills/` that are **not** in the skill table
mxcli writes into `CLAUDE.md`. That table lists only mxcli's own skills; these are
this project's, and they apply on top of it. Load them with the Skill tool, before
the work, not after. Where the Skill tool does not list them, read the files one per
command: a combined `cat` of several skills crosses the tool-output limit and the
whole text is then read a second time from a saved file (54k characters for 47k).
The table says which one to load:

| When | Skill |
|---|---|
| Adding, changing or fixing **any** feature — a page, a button, a microflow, an action | `test-first-delivery` — the failing test comes first, and nothing is done until the whole suite is green |
| Creating a module, adding the first documents to one, or deciding which folder a document goes in | `module-structure` |
| Writing or changing any microflow, nanoflow or rule | `naming-and-captions` — a business `@caption` on every decision **and** every action (retrieve, create, change, commit, delete, call, show page, set), never the Mendix default |
| A second page, snippet or microflow that resembles an existing one | `reuse-and-snippets` |
| Moving documents between folders or modules | `organize-project` |
| Writing or altering any **page** or snippet | `spacing-and-layout` — two inline widgets side by side need `DesignProperties: ['Spacing': ['margin-right': 'S']]`; the gate's `layout` verdict fails without it |

Facts about this app come from one call, not from exploring by hand -- each of these
runs its lookups in parallel and answers in well under a second:

```bash
bash tests/orient.sh                            # structure, security, navigation, tests + covers, coverage, lint, app state
bash tests/diagnose.sh <Entity> <user>          # row counts, sessions, access rules, associations, runtime errors
bash tests/peek.sh '<menu item>' [widget]       # a page's visible text and console errors -- writes no test
```

To look at a page, use `tests/peek.sh` -- never a throwaway script or `verify-zz-*` test of your
own: it signs in, opens the menu item and prints what is on screen, and leaves nothing behind.

While you iterate, keep the app up in another terminal and run one script at a
time -- the suite is for the end, not the loop:

```bash
bash tests/gate.sh --boot-if-needed          # starts the app the way this project starts it
bash tests/gate.sh --only <feature>          # one script against the running app
```

`--boot-if-needed` is the portable way in. `./mxcli run --local --watch` gives a ~1s
hot reload where it works, but it deadlocks on some machines, and where the runtime
serves a built deployment there is no hot reload at all -- a model change is invisible
until a rebuild. On such machines the installer writes `tests/harness.env` with how
this project boots (`MDL_BOOT_COMMAND`); where the file is absent, `mxcli run` works
and nothing needs recording. Either way the gate is the one command that is right
everywhere, and `bash tests/gate.sh --restart` is the one way to restart the app when
the gate says the model changed after the runtime started. To stop it (before
`mxcli fix widgets`, say), `bash tests/gate.sh --stop` -- never a hand-written kill loop.
Never wrap a harness command in `timeout`: macOS has none (`timeout: command not found`), and
the gate, `--only` runs and the boot carry their own limits.

**Read `tools/mdl-checks/syntax-digest.md` once, before the first script.** `tests/orient.sh`
writes it from this project's own mxcli: the `Syntax:` blocks of the fourteen topics every
session otherwise looks up one call at a time (entities, associations, enumerations, module and
user roles, demo users, entity access, settings, modules, pages, page actions, snippets,
navigation, object operations) -- 22, 25 and 19 lookups in three measured sessions.

For anything else, `./mxcli syntax` with no argument lists every topic. After that, **ask for the leaf
topic directly and ask for everything you need in one command** -- each lookup costs
a whole round trip, and `syntax microflow` followed by `syntax microflow.create` is
two where one would do:

```bash
./mxcli syntax microflow.object-operations; ./mxcli syntax page.action; ./mxcli syntax navigation.create
```

**Do not probe syntax by writing variant files and running precheck on each.** One session
generated a dozen versions of the same statement into a temporary file and ran
`tests/precheck.sh` on every one. That answers the wrong question: precheck runs a full
`mx check` on a copy of the model and says whether the BUILD would break.
`./mxcli check <file> -p <app>.mpr --references` is the cheaper answer and a stricter one --
it also refuses names that do not exist (0.4s against a rebuilt precheck's seconds, measured).
Keep `tests/precheck.sh` for the script you are about to exec, which a hook runs for you.

What neither the digest nor `./mxcli syntax` says -- this harness's own rules:

```
DesignProperties: ['Spacing': ['margin-right': 'S', 'margin-bottom': 'S']]
  -- sides margin-|padding- top|right|bottom|left · values None S M L and NOTHING else
  -- two inline widgets side by side (label+button, button+button) collide without it;
  --   the gate's `layout` verdict fails on it. Never a Class: or custom CSS for spacing
datagrid dg (...) { column colStatus (attribute: "Status") { dropdownfilter fltStatus } }
  -- a data grid filters itself, one filter inside the column it belongs to: textfilter on a
  --   String, numberfilter on a number, datefilter on a date (FilterType: between for a
  --   range), dropdownfilter on an enumeration, and over an association
  --   dropdownfilter fltCustomer (Association: Mod.Order_Customer,
  --   datasource: database Mod.Customer, CaptionAttribute: Name). Boolean takes none.
  --   Never a filter bar of your own over a helper entity: lint rule UI001 fails on it
show message '{1}' type info|warning|error objects [$Obj/Name + ' saved'];   -- '{1}' is the slot, the
show message 'Plain text' type info;                                          -- list fills it
validation feedback $Obj/Attr message 'Name is required';   -- more: ./mxcli -c "HELP" | grep -A6 'show message'
```

Users who sign in (you, your customers, staff) need no login screen of your own. Two
sessions each lost 15-25 minutes building one -- a login microflow calling a
`System.Login` Java action that does not exist, grants on `Administration.Account`
that break the build, jar files unpacked in search of an API:

- **Security on is the whole login.** At `PROTOTYPE` or `PRODUCTION` level the
  runtime serves its own sign-in page (`login.html`); anonymous visitors land there.
- **Build at `PRODUCTION` from the first script** -- `alter project security level PRODUCTION;`.
  At `PROTOTYPE` Mendix checks page and microflow access and the read/write rights but
  **ignores the XPath constraint** on an access rule: row-level isolation is stored, passes
  `mx check` and lint, and lets every row through, so a test can go green on an app that
  leaks. The gate's `security` check fails below Production. Production costs one thing:
  every entity a page reads needs a rule for that role, or the page comes up empty.
- **A user is an `Administration.Account`** (it extends `System.User`) with a user
  role. Give each kind of user its own user role, and include `Administration.User`
  in it so the person can change their own password:
  `create user role Customer (Invoicing.Customer, Administration.User);`
- **Demo users are the seeded logins**, with their passwords set:
  `create demo user 'demo_customer' password 'Customer1234!' entity Administration.Account (Customer);`
  A password shorter than the project's policy fails the exec; an account committed
  without one fails at runtime with "The password cannot be empty".
- **Never grant your own module roles on `Administration.*` entities** -- an access
  rule takes only its own module's roles (build error CE0007). To show whose data
  is whose, link your entity to `Administration.Account` and constrain *your*
  entity's access rule with XPath on that association -- full association names,
  and the user token quoted `'[%CurrentUser%]'` (doubled quotes inside the MDL
  string). `CurrentUser()` and `$currentUser` pass `mxcli check` and fail the build
  with CE0161:
  `grant Invoicing.Customer on Invoicing.Invoice (read *) where '[Invoicing.Invoice_Customer/Invoicing.Customer/Invoicing.Customer_Account = ''[%CurrentUser%]'']';`
  The link itself goes to another module, so give it `ON DELETE SET NULL`: a PREVENT or
  RESTRICT rule on it builds and then stops the runtime at startup with `None.get`:
  `create or modify association Invoicing.Customer_Account from Invoicing.Customer to Administration.Account type Reference on delete set null;`
- **Creating accounts in the app:** reuse the Administration module's account pages
  (`SHOW PAGES IN Administration`); a change to them goes in `AdministrationExt`
  (skill: `module-structure`). Once users sign in, the menu ends with Log out
  (skill: `spacing-and-layout`).
- **Tests sign in as that user:** `export TEST_USER=demo_customer` before sourcing
  `tests/lib.sh`, and `TEST_PASSWORD_demo_customer=...` in `tests/credentials.env`.

Reserved words bite at build time, not at `check`. Quoting an identifier (`"Status"`,
`"Order"`) escapes the ~38 MDL parser keywords, but three names are reserved by the
Mendix platform itself and quoting does not help: **`Owner`, `Type`, `Default`** --
rename them (`Staff`, `ResourceType`, `Standard`). Three sessions in a row lost a boot
to a module role named `Owner` (CE7247); an attribute named `Type` fails MDL021, and
`CreatedDate`/`ChangedDate`/`ChangedBy` are the audit pseudo-types
(`owner: autoowner`), not ordinary attributes. Full list: `./mxcli syntax keywords`,
the detail in the `check-syntax` skill.

Never run `mx check` (or `./mxcli docker check`) straight at the project while the
app is up: it re-saves the `.mpr`, the `--watch` runtime rebuilds underneath the
suite, and a green feature turns red for no reason. `bash tests/gate.sh` runs the
same check against a scratch copy of the model, which is why the check belongs in
the gate and not in a command of its own. CLAUDE.md's `docker check` line is for a
project with nothing running. The one check to run *before* an exec is
`bash tests/precheck.sh <script>.mdl`: it applies the script to a scratch copy and runs
`mx check` there (~6s), so the CE errors `mxcli check` cannot see -- a reserved name,
an enumeration in a text box, a broken XPath or expression, a missing member -- come
out before the runtime stops for a rebuild that fails. It also catches a script that
would stop half-way (a demo user whose password the policy rejects, say), which on the
real model leaves it half-applied. Under Claude, Cursor and OpenCode a hook runs it
before every `mxcli exec` and blocks a failing one -- do not call it by hand there;
under Codex call it yourself. `MDL_PRECHECK=0` in tests/harness.env turns it off.
It sees what `mx check` sees. A Marketplace module whose version does not match the
project's Mendix version passes the precheck and fails the deployment build (CE4271);
the boot is the backstop for that one class, and a full build before every exec would
cost more than it saves.

Keep every `mdlsource/*.mdl` re-runnable -- `create or modify`, `create entity if not
exists` -- because `mxcli exec` stops at the first failing statement: a script that
fails on "already exists" never runs the statements after it, and the model is left
half-applied. After a failed exec, fix the script and exec it again rather than
patching the model by other means.

Never read or edit `mprcontents/` or the `.mpr` by hand (`strings`, `unzip`, a copied
`.mpr` as backup): the `.mpr` is only an index, and a hand-repaired unit breaks the
model in ways no check reports. `DESCRIBE` and `SHOW` read the model; MDL changes it.
When the build names an element but not the cause, the gate prints a hint for the
error code -- read that and the skill it names first.

Never debug by rerunning the whole suite. A test that passes alone and fails in the
suite is a test-isolation bug (sign-in identity, or data left behind) and is fixed in
`tests/lib.sh`.

"Done" for a feature is one command, reported as command output — it runs the suite,
`mx check`, lint, coverage, naming, layout and security, and ends in `DONE` or `NOT DONE`:

```bash
bash tests/gate.sh
```

`mxcli init` regenerates `CLAUDE.md`, `AGENTS.md` and `.claude/settings.json`; it
does not touch this file, `.claude/skills/` or `.claude/settings.local.json`, which
is why the project's own rules live here.

**Ask before any git command that writes.** `init`, `add`, `commit`, `checkout`,
`branch`, `merge`, `reset`, `stash`, `clean`, `push` -- every one of them waits for the
person to say yes, in this project and in any other folder. A session ran
`git init && git add -A` here on its own initiative and the folder was never meant to be
a repository. Reading is free: `git status`, `git log`, `git diff` whenever you need them.

When you record a decision in the project brain, carry what proved it -- the error
message, the command, the measurement. A captured "why" is read as settled fact by
every later session, and a wrong one stops the next person from looking; if the cause
is a guess, write it as one.

On Windows the harness runs under Git Bash or WSL2 and the binary is
`./mxcli.exe`; everything else here is unchanged.
