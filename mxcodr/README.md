# mxcodr — the installable bundle

Everything a Mendix project needs to pick up this repo's skills, lint rules and
checkers. `install.sh` copies it into a project; this file explains how the payload
is rebuilt when the sources change.

Deliberately **not** documented in `CLAUDE.md` or `AGENTS.md`: mxcli regenerates
both on `mxcli init`, so anything written there is lost on the next tooling update.

## What is in here

```
install.sh        copies the payload into a Mendix project; the entry, ~90 lines -- it sources
install/          the rest in order: 8 files of helpers (ui, prereqs, postgres, docker, windows,
                  mxcli, studio_pro, toolchain), then the steps (target, step_prereqs, step_app,
                  step_skills, step_hosts, step_harness, summary). Its header lists which is which
bootstrap.ps1     Windows only: gets Git Bash, Python and Node, then hands over to install.sh
VERSION           date-based version, copied to tools/mdl-checks/VERSION in the target
MXCLI_TESTED      the mxcli build this bundle was verified against; orient.sh warns when the
                  project's ./mxcli is older
rules/            mdl-skills.md (Claude, OpenCode, and Pi through its extension) and
                  mdl-skills.mdc (Cursor) — the always-loaded rule
hooks/            host-specific prompt/PostToolUse adapters plus the Codex and Cursor gates; each
                  runs on its own, so each carries a copy of mdl_find_python from portable.sh
plugins/          mendix-mdl-harness.js (OpenCode) and mendix-mdl-harness.pi.js (Pi) -- the same
                  three jobs as the hooks, in each host's own event API
tests/            gate.sh + gate/ (app, checks, hints, preflight, tests), precheck.sh, orient.sh,
                  diagnose.sh, peek.sh, lib.sh + lib/ (timeout, sessions, scenario, results),
                  portable.sh, scenario-helpers.js, run-app.sh (Windows), run-docker.sh (Docker
                  mode) — the harness, upgraded in place on every install.
                  gate.sh is the done gate: tests, mx check, lint, coverage, naming, layout and
                  security, then warnings (rendered pages, server errors). precheck.sh is what the hooks run before an exec; orient.sh and
                  diagnose.sh gather facts in parallel; peek.sh looks at a page without a test;
                  portable.sh holds what differs between platforms and the environment checks
                  every script shares
.gitattributes    forces LF on *.sh and *.py — copied only if the project has none
examples/         8 verify-*.test.sh from the demo app — NOT installed; a project's tests
                  are written by whoever builds the feature
skills/           6 × SKILL.md — the prose (test-first-delivery with a reference/ of three)
lint-rules/       3 × *.star — MOD001, REU001, UI001 — run by `mxcli lint`, no Python needed
checks/           *.py + fixtures/ — the checks Starlark cannot express, gate_helpers.py
                  for the gate's JSON and digests; check_layout.py is the entry of the layout
                  check and its rules are in layout_rules/ (one module per area of a page,
                  listed at the top of check_layout.py), plus
                  record_install.py, which writes tools/mdl-checks/INSTALL.json (version,
                  date, sha256 per installed file) so the gate can tell a project running
                  last week's checkers from one running these
```

The payload is a **copy** of files that live elsewhere in this repo. This directory
is the shipping container, never the place to edit:

| In `mxcodr/` | Source of truth |
|---|---|
| `skills/<name>/SKILL.md` | `.ai-context/skills/<name>/SKILL.md` |
| `lint-rules/*.star` | `.claude/lint-rules/*.star` |
| `checks/*.py`, `checks/fixtures/` | `tests/skills/` |
| `rules/`, `hooks/`, `plugins/`, `tests/`, `skills/spacing-and-layout/` | authored here; no other copy in the repo |

**Finding your way in a long script.** No script is longer than about 500 lines. Where one grew
past that it became an entry plus parts: `install.sh` + `install/`, `tests/gate.sh` +
`tests/gate/`, `tests/lib.sh` + `tests/lib/`, `checks/check_layout.py` + `checks/layout_rules/`.
The entry keeps the name everything calls, starts with a map of its parts, and sources or
imports them in order; each part starts with two lines saying what it holds and who reads it.

## Why the suite is written as one scenario per test

`playwright-cli` costs ~0.66s per invocation, before any browser work. The old
suite made ~25 of them per test and took **2m19s green, 8m55s red**. Each test now
runs its whole flow in a single `playwright-cli run-code` process and asserts
against the database with `mxcli oql` (~0.03s per query):

| | Before | After |
|---|---|---|
| Suite, green | 2m19s | **15s** |
| Suite, red | 8m55s | **22s** |
| One test | 8–36s | **1–3s** |
| Scripts | 10 | 8 (same coverage: 10/10) |

`install.sh` never overwrites a `verify-*.test.sh` or `credentials.env`, so an app
that already has tests keeps every one of them. The harness scripts -- `gate.sh` and
`tests/gate/`, `precheck.sh`, `orient.sh`, `diagnose.sh`, `peek.sh`, `lib.sh`, `portable.sh`
and `scenario-helpers.js` -- are the bundle's own and *are* replaced on each install: a
fix in `gate.sh` that never reaches an installed project is not a fix.

## Why rules and hooks, not generated agent files

`mxcli init` **overwrites** `CLAUDE.md`, `AGENTS.md` and `.claude/settings.json` —
measured, not assumed: markers written into all three were gone after one
`./mxcli init`. The same test showed `.claude/rules/`, `CLAUDE.local.md` and
`.claude/settings.local.json` survive untouched.

So the project's own instructions live where mxcli does not reach:

- **`.claude/rules/mdl-skills.md`** — loaded into every session at launch, same
  priority as `.claude/CLAUDE.md`. It names the six skills and when each applies,
  because mxcli's generated `CLAUDE.md` skill table lists only mxcli's own skills
  and an agent that follows that table never sees these.
- **`.claude/settings.local.json`** — registers Claude's two hooks.
- **`.codex/hooks.json`** — registers the Codex equivalents plus a `Stop` gate.
  Codex discovers the six `.agents/skills/` copies automatically. Project hooks
  require project trust and one review through `/hooks`; Codex asks again whenever
  a hook definition changes.
- **`.opencode/plugin/mendix-mdl-harness.js` and `opencode.json`** — OpenCode has no
  exit-code contract and no follow-up field; its hook payloads are mutable instead,
  and its SDK client can submit a message into the session. Rules load through
  `opencode.json`'s `instructions` glob rather than `AGENTS.md`, which mxcli
  regenerates. Both `.opencode/plugin/` and `.opencode/plugins/` are accepted;
  the singular is used.
- **`.cursor/hooks.json` and `.cursor/rules/mdl-skills.mdc`** — Cursor reads neither
  `.claude/rules/` nor `.ai-context/skills/`, so the same rules are installed in its
  own shape: an `alwaysApply` `.mdc` rule, plus three hooks. All three wire formats
  differ from the other hosts, which is why it gets its own adapters rather than
  sharing Codex's.
