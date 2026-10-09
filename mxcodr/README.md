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
install/hosts/    the five .cjs scripts step_hosts runs, one per host config it merges;
                  install/install_tool.cjs does the installer's other small jobs
bootstrap.ps1     Windows only: gets Git Bash and Node, then hands over to install.sh
VERSION           date-based version, copied to tools/mdl-checks/VERSION in the target
MXCLI_TESTED      the one mxcli release this bundle works with ("<tag> <build-date>"): the
                  installer downloads exactly that release and offers to swap any other
                  ./mxcli, newer ones too; orient.sh warns when ./mxcli is not it
rules/            mdl-skills.md (Claude, OpenCode, and Pi through its extension) and
                  mdl-skills.mdc (Cursor) — the always-loaded rule
hooks/            host-specific prompt/PostToolUse adapters plus the Codex and Cursor gates; each
                  runs on its own, so each carries a copy of mdl_find_node from portable.sh, and
                  hands its small jobs (read a field, split a command) to checks/hook_tool.cjs
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
                  every script shares
.gitattributes    forces LF on *.sh, *.cjs, *.js and *.mdl — copied only if the project has none
examples/         8 verify-*.test.sh from the demo app — NOT installed; a project's tests
                  are written by whoever builds the feature
skills/           5 × SKILL.md — the prose (test-first-delivery with a reference/ of four)
rulebook/         one Markdown card per rule (89) -- step, level, the check that produces its code,
                  what it checks, the fix; installed as tests/rulebook/, where the person's ## Local
                  section sets a level or excepts a document (see "The rulebook" below)
lint-rules/       3 × *.star — MOD001, REU001, UI001 — for `./mxcli lint` by hand; the gate no
                  longer runs lint (UI001 and SEC007 are in the catalog step)
