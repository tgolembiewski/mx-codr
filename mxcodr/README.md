# mxcodr — the installable bundle

Everything a Mendix project needs to pick up this repo's skills, lint rules and
checkers. `install.sh` copies it into a project; this file explains how the payload
is rebuilt when the sources change.

Deliberately **not** documented in `CLAUDE.md` or `AGENTS.md`: mxcli regenerates
both on `mxcli init`, so anything written there is lost on the next tooling update.

## What is in here

```
install.sh        copies the payload into a Mendix project; the entry, ~90 lines -- it sources
install/          the rest in order: 9 files of helpers (ui, prereqs, postgres, docker, windows,
                  mxcli, studio_pro, toolchain, theme), then the steps (target, step_prereqs, step_app,
                  step_skills, step_hosts, step_harness, summary). Its header lists which is which
install/hosts/    the five .cjs scripts step_hosts runs, one per host config it merges;
                  install/install_tool.cjs does the installer's other small jobs
bootstrap.ps1     Windows only: gets Git Bash and Node, then hands over to install.sh
VERSION           date-based version, copied to tools/mdl-checks/VERSION in the target
MXCLI_TESTED      the one mxcli release this bundle works with ("<tag> <build-date>"): the
                  installer downloads exactly that release and offers to swap any other
                  ./mxcli, newer ones too; orient.sh warns when ./mxcli is not it
rules/            mdl-skills.md (Claude, OpenCode, and Pi through its extension) and
                  mdl-skills.mdc (Cursor) — the always-loaded rule
hooks/            host-specific prompt/PostToolUse adapters plus the Codex and Cursor gates; they
                  source hook-env.sh (Node and hook_tool.cjs, which does their small jobs: read a
                  field, split a command); guard-harness-env.sh carries its own copy and runs alone
plugins/          mendix-mdl-harness.js (OpenCode) and mendix-mdl-harness.pi.js (Pi) -- the same
                  three jobs as the hooks, in each host's own event API
tests/            gate.sh + gate/ (app, checks, hints, preflight, tests), precheck.sh, orient.sh,
                  diagnose.sh, peek.sh, film.sh, theme.sh, lib.sh + lib/ (timeout, sessions, scenario, results),
                  portable.sh, scenario-helpers.js, run-app.sh (Windows), run-docker.sh (Docker
                  mode) — the harness, upgraded in place on every install.
                  gate.sh is the done gate: tests, mx check, catalog, coverage, naming, layout and
                  security, then warnings (rendered pages, server errors). precheck.sh is what the hooks run before an exec; orient.sh and
                  diagnose.sh gather facts in parallel; peek.sh looks at a page without a test;
                  film.sh records a video of a test's run;
                  portable.sh holds what differs between platforms and the environment checks
                  every script shares; rules.sh lists and explains the rulebook's cards
.gitattributes    forces LF on *.sh, *.cjs, *.js and *.mdl — copied only if the project has none
examples/         8 verify-*.test.sh from the demo app — NOT installed; a project's tests
                  are written by whoever builds the feature
skills/           5 × SKILL.md — the prose (test-first-delivery with a reference/ of four)
rulebook/         one Markdown card per rule (89) in a folder per group (layout, naming, security,
                  paths, catalog, folders, app) -- step, level, the check that produces its code,
                  what it checks, the fix; installed as tests/rulebook/, where the person's ## Local
                  section sets a level or excepts a document (see "The rulebook" below)
lint-rules/       3 × *.star — MOD001, REU001, UI001 — for `./mxcli lint` by hand; the gate no
                  longer runs lint (UI001 and SEC007 are in the catalog step)
checks/           *.cjs + fixtures/ — the checks, all on Node: one checker per gate step
                  (check_mdl naming, check_layout + layout_rules/ layout, security_rules,
                  catalog_rules, check_scope, check_paths, check_folders, check_unused,
                  check_test_coverage); mxcli_client.cjs is how they call ./mxcli;
                  rulebook.cjs reads the cards; gate_helpers.cjs is the gate's small jobs,
                  split by job into gate_scripts, gate_runtime, gate_visual, gate_changed on
                  gate_values (values read and printed as the Python originals did);
                  shell_helpers.cjs and hook_tool.cjs do the small jobs of tests/*.sh and
                  hooks/*.sh; py_compat.cjs gives the ports Python's regex, shlex, glob and
                  json semantics; docs/hints.md feeds tests/checks/app.md; record_install.cjs writes
                  tools/mdl-checks/INSTALL.json (version, date, sha256 per installed file)
                  so the gate can tell a project running last week's checkers from one
                  running these
docs/             design-notes.md (why each rule and mechanism exists, measured), windows.md
```