- **`.pi/extensions/mendix-mdl-harness.js`** — Pi discovers skills from `.agents/skills/` on
  its own; the hooks and the rules come from one extension. The rules go into the system prompt
  on `before_agent_start`, because on Pi 0.87.1 a `.pi/AGENTS.md` never reached the model -- only
  the root `AGENTS.md` did, which mxcli regenerates -- and the session that never saw the rules
  ran `git init` and a commit unasked. An earlier install's `.pi/AGENTS.md` is removed. Pi asks
  for project trust before it runs an extension from the project directory (`pi --approve` for
  one run).
- **`.codex/config.toml`** — receives a short `developer_instructions` block that
  asks Codex to remind the user about `/hooks` after the first prompt. This has to
  live outside the hook: a hook awaiting trust cannot remind the user to trust it.
  If the project already defines `developer_instructions`, the installer preserves
  it and prints a notice instead of replacing it.

The three hosts with shell hooks — Claude Code, Codex and Cursor — are registered the
same way: `bash tools/mdl-checks/hooks/<x>.sh`, project-relative. OpenCode and Pi load a
plugin instead, which calls the same scripts. Codex used to get `bash "$(git rev-parse --show-toplevel)/…"`, which
only expands if the host runs hook commands through a POSIX shell; the three Codex
scripts resolve the repo root themselves, so the registration never needed it. An
upgrade replaces the old entry rather than adding a second one, and Codex asks for
`/hooks` trust again because the definition changed.

Both registrations are merged rather than replaced, so a developer's existing
Claude settings and project-specific Codex hooks survive installation. The hook
scripts live together in `tools/mdl-checks/hooks/`; separate PostToolUse adapters
preserve the hosts' different output contracts.

The six `.agents/skills/` copies are self-contained except for links to standard
mxcli guidance such as `test-app` and `overview-pages`. Those links explicitly
resolve through `.ai-context/skills/`, where `mxcli init` installs the canonical
versions, instead of assuming Codex has duplicate sibling skills under `.agents/`.

The hooks are the part that does not depend on the model choosing to comply:

| Hook | Fires | Does |
|---|---|---|
| `remind-skills.sh` | every Claude user prompt | adds one line of context naming the skills and what "done" means |
| `remind-skills-codex.sh` | every Codex user prompt | gives the same rule using Codex's `$skill-name` invocation syntax |
| `before-mxcli-exec.sh` | before a Claude Bash call containing `mxcli exec <script>.mdl` | runs `tests/precheck.sh` (the scripts applied to a scratch copy of the model, then `mx check` there, ~3-5s, and nothing at all when the same scripts already passed) and blocks the exec with the `[error]` lines when it would break the build -- the CE errors `mxcli check` cannot see |
| `after-mxcli-exec.sh` | after a Claude Bash call containing `mxcli exec` | runs coverage and reports only a failure on stdout |
| `after-mxcli-exec-codex.sh` | after a Codex Bash call containing `mxcli exec` | adapts coverage failures to Codex's exit-2 feedback contract and marks the session as requiring the full gate |
| `stop-gate-codex.sh` | when that Codex session tries to finish | runs `bash tests/gate.sh`; exit 2 continues the turn until the positive `DONE — every check passed` line appears |
| `remind-skills-cursor.sh` | Cursor `sessionStart` | returns `additional_context` — Cursor's `beforeSubmitPrompt` can only allow or block a prompt, it cannot inject |
| `before-mxcli-exec-cursor.sh` | Cursor `beforeShellExecution` | the same precheck; answers `permission: deny` with the errors as `agentMessage` |
| `after-mxcli-exec-cursor.sh` | Cursor `postToolUse` | returns coverage failures as `additional_context` — `afterShellExecution` sees the command but cannot answer the agent — and writes the marker |
| `stop-gate-cursor.sh` | Cursor `stop` | runs the gate and returns its output as `followup_message`, auto-submitted as the next user message; `loop_limit` caps the retries |
| `plugins/mendix-mdl-harness.js` | OpenCode `chat.message`, `tool.execute.before`, `tool.execute.after`, `event(session.idle)` | one plugin doing all four: runs the precheck before an exec and throws to abort a failing one, appends the rules to each user message, appends coverage failures to the tool output the model reads, and on idle runs the gate and submits its output through `client.session.prompt` (capped at 3 rounds) |
| `plugins/mendix-mdl-harness.pi.js` | Pi `before_agent_start`, `tool_call`, `tool_result`, `agent_before_settle` | the same three jobs in Pi's own API: `tool_call` returns `block: true` with the precheck output as `reason`, `tool_result` appends the coverage failures to what the model reads, and `agent_before_settle` runs the gate and returns `continue: true` so a red gate becomes the next turn (capped at 3 rounds). `before_agent_start` appends `.claude/rules/mdl-skills.md` to the system prompt, once per run; the skills come from `.agents/skills/`, which Pi discovers on its own |

### A red gate ends with what still blocks DONE

Sessions read the gate through `tail -3`, `tail -25` or a `sed … | head`, and each of those cut
off either the verdict or the details under it; after a compaction a session had neither and
spent an hour rediscovering what was left. Every red run now ends with each failed check, how
many findings it has and up to five of them with their fix, and the verdict again as the very last
line:

```
== still blocking DONE
   naming: 8
     - [loop-annotation] line 796: loop without @annotation -- put @annotation '<why it repeats>' on the line above: while $MonthBack >= 0
     - …four more…
     ... 3 more under == naming above
   layout: 1
     - [NAV01] line 0: navigation profile Responsive: users sign in, but its menu has no way to log out -- add `menu item 'Log out' sign_out …`
   NOT DONE — failed: naming layout
```

Every naming finding carries its fix after ` -- `, as the layout ones already did: a session that
could not tell what `loop-annotation` wanted opened `check_mdl.py` to find out.

### What the gate says about tests that never failed

A full `bash tests/gate.sh` lists every `verify-*.test.sh` with no recorded red run in
`.mxcli/red-first/`: a test written after the code it checks has never been seen to fail, and may
assert nothing. It is a warning under the verdict, not a failure. Either break what the test checks
once and watch that one test go red (`bash tests/gate.sh --only <feature>` records it), or list the
test in `MDL_ALLOW_GREEN_FIRST` in `tests/harness.env` when it is green by nature, such as a
seeding reset.

Each boot empties `.mxcli/gate-boot.log` and keeps the one before it as
`.mxcli/gate-boot.prev.log`, so a failure that a later boot overwrote can still be read.

### Looking at a page without writing a test

`bash tests/peek.sh 'Invoices' [widget]` signs in, opens that menu item and prints the page's
visible text and console errors. It writes no test file, claims no coverage and records no
red-first run -- the scratch `verify-zz-*.test.sh` two sessions wrote for this left a
"went green without ever being red" record behind every time.