checks/           *.cjs + fixtures/ — the checks Starlark cannot express, all on Node:
                  gate_helpers.cjs for the gate's JSON and digests; check_layout.cjs is the
                  entry of the layout check and its rules are in layout_rules/ (one module
                  per area of a page); shell_helpers.cjs and hook_tool.cjs do the small jobs
                  of tests/*.sh and hooks/*.sh; py_compat.cjs gives the ports Python's
                  regex, shlex, glob and json semantics; record_install.cjs writes
                  tools/mdl-checks/INSTALL.json (version, date, sha256 per installed file)
                  so the gate can tell a project running last week's checkers from one
                  running these
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
`tests/gate/`, `tests/lib.sh` + `tests/lib/`, `checks/check_layout.py` + `checks/layout_rules/`.
The entry keeps the name everything calls, starts with a map of its parts, and sources or
imports them in order; each part starts with two lines saying what it holds and who reads it.

## The harness runs on Node, not Python

Since bundle 2026.10.05.1 nothing in the harness runs Python: the hooks, the gate, its checks and
the installer run on Node, which the browser tests (playwright-cli) needed anyway. One tool fewer to
install, and on Windows the class of bug where Python wrote `\r\n` or read stdin as cp1252 is gone
(a command with `✓` in it made the Python hook print nothing; the Codex trust reminder never showed
because `codex_config.py` printed `added\r`).

Each port prints what the Python printed. `checks/py_compat.cjs` gives the ports Python's meaning
where JavaScript differs: regular expressions (Unicode `\w`, `\b`, `\s`, `$` before a final
newline), shlex, glob and fnmatch, `json.dumps`, `str.split`/`strip`/`splitlines`. The Python
originals and the inline snippets are kept verbatim in `tests/performance/fixtures/python-reference/`
in the development repo, and the audit runs both on the same input. Before the switch they were
compared on 30 real projects and 27,275 tool calls from session logs: guard, hook jobs (107,136
inputs), whole hooks (3,457 runs), coverage, check_mdl (1,587), check_layout (3,916, all 23 rules
hit), gate_helpers (2,672), shell snippets (4,086), view_access, check_scope, themes, installer —
no difference on macOS; on Windows the only differences were Python's `\r\n` and its cp1252 reads.

Node 22.5 or newer reads the Mendix version from an `.mpr` (`node:sqlite`); with an older Node that
one detail is skipped. `$PY` is still set in `tests/portable.sh` for project tests written before
the switch that call `"$PY"`; new tests read JSON with `field`/`oql_value` and do arithmetic with
`awk` or `node -e`.

## The rulebook: every rule is a card (2026.10.09.2)

The harness judged an app by 87 rules spread over fifteen Node files, three bash functions and ten
`MDL_*` switches in `tests/harness.env`; a rule's level sat in its code, two rules had exceptions,
and the hand-written docs drifted (NAV02 and ALERT01 were documented as blocking for weeks while
the checker warned). The person asked for one place, one format, readable by a human, where a rule
is defined, changed or excepted -- with the hard condition that the harness behaves exactly as
before.

`rulebook/` holds one Markdown card per rule, installed as `tests/rulebook/<CODE>.md`:

```markdown
# URL01 — every page that can have a URL has one
step: layout
level: block
check: layout_rules/urls.cjs#urlFindings
key: document

## What it checks
...
## Fix
...
## Local
level: warn
except: Orders.Approval_Task   # opened only from the task inbox
```

The header says which gate step prints the code, its default level (`block` fails the step, `warn`
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
repeats its type). The gate prints the new codes; check_mdl left the Python parity test.

Next bundle: the switches migrate into `## Local` and disappear; `check: pattern` cards for a
team's own rule; the "kept on purpose?" line a finding prints for the person to paste.

## mxcli 0.25: the checks read `mdl 1`, the advice is written in it

Bundle 2026.10.05.3 pins mxcli v0.25.0 (`MXCLI_TESTED`). From 0.25 `describe`, `-c` and `mxcli syntax`
speak `mdl 1`: properties in `( )`, menu items as `menu item 'X' ( OnClick: …, Icon: … )`, `sign out`,
grants as `grant read * on entity E to Role where [ … ]`, unnamed rows, columns and footers, no
`@position`, `retrieve … first`. A script without a header is still read as `mdl 0`.

- **Every parser reads both formats.** check_mdl reads the omitted default decision captions and
  unnamed grid columns; check_layout passes `mdl 1` text through `layout_rules/mdl1.cjs`, which writes
  it back in the 0.24 spelling the rules read; VIEW01, SCOPE01, script_overrides and split-entities
  read the new grant order. On 0.24 text every output is byte-identical to before.
- **Proof:** the same 30 models described by 0.24 and by 0.25 give the same findings, per rule and
  document (`tools/dev/compare-formats.py` in the development repo, which runs the gate's own step
  functions with each mxcli). The audit keeps three such pairs as fixtures and compares them.
- **Advice in 0.25 spelling.** Every finding passes through `checks/mdl1_spelling.cjs` before it is
  printed, so a fix the gate suggests parses under `mdl 1;` and without a header (each suggested
  statement was checked with `mxcli check` both ways). `mdl-pitfalls.md`, the skills' examples
  (`mxcli fmt --upgrade`), the rules and `tests/checks/` use the same spelling. mxcli 0.24 refuses
  some of it: a project still on 0.24 is read correctly but advised in 0.25 spelling, and orient
  says to swap its `./mxcli`.
- **Caption baseline:** it records the mxcli version, so the move re-baselines instead of turning
  every caption warning into an error.
- **Fixed in 2026.10.05.4:** a member-level entity rule (`read (Number, Total) … where`) kept its
  XPath unread: VIEW01 took it for unconstrained and SCOPE01 never counted the role as scoped (the
  rights' pattern stopped at the inner bracket), in both formats. Now read: on the 30 projects VIEW01
  names every source a role sees only partly, and 84 instead of 66 role/entity pairs count as
  scoped. mxcli 0.25 describes microflows
  about four times slower than 0.24 (1.5 s to 5.9 s for one module of InvoiceB2B); naming and layout
  take a few seconds longer on large models.

Verified on InvoiceB2B on macOS (gate DONE, 19/19 tests, after the installer swapped `./mxcli` to
v0.25.0 with its checksum) and on the Windows demo app (same results as on 0.24: 12/12 tests,
coverage 14/14, 4 PERF warnings, the same 38 layout failures).

## Upgrading mxcli in an existing project

`bash mxcodr/install.sh .` in a project swaps `./mxcli` for the release `MXCLI_TESTED` pins (it asks,
or `MDL_ASSUME_YES=1`), checksum-verified, keeping the old binary beside it. Since 2026.10.05.5 it
also runs `./mxcli init --sync-skills .` there, before it copies the harness's own skills: mxcli's
skills and bundled lint rules come from its binary, and a project swapped from 0.24 to 0.25 kept the
0.24 ones, which teach the old MDL spelling. The sync leaves `.claude/rules/`, `settings.local.json`
and the harness's lint rules alone. A running `mxcli run --watch` still uses the old binary:
`bash tests/gate.sh --restart`.

## `organize-project` is mxcli's skill (2026.10.05.6)

The harness shipped an `organize-project` skill; mxcli 0.25 ships one of the same name and nearly
the same text, newer for 0.25 (`list impact of`, `task queue`, `mdl 1;` headers). The installer and
`mxcli init --sync-skills` overwrote each other's copy. The harness no longer ships it:
`module-structure` links to mxcli's in `.ai-context/skills/`, and the installer removes the copy an
older install left in `.agents/skills/`, where mxcli writes none.

## A Mac asks which Studio Pro a new app uses (2026.10.05.8)

A new app on a Mac was always created at Mendix 11.12.1 (`DEFAULT_MX_VERSION`), whatever Studio
Pro the machine had. The installer now lists the Studio Pro apps in `/Applications` and
`~/Applications` that carry `Contents/modeler/mx` (the version comes from the app's name) and always asks
which one to use when there are several, also under `MDL_ASSUME_YES`, which answers yes/no
prompts and not this choice. `MX_VERSION` still decides without asking.

Fixed in 2026.10.05.9: the menu read each version into `$version`, the installer's own variable
for the bundle's version, so an install that showed the menu recorded `"version": ""` in
`tools/mdl-checks/INSTALL.json` and the gate said "the harness installed here is ;".

## A session refusal is dated by the line it belongs to

Bundle 2026.10.05.2. A trial-licence runtime logs a refused session as an exception whose stack
trace lines carry no date, and the gate compared those lines with the suite's start as text:
`com.mendix...` sorts after every date. One refusal three days old in `.mxcli/runtime.log` then
labelled every later suite "ENVIRONMENT, not the feature" -- green ones too -- and, since a red run
blamed on the environment is not recorded, red-first said a test that had failed had never been
red. A line without a date now takes the time of the dated line above it.

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
  priority as `.claude/CLAUDE.md`. It names `test-first-delivery` as the one skill to
  read before the first feature; the other project skills are named by the gate finding
  that needs them, because mxcli's generated `CLAUDE.md` skill table lists only mxcli's
  own skills and an agent that follows that table never sees these.
- **`.claude/settings.local.json`** — registers Claude's two hooks.
- **`.codex/hooks.json`** — registers the Codex equivalents plus a `Stop` gate.
  Codex discovers the five `.agents/skills/` copies automatically. Project hooks
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

The five `.agents/skills/` copies are self-contained except for links to standard
mxcli guidance such as `test-app` and `overview-pages`. Those links explicitly
resolve through `.ai-context/skills/`, where `mxcli init` installs the canonical
versions, instead of assuming Codex has duplicate sibling skills under `.agents/`.

The hooks are the part that does not depend on the model choosing to comply:

| Hook | Fires | Does |
|---|---|---|
| `remind-skills.sh` | every Claude user prompt | adds one line of context naming the skills and what "done" means |
| `remind-skills-codex.sh` | every Codex user prompt | gives the same rule using Codex's `$skill-name` invocation syntax |
| `before-mxcli-exec.sh` | before a Claude Bash call containing `mxcli exec <script>.mdl` | runs `tests/precheck.sh` (the scripts applied to a scratch copy of the model, then `mx check` there, ~3-5s, and nothing at all when the same scripts already passed) and blocks the exec with the `[error]` lines when it would break the build -- the CE errors `mxcli check` cannot see |
| `guard-harness-env.sh` | before a Claude Bash, Edit or Write call, a Codex shell call, Cursor's `beforeShellExecution`, and in the OpenCode and Pi plugins | blocks a search or read outside the project (`find /`, a recursive grep of `/System/...`, `sed` on the mxcli source under `/private/tmp`, `~/.mxcli/mxbuild`): a session scanned the whole disk for a login and read the mxcli source for a widget's syntax, and nothing outside the project answers a Mendix question; a `/tmp/x.log` the session wrote passes. Also blocks a session writing what judges it: `tests/harness.env`, the harness's own files (`tools/mdl-checks/`, the harness scripts in `tests/` that `INSTALL.json` records, `.claude/lint-rules/`, the hook and plugin configs), and `tests/gate.sh` run with a gate switch set inline. Only writes: reading, copying from, and the session's own `verify-*` tests, `mdlsource/` and `credentials.env` pass. `MDL_HARNESS_EDITS=allow` in `tests/harness.env` (the person's) lifts the harness-file part. Codex and Cursor edit files outside these hooks, so there only the shell route is covered; the gate's drift check still names a changed file |
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
     - [CAPTION06] line 796: loop without @annotation -- put @annotation '<why it repeats>' on the line above: while $MonthBack >= 0
     - …four more…
     ... 3 more under == naming above
   layout: 1
     - [NAV01] line 0: navigation profile Responsive: users sign in, but its menu has no way to log out -- add `menu item 'Log out' sign_out …`
   NOT DONE — failed: naming layout
```

Every naming finding carries its fix after ` -- `, as the layout ones already did: a session that
could not tell what `CAPTION06` wanted opened `check_mdl.py` to find out.

The caption rules (`CAPTION01`, `CAPTION03`, `CAPTION04` and the other
wording rules) are warnings in the gate: 286 of them once landed at once on a session with no
test green yet. `MDL_CAPTIONS=error` in `tests/harness.env` makes them block again; variable-name
rules always block. A capped list says so ("10 of 286 shown"): the next session read ten lines as
ten findings. `MxTest`, the module `mxcli test` injects, is not one of the app's own: a
gate that listed it could not run naming.

`REFRESH01`, run with the naming rules and always blocking: a microflow that ends in `close page`
(a popup's Save) commits with `refresh`. Every app the harness built kept the old rows under the
popup after Save -- `commit $Invoice;` then `close page;` -- and the tests missed it, because one
reloaded the page to see the new row. The test skill now calls such a reload a bug found.

A `# covers:` line may separate its names with commas or spaces. A session wrote spaces and read
0/24 covered with every test green.

### What the gate says about tests that never failed

A full `bash tests/gate.sh` lists every `verify-*.test.sh` with no recorded red run in
`.mxcli/red-first/`: a test written after the code it checks has never been seen to fail, and may
assert nothing. It is a warning under the verdict, not a failure. Either break what the test checks
once and watch that one test go red (`bash tests/gate.sh --only <feature>` records it), or list the
test in `MDL_ALLOW_GREEN_FIRST` in `tests/harness.env` when it is green by nature, such as a
seeding reset.

A test that `set -e` ends on a command that printed nothing (say `x=$(oql_count ... 2>/dev/null
|| echo "")`, where the exit inside `$(...)` skips the fallback) no longer shows a bare `FAIL`: its
last line names the test's line and command. `fail` also joins a multi-line message onto one
line: the runner shows only a test's last line, and `fail "...: $body"` ended on a grid row.

`mx check`, lint and the page and flow dumps run beside a boot. When `--restart` rebuilds while
they read the project, each is tried once more before the gate calls it "could not run".

Each boot empties `.mxcli/gate-boot.log` and keeps the one before it as
`.mxcli/gate-boot.prev.log`, so a failure that a later boot overwrote can still be read.

### Looking at a page without writing a test

`bash tests/peek.sh 'Invoices' [widget]` signs in, opens that menu item and prints the page's
visible text and console errors. It writes no test file, claims no coverage and records no
red-first run -- the scratch `verify-zz-*.test.sh` two sessions wrote for this left a
"went green without ever being red" record behind every time.

### A video of a test's run

`bash tests/film.sh --list` prints every browser test: its name, the user it signs in as, what it
covers and the journey from its header. `bash tests/film.sh <name>` records the
shared browser while that one test runs, unchanged but slowed for the eye, through playwright-cli's
`video-start`/`video-stop`; each film opens with a card naming the test (`video-chapter`), and a mouse pointer moves to each
click. Headless Chromium draws no pointer, so film.sh adds an arrow to the page that follows the
test's mouse; playwright-cli's own (`video-show-actions`) comes with a label per action that prints
what is typed, the test password included. The browser is closed afterwards.
Slowed: before each click, fill or pick the pointer travels to the element, and a pause follows
(`--pace <ms>`, default 1000; `--pace 0` is the test's own speed). `lib/scenario.sh` does it when
`MDL_FILM_PACE_MS` is set, by wrapping the actions on playwright-cli's Locator and Page; every
other scenario sets the pace to 0, so a gate run after a film runs at full speed.

Each film has one page listing the test's steps in English, as the paced wrappers noted them: the
verb and the label of what was used (`Type in "Quantity"`, `Click "Save order"`), never what was
typed. A repeated step or pair of steps is one line (`(4 times)`); past 15 lines the page has two
columns, and past 30 the rest is counted, so it is always one page. With ffmpeg the page opens the
mp4 (drawn by a playwright-cli browser of its own, `-s=mxcodr-film-slide`); without ffmpeg there
is only the .webm and no mp4, and the filmed browser shows the page at the end of it. Films
go to `.mxcli/films/<name>.webm`, plus an `.mp4` when ffmpeg is there. A failing test keeps its
film. It refuses while a gate, a test or another film holds the browser, and when no app (or
another project's app) answers.

`bash tests/film.sh --all` films every test in the background: it prints an estimate (about 40 s
a test at the default pace) and returns at once; `--status` shows how far it is, `--stop` ends it,
and the log is `.mxcli/films/all.log`. It runs in a session of its own (`perl POSIX::setsid`, else
`nohup`), so it outlives an agent's tool call. After every test it checks the app still answers
and stops if not, naming the tests it did not film: in the B2B session a foreground `--all` ran 11
minutes and outlived the app's unlicensed run time halfway through. With ffmpeg the films are
joined into `all.mp4`. While it records the gate refuses (`preflight_films`), since both would
drive the one browser. The skill `film-tests` lists the tests first, so
the person can say which ones to film.

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

A test that fails with the runtime's help shows the cause, not the request handler's preamble
("[User '...' with session id '...' and roles '...']" filled the line in three sessions). A 404 on
`dist/*.js` after a `--watch` rebuild says "the client bundle is stale: `--restart`" instead of
Mendix's "the page includes a broken widget". CE0106 and CE0557 -- a microflow or page reached from a
page, button or menu with no role, in all three sessions of 2026-09-28 -- get a hint that names each
element and the `grant` line to paste.

CE0582 (the classic drop-down, which the React client does not run) gets a hint too: `combobox` or
`radiobuttons` on the same attribute, both checked on Mendix 11.12. And `page_text()` waits, at most
`ACTION_TIMEOUT`, until no progress indicator or loading grid shows and the page has text, then
returns the same body text as before: four sessions read an empty page ("it says: | | |") taken
while Mendix was still rendering.

A test script bash cannot parse now gets its reason under the gate verdict ("bash cannot parse it:
line 17: syntax error ..."), plus the usual cause, an apostrophe inside `scenario '...'`. Before,
the gate showed a bare "FAIL verify-admin (55ms)". The precheck also passes mxcli's own `hint:` lines
through, for example "defined later in this script -- move its create statement before this one":
mxcli 0.24 refuses a `call microflow` to a microflow the same script creates further down.

The before-exec hooks now refuse an exec whose script a step in the same command writes: an edit,
a `mv`, a `sed -i` or a redirect, as in `mv 05b.mdl 04c.mdl && mxcli exec 04c.mdl`. The precheck
runs before the command, so it checked the old file, or found none and let the exec through. A
python edit followed by the exec put four build errors into a DeepSeek session's model that way. A
step that only reads the script (`grep`, `cat`) is still fine. `"$PWD/mdlsource/x.mdl"` is no longer
taken for a loop variable. The outside-project guard no longer reads a `|` inside a quoted grep
pattern as a pipe: `grep -E 'add \$|remove \$' skills/` was blocked as a read of "/$".

A runtime out of sessions is now named as the environment, not the features. A trial licence
allows a few; past that every sign-in is refused and Basic-auth REST/OData calls fail. The gate
reads "Maximum number of sessions exceeded" from the runner output or from runtime.log since the
suite started, and says `--restart` starts with none. The tests still fail the gate; only the
cause line changes. Three suites in one session had blamed the features for it.

The CE7247 hint follows the message. Mendix uses that code for a reserved name and for an invalid
URL: a REST client BaseUrl set to a constant is stored as `'{@Mod.Const}'` and refused. The hint had
told a session to rename Owner/Type/Default. It now names the BaseUrl fix, and it says nothing for
a CE7247 text it does not know.

A Marketplace module the app needs now waits for the person's login (`tests/marketplace-login.sh`).
When mx check reports "couldn't find the X module in your app" and mxcli is not logged in, the
precheck or the gate stops with a short instruction. It says to create a token, run
`./mxcli auth login` in your own terminal, and never paste the token into the chat. From then on,
every `mxcli exec`, gate run and `mxcli marketplace` call is refused with the same message. Once
mxcli is logged in, it lets go by itself. Logged in, the hint says how to install the module:
`marketplace search`, then `install <id>`. orient.sh shows the login state at the start.
Only the exec hook's precheck (`--for-exec`) sets the wait: a precheck run by hand on a probe script
only says what an exec would need. A session that probed a throwaway Business Events script that
way set the wait for real and could not clear it. The login message also names the way out:
`MDL_MARKETPLACE_LOGIN=report`.
`MDL_MARKETPLACE_LOGIN=report` in tests/harness.env is for unattended runs: nothing waits, and the
feature is reported as not built, not imitated. A DeepSeek session had built Java imitations of
three module-based features, and the gate passed them. The guard also keeps the token out of the
session: it refuses reads of `~/.mxcli/auth.json`, `$MENDIX_PAT`, and a dump of an environment
that holds it. While a login is pending, the end-of-turn gate (Pi, OpenCode, Codex, Cursor) stays quiet so the session can stop and wait, and the session cannot delete the wait flag. The first live test showed the Pi gate follow-up sending a session that had asked for the login back to work.
Only running the gate waits: reading tests/gate.sh (grep, cat) and `mxcli marketplace --help` pass.

`SCOPE01` (check `scope`, a warning; `MDL_SCOPE=error` blocks): a page's data source microflow
retrieves an entity with nothing tying it to the user, while the page's role reads that entity
through an XPath-scoped access rule. A microflow does not apply entity access, so the rule never
reaches those rows: a customer portal showed another customer's invoice this way and only its
verify test caught it.

`VIEW01` (check `security`, blocks DONE): a view entity a role reads with no XPath constraint,
while that role sees only its own rows of an entity the view's query reads. Pi gave its Customer
role `read *` on two views that total every customer's invoices, so each customer could read the
others' figures. A role with no rule on that data at all (a manager on a dashboard) is not flagged.

A scenario run outside the gate's runner (peek.sh, or a test run by hand after the gate) opens the
browser itself when playwright-cli says none is open, and runs once more; two sessions retried the
same command on "Browser 'default' is not open". `MDL_CLOSE_BROWSER=1` in `tests/harness.env`
closes the browser after each suite and on `--stop`: sessions left theirs open, 39 of them at once
(6.5 GB). Off by default, since `--only` reuses the open browser and its sign-in.

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

When `--watch` does not rebuild at all after an exec -- the model is newer than the boot log's last
line for 15 seconds (`MDL_WATCH_MISSED_SECONDS`) -- the gate restarts the app itself, as
`--restart` would, so the suite runs on the current model. Pi's exec of three view entities left
the watcher silent, and `mxcli oql` said the new entities did not exist.

After an `mxcli exec`, the hook names what the scripts it ran put back that another script had
changed (`script_overrides.py`): a `create or modify page` drops another script's `alter page`, and
a `grant` restores access another script revoked. It replays the scripts beside it in name order,
so a revoke that a later script grants back again is not reported, and an `alter page` that only
sets values the page source already has is not either. Pi re-ran `07_dashboard.mdl` and gave the
Dashboard back to a role `20_access.mdl` had taken it from; a test failed on it.

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
(`VIS03`), a chart that cannot be seen whole on one screen (`VIS04`: taller or wider than the
screen it scrolls in, or inside a box that scrolls sideways). The gate names the page from the widget names in `mdlsource/` and lists each problem
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

The gate asks for every warning to be fixed together with the next real fix, never in a gate run
of its own. After DONE it says to leave them for the report, which names each one as what to fix
next. Its old "fix them anyway" sent sessions back for more full gates after DONE, just for warnings.

Lint warnings were only counted, so a commit inside a loop (`CONV011`, one database call per row)
surfaced at the end of the work, or not at all: Pi fixed seven of them a turn later. From bundle
2026.10.08.1 the gate listed each one under its warnings; since 2026.10.09.2 the gate does not run
`mxcli lint` at all (the person's decision: lint's advice is read on request, `LINT01` in the
rulebook), and the pitfall in the syntax digest shows the right form up front.

`PERF02`, `PERF03`, `PERF05` and `PERF06`, warnings from the naming step: a loop over a retrieved list that only
adds up its rows, a database call per row inside such a loop (a retrieve, a Java action, or a flow
that reads or writes), and a whole table retrieved and filtered with `if`. Pi's B2B dashboard summed
10,680 orders in a loop on every open. Measured on a copy: the loop 160 ms, `count()`/`sum()` right
after the retrieve 159 ms, one OQL view entity 60 ms -- so the fix named is the view, and the
condition in the retrieve's XPath. `PERF06` is a loop that only keeps the largest or smallest value
(the next invoice number): one `retrieve ... sort by ... desc limit 1` returns that row. `$X = ...`
without `set` counts as an assignment too; Pi wrote it that way and PERF02 missed it. Seed and
demo-data flows are skipped.

`PERF07`, also a warning from the naming step: an attribute a retrieve or a page's data source
filters (`=`, `<`, `>`) or sorts on, with no index that starts with it. Mendix indexes `id`, every
association and every attribute with a uniqueness rule itself (checked in PostgreSQL); InvoiceB2B
filtered invoices on `PaymentStatus` and `DueDate` and sorted orders by `DateCreated` with none.
Measured on a copy of its orders: at 200,000 rows the newest order by date took 35 ms without an
index and 0.01 ms with one, one status 9.7 ms and 2.0 ms; at 10,000 rows both stay under 2 ms. The
naming step now also describes the entities and pages for it. Booleans, `!=`, `contains()`, view
entities and seed flows are left out: an index does not help them, or they run once.

`DS01` (`checks/datasource_rules.cjs`, naming step, blocks DONE): a data grid, list view or gallery
whose microflow or nanoflow source only retrieves its rows -- a database retrieve with an XPath and a
sort, or association steps from a parameter, an optional `sort()`, a `return` -- must take a
`database` source. The database then pages, sorts and filters (Data Grid 2's column filters run on
the server), and the entity's access rules apply; a flow's list goes to the client whole and is
paged there. The finding prints the source: the flow's XPath with each parameter replaced by what
the widget passes (`'[%CurrentObject%]'` for the enclosing object), an association step as
`[Assoc = $Param]` on the row entity mxcli's `-- Context:` line names, `sort()` as `sort by`.
Loops, calls, aggregates, `first` and joined lists are left alone. Over 34 local apps 67 of 171
list widgets took their rows from a flow; InvoiceB2B had 13, all bare retrieves. Its suggestions,
applied to a copy (Order_Detail, Customer_Home), passed mx check with 0 errors.

`EVENT01`-`04` and `ERR01` (`checks/event_rules.cjs`, naming step, with the entities and pages it
already describes) read entity event handlers and error handlers. Two block DONE: a commit handler
that commits the object it was called for with events (it runs itself until the app crashes), and
a before handler without `raise error` that can return false (the save is skipped in silence). Three
warn: `without events` on an entity whose commit handler then does not run, Save changes on an
entity a before-commit handler refuses with an error (the user sees "An error has occurred"), and
an error handler with no log, raise, message or return (`on error continue` is mxcli's CONV014).
Neither mx check nor the lint rules see any of them. Over 34 local projects they found nothing: six
handlers in all, each a correct `before commit ... raise error`; one first draft of EVENT02 flagged a
handler returning a variable that is only ever `true`, so a returned variable counts only when it
can be anything else. They guard against the failures, not a measured backlog. A bare `commit $X;`
runs the handlers in MDL as in Studio Pro.

PERF07 and PERF08 also read the queries inside view entities: `i.DueDate < ...` in a view's OQL
wants an index like a retrieve's XPath does. Pi kept a `(DueDate)` index two views filter on, and
PERF08 called it unused. A query that compares an association with `=` gets no PERF07: Mendix
indexes every association itself, a model index cannot include one, and an attribute index adds
little after it. For PERF08 such a query still counts as a use.

PERF07 suggests one index per query, not per attribute: the attributes its XPath compares with `=`
first, then the first range comparison or sort. `PaymentStatus = ... and DueDate < ...` gets one
`(PaymentStatus, DueDate)`; at 200,000 rows the newest order of one status took 9.9 ms with no index,
2.6 ms with an index on each attribute and 0.01 ms with one `(Status, DateCreated)`. An index on
(A, B) also serves a query on A alone, so that shorter suggestion is dropped, and an existing (A)
the new index replaces is named with its `drop index` line. Pi, told to index each attribute on its
own, added twelve single indexes where two queries wanted one of two columns each.

`PERF08`, a warning too: an index of the model that no query needs. Either another index starts
with the same columns and serves every query it does, or no retrieve, page data source or grid
filter uses it better than another index. Grid filters count as queries: a drop-down filter
compares with `=`, a date or number filter with a range (a text filter is `contains()`, which no
index helps). The `drop index` line spells the index as written, `desc` included, since mxcli
matches it exactly. Pi kept `(CapturedOn)` and `(DueDate)` after adding `(Currency, CapturedOn)`
and `(PaymentStatus, DueDate)` for the same queries. Keep an index Java, OQL or an outside client
filters on; the model does not show those.

After a full DONE the gate remembers what it saw. A DONE on the same model, tests and `theme/` says
"a repeat proves nothing new": Pi once re-ran a green gate three times in two minutes on an
unchanged app, "to confirm stability". `theme/` counts because a session that only sized a chart
in a stylesheet was told its DONE was a repeat.

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
round trip. The first digest carried the `Syntax:` blocks of nineteen leaf topics (25 kB); seven
later sessions (445 lookups) showed what sessions actually ask for is the **index** pages -- the
bare `./mxcli syntax` 27 times, `syntax microflow` 51, `page` 36, `security` 16, `layout` 15 --
while the nineteen leaves were looked up 10 times in 89 with the digest in the prompt. The digest
now holds the index rows (a topic per line, so a session names the leaf it needs in one call),
the small leaves every app writes (roles, page access, variables, retrieve, show page) and the
pitfalls: 14 kB, made from the project's own `./mxcli`, so it matches the version; its first line
records which one, and it is written again when the version or the topic list changes.

A file the agent is told to read was not enough -- a fourth session listed the digest's table of
contents and still asked 165 times -- so the digest now goes where each host loads instructions
by itself: `.claude/rules/mdl-syntax-digest.md` (Claude Code), `.cursor/rules/mdl-syntax-digest.mdc`
(Cursor, `alwaysApply`), `opencode.json`'s `instructions` (OpenCode), the system prompt the Pi
extension extends (Pi); under Codex the rules say to `cat` it once. The installer writes it --
Claude Code reads `.claude/rules/` only when a session starts -- and `tests/orient.sh` keeps it
current (`mdl_syntax_digest` in `portable.sh`). The rules file keeps only what no `syntax` topic
says: the spacing, grid-filter and message rules that are this harness's own.

### One source for what every host repeats

The per-prompt reminder is one template, `checks/reminder.txt` (installed as
`tools/mdl-checks/reminder.txt`), with three placeholders a host fills in -- its rules file, how it
loads `test-first-delivery`, and whether a hook runs the precheck for it. The Claude, Codex and
Cursor hooks source `hooks/remind-skills-lib.sh` for it; the OpenCode plugin reads the same file.
Five copies had drifted apart before. The two before-exec hooks (Claude/Codex, Cursor) share
`hooks/before-mxcli-exec-core.sh` -- the inline-MDL scan, the script list, the precheck call and
the block messages -- and keep only how they read the call and answer it. The OpenCode plugin and
the Pi extension share `checks/plugins/harness-core.cjs` (installed as
`tools/mdl-checks/plugins/harness-core.cjs`): the bash runner, the guard call, the decision before
and after an `mxcli exec`, the gate's follow-up message. Both load it with `createRequire` from
either place, so the hosts' loaders see one ordinary module each. Behaviour is unchanged; the
audit's 238 tests say so, and three changes in one day that each touched four or five files would
now touch one.

A green `--only <feature>` run ends with what coverage says now ("Audit: 11/20 -- the full gate
cannot pass yet; the next feature and its test first", or "every element is covered: the full gate
can pass now"): DeepSeek ran 15 full gates in an hour on the footer's bare "run bash tests/gate.sh",
several with coverage still 0/24. Advice only; no verdict changed. The precheck's "move them into
ONE .mdl" advice now also follows a "microflow not found" / "page not found" (a calculated
attribute's microflow, or a page's action microflow, in a later script), not only an unresolved
reference.

### What a session reads before it starts, measured

Seven Pi sessions (GLM, DeepSeek, Qwen, mtplx) were measured for where their context went. The
fixed prompt (rules 19 kB, digest 25 kB, `AGENTS.md` 6 kB) was the smaller part: the rules told
every session to read four skills before writing anything -- `test-first-delivery`,
`module-structure`, `naming-and-captions`, `spacing-and-layout` -- 62 kB per session, re-read
after every compaction (`spacing-and-layout` five times in one session), and the layout findings
those skills describe came anyway, each with its fix, which is what the session then applied.
Text in the prompt did not land (the "grant in the same script" pitfall was in it; CE0557 came);
a hint at the moment of the error did (CE1613 fixed in one try).

The one skill every session reads, `test-first-delivery`, is a 9 kB core: the loop in one
screen, with each step's facts as a line, and what a test can call. The step-by-step prose and
its worked example are in `reference/loop.md`, beside `scenario.md`, `facts.md` and
`gate-and-suite.md`, and are read only when that step is the one in hand (it was 12 kB, half of
it the loop told twice).

Security best practices (`checks/security_rules.cjs`, step `security`, bundle 2026.10.08.4), from
Mendix's own "Best Practices for App Security", read from a copy's catalog and `show project security`.
Blocking: a constant named for a secret with a default value (`CRED01`), the guest role creating or
writing a persistent entity (`ANON01`), strict mode off (`STRICT01`), a page that shows a role its own
rows through `[%CurrentUser%]` while the role's access rule reads every row and no page of it lists them
all (`FILTER01`), a query built by joining text and a variable (`SQL01`). Warnings: an entity that
specialises `System.User` or `Administration.Account` (`EXTENDS01`), an HTML Element in innerHTML mode
showing an attribute a user types (`XSS01`), a role that may write attributes only flows set and none
of its pages edits (`WRITE01`), and two for the person, since mxcli cannot change them: the admin still
`MxAdmin` (`ADMIN01`) and a password policy without a symbol, digit or mixed case (`PWD01`). Codes and
fixes: `tests/checks/security.md`. Measured on 32 local apps: STRICT01 on 15, CRED01 on 3 (B2B's
`MockApiPassword` and `WarehouseDbPassword`), EXTENDS01 on 2, WRITE01 on 19 (computed totals and
statuses); ANON01, FILTER01, SQL01 and XSS01 on none, FILTER01 and XSS01 proven on a copy given one.
Bundle 2026.10.08.5: on B2B the CRED01 fix cost a session 8 minutes in the harness's source -- the
finding said `create or modify constant` (SCRIPT01 refuses a second create) and SCRIPT01 said "or with
`alter constant`", which mxcli does not have. CRED01 now says to blank the default in the script that
creates the constant (a script of its own when STALE01 refuses the re-exec); SCRIPT01 offers `alter`
only for entity, enumeration, page, snippet, microflow, nanoflow and workflow.
Bundle 2026.10.08.6: WRITE01 skips an attribute a nanoflow or an `@applyentityaccess` microflow sets --
those run with the user's rights and need the write right (73 -> 70 warnings on 32 apps). Its message
names the associations the role writes, to keep in a `write (...)` list, which drops what it does not
name: on B2B the session narrowed the write lists, the order's customer picker turned read-only and
nine tests failed. On a copy with the old rules put back, the list the finding names is the one the
session reached by trial (`Order_Customer, Order_Workflow`, `OrderLine_Order, OrderLine_Product`, ...).
Bundle 2026.10.08.7: UI001 (a hand-built filter bar over a grid) blocks DONE -- its `.star` rule was at
warning level, so it never did, though the docs said so; 2 of 32 local apps have one. The lint detail
now shows each error with its fix: mxcli 0.25 marks errors with a different glyph, and the gate printed
an empty detail under a red lint verdict. MOD001 stays a warning: FOLDER01 blocks the same.
Bundle 2026.10.08.8: `URL01` (step `layout`, `layout_rules/urls.cjs`) -- every page of the app's own
modules that is not a pop-up or login page has a URL, whenever Mendix allows one. Measured with mx check
on Mendix 11.12: a URL takes a segment per parameter, `{Order/Id}` or `{Order/OrderNumber}` for an
object and `{Qty}` for a value (one missing is CE5601), and a non-persistent entity cannot be in a URL
(CE5605), so such a page is skipped. The finding prints `alter page ... { set Url = '...' };` with a
segment per parameter; on a copy of InvoiceB2B the twelve it printed passed mx check. Almost no
local app has URLs yet (0-1 each, 9-17 pages without on the B2B apps).
Bundle 2026.10.08.9: the layout step writes every finding to `.mxcli/layout.txt` and says so when the
detail shows only twelve; on InvoiceB2B URL01 found seventeen pages and the session read the checker's
source for the other five. (The B2B session then reached DONE: seventeen URLs, and the URL change
surfaced a CE2729 page leak -- a customer page showing an internal note -- which it fixed.)
Bundle 2026.10.09.1, from an InvoiceChase session built from scratch (Qwen 3.8 27B, then Flash Next;
DONE in 50 minutes): a credentials.env without a final newline lost its last password (the scenario
read it with `while read`); precheck now says when a script clears an old error and Mendix reports what
lay behind it, in other scripts' documents -- fix them where they are created, all in one exec; SCRIPT01
compares only the owner scripts in `mdlsource/`, so an old one-off no longer blocks the next repair; and
two pitfalls: a user's roles are the reference set `UserRoles`, and `create module` takes nothing else.

`FOLDER01` (`checks/check_folders.cjs`, step `folders`, bundle 2026.10.08.1): every document of the
app's own modules sits in `<business folder>/UI` (pages, snippets, layouts), `/FNC` (microflows,
nanoflows) or `/ENV` (everything else: enumerations, constants, Java and JavaScript actions, JSON
structures, mappings, REST and OData services, workflows, scheduled events); what the module shares
goes in `_Shared/<kind>`, and a business folder may nest (`Orders/Approval/UI`). Read from
`CATALOG.OBJECTS` on a copy, as `unused` does; a published OData service's folder from DESCRIBE, since
mxcli 0.25's catalog records none for it. The finding prints a `move` per document; a root document
gets the business folder its name uses (`ENUM_OrderStatus` -> `Orders/ENV`), else `_Shared`. MOD001 now
takes a final `UI`, `FNC` or `ENV`. On a copy of InvoiceB2B: 209 documents outside, the 209 moves in one
exec (26 s), then FOLDER01 and MOD001 clean and mx check 0 errors.

Bundle 2026.10.07.13: each suite run starts by clearing what the previous one left -- playwright-cli's
page snapshots, console logs and downloads at the top of `.playwright-cli/`, and the
`verify-*-failure.png` screenshots -- so a failure keeps its screenshot until the next run. InvoiceB2B
held 618 snapshots, 420 logs, 180 invoice PDFs (7.7 MB) and 26 screenshots. The installer adds
`/.playwright-cli/` to `.gitignore`.

`STALE01` (`tests/precheck.sh`, bundle 2026.10.07.10): a script run again does not write over what
changed in its documents since it last ran. On InvoiceB2B a re-exec of `11_navigation.mdl` rebuilt
`Admin_Home` and put back twelve widget names a later rename had replaced; the gate caught it only
afterwards (NAME02). The after-exec hook keeps each applied script in `.mxcli/applied/` (the guard
keeps sessions out of it); before the next exec of the same script, `mxcli diff` of that copy names
the documents the model changed since, `mxcli diff` of the script the ones it would write, and a
document in both refuses the exec with its name and the fix (a new script that alters only what it
changes, or the documents DESCRIBEd into the script first). Without a copy, the version in git's HEAD
stands in; a script never run is not checked. On a copy of B2B it refused `02e_turn3_approval.mdl`
(three pages renamed since) and passed `57_indexes.mdl`; the precheck takes about 5 s longer then.

`MDL_DB_RESET=session` (`tests/db-snapshot.sh`, bundle 2026.10.07.7): browser tests commit on every
click -- Mendix has no transaction around a whole session the way UnitTesting rolls back one microflow
-- so the data each session's tests created stayed, and on InvoiceB2B the suite spent a seeded
customer's credit until the approval tests were refused. With the switch on, the first gate, orient
or film run of an agent session takes a `pg_dump` of the dev database while the app runs (0.5 s for
30 MB), and the session's first full DONE rolls it back: `pg_restore` into a database beside it, stop
the app, swap the two by renaming, boot (about 30 s; the B2B gate went from 92 to 118 s once). The
same session takes no second snapshot; the next one does. The session is the id the hooks write to
`.mxcli/session.id` (Claude Code and Codex from the prompt hook's `session_id`, Cursor at session
start, Pi per session, OpenCode per tool call). Local PostgreSQL only, not in Docker mode. A step that
fails leaves the database as it was and boots the app; the previous data stays as
`<db>_before_restore`, the last three dumps in `.mxcli/db-snapshot/`. Measured on B2B: 1796 orders,
1798 after a test, 1796 after DONE, the app up on it. Bundle 2026.10.07.8: a reinstall keeps every
key of `tests/harness.env` it does not write itself; it used to write the file from scratch and drop
the person's own switches.

Bundle 2026.10.07.6, three fixes from the B2B session: a `scenario '...'` body that an apostrophe
cut short while the file still parses (`// the customer's order`) is named with its line before the
suite runs, where the runner said only "returned nothing"; the installer gitignores the
`verify-*-failure.png` screenshots `mxcli playwright verify` writes beside the .mpr; PERF08 counts a
combo box's `CaptionAttribute` as a sort on that attribute (it called a product picker's (Name)
index unused) and reads a data grid whose `DataSource:` sits on its own line (mxcli 0.25), so its
column filters are queries of that grid's entity.

Step `paths` (`checks/check_paths.cjs`, `checks/outcome_rules.cjs`): every testable path of the model
needs a test that walks it. The paths come from the model, never from an app's names, so the rule
holds for any app: `OUTCOME01` every message a user can be shown -- `show message`, `validation
feedback`, an attribute's `error message`, and text handed to a flow that shows it or stores it for a
page (found by what the flow does: its String parameter reaches a message, or a stored attribute when
three or more flows hand it their text; a seed flow saving a name is one caller) -- asserted by four
words in a row outside a comment line, placeholders splitting the text; `WF01` a flow that completes a
workflow user task without reading the task's target users (anyone allowed to run it decides);
`WF02` every user-task outcome chosen in a test, and a test of the task signing in as two users;
`ISO01` each role reading an entity through an XPath constraint has a test signed in as such a user
that reads it; `ROLE01` every demo user's role signs in somewhere; `SVC01` every published REST and
OData service is called. A test signs in as a demo user when its text names that user. The installer
writes `.mxcli/gate-cache/paths-baseline.json` once, from the model as it is: paths unchanged since
are warnings (the backlog; `MDL_PATHS=error` blocks them too, and `.mxcli/paths.txt` lists every
finding after each gate), new or changed ones block; a new app gets an empty baseline, so
everything blocks. WF01 blocks whatever its age. The guard keeps the baseline and `MDL_UNTESTED`
(the person's list of paths left untested on purpose) out of a session's reach. Measured over 34
local apps: 227 messages, 213 matchable, 158 asserted by no test (InvoiceB2B: 46 of 55); the
approval of InvoiceB2B let any Employee decide a manager's task (WF01). `scenario-helpers.js` gained
`sign_in_as('<user>')` for journeys of several people, and `await_message` now matches only text that
appeared after the last click, fill or key press: before, any text already on the page satisfied it.

`UNUSED01` (`checks/check_unused.cjs`, step `unused`, blocks DONE): a microflow, nanoflow, page,
snippet, enumeration or Java action of the app's own modules that nothing uses. Three proofs must
agree, all on a copy of the project (the catalog is written beside the .mpr it reads, and the
suite refreshes the app's own at the same time): no reference in mxcli's catalog (`CATALOG.REFS`
-- calls, pages, data sources, navigation, settings, scheduled events, published services -- and
no attribute or parameter of the enumeration's type); the short name in no other document's MDL
source or strings (a comment, an OQL query) and in no file under `javasource/` (proxies aside),
`javascriptsource/`, `theme/`, `themesource/` or a `tests/*.test.*` file -- not on a `# covers:`
line, which every page and `ACT_` flow is on (coverage), so it declares, not uses; then every one of them is dropped on
the copy and mx check must still report 0 errors -- else nothing is reported. The finding lists
the `drop` statements. `mdlsource/` is not a proof: it holds the scripts that created them. A
document kept on purpose goes in `MDL_KEEP_UNUSED=Mod.Doc,...` in `tests/harness.env`, set by the
person (the guard blocks a model setting it). Over 34 local apps 67 were left; InvoiceB2B had 15
(13 `DS_` flows its DS01 fix replaced, a seed-reset flow, an enumeration), and dropping all 15 on a
copy passed mx check; a page still shown by a button, offered as a candidate, failed it with 2
errors and was not reported. The step takes 7 s when it has candidates, mostly the copy's mx check.

So the rules are 8 kB and name one skill to read first; the others are named by the finding
that needs them, and the per-prompt reminder says the same. What each check code wants and its
fix is written down once -- sessions had grepped `tests/gate/*.sh` (90 to 228 kB of it per
session) for what `HOME01` or `--only` required -- and a red verdict points at it. Since bundle
2026.10.04.9 that is one file per gate step, `tests/checks/layout.md`, `lint.md`, `naming.md` and
`paths.md`, `app.md` (mx check, coverage, security, scope, unused, the suite, visual and runtime), each under 4,500
characters, with `tests/CHECKS.md` as the index of which file holds which code. The one page had
reached its 9,300-character budget, and a red verdict now names only the files of the steps that
failed, so a session reads 1.3 to 3.7k characters instead of 9.3k.

The model checks describe each module's documents with one mxcli call per module and kind, not
one per document. On InvoiceB2B's model the microflows took 2 s instead of 11 s and the entities
under 1 s instead of 2 s, with byte-identical text; `naming` and `layout` each spent about 18 s,
most of it starting mxcli once per document. mxcli stops at the first document it cannot
describe, so then the step falls back to one call each, which names the one that failed.

The gate and the after-exec hook warn when Studio Pro has the project open: lsof shows a Studio
Pro process holding a file in the project directory (on Windows, without lsof: Studio Pro is
running). Studio Pro keeps the model in memory and saves its own copy of a document over what
mxcli wrote. On InvoiceB2B it rewrote the Orders domain model at 19:13, and twelve indexes an exec
had added at 18:47 were gone from the model and, after a restart, the database; the session took
the gate for the cause. The runtime Studio Pro starts carries `-Dmendix.running.locally.by.studiopro`
and is not counted.

Captions bind after the first DONE. While the app is built they stay warnings (286 at once had
swamped a session with no test green), but InvoiceB2B then carried 640 of them through every
DONE, since nothing asked for them. Each full DONE now keeps a hash of every microflow's text
(`.mxcli/gate-cache/captions-baseline.json`; where its boxes sit does not count). From then on a
microflow that is new or changed since the last DONE fails naming until its actions, decisions
and loops have captions; older ones stay warnings. The first DONE with a backlog says once:
clear it module by module, then run the full gate once.

Bundle 2026.10.04.13 is the first step of the audit of 2026-10-04 (`docs/audit-mxcodr-2026-10-04.md`
in the development repo): security, and checks that passed without running.
- A port from `tests/harness.env` (or the environment) is digits or it is ignored, and said so.
  Bash runs a command substitution inside `$(( ))`, so `APP_PORT=x[$(cmd)]` ran `cmd` in every
  script that sources `tests/portable.sh`; `APP_PORT=1@host` sent the test password to that host.
- "A check that did not run has not passed" now holds in six more places. `scope`: a checker that
  crashed counted as warnings. `layout`: an unreadable security level read as "security off" and
  skipped NAV01 and NAV03; user roles that could not be listed or described silenced ACCOUNT03,
  HOME01 and MODULE01. `security`: a crash of `view_access.py`, or entities that could not be
  listed, read as "level Production". The suite: no `Total:` line with exit 0. `visual` and the
  runtime log: a crash of `gate_helpers.py`. Each is now "could not run". Snippets, layouts and
  flows the layout check reads as extra input still do not block when one cannot be described,
  but the gate names the rules that may have missed a finding.
- Entity names from the model are checked (`Module.Entity`) before they become file names.
- PERF08 reports nothing when no query at all was recognised (it called every index unneeded),
  and PERF07 no longer tells you to drop the index of a `unique` attribute.
- The timeout watchdog ran into "BASHPID: unbound variable" on macOS's own bash 3.2.
- `--restart` and the boot stop only this project's `mxcli run`: one started in this directory or
  naming it. Two projects whose `.mpr` has the same name used to stop each other's app.

Bundle 2026.10.04.14 is the audit's second step: the rules written on 2026-10-04, and the guard.
- PERF07: an `or` in a condition is two lookups, each with its own index, not one index on both
  attributes; `[$Wanted = Status]`, the attribute on the right, is read; a page source written
  `database X` without `from` is read; a grid filter is reported on the page that has the grid.
- PERF02: `$Text = $Text + $Item/Code + ','` builds a text and is not a sum. A comment after a
  statement no longer joins it to the next line, which hid the loop that followed a retrieve.
- VIEW01 matches an entity whose name is quoted (`Orders."Order"`).
- The after-exec note follows the order the scripts ran in: `exec 20_access.mdl 07_dashboard.mdl`
  grants again what 20 revoked, and is now reported. A property set by an `alter` counts as
  already in the page source only when it is on that widget.
- The guard reads four ways around it: a `cd` before the write, a link to a guarded file, a copy
  into its directory, and inline `python3 -c` or `node -e` that writes `harness.env`. Without a
  working Python it no longer lets a call that names `harness.env` through unread.
- `scenario()` hands its script to playwright-cli by file (`--filename`): as an argument the test
  password showed in `ps`. An older playwright-cli gets it the old way.
- The gate does not write its boot log or cache through a symbolic link, and the installer's EXIT
  trap no longer evals a value from the caller's environment.

Bundle 2026.10.04.15 is the audit's third step: a checker that recognises nothing has not passed.
The checkers are regular expressions over what mxcli prints, and mxcli's next release prints it
differently (`create or modify navigation`, user roles as property lists). A checker that matches
nothing used to report zero findings, a PASS. Now the gate tells each checker how many documents
it described: `naming` with none of the microflows recognised, `layout` with none of the pages,
no navigation profile or no user role recognised, and `security` with no entity recognised each
say "could not run", naming the describe format as the cause. The index rules say "not checked"
instead of calling every index unneeded. The caption baseline carries the mxcli version that
produced it and starts over when it changes, so a new describe format does not turn every
caption warning into a failure at once. Names that mxcli lists are checked (`Module.Name`)
before they become MDL statements or file names. In the development repo a real project's
describe output is kept as a fixture, with the number of documents mxcli listed; a test asserts
that every parser recognises that many (`tools/dev/make-golden-dump.py` regenerates it with a new
mxcli, and the test then names the parsers that went silent).

Bundle 2026.10.04.16 is the first part of the audit's fourth step: copies that had drifted, and
the guard as a module. No rule changed.
- The Cursor before-exec hook had lost two rules the Claude Code hook has: a `sleep` before the
  gate, and a script named through a shell variable (`mxcli exec mdlsource/$f.mdl`), which
  precheck could not find and let through.
- The after-exec hook's own module list did not leave out `MxTest`; `tests/orient.sh` asked the
  coverage checker one module at a time, which reports a test covering another module's page as
  stale. Both now do what the gate does.
- The guard's decision moved out of the hook, where it was 227 lines of Python in a shell string,
  into `checks/guard_harness.py` (installed as `tools/mdl-checks/guard_harness.py`), unchanged. The
  hook finds it in the bundle and installed, and without it blocks a call that names `harness.env`.
- A test compares the copies hooks keep of shared helpers (`mdl_find_python` in ten files, the
  Studio Pro process pattern, the module list), so a fix made in one copy and not the others fails.
- `gate_helpers.py runtime-age` no longer stops with a traceback when the `.mpr` is gone; comments
  that described older behaviour ("five model checks") say what the code does.

Bundle 2026.10.04.17 fixes what the first real Windows run of the audit's changes showed. On
Windows Python's `print()` ends a line with CR LF, so the entity names the gate reads into bash
kept the CR and matched no describe file. Until the audit that failure was swallowed (`|| true`),
so `VIEW01` and the index rules (`PERF07`, `PERF08`) never ran on Windows; once a check that
could not run stopped counting as a pass, `security` said "could not run" there and the gate could
not say DONE. The two inline scripts whose lines bash reads (entity names, user roles) now write
LF, as the module list already did. Verified in the Parallels Windows 11 VM: the installer, then
the gate with the app booted by `tests/run-app.sh`.

Bundle 2026.10.04.18 changes no behaviour. The five Python blocks `install/step_hosts.sh` held as
heredocs (the merges into `.claude/settings.local.json`, `.codex/config.toml`, `.codex/hooks.json`,
`.cursor/hooks.json` and `opencode.json`) are files under `install/hosts/`, byte for byte the
same code, run with the same argument. Old and new were run on the same inputs (no file, an
existing file, twice in a row) and the whole hosts step on an empty project: the files written
and the output are identical. `step_hosts.sh` went from 237 lines to 53.

Bundle 2026.10.04.19: on Windows an early exit of the gate once printed `rm: cannot remove
.../mxcheck: Directory not empty`. Git Bash has no `pgrep`, so the cleanup stopped the bash job
but not `mx.exe` under it, which was still writing into the scratch copy. The cleanup now stops
the whole tree with `taskkill /T` there, retries the removal for up to five seconds, and says so
in one line if the directory still cannot go. The verdict never depended on it. Twelve early
exits and a full gate in the Windows VM left no scratch directory behind; the original message
itself did not come back in any of them, old bundle or new. The
summary line about microflow tests (`*.test.mdl`, not run by the gate) is printed once the suite
is green: while it was red, two sessions took the line as the next job and spent 20-40 minutes
on tests that do not count for DONE. The gate's requirements themselves are unchanged.

A test's `# covers:` line may name a published OData or REST service as well as a page, snippet or
microflow: an OData test named its service, failed coverage with "8/8 covered", and the session
rewrote the checker. A name that counts for nothing now says why ("an entity -- name the page or
microflow the test drives instead"). Shell values reach a scenario as `vars.<NAME>` from
`SV_<NAME>` (`SV_PW="$pw" scenario '... vars.PW ...'`), JSON-encoded: splicing `'"$pw"'` into the
body cost DeepSeek, Qwen and GLM minutes each.

On top of the digest sits `checks/mdl-pitfalls.md` (installed as `tools/mdl-checks/mdl-pitfalls.md`):
twenty "write this, not that" lines for what cost measured sessions the most time (six of them confirmed by a second model on the same prompt) -- the
`[%CurrentDateTime%]` token, a token's quoting inside `where '...'`, the association/entity path
of an access rule, reference combo boxes, `Account.Name`, and in tests the scenario runner (no
`fetch` or `Buffer`: `page.request` or `curl`; `result=$(scenario '...')` with no quotes around it). Two Pi sessions (Qwen 3.8, DeepSeek 4)
asked `mxcli syntax` 56 times between them, yet lost their time to these, not to syntax. Every
example in the file passed `mx check` on mxcli v0.24.0. The digest is a fixed prefix -- it changes
only with the mxcli version, the topic list or the pitfalls -- so a host with a KV cache (Pi on
DeepSeek) computes it once. Before each PR, check the current mxcli and bring both up to date.
The digest now holds nineteen topics (microflow create, variables and retrieve, and project
security joined), about 25 kB.

### What `tests/precheck.sh` does and does not catch

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

## Faster without being weaker

`bash tests/gate.sh --changed` runs the tests a model change touched: each test remembers, after
a run, the state of the units (`mprcontents/*.mxunit`) its `# covers:` line names, and the gate
picks the tests whose units moved since, every test after a change no test can name (the domain
model, security, navigation), and a test that never ran here. It fills the gap between `--only`
(one test, ~2s) and the full gate (every test, ~50s): a session once ran seven full gates, several
only to see whether anything else had broken. It ends in PASSED, never DONE.

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
  and runs the gate. The stale-model warning names it. Git Bash on Windows has no
  `pgrep`, so there it asks PowerShell for the processes that name the project's
  folder and stops them with `taskkill`.
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
`SPACE04` | error | a button or text right on top of, or right under, a box (data grid, list, gallery, group box, tab container, a card or coloured container) with no margin between them; a button in a grid's `controlbar` without `margin-bottom` |
`HEAD01` | warning | the page renders no heading and calls no header snippet |
`GRID01` | error | a grid filter in a column with no `Attribute:` (and none of its own) — it renders "Unable to get filter store" |
`GRID02` | error | a button outside a data grid changes the rows it shows (creates its entity, uses its selection, or calls a flow that writes it, three calls deep); it goes in the grid's header, `controlbar` inside the datagrid |
`NAV01` | error | project security is on and no menu, page or snippet offers Log out |
`NAV02` | warning | the Log out item is not the last item of its menu |
`NAV03` | error | project security is on and a role's home page (`home page X for Role`) is not in the menu |
`NAV04` | error | one of the project's own layouts opens two or more pages from buttons — a menu built by hand |
`NAV05` | error | a menu item or sub-menu has no icon; the message suggests an Atlas_Filled icon for its caption |
`NAV06` | error | two menu entries one user role sees share an icon; only the entries the role may open count (`SHOW ACCESS` on each page and microflow the menu links to), and with security off every entry; the message suggests another icon |
`ACCOUNT01`-`03` | error | users sign in and the Administration module is there, but the menu lacks `Users` (`page Administration.Account_Overview`) or `My account` (`microflow Administration.ManageMyAccount`, which opens `MyAccount` for the signed-in user), or a signed-in role lacks `Administration.User`, or no role has `Administration.Administrator` |
`MODULE01` | error | the app has its own module with pages and the template's `MyFirstModule` is still there; the message lists what still uses it (home pages, user roles, pages or flows) and the steps to remove it |
`HOME01` | error | users sign in and the administrators' role opens on a page outside the app's own modules (the template's `Home_Web`, an Administration page) |
`ICON01` | error | a button (`actionbutton`, `linkbutton`, on a page or in a snippet) without an icon; the message suggests an Atlas_Filled icon from its action and caption |
`LAYOUT01` | error | the app's pages use more than one layout (pop-ups, the login page and phone/tablet layouts aside), so the menu changes between pages |
`USER01` | error | users sign in, and a page (pop-ups and the login page aside) does not open with `<Module>.SNIPPET_CurrentUser` on the right of its top row, after Back if there is one: the user icon and e-mail, top right, the same place on every page |
`BACK01` | error | a page another page or a flow opens (`show_page`) does not start with a Back button: `close_page`, icon `chevron-left`, top left. Pop-ups, menu pages and home pages are exempt |
`TEXT01` | error | a `textbox` edits a String longer than 500 characters or unlimited; the message gives the `textarea` that replaces it |
`TEXT02` | warning | a `textbox` edits an attribute named like prose (`Description`, `Notes`, `Comment`, `Reason` ...) of 100 characters or more |

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

`NAME01` and `NAME02` (`layout_rules/names.cjs`, `--names`) hold widget names to one app-wide
scheme, `<Page>_<What><Type>`: `OrderDetail_GenerateInvoiceButton`, `OrderDetail_InvoicesGrid`,
`CurrentUserSnippet_AccountButton`. Mendix keeps a widget name unique on its page only; over 34
local apps a third of 3,684 widgets shared their name with a widget on another page (`heading` on
18 pages of InvoiceB2B, `ctPageTop` on 17), so a test's `.mx-name-...`, a failure or a log line
named a dozen places, and 17% were Studio Pro defaults like `container3`. The page part (the page's
name, no module or underscore; a snippet's name plus `Snippet`; the module in front only when two
modules share a page name) makes a name unique; the type word at the end is plain English. NAME02
prints the name to use, from the widget's attribute, caption or data source; where nothing says
what it shows (a KPI tile) it asks for the word, and a code where words belong (`K1`, `Kpi3`, `Box2`)
fails too: InvoiceB2B first renamed `k1Value` to `AdminHome_K1ValueText`, which kept the form and said
nothing (16 such names). A number inside a word stays (`Top10CustomersGrid`); a suggestion never
starts with a digit. For a grid the finding adds that its selection variable (`$dg...`) is renamed too. On InvoiceB2B it named 364 of 389 widgets itself.
Like the microflow captions they warn until the first DONE (one line with the count and five
examples), then a page new or changed since the last DONE needs them (`names-baseline.json`);
`MDL_WIDGET_NAMES=error` makes all block, `0` turns them off. Renaming a widget breaks a test that
finds the old name, and the finding says so.

`SPACE04` came from a screenshot: "Generate invoice" in a grid's `controlbar`, where `GRID02`
puts it, sat on the grid's header row. Atlas gives buttons, text, grids, lists and cards no
vertical margin, so one stacked on the other touches. Plain containers, headings (`SPACE01`) and
a list whose items already end in a margin are left alone. Over 37 local projects it found
17 in 9 apps: 10 buttons on a grid's first row, 5 lines of text on or under a grid,
2 buttons under a grid.

`TEXT01` and `TEXT02` read the entities (`describe entity`) for the length of the text each
textbox edits. InvoiceB2B had four 2000-character fields (internal notes, an approval reason)
in one-line textboxes: the text scrolled sideways and its line breaks were lost on screen. The
length decides, so it blocks; a name alone is a hint, since `Summary String(100)` may be one
line on purpose. mxcli reads a bare `String` as unlimited.

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

Two projects run side by side when the second sets `APP_PORT=8082` in its
`tests/harness.env` (locally the admin API follows, at `APP_PORT+9`). The gate checks that
the runtime answering on its port names this project's `deployment` folder, and exits 2
naming the other project when it does not; `run-app.sh` stops only its own runtime.

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

A step of the installer that runs long shows its elapsed time on the bar (`· 1m05s`), and
the app-creation step redraws every two seconds while `mxcli new` prints nothing: its first
build is silent for minutes, and a bar stuck at "13%  creating InvoiceChasQwen3827BSplash
(Mendix ~" -- the label cut, nothing moving -- read as a freeze. The app's name now goes on
the done line, so the label fits an 80-column terminal.

## Windows

The harness is bash and Node on every host, so on Windows it runs under **Git
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
Git for Windows and Node.js (skipping whatever is already there), finds
a **real** Git Bash, and hands over to `bash install.sh <target> --with-deps`
(the default since 2026.10.01.3; `--no-deps` only reports what is missing),
which installs `playwright-cli`, its Chromium headless shell and `mxcli.exe`, then
lands the harness. With several Studio Pro versions installed it reports the newest.
It creates the app with `mxcli new --skip-build`: on Windows mxcli's first build never
returns (mxbuild leaves a Gradle daemon holding mxcli's output pipe); the gate's first boot
builds the app instead.

Three things it deliberately does not do:

- **Docker Desktop is offered, not silently installed.** When it is missing and
  someone is at the keyboard, the installer explains what needs it, shows the exact
  command, and asks. On yes it installs, offers to start Docker Desktop, lists the
  three things only a person can do (start it, accept the licence, let it set up the
  WSL2 backend) and then waits with you for the daemon — up to `DOCKER_WAIT`
  seconds, default 180, and Ctrl-C stops the waiting without stopping the install.
  With no console it falls back to printing the command. `MDL_ASSUME_YES=1` answers
  the prompts for an unattended run. When Virtual Machine Platform and Hyper-V are
  both off, Docker Desktop cannot start at all: the installer does not wait, and
  says `wsl --install --no-distribution` plus a reboot, or `MDL_RUN_MODE=local`.
- **The JDK is found, not demanded.** Studio Pro installs one as its own
  prerequisite, so a machine that can open the project usually has a usable JDK
  already — on the Windows test machine there were *three*, and none on the PATH.
  The installer looks in `JAVA_HOME` (both `$JAVA_HOME/bin/java` and the
  `$JAVA_HOME/java` shape a real machine turned out to use), Eclipse Adoptium,
  Java, Microsoft and Zulu directories, `/usr/lib/jvm` and
  `/Library/Java/JavaVirtualMachines`, and prints the path plus the one-line
  `export PATH=...` that fixes it. The version follows the project, not a
  constant: Mendix 9 wants 11, 10 and 11 want 21, 11.14+ wants 25. The version is read from
  the `version "…"` line wherever it is in `java -version` (2026.10.05.12): with
  `JAVA_TOOL_OPTIONS` set, the first line is "Picked up JAVA_TOOL_OPTIONS: …", and reading only
  that line reported "JDK 21 still missing" on a Mac with four JDKs.
- **Studio Pro** is never installed. On Windows it is the only source of `mx`
  (the Mendix CDN publishes a Linux mxbuild only, and `mxcli setup mxbuild` says
  so and refuses), so the installer *looks for* the Studio Pro versions already on
  the machine and creates the app at the newest one. `MX_VERSION` overrides.

The manual route, if you would rather do it yourself:

1. **Git for Windows** — <https://git-scm.com/download/win>. Keep the default
   *“Checkout as-is, commit Unix-style line endings”*, and tick *“Add a Git Bash
   Profile to Windows Terminal”*. Everything below is typed in Git Bash, not
   PowerShell or `cmd`.
2. **Node.js** (LTS) — <https://nodejs.org>. If the installer has not put it on the PATH
   of the shell you are in yet, the harness looks in `C:\Program Files\nodejs` itself.
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
node --version
./mxcli.exe --version
docker info                      # needed by mx check and --ensure-db
bash tests/orient.sh             # exercises mxcli, Node and mktemp together
```

What the bundle does about each difference:

| Difference | Handled by |
|---|---|
| Git for Windows, with `bash.exe` on the PATH | every command in the loop is `bash tests/...`; the OpenCode plugin also probes `%ProgramFiles%\Git\bin` and `%LOCALAPPDATA%\Programs\Git\bin` before giving up |
| Node not yet on this shell's PATH | `mdl_find_node` (portable.sh, the hooks, install.sh) also looks in `C:\Program Files\nodejs` and `%LOCALAPPDATA%\Programs\nodejs` |
| `mxcli.exe` in the project root | detected alongside `mxcli`; `install.sh` swaps out the Linux binary `mxcli new` leaves behind and keeps it as `mxcli.linux` |
| A PostgreSQL for the app | `mxcli run --local` is Docker-free but Postgres-only. Native PostgreSQL works; `mx check` needs no container at all |
| LF line endings | `.gitattributes` pins `*.sh`, `*.cjs` and `*.js`. Without it one editor save turns every line of `gate.sh` into `$'\r': command not found` |
| `bash` on the PATH is the wrong bash | `C:\Windows\System32\bash.exe` is the **WSL launcher**. `bootstrap.ps1` and the OpenCode plugin put Git's own directories first and reject anything under `System32` |
| `\r\n` from the checks | Python's `print()` ended lines with `\r\n` on Windows and bash kept the `\r` (the gate asked for module `Integration\r`). The checks run on Node now, which writes `\n` everywhere |
| No `pgrep` | the database check asks PowerShell whether a Mendix runtime is running before it calls an HSQLDB lock stale; it once said "rm it" beside a running app. When nothing can tell, it stays quiet |
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