The payload is a **copy** of files that live elsewhere in this repo. This directory
is the shipping container, never the place to edit:

| In `mxcodr/` | Source of truth |
|---|---|
| `skills/<name>/SKILL.md` | `.ai-context/skills/<name>/SKILL.md` |
| `lint-rules/*.star` | `.claude/lint-rules/*.star` |
| `checks/fixtures/` | `tests/skills/fixtures/` |
| `checks/*.cjs`, `rules/`, `hooks/`, `plugins/`, `tests/`, `skills/spacing-and-layout/`, `skills/film-tests/` | authored here; no other copy in the repo |

**Finding your way in a long script.** No script is longer than about 500 lines. Where one grew
past that it became an entry plus parts: `install.sh` + `install/`, `tests/gate.sh` +
`tests/gate/`, `tests/lib.sh` + `tests/lib/`, `checks/check_layout.cjs` + `checks/layout_rules/`,
`checks/gate_helpers.cjs` + `checks/gate_*.cjs`.
The entry keeps the name everything calls, starts with a map of its parts, and sources or
imports them in order; each part starts with two lines saying what it holds and who reads it.

## The rulebook: every rule is a card (2026.10.09.2)

The harness judged an app by 87 rules spread over fifteen Node files, three bash functions and ten
`MDL_*` switches in `tests/harness.env`; a rule's level sat in its code, two rules had exceptions,
and the hand-written docs drifted (NAV02 and ALERT01 were documented as blocking for weeks while
the checker warned). The person asked for one place, one format, readable by a human, where a rule
is defined, changed or excepted -- with the hard condition that the harness behaves exactly as
before.

`rulebook/` holds one Markdown card per rule, installed as `tests/rulebook/<group>/<CODE>.md`:

```markdown
---
step: layout
level: block
check: layout_rules/urls.cjs#urlFindings
key: document
---

# URL01 — every page that can have a URL has one

## What it checks
...
## Fix
...
## Local
level: warn
except: Orders.Approval_Task   # opened only from the task inbox
```

The header (front matter between two `---` lines, so GitHub and editors show it as metadata; since bundle 2026.10.09.5) says which gate step prints the code, its default level (`block` fails the step, `warn`
is listed under the gate's warnings, `info` is counted, `off` is not checked), which function
produces it (`bash:` for a rule in a script, `mxcli` for lint) and whether a finding names a
document (`key: document`, so `except:` makes sense). `baseline: captions|names|paths` records the
rules that warn until the first DONE and then block a new or changed document. `fixed: yes` marks
the three with no level to set (the suite, mx check, SCRIPT01). `## Local` is the person's: a
`level:` overrides the default, each `except:` line names a document the rule skips, `#` starts a
comment. 89 cards: the 87 codes, plus `PRODUCTION01` (the Production level and VIEW01, what
`MDL_REQUIRE_PRODUCTION` switched), `COVERAGE01`, `TESTS01`, `MX01`, and three from mxcli lint.

How it steers, without changing what happens: `checks/rulebook.cjs` is the one parser.
`tests/gate/checks.sh` copies `tests/rulebook/` to `$WORK/rulebook` once (eleven parallel steps read
one version), validates it (a broken card makes every model check "could not run" with the card
and line), and hands each checker `--levels` with only the codes the person changed and `--except`
with the exceptions; a checker keeps its own behaviour for every other code, so an untouched
rulebook changes nothing. The bash points (`security_level`, `step_visual`, `step_runtime_errors`,
precheck's TEST01 and STALE01, ALERT01's promotion) read `mdl_rule_level`. The step's levels and
exceptions are part of its cache fingerprint, and a step's summary ends with what the person changed
(`rulebook: 1 excepted (URL01 Orders.Approval_Task), WRITE01 raised to block`), also on a replayed
pass. The ten `MDL_*` switches still work and the card wins; their migration into `## Local` is the
next bundle.

Measured: on 34 local apps every step's four result files (`.status`, `.summary`, `.detail`,
`.warnings`) are byte-identical before and after, and identical again on an app with no
`tests/rulebook/` at all.