A peek at the page a user already lands on (their home page) no longer fails as "clicked menu …
but nothing happened": for a look that means "already there". Signed in as a user with no
password in `tests/credentials.env`, the error names the user and peek lists the users that do
have one. And a gate check that stops without writing why is no longer a bare "could not run": the
gate says the fault is in the harness, not in the project, after a session spent many steps
taking the gate apart to find a fault of its own.

A scenario that ends without a `return` now says so ("returned nothing -- end the scenario body
with a return"), instead of "produced no result ... needs: playwright-cli open", which sent a
session to the browser. The `sleep` block covers a hand-rolled wait on `.mxcli/gate-boot.log` or
`runtime.log` too, not only one in front of `tests/gate.sh`.

With `mxcli run --watch`, the gate now waits until the boot log has been quiet for a few seconds
after its last "applied" line, and until the app actually serves the web client that
`index.html` names. Several execs in a row rebuild one after another, and a gate that started in
the gap between two builds ran the suite into a restart that was re-bundling the client (404 on
`dist/index.js`); every test in that window failed. The USER01 and BACK01 messages are now one
line each with the code to paste, after a session read `check_layout.py` three times to
understand them.

The wait also ends where there is nothing to wait for. Right after `tests/gate.sh --restart` the
boot log ends with "Watching model ... (serving build #1)" rather than "applied", and every gate
sat out the full two minutes before its first test. And when a `--watch` rebuild fails, the gate
now stops at once and names the error (`CE0116 ... (Page 'X', Action button 'y')`): before, it
waited two minutes, then tested the model from before the exec, and a session took a fix that
never reached the app for a fix that did not work.

A `# covers:` list wrapped over several `#` lines now counts every line of names, not the first
only: a session saw its new flows reported untested until it joined the list by hand. BACK01
leaves alone a page that is a menu item or a home page, even when a flow shows it again (back to
My Orders after placing an order): the menu is its way back, and a session deleted the flow's
`show page` to quiet the rule. And `oql` writes each entity after FROM or JOIN as
`Module."Entity"` (`"Order"` gets `$MODULE`), and when mxcli still refuses a query it shows how an
entity and an association are written: a session spent five queries on "'Order' is not a valid
entity path".

A microflow debugger left on (`mxcli debug enable`) stops the gate before the tests: a test that
reaches a breakpoint waits there until its timeout, and every `--watch` rebuild fails with CE0116
"Could not check expression" while it is on. A failed rebuild says so too, and a session had
taken that CE0116 for a hiccup of the build. Both say `./mxcli debug disable`.

After an `mxcli exec` the hook's first line says whether it applied (`exec: applied` or
`exec: FAILED`), read from the exec's output, which the OpenCode and Pi plugins pass on too. A
session piped exec through `grep -ci error`, counted the "0 errors" of mxcli's summary, and ran a
clean script again twice. `diagnose.sh` takes the entity with or without its module
(`Order` or `Sales.Order`; the second asked for `Sales.Sales.Order`). The syntax digest adds
`page.datasource` (a list inside a data view, over an association or from a microflow), after a
session guessed `page.datagrid` and `page.widgets.datagrid`, and it is written again when its
topic list changes, not only when mxcli does.

### How the pages look

The gate looks at the rendered page, not only the MDL. At the end of every test, `look()`
in `tests/scenario-helpers.js` measures the page the test left open: two unrelated widgets that
overlap by 4 px or more (`VIS01`), a page that scrolls sideways (`VIS02`), text cut off
(`VIS03`). The gate names the page from the widget names in `mdlsource/` and lists each problem
once under `== warnings`. The layout check adds `ALERT01`: a box class (`alert`, `card`, `well`)
on a `dynamictext`, which renders inline and draws its box over the line below. A cancellation
notice did exactly that on an order page and the gate said DONE.

`EDGE01` (an error) fails a page on an Atlas_Core layout that has a widget outside a
`layoutgrid` at its top level. Those layouts add no side margin, so the heading sat against the
menu and the signed-in name ran off the right edge: a session had built its title and its Back /
signed-in row straight on the page, copying the skill's own example, which now sits in the grid.
The rule looks inside the snippets a page calls; pop-ups and pages on the project's own layouts
are not judged.

With `MDL_VISUAL_REVIEW=agent` in `tests/harness.env` (for a model that reads images), `look()`
also saves a screenshot per page. The gate writes `.mxcli/visual/review.md` with a fixed list of
questions, and asks the agent to read each PNG and write `verdicts.json`: approve or reject, an
answer to every question, and a fix. A verdict is keyed on the screenshot's sha256, so a changed
page is asked again (`LOOK01`); a rejection repeats its fix (`LOOK02`).

All of these are warnings for now: they do not block DONE. `MDL_VISUAL=error` makes them
block, `MDL_VISUAL=0` turns them off.

### What the server logged while the suite ran

The gate records when the suite starts and lists every distinct `ERROR`/`CRITICAL` line the
runtime logged after it (`RUNTIME01`), leaving out what a client re-bundle or a restart logs on
its own. A page action that throws shows the user a generic dialog, and a test that does not look
for the dialog passes. It is a warning for now; `MDL_RUNTIME_ERRORS=error` makes it block DONE,
`=0` turns it off.

### Microflow tests are named, not run

`mxcli test --local` boots its own runtime on port 8081, where the harness's app runs, so the gate
does not run `*.test.mdl`. When there are any, the summary names how many and the three commands
that run them (stop the app, `mxcli test --local`, boot again -- even when a test fails; on a
project booted with `MDL_BOOT_COMMAND`, a pointer to the test-microflows skill instead).

### The syntax every session looks up

Three measured sessions asked `./mxcli syntax <topic>` 22, 25 and 19 times each, one topic per
round trip, and mostly the same fourteen topics: entities, associations, enumerations, module
and user roles, demo users, entity access, settings, modules, pages, page actions, snippets,
navigation and object operations. Their `Syntax:` blocks go into one digest (about 17 kB) made
from the project's own `./mxcli`, so it matches the version; its first line records which one,
and it is written again when the version changes.

A file the agent is told to read was not enough -- a fourth session listed the digest's table of
contents and still asked 165 times -- so the digest now goes where each host loads instructions
by itself: `.claude/rules/mdl-syntax-digest.md` (Claude Code), `.cursor/rules/mdl-syntax-digest.mdc`
(Cursor, `alwaysApply`), `opencode.json`'s `instructions` (OpenCode), the system prompt the Pi
extension extends (Pi); under Codex the rules say to `cat` it once. The installer writes it --
Claude Code reads `.claude/rules/` only when a session starts -- and `tests/orient.sh` keeps it
current (`mdl_syntax_digest` in `portable.sh`). The rules file keeps only what no `syntax` topic
says: the spacing, grid-filter and message rules that are this harness's own.

### What `tests/precheck.sh` does and does not catch

Before every `mxcli exec` a hook applies the scripts to a scratch copy of the model and runs
`mx check` there (~3-5s; `--no-update-widgets`, retried the slow way only on CE0463), so a reserved name, an enumeration in a text box, a broken XPath or a
missing member surfaces before the runtime stops for a rebuild that fails -- and so does a script
that would stop half-way and leave the model half-applied. It does **not** see what only the
deployment build sees: a Marketplace module whose version does not match the project's Mendix
version passes the precheck and fails the build (CE4271). `MDL_PRECHECK=0` in `tests/harness.env`
turns the whole thing off.

When a script fails to apply at all, precheck prints the errors themselves -- the `✗` lines, a
`Parse error:` or an `Error:` line, at most fifteen -- and then the verdict; a `tail` of mxcli
0.24's output kept only its six-line summary and showed "33 error(s) above" with nothing above it.

It also refuses a script that creates a document another script in the same folder creates too
(`SCRIPT01`): whichever of the two runs last decides what the page is, so re-running the earlier
one undoes the later one without any error. In a Pi session `Order_Detail` was created in two
scripts, a re-run put back the page without its PDF button, and the model spent 25 steps looking
in the runtime. An exec that names its script through a variable (`for f in …; do mxcli exec
mdlsource/$f.mdl`) is blocked by the hooks and plugins, because precheck would receive a literal
`$f` and check nothing. And `gate.sh --only` / `--tests-only` end in `PASSED — … -- not DONE`:
a single passing script once printed the same DONE line as the full gate while the suite was red.

Under the errors it prints a one-line hint per error code, from `tests/gate/hints.sh` -- the same
hints the gate prints for a failed boot. They earn their place by having cost a session time:
twenty-six `CE2729` lines in one precheck were a single missing pair of grants, and now say so.
Precheck is for the script about to be exec'd; a syntax question is answered by
`./mxcli syntax <topic>` or `./mxcli check <file> -p <app>.mpr --references`, not by running
precheck on variants.

### Booting clears this project's own leftovers

`bash tests/gate.sh --boot-if-needed` stops whatever of this project is still running before
it boots, when nothing answers on the app port. A half-dead run can hold the admin API (8090)
or mxbuild's port (6543) while the app port is free, and the boot then dies on
"is already in use" -- measured once as three and a half minutes and a false NOT DONE.
Processes are matched on the project path followed by a separator, so a stop in
`.../InvoiceB2B` leaves `.../InvoiceB2BOpus5.5` alone; an unanchored match once killed it.

### The gate requires Production security

The `security` check fails the gate at any level below Production. At Prototype Mendix checks page
and microflow access and the read/write rights but **ignores an access rule's XPath constraint**, so
row-level isolation is stored, passes `mx check` and lint, and lets every row through. The failure
names the entities whose constraints are doing nothing and prints the shape that works (link to
`Administration.Account`, constrain every entity the role reads, give every entity a rule, prove
both directions in a test). `MDL_REQUIRE_PRODUCTION=0` in `tests/harness.env` is for an app that
deliberately has no users at all.

## Rebuilding after a source change

Fifteen files here have a second copy in the repo: five skills in
`.ai-context/skills/` and the three reference files of one of them, three lint rules in
`.claude/lint-rules/`, and the naming and coverage checkers plus their two fixtures in
`tests/skills/`. Both copies get edited,
so a plain copy can go either way. One did: on 2026-09-13 four `mxcodr/` files were
newer than their sources, and the copy block that used to be here would have rolled
them back without a word.

Bump `mxcodr/VERSION` first (`YYYY.MM.DD.N`), then run from the repo root:

```bash
bash tests/skills/rebuild-mxcodr.sh --check   # report only
bash tests/skills/rebuild-mxcodr.sh           # copy what is safe, record the result
```

The script compares each pair with its hash at the last sync, recorded in
`tests/skills/.mxcodr-sync.sha256`. A changed source is copied into `mxcodr/`. A `mxcodr/`
file edited directly is refused, with the `cp` that brings it back to the source.
When both sides changed, it refuses and asks you to decide. Nothing is copied unless
every pair is safe.

`rules/`, `hooks/`, `plugins/`, `tests/`, `checks/check_layout.py`,
`checks/gate_helpers.py`, `checks/record_install.py` and `skills/spacing-and-layout/`
have no copy in the repo. They are authored here, in `mxcodr/`, and nothing overwrites them.

The harness's own regression tests need no app and run in about thirty seconds:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 tests/performance/audit.py
```

## Testing the bundle before shipping it

Never test against a real project — install into a throwaway copy, with the skills
and checkers stripped out, so nothing passes because it was already there:

```bash
W=/tmp/install-target
rm -rf "$W" && mkdir -p "$W"
rsync -a --exclude deployment --exclude .git --exclude .mendix-cache \
      --exclude mxcli --exclude mxcli.linux --exclude tests \
      ~/CloudeCodeProjects/InvoiceDesk/ "$W/"
ln -s ~/CloudeCodeProjects/InvoiceDesk/mxcli "$W/mxcli"
rm -rf "$W"/.claude/lint-rules/mod001_*.star "$W"/.claude/lint-rules/reu001_*.star \
       "$W"/.claude/lint-rules/ui001_*.star "$W"/tools