What moved with it:

- **`mxcli lint` left the gate.** The person's decision: only its two blocking rules stay, as cards
  in a new **`catalog`** step (`checks/catalog_rules.cjs`, on a copy of the project like the security
  step): `UI001` and `SEC007`, ported one to one from their Starlark over `CATALOG.WIDGETS` and
  `CATALOG.PERMISSIONS`, same messages (the grid named in UI001's message may differ: the Starlark
  took the last grid of the module). `MPR009` and `QUAL006` are mx check errors anyway. Everything
  else lint says is advice, read on request: `LINT01` (default `off`) at `warn` or `block` runs
  `mxcli lint --format json` in the catalog step. The three `.star` files stay for `./mxcli lint` by
  hand; `orient.sh` prints the rulebook instead of lint.
- **The docs are generated from the cards.** `tests/checks/<step>.md` (`catalog.md` and `folders.md`
  new, `lint.md` gone) and `tests/CHECKS.md` come from `node checks/rulebook.cjs rulebook docs tests`
  in `mxcodr/`; a test fails when they are stale, and keeps each under 4,500 characters. The rows
  that are not rules (CE hints, Studio Pro open, a stale client bundle) live in
  `checks/docs/hints.md` (bundle 2026.10.09.4; before, `rulebook/_app-appendix.md`), under their own
  heading in `app.md`: they are ours, not rules the person sets.
- **`bash tests/rules.sh`** (read only): `list [step]`, `explain CODE`, `check`.
- **The guard** blocks a session writing `tests/rulebook/`, also with `MDL_HARNESS_EDITS=allow` and
  from inline code (`node -e` appending to a card), with a message that says what to do instead:
  name the line to add under `## Local` in the report. `.claude/lint-config.yaml` (mxcli's own lint
  levels) and `tests/rules.sh` are harness files.