bash mxcodr/install.sh "$W"
```

Then confirm the installer claims:

```bash
cd "$W"
ls .claude/skills .agents/skills .ai-context/skills          # 6 in each
diff -r .claude/skills/module-structure .agents/skills/module-structure
python3 -m json.tool .codex/hooks.json >/dev/null             # Codex hooks merged
ls .pi/extensions/                                            # Pi extension (rules included)
python3 -c 'import tomllib; tomllib.load(open(".codex/config.toml", "rb"))'
./mxcli lint -p InvoiceDesk.mpr | grep -E 'MOD001|REU001|UI001'  # rules load and fire
python3 tools/mdl-checks/check_test_coverage.py . InvoiceDesk
./mxcli init --sync-skills . && ls .agents/skills            # survives an mxcli sync
```

That last line is the one that matters most: it proves an mxcli upgrade does not
delete skills mxcli never shipped.

## Running it

Run it from the mx-codr clone. It asks for the Mendix project folder, with the folder you
are in as the default, copies `mxcodr/` into the project and installs there:

```bash
bash mx-codr/mxcodr/install.sh --with-deps          # asks
bash mx-codr/mxcodr/install.sh ~/Apps/MyApp          # named
cd ~/Apps/MyApp && bash mxcodr/install.sh            # again, from the copy in the project
```

It never installs into the clone or the bundle: the repo root carries `.mx-codr-repo`, and
a target inside either is refused. With no terminal to ask, it needs the folder named, or
must be run from inside an app (a `*.mpr` in the current folder). `bootstrap.ps1` asks
the same question before its winget stage. It used to guess "the folder above the bundle",
which was the clone itself when the repo was cloned.

`--no-app` declines app creation; `--help` lists the arguments, `MX_VERSION` and
`APP_NAME` override what gets created.

It never stops without saying why: an unexpected failure prints the file, line and command
it stopped at.

## Local mode and Docker mode

The installer asks which one; the answer is `MDL_RUN_MODE` in `tests/harness.env`, and a
re-run offers it again. `MDL_RUN_MODE=local|docker` answers without asking; with no terminal
the default, local, is taken.

**Local (the default).** The runtime runs on the computer through `mxcli run --local` (on
Windows `tests/run-app.sh`, since `run --local` cannot boot there), with a local PostgreSQL.
A model change is live in about a second through `--watch`. The installer sets PostgreSQL up
and writes `MDL_DB_*`, `MDL_MXBUILD_PATH` and, on Windows, `MDL_BOOT_COMMAND`. `mxcli run
--local` is PostgreSQL-only; where PostgreSQL runs but no login works, the installer asks for
a superuser once, creates the `mendix` role and the app's database, and stores only the app's
own credentials.

**Docker.** The runtime and its database run in containers (`mxcli docker run`), started by
`tests/run-docker.sh`:
- every port is shifted by `APP_PORT-8080` (8081, admin 8091, database 5433);
- each app gets its own containers and database volume (`COMPOSE_PROJECT_NAME`, from the
  app's folder); mxcli alone names every stack `docker`, so all apps shared one;
- the runtime log is followed into `.mxcli/runtime.log`;
- `gate.sh` rebuilds and restarts the app before the tests whenever the model changed, about
  40 s, and `--stop` removes the containers. A model reload alone (`mxcli docker reload`,
  about 25 s) was measured to miss a new attribute, so the gate always restarts;
- the first start downloads images and takes about a minute, and Docker Desktop must be
  running whenever the app does.

Measured on the same app: local mode, a model change live in about 1 s; Docker, about 40 s.

Neither mode puts `mx check` in a container: `mxcli docker check` runs `mx` from Studio Pro
or a cached mxbuild, whatever its name says. So on Windows Studio Pro is needed in both
modes, and `mx check` runs at the installed version.

`tests/harness.env` can hold a database password. Like `tests/credentials.env`, it stays out
of any repository you push.

## Faster without being weaker

A 36-minute agent session was recorded end to end (`docs/sessions/` in the source
repo) and 20 of those minutes were inside tools. Two harness defects manufactured
most of the waste, and neither was about the tests being slow:

- **`mx check` rewrote the `.mpr`** it checked -- bytes identical, mtime new. Under
  `mxcli run --watch` that mtime is the reload trigger, so the gate's own check
  restarted the runtime in the middle of its own suite: a red test with no cause,
  then a false "model changed after the runtime started" warning, then two
  hand-rolled restarts. `check_mx` now runs on a scratch copy (`.mpr`,
  `mprcontents/`, `widgets/`, `theme/`, `themesource/`; an APFS clone, ~0.2s) and
  never touches the live tree. Measured on the same app, same runtime: the old gate
  triggered `Change detected, rebuilding (build #2)` every run; the new one does not.
- **A test run by hand had no timeout.** `bash tests/verify-x.test.sh` hung for 801s
  once and 1141s once in that session. `lib.sh` now carries its own watchdog
  (`SCRIPT_TIMEOUT`, 5s before the runner's kill), which ends the stuck
  `playwright-cli` process too -- the runner's SIGKILL of bash left it holding the
  shared browser, so the *next* test hung the same way.

The rest is the suite itself, all of it behaviour-preserving:

| | Before | After | How |
|---|---|---|---|
| Suite of 10, green | 29.1s | **14.7s** | one sign-in per run instead of one sign-out and sign-in per test (`MDL_SESSION_REUSE`, set by the gate; `FRESH_SESSION=1` restores); the sign-out moved into the scenario's own `finally` instead of a second process; `await_message(/text/)` instead of `waitForTimeout(1500)` |
| `--only` iteration | 1.8s | **1.0s** | the session stays signed in between runs (`KEEP_SESSION`) |
| Full gate, nothing changed | 17s | **~15s** | the four model checks replay their last green result (`.mxcli/gate-cache/`, keyed on the model's size+mtime and each check's inputs; a failure is never cached; `--no-cache`) |
| Every Bash tool call | +0.05s | **+0.006s** | the coverage hook tests the raw event for `mxcli exec` before it goes looking for a Python |

Three more things the session showed and the harness now answers:

- `bash tests/gate.sh --restart` stops this project's runtime -- the process tree
  under `mxcli run`, so mxbuild and the Java runtime go with it -- boots it again
  and runs the gate. The stale-model warning names it.
- The first red `--only` run of a script is recorded in `.mxcli/red-first/`. A
  script that goes green with no such record is named once, and that is the only
  test worth breaking the feature for. The session had broken every feature for
  every test (15 minutes) and learned nothing the red runs had not already shown.
- `field` prints JSON booleans as `true`/`false` (it printed Python's `True`, so a
  test comparing against `"true"` could never pass); `fields` reads several keys in
  one process.

## The skill list is fixed when the session starts

An agent's Skill tool lists what existed when its session began. Install into a
directory whose session is already open and the skills land on disk but not in that
list, and the agent cannot invoke them — it is told not to guess names.

Measured, same prompt, same machine, two sessions:

| | session restarted after install | installed mid-session |
|---|---|---|
| commands before the first real one | 8 | **36** |
| time before the first real one | 2m13s | **6m30s** |
| skill text read | 3 skills, via the Skill tool | **twelve SKILL.md files, 216k characters, by `cat`** |

Without the list the agent has no map, so it reads everything it can find —
including `bootstrap-app`, which is for a repo with no `.mpr` at all. The installer
now says this in its closing notes, and the per-prompt reminder hook carries the
fallback: if the Skill tool does not list them, read exactly the three named files
and look syntax up on demand rather than sweeping the directory.

## Canvas geometry is mxcli's job, not ours

A screenshot of a reset flow in Studio Pro: one row of 17 activities running 2400px
off the right of the screen, and two loops drawn as enormous empty rectangles with
their delete activity adrift below them. mxcli had authored it correctly -- `mx check`
0 errors -- so `check_mdl.py --skill naming` grew three geometry rules: `flow-width`
(over 1600px), `loop-box-empty` (under 8% of the box filled) and
`overlapping-position` (two activities at one point). Each told the session to write
better `@position` values by hand.

**All three are gone** (2026-09-22). mxcli now lays a microflow out itself
([mendixlabs/mxcli#1154](https://github.com/mendixlabs/mxcli/issues/1154)): the main
line wraps onto rows past two canvas widths, a guard's branch drops into the lane
below, a wide `case` sends its lines out in three groups, a note sits above its
element. A session that writes no `@position` gets that layout, and the skill now says
to write none -- a hand-placed statement is never moved and is not measured against
what the builder puts around it, so a few of them are exactly what produces
overlapping boxes.

Measured on a generated app of 41 microflows laid out by the new mxcli, the old rules
failed **9 flows for width** (1755px to 3100px, against a wrapping point of 2880) and
flagged **5 false overlaps** -- loop children, whose coordinates are offsets from the
loop and not canvas points, so two loops with a child at the same offset looked like
one hiding the other. A rule that fights the generator is worse than no rule.

The loop-coordinate finding behind the old `loop-box-empty` rule is still true and
worth keeping here: Mendix stores geometry as `RelativeMiddlePoint`, relative to the
parent, so an activity inside a loop is placed relative to the loop --

```
LoopedActivity            560;200   Size 670;440    <- box grew to hold its child
  delete (inside loop)    560;360                   <- 560px right OF THE LOOP
```

-- which is why a body written with canvas coordinates drew a huge empty box. mxcli
handles this now; it is written down because anything that reads positions back out of
a `describe` dump has to know it.

## The verdict that catches what looks wrong

A page can pass everything and still be unusable. Measured: a gate reporting 10/10
tests, `mx check` 0 errors, lint 0 errors, coverage 12/12 and naming clean, on a
screen whose heading, two buttons and grid were welded together with no gap — because
the widgets were emitted as bare siblings with no spacing at all.

Mendix has a property for exactly this, so no CSS is involved. Atlas Core declares a
`Spacing` design property with `margin-` and `padding-` on four sides, values `None`
`S` `M` `L`:

```
actionbutton btnRemind (
  Caption: 'Send reminder',
  Action: microflow Mod.ACT_Invoice_SendReminder(Invoice: $currentObject),
  DesignProperties: ['Spacing': ['margin-right': 'S']])
```

`checks/check_layout.py` reads `describe page` — which prints `DesignProperties` —
and reports these, plus the navigation rules that read `DESCRIBE NAVIGATION` and the
project's own layouts:

| | Severity | Fails when |
|---|---|---|
`SPACE01` | error | a widget sharing a line with the next and no `margin-right`; a heading with content under it and no `margin-bottom` |
`SPACE02` | error | a spacing value outside `None` `S` `M` `L` |
`SPACE03` | error | widgets on one line disagreeing on vertical margins, or none carrying `margin-bottom` |
`HEAD01` | warning | the page renders no heading and calls no header snippet |
`GRID01` | error | a grid filter in a column with no `Attribute:` (and none of its own) — it renders "Unable to get filter store" |
`NAV01` | error | project security is on and no menu, page or snippet offers Log out |
`NAV02` | warning | the Log out item is not the last item of its menu |
`NAV03` | error | project security is on and a role's home page (`home page X for Role`) is not in the menu |
`NAV04` | error | one of the project's own layouts opens two or more pages from buttons — a menu built by hand |
`NAV05` | error | a menu item or sub-menu has no icon; the message suggests an Atlas_Filled icon for its caption |
`ACCOUNT01`-`03` | error | users sign in and the Administration module is there, but the menu lacks `Users` (`page Administration.Account_Overview`) or `My account` (`microflow Administration.ManageMyAccount`, which opens `MyAccount` for the signed-in user), or a signed-in role lacks `Administration.User`, or no role has `Administration.Administrator` |
`MODULE01` | error | the app has its own module with pages and the template's `MyFirstModule` is still there; the message lists what still uses it (home pages, user roles, pages or flows) and the steps to remove it |
`HOME01` | error | users sign in and the administrators' role opens on a page outside the app's own modules (the template's `Home_Web`, an Administration page) |
`ICON01` | error | a button (`actionbutton`, `linkbutton`, on a page or in a snippet) without an icon; the message suggests an Atlas_Filled icon from its action and caption |
`LAYOUT01` | error | the app's pages use more than one layout (pop-ups, the login page and phone/tablet layouts aside), so the menu changes between pages |
`USER01` | error | users sign in, and a page (pop-ups and the login page aside) does not open with `<Module>.SNIPPET_CurrentUser` on the right of its top row, after Back if there is one: the user icon and e-mail, top right, the same place on every page |
`BACK01` | error | a page another page or a flow opens (`show_page`) does not start with a Back button: `close_page`, icon `chevron-left`, top left. Pop-ups, menu pages and home pages are exempt |

`GRID01` came from the same session: a customer grid showed its date column as formatted
`Content` and dropped the column's `Attribute`, and its date filter rendered a red "Unable to
get filter store" box. `mxcli check`, `mx check` and lint all passed it.

The same sessions left three smaller fixes. A red gate now ends with every finding of each
failed check (up to five, each with its fix), not only the first: a model that read the gate
through `| tail -16` saw one NAV finding and opened `check_layout.py` to learn what the other six
wanted. A `sleep` in the same command as `tests/gate.sh` is blocked by the Claude Code hook and the
OpenCode and Pi plugins, because the gate waits for the runtime itself; two sessions added one
anyway. And the OQL helpers (`oql_count`, `oql_value`, `await_row`, `diagnose.sh`) quote the entity
name: `FROM OrderDesk.Order` does not parse, so a test on an entity named `Order` failed and
`diagnose.sh` printed a false 0 rows. A Pi session found and fixed that one in its own copy.

`NAV03` and `NAV04` came from a Pi session that needed an employee menu and a customer
menu, found that MDL menu items take no roles, and built two layouts of link buttons
instead. On screen the links ran together into one line, a fixed 232 px panel covered
half a phone and there was no hamburger. Mendix already hides a menu item from a user
who cannot open its page, so one profile menu serves every role; the rule file and
`spacing-and-layout` now say so, and both messages carry that fact and the fix.

`SPACE03` came from two further screenshots. A `margin-bottom` on one inline-block and
not its neighbour lifts it about ten pixels out of line; and a row of buttons with
`margin-right` but no `margin-bottom` looks right until the window narrows, when it
wraps onto a second row sitting against the first. One omission, two symptoms, so one
rule: everything on a line shares its vertical margin and it is not `None`.

Only inline-against-inline fails. A textbox in a dataview, a datagrid, a layoutgrid
or a snippetcall is block-level and already spaced by the theme — an earlier, broader
version of this check produced 20 findings on an app whose screens look right, so it
was narrowed to what actually collides.

`SPACE02` exists because `mxcli check` accepts any value here (`'XL'` passes) and only
`mx check` catches it, late, as CE6083. `HEAD01` is a warning because a heading may
legitimately come from a shared snippet — the demo app's `SNIPPET_AppHeader` — and a
rule must only fail what is wrong under every convention.

mxcli's Starlark rules cannot do this: a `page` object there exposes only
`widget_count`. And `ALTER PAGE`'s `SET` rejects a `DesignProperties` map, so an
existing page is fixed by patching its `describe` output and re-running it.

## The local database a deploy build can eat

Studio Pro keeps the app's own data in an HSQLDB under `deployment/data/database/`.
`mxbuild --target=deploy` runs a Clean up step across the whole of `deployment/`,
and that has been observed leaving the database half-written: the
`mendixsystem$version` table's DDL present, the single row the runtime reads out of
it absent. The runtime then refuses to start, and Studio Pro refuses to open the
project, both complaining about that table. A killed runtime also leaves a
`default.lck` behind, which blocks the next boot on its own.

Neither needs a database to diagnose — HSQLDB writes its schema as text:

```
healthy   default.script: CREATE … "mendixsystem$version" … + INSERT INTO "mendixsystem$version"
broken    default.script: CREATE … "mendixsystem$version" …   (no INSERT, 426 rows against 1077)
```

So `mdl_check_local_database` in `portable.sh` greps for exactly that, and the gate's
environment preflight and `diagnose.sh` both call it. Silent when the database is
absent (normal), fresh, or healthy; otherwise it names the file and the one command
that fixes it. The database holds demo data only — the seed runs through the app.

`tests/run-app.sh` also stopped causing it: it copies
`deployment/data/database/` aside before its `--target=deploy` build and puts it back
afterwards. The runtime it boots talks to PostgreSQL, so that database is nobody's
business but Studio Pro's.

## A green gate that measured the wrong app

The gate has always warned when the model changed after the runtime started —
security and entity changes do not hot-apply, so a correct fix reads as a failing
feature. That check keyed on the runtime process's start time via `pgrep` and
`ps -o lstart=`, neither of which exists in Git Bash.

So on Windows it returned silently, every run. Found in the field with a `.mpr`
about 25 minutes newer than the deployment being served: the gate would have gone
green against an old build and said nothing. A check that degrades quietly is worse
than no check, because the green is still printed.

It now keys on **file dates** first, which need no process tools:

```
!! the model is 1523s newer than the built deployment -- this run measures the OLD app
   rebuild before trusting anything green here
```

`.mpr` against `deployment/model/model.mdp`. The `pgrep` path is kept as a second
signal where it exists — it catches the other direction, a deployment rebuilt while
the runtime kept serving what it booted with.

This matters most where there is **no hot reload at all**: a runtime serving a built
deployment cannot see an MDL change until something rebuilds. A boot script used
through `MDL_BOOT_COMMAND` should rebuild whenever the `.mpr` is newer than
`deployment/model/model.mdp`, rather than waiting to be told with a flag.

## When `mxcli run --local` cannot boot

On Windows/ARM it deadlocks: mxcli spawns `mxbuild --serve` and never drains its
stdout pipe, so mxbuild fills the pipe and dies, and mxcli waits forever for a
readiness that cannot arrive. There is no error, no output and no CPU — it looks
exactly like a slow build, which is how it costs you an hour before you suspect it.

The gate takes a way out. Put a working boot command in `tests/harness.env`:

```sh
MDL_BOOT_COMMAND="bash tests/run-app.sh"
```

`gate.sh --boot-if-needed` then runs that instead, still creating the database first
and still bounded by `BOOT_TIMEOUT`. Anything that ends with an app answering on
`$APP_PORT` will do.

A boot script written this way has to do three things `mxcli run --local` would
otherwise have done, each of which is easy to miss:

- **Bundle the web client.** `mxbuild --target=deploy`'s "Bundle application" step
  compiles Java and stops — it never runs rollup, so `deployment/web/dist/` is absent
  and the page is blank on a 404 for `dist/index.js`. mxbuild has already written the
  inputs (`index.js` and a `rollup.config.mjs` of absolute paths), so running that
  config finishes the job in about three seconds.
- **Start the runtime with the admin password the tools expect.** `mxcli oql` and
  `tests/diagnose.sh` authenticate with `mxcli-local-dev`.
- **Set `mendix.running.locally.by.studiopro`.** The OQL endpoint is a `/dev/`
  servlet gated on that system property; without it the runtime logs *"Skipping
  development servlet registration"* and every data assertion fails.

## Windows

The harness is bash and Python on every host, so on Windows it runs under **Git
Bash** or WSL2 — there is no PowerShell port, and there is not going to be one:
the gate, the hooks and every host adapter are the same scripts on every
platform, and a second implementation is a second thing to keep true.

**Git Bash** is the shell inside Git for Windows: a real `bash.exe` plus `grep`,
`sed`, `curl`, `mktemp` and the rest, on the MSYS2 compatibility layer. Not a VM
and not WSL — it runs on the Windows filesystem directly (`C:\Users\you` is
`/c/Users/you`) and calls Windows binaries, so `./mxcli.exe` works from it.

### Setting a Windows machine up — one command

```powershell
powershell -ExecutionPolicy Bypass -File mxcodr\bootstrap.ps1 C:\Mendix\YourApp
```

`bootstrap.ps1` is the only piece that cannot be bash: `install.sh` needs a shell
before it can run, so getting that shell is PowerShell's job. It winget-installs
Git for Windows, Python 3 and Node.js (skipping whatever is already there), finds
a **real** Git Bash, and hands over to `bash install.sh <target> --with-deps`,
which installs `playwright-cli`, its Chromium headless shell and `mxcli.exe`, then
lands the harness.

Three things it deliberately does not do:

- **Docker Desktop is offered, not silently installed.** When it is missing and
  someone is at the keyboard, the installer explains what needs it, shows the exact
  command, and asks. On yes it installs, offers to start Docker Desktop, lists the
  three things only a person can do (start it, accept the licence, let it set up the
  WSL2 backend) and then waits with you for the daemon — up to `DOCKER_WAIT`
  seconds, default 180, and Ctrl-C stops the waiting without stopping the install.
  With no console it falls back to printing the command. `MDL_ASSUME_YES=1` answers
  the prompts for an unattended run.
- **The JDK is found, not demanded.** Studio Pro installs one as its own
  prerequisite, so a machine that can open the project usually has a usable JDK
  already — on the Windows test machine there were *three*, and none on the PATH.
  The installer looks in `JAVA_HOME` (both `$JAVA_HOME/bin/java` and the
  `$JAVA_HOME/java` shape a real machine turned out to use), Eclipse Adoptium,
  Java, Microsoft and Zulu directories, `/usr/lib/jvm` and
  `/Library/Java/JavaVirtualMachines`, and prints the path plus the one-line
  `export PATH=...` that fixes it. The version follows the project, not a
  constant: Mendix 9 wants 11, 10 and 11 want 21, 11.14+ wants 25.
- **Studio Pro** is never installed. On Windows it is the only source of `mx`
  (the Mendix CDN publishes a Linux mxbuild only, and `mxcli setup mxbuild` says
  so and refuses), so the installer *looks for* the Studio Pro versions already on
  the machine and creates the app at the newest one. `MX_VERSION` overrides.

The manual route, if you would rather do it yourself:

1. **Git for Windows** — <https://git-scm.com/download/win>. Keep the default
   *“Checkout as-is, commit Unix-style line endings”*, and tick *“Add a Git Bash
   Profile to Windows Terminal”*. Everything below is typed in Git Bash, not
   PowerShell or `cmd`.
2. **Python 3** — <https://python.org/downloads>, ticking *“Add python.exe to
   PATH”*. Not the Microsoft Store build: it leaves a `python3.exe` stub that
   answers `command -v` and then opens the Store instead of running. (If it is
   already installed without PATH, the harness finds it anyway — see below.)
3. **Docker Desktop** — *optional*. Only the app's PostgreSQL ever needed a
   container, and a native PostgreSQL replaces it; `mx check` runs from Studio Pro.
   See **Local mode and Docker mode** above.
4. **mxcli** — `mxcli.exe` in the project root. On a fresh app `mxcli new` writes
   a *Linux* binary there for the devcontainer; the installer swaps in the Windows
   one and keeps the other as `mxcli.linux`.
5. **Install** — from Git Bash, in the project: `bash mxcodr/install.sh . --with-deps`

```bash
# confirm the machine before blaming the harness
bash --version                   # 4.x from Git for Windows
python --version                 # or python3, or py
./mxcli.exe --version
docker info                      # needed by mx check and --ensure-db
bash tests/orient.sh             # exercises mxcli, Python and mktemp together
```

What the bundle does about each difference:

| Difference | Handled by |
|---|---|
| Git for Windows, with `bash.exe` on the PATH | every command in the loop is `bash tests/...`; the OpenCode plugin also probes `%ProgramFiles%\Git\bin` and `%LOCALAPPDATA%\Programs\Git\bin` before giving up |
| Python 3 as `python`, `python3` or `py` | `tests/portable.sh` runs each candidate once before believing it, because Windows ships a `python3.exe` stub that opens the Microsoft Store and answers `command -v` |
| `mxcli.exe` in the project root | detected alongside `mxcli`; `install.sh` swaps out the Linux binary `mxcli new` leaves behind and keeps it as `mxcli.linux` |
| A PostgreSQL for the app | `mxcli run --local` is Docker-free but Postgres-only. Native PostgreSQL works; `mx check` needs no container at all |
| LF line endings | `.gitattributes` pins `*.sh` and `*.py`. Without it one editor save turns every line of `gate.sh` into `$'\r': command not found` |
| Python installed but invisible | winget accepts python.org's default of *not* adding python to the PATH, so a working Python 3.12 can exist that no shell can see — observed on a clean Windows 11 VM. `portable.sh`, the hooks and `install.sh` all search `%LOCALAPPDATA%\Programs\Python\Python3*` and `C:\Program Files\Python3*` before giving up |
| `bash` on the PATH is the wrong bash | `C:\Windows\System32\bash.exe` is the **WSL launcher**. `bootstrap.ps1` and the OpenCode plugin put Git's own directories first and reject anything under `System32` |
| No CDN mxbuild | `mxcli setup mxbuild` refuses on Windows; `mx` comes from an installed Studio Pro. The installer enumerates `C:\Program Files\Mendix\*\modeler\mx.exe` and builds at the newest version present |

Three Unix-only niceties degrade instead of failing: the stale-model warning needs
`pgrep` and says nothing without it, the ELF test for the binary swap needs `file`,
and the sub-second sleep in `--boot-if-needed` falls back to `sleep 1`.

**Verified on Windows 11** (build 10.0.26200, ARM64, Parallels VM), installing into
`C:\Mendix\TestApp` with `bootstrap.ps1`: Git and Node detected and
skipped, Python found where winget had left it *off* the PATH, `playwright-cli`
and its Chromium headless shell installed, `mxcli.exe` downloaded for
windows/amd64, a Mendix app created at 9.24.37.77045 — the newest Studio Pro on
that machine — and the skills, lint rules, checkers, all four hosts' hooks and the
harness installed. `bash tests/orient.sh` then read the model, security, lint,
navigation and structure. A second run installed nothing and reported only Docker.

Four real defects were found and fixed by that run, none of which the macOS or
Linux testing could have surfaced:

- `install.sh` used `$APP/mxcli.exe` to create the app and then copied the scaffold
  over it. On Windows a running `.exe` is locked, and `cp` unlinks before it fails,
  so the binary vanished mid-install. It is now stashed before `mxcli new` runs.
- Python 3.12 was installed and invisible — winget accepts python.org's default of
  not touching the PATH. `portable.sh`, the hooks and the installer now search the
  standard install directories.
- `mxcli setup mxbuild` exits 1 on Windows ("the Mendix CDN's mxbuild is a Linux
  binary"), so MxBuild is never installed there; Studio Pro is the only source, and
  the installer now enumerates what is installed and builds at the newest of them
  rather than asking for a version that cannot be produced.
- The first `bash.exe` on the PATH is `C:\Windows\System32\bash.exe`, the WSL
  launcher. Git's own directories now come first everywhere it matters.

What was also run, elsewhere:

- on macOS, a fake `python3` that exits non-zero placed ahead of a working `python`
  on the `PATH` — `portable.sh` rejected it and chose `python`, and the coverage
  checker ran;
- in a `debian:stable-slim` container with no Python at all, the old
  `mktemp -d -t mdl-gate` failed exactly as predicted (`too few X's in template`)
  while `mdl_tmpdir` worked — so this bundle was broken on Linux and Git Bash
  before the fix, not merely unproven;
- `mxcli` renamed to `mxcli.exe` in a probe app: found by both the shell scripts
  and `check_test_coverage.py`;
- a full `bash tests/gate.sh` in that probe: suite, `mx check`, lint, coverage and
  naming all ran through the rewritten paths;
- a second `install.sh` over the first: the harness scripts upgraded, the
  `verify-*.test.sh` untouched, and the stale `./tools/...` hook registration
  replaced rather than duplicated.

Two things stay unproven on Windows, both for want of Docker on that VM:
`bash tests/gate.sh` cannot run `mx check`, and the browser suite has not been
exercised there. A JDK *is* installed — three of them — so
`./mxcli.exe run --local` needs only the `export PATH` line the installer prints.

## Publishing it as a repo

`install.sh` resolves its own location, so the bundle runs from wherever it sits. In the
mx-codr repo it is the `mxcodr/` directory:

```bash
git clone https://github.com/<you>/mx-codr /tmp/mx-codr
bash /tmp/mx-codr/mxcodr/install.sh ~/CloudeCodeProjects/YourApp
```

## What it deliberately does not touch

`.claude/settings.json` and `AGENTS.md` remain owned by mxcli and the project. The
installer merges only its named entries into `.claude/settings.local.json` and
`.codex/hooks.json`; it never replaces either file. It prepends the first-prompt
reminder to `.codex/config.toml` only when no `developer_instructions` key exists.
Codex users still make the explicit security decision by trusting the project and
reviewing the installed definitions with `/hooks`.