- **The installer** merges the bundle's cards into `tests/rulebook/`: new text up to `## Local`, the
  installed `## Local` kept word for word, a card the bundle lacks (the team's own) left alone.
  `INSTALL.json` hashes a card without its `## Local`, so a level or an exception is never
  "harness drift"; a changed rule text is.

Bundle 2026.10.09.3: the naming step's ten oldest codes, the last ones in lowercase, follow the
same scheme as every other: `CAPTION01` (an activity's business caption), `CAPTION02` (not the
Mendix default), `CAPTION03` (a decision has one), `CAPTION04` (a question), `CAPTION05` (words, not
the expression), `CAPTION06` (a loop's annotation), `CAPTION07` (no caption on a loop), `CAPTION08`
(a case caption mxcli overwrote), `VAR01` (a placeholder variable name), `VAR02` (a name that only
repeats its type). The gate prints the new codes.

Bundle 2026.10.09.6 changes no behaviour: it is the maintainability refactor of 2026-10-09 (a shared
mxcli client, `step_run`, `hooks/hook-env.sh`, `gate_helpers` and `tests/gate/checks.sh` split by job,
this README a map). Every step was checked on 34 apps against a frozen copy of the harness
(`tests/performance/fixtures/node-reference/`), with each Node call run against that copy too.

Bundle 2026.10.09.7: the cards sit in a folder per group, the same groups as the files of
`tests/checks/` (layout 29, naming 23, security 12, paths 6, catalog 3, folders 1, app 15). The
parser reads the folders, refuses a code in two files and a card in another group's folder; the
installer moves a card installed flat by .09.2-.6 into its folder with its `## Local`.

Next bundle: the switches migrate into `## Local` and disappear; `check: pattern` cards for a
team's own rule; the "kept on purpose?" line a finding prints for the person to paste.

## Upgrading mxcli in an existing project

`bash mxcodr/install.sh .` in a project swaps `./mxcli` for the release `MXCLI_TESTED` pins (it asks,
or `MDL_ASSUME_YES=1`), checksum-verified, keeping the old binary beside it. Since 2026.10.05.5 it
also runs `./mxcli init --sync-skills .` there, before it copies the harness's own skills: mxcli's
skills and bundled lint rules come from its binary, and a project swapped from 0.24 to 0.25 kept the
0.24 ones, which teach the old MDL spelling. The sync leaves `.claude/rules/`, `settings.local.json`
and the harness's lint rules alone. A running `mxcli run --watch` still uses the old binary:
`bash tests/gate.sh --restart`.

## What `tests/precheck.sh` does and does not catch

Before every `mxcli exec` a hook applies the scripts to a scratch copy of the model and runs
`mx check` there (~3-5s; `--no-update-widgets`, retried the slow way only on CE0463), so a reserved name, an enumeration in a text box, a broken XPath or a
missing member surfaces before the runtime stops for a rebuild that fails -- and so does a script
that would stop half-way and leave the model half-applied. It does **not** see what only the
deployment build sees: a Marketplace module whose version does not match the project's Mendix
version passes the precheck and fails the build (CE4271). `MDL_PRECHECK=0` in `tests/harness.env`
turns the whole thing off.

A blocked command runs none of its steps. When something comes before the `mxcli exec` (an edit,
`python3 - <<EOF ... EOF; ./mxcli exec ...`), the block says that nothing ran, the edit included:
GLM sent that shape seven times and debugged an edit that was never applied.

When a script fails to apply at all, precheck prints the errors themselves -- the `✗` lines, a
`Parse error:` or an `Error:` line, at most fifteen -- and then the verdict; a `tail` of mxcli
0.24's output kept only its six-line summary and showed "33 error(s) above" with nothing above it.
The unresolved references are listed too (`microflow not found: ...`). Two scripts that need
each other (a page calls a new microflow that opens that page) fail alone in either order: they
belong in one `.mdl`, and `--no-check` does not get past the precheck.

MDL given with `-c` (`mxcli -p App.mpr -c "GRANT ..."`) is checked like a script: `CREATE`,
`ALTER`, `DROP`, `GRANT`, `REVOKE`, `MOVE` and `RENAME` go through the precheck in every host. A
local model wrote its access rules that way, unchecked, and put a broken XPath into the model.
Errors the model already had are told apart from the script's own: "the model ALREADY has N
error(s) ... fix them first", and a script that adds none passes. An old error still counts
against a script that touches what it names, so swapping one broken rule for another does not
pass.

It refuses a script that creates a page or an `ACT_` microflow the model does not have yet when no
`# covers:` line of `tests/verify-*.test.sh` names it (`TEST01`, 2026.10.05.11). The skill said
test first, but coverage was checked only at the end: in InvoiceChaseCodr the session built the
whole app, then wrote six tests in one go, and three had never failed. Blocked at the exec, the
test comes after the script that names the page's widgets and before the page exists, so it is
red first by itself. A fix to a page already in the model, a `SUB_` microflow, an entity and a
Marketplace module pass; a model that cannot be read never blocks. `MDL_TEST_FIRST=0` in
`tests/harness.env` turns it off.

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
Local models added more: `[%CurrentDateTime%]`, not `now()` or `currentDateTime()` (CE0117); a
token keeps its `]` inside the doubled quotes, `''[%CurrentUser%]''` (CE0161); an access-rule
path alternates association and entity (CE1613); `Administration.Account.Name` is System.User's,
so show `FullName` (CE1613).
Precheck is for the script about to be exec'd; a syntax question is answered by
`./mxcli syntax <topic>` or `./mxcli check <file> -p <app>.mpr --references`, not by running
precheck on variants.

## One compatible mxcli

The harness works with one mxcli release, the tag in `MXCLI_TESTED` (now `v0.24.0`). The
installer downloads exactly that release, checksum-verified against the digest GitHub publishes
for it, and offers to swap any other `./mxcli` for it -- an older one and a newer one alike, the
old binary kept beside it as `mxcli.<version>`. A fresh project never takes the mxcli on the PATH.
`orient.sh` warns at the start of every session when `./mxcli` is not that release.

Why newer is not better: mxcli main after v0.24.0 describes the model in `mdl 1` (menu items as
`( OnClick: …, Icon: … )`, user roles as property lists, unnamed rows and columns). The gate's
checkers read the v0.24.0 form; on the new one they found nothing and passed. `MXCLI_TESTED` is
raised only after the harness reads the new release and its tests pass on it. `MXCLI_TAG=<tag>`
overrides it for one run, on purpose.

## The app's look

With the other questions, before the unattended part, the installer asks how a new app should
look: Mendix's own Atlas (the default -- the app as Mendix makes it) or one of five themes in the
style of the InvoiceB2B colour page the person picked: `navy`, `teal`, `amber`, `plum`, `forest`.
Each has a dark side menu with a lighter active item, a top bar of its own colour, a neutral grey
page with white cards, and buttons in the brand colour. The terminal lists each as a slice of
the app in its colours (24-bit where the terminal has it, the nearest of 256 otherwise); a page
opens in the browser with a screenshot of a real Mendix app in each theme. The answer is a number or
a name; `MDL_THEME` answers it unattended, and with no terminal Atlas is kept.

A theme is files under `theme/` only, never the model. The five are created from
`checks/themes/<name>.css` (installed as `tools/mdl-checks/themes/`) on mxcli's signal base, with
`<name>.skin.scss` appended to the scaffold for the frame mxcli does not paint: the top bar's own
colour, the active menu item, and outline buttons in the brand colour. The skin sets only Atlas's
own variables (`--navtopbar-bg`, `--navsidebar-bg-active`, `--btn-default-color`, ...), never an
Atlas property, the way Mendix asks a theme to be customised; the button colours are scoped to the
buttons a page author set to Default (`.mx-button.btn-default`), so the grid's column selector and
the date picker keep the neutral look. Atlas removes any mxcli
theme. A theme is applied with `--variant light`, so the app opens light even when the OS is dark
(the dark palette stays in the files; `./mxcli theme apply <name> --variant auto` follows the OS).

The frame also sets `--mxt-control-height: 38px` (2026.10.05.10). mxcli's signal base makes form
controls 32px, while the data grid's filter buttons (operator, calendar) keep Atlas's 38px: the
filter row was uneven, and the drop-down filter's 8px padding left too little room, so "Select" was
cut off at the bottom (plum, InvoiceChaseCodr). The frame used to be appended once, when the theme
was created, so an existing project never got a fix to it. Now `themes.cjs frame` replaces it in
place on every apply: `tests/theme.sh` does that, and the installer re-applies an existing app's
active mx-codr theme (its logo left alone).
The mx-codr logo (a prompt `>` and a heavy "c", sharp even at 16px) comes with every theme, Atlas too, in that theme's
colours: `checks/themes/logos/<name>/` is copied over `theme/web/` and replaces Mendix's browser and
home-screen icons, the sign-in logo and the top bar logo (`img/Atlas_Core$Layout$logo.svg`, by
name; mxbuild copies `theme/web/` over its own files). The sets are rendered by
`tests/skills/build-logos.py` in the development repo.
`bash tests/theme.sh` lists them and `bash tests/theme.sh plum` switches; under
`mxcli run --watch` a running app showed the new look about 7 seconds later, no restart. The
palettes, the catalog and the page are generated by `tests/skills/build-themes.py <any app>` in
the mx-codr development repo, from the tokens mxcli actually writes. The screenshots in
`checks/themes/shots/` come from `tests/skills/theme-shots.sh` there: per theme, the installer in an
empty folder, a showcase page (a grid, a form, buttons, tabs) that stays in the development repo,
a boot, one shot.

## Rebuilding after a source change

Thirteen files here have a second copy in the repo: four skills in
`.ai-context/skills/` and the four reference files of one of them, three lint rules in
`.claude/lint-rules/`, and the two checker fixtures in `tests/skills/fixtures/`. Both copies get edited,
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

`rules/`, `hooks/`, `plugins/`, `tests/`, `rulebook/`, `checks/*.cjs` (all but the fixtures),
`skills/spacing-and-layout/` and `skills/film-tests/` have no copy in the repo. They are authored here, in `mxcodr/`, and nothing overwrites them.

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
node tools/mdl-checks/check_test_coverage.cjs . InvoiceDesk
./mxcli init --sync-skills . && ls .agents/skills            # survives an mxcli sync
```

That last line is the one that matters most: it proves an mxcli upgrade does not
delete skills mxcli never shipped.

## Running it

Run it from the mx-codr clone. It asks for the Mendix project folder, with the folder you
are in as the default, copies `mxcodr/` into the project and installs there:

```bash
bash mx-codr/mxcodr/install.sh                      # asks; installs what is missing
bash mx-codr/mxcodr/install.sh ~/Apps/MyApp          # named
cd ~/Apps/MyApp && bash mxcodr/install.sh            # again, from the copy in the project
```

It never installs into the clone or the bundle: the repo root carries `.mx-codr-repo`, and
a target inside either is refused. With no terminal to ask, it needs the folder named, or
must be run from inside an app (a `*.mpr` in the current folder). `bootstrap.ps1` asks
the same question before its winget stage. It used to guess "the folder above the bundle",
which was the clone itself when the repo was cloned.

`--no-app` declines app creation; `--help` lists the arguments, `MX_VERSION` and
`APP_NAME` override what gets created. Without `MX_VERSION` a Mac with several Studio Pro
installs always asks which one the new app uses, `MDL_ASSUME_YES` included (the newest is the
default; with no terminal the newest is taken and the installer says so); with one it takes that
one, with none Mendix 11.12.1. Windows
takes the newest installed.

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

## Windows

Setting a Windows machine up, its traps and what the installer repairs: [docs/windows.md](docs/windows.md).

The harness is bash and Node on every host, so on Windows it runs under **Git
Bash** or WSL2 — there is no PowerShell port, and there is not going to be one:
the gate, the hooks and every host adapter are the same scripts on every
platform, and a second implementation is a second thing to keep true.

**Git Bash** is the shell inside Git for Windows: a real `bash.exe` plus `grep`,
`sed`, `curl`, `mktemp` and the rest, on the MSYS2 compatibility layer. Not a VM
and not WSL — it runs on the Windows filesystem directly (`C:\Users\you` is
`/c/Users/you`) and calls Windows binaries, so `./mxcli.exe` works from it.

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

## Why it works this way

Every rule and mechanism here was added after a session failed without it. The reasons, the
measurements behind them and the bundle each came in: [docs/design-notes.md](docs/design-notes.md).
