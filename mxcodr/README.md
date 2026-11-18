# mx-codr harness (v2, skills only)

Bundle **2026.11.11.2** (`overlay/lib/mx.mjs`, `BUNDLE`), pinned to mxcli **0.31.0** (`PIN`). The design is
`docs/plans/open/plan-harness-v2-skills-only.md` (owner decision 2026-10-31: the gate goes).

- Live mode (2026-11-05, same bundle 2026.11.05.2, nothing changes for file mode): the Studio Pro extension
  (`spikes/studio-pro-ext/`) installs this bundle from its pane with `live: true` in `ruleText`, `writeRules` and
  `copySkills`. The edits are in `overlay/lib/live.mjs` (each names the exact text it replaces and throws when it is
  gone); `overlay/templates/live.md` becomes `.claude/rules/mxcodr-live.md`; `overlay/lib/mx.mjs` gains `PIN_SHA256`
  (the release digests of the pinned mxcli, which the extension's setup checks its download against). A file-mode install
  writes byte for byte what it did: 321 files over 12 agent and coverage combinations (rule files, skills, test kit, film recorder, coverage check; re-measured for stage 4, and again for stage 4c's films) compared with the committed
  bundle, 0 differ. See *Live mode* below.
- Since 2026.11.11.2 (mx-codr 1.75.15): the pane's ⋯ item Check setup is called Setup and agents; `live.md` (where the
  agent points the person for version control) and the kit's `mx.ts` (its `oql()` error) name it so. Nothing else
  changed; the bundle number moves so that set-up apps are offered the new text.
- Since 2026.11.11.1: pinned to mxcli **0.31.0** (`PIN`, and `PIN_SHA256` from the release's asset digests).
  Measured 2026-11-11 with the darwin-arm64 binary on a copy of stage1-base-1116: `init --all-tools` writes the same
  `CLAUDE.md`, `AGENTS.md` and `settings.json`, adds `/javasource/mxtest/` to `.gitignore` and one skill
  (`mcp-server`, no clash with ours); the 37 MDL blocks of the bundle check exactly as on 0.30 (the 19 whole
  statements pass, the widget fragments fail alike); the skills' catalog queries run (the snippet-users query of
  `reuse-and-snippets` now finds snippet calls: 0.30 recorded them as page refs). `check` is stricter: `like`,
  `between`, `in (...)` and `is null` in an expression are MDL091, an unparenthesised `if` as an operand is
  MDL-IFOPERAND01, a widget bound to a missing attribute is CE1613 with `--references`. `naming-and-captions` gives
  the forms to write instead, and no longer says `check` passes `count(...)` in an expression (MDL044 refuses it on
  0.30 and 0.31). New lint rule SEC013 (warning: level Off, or Prototype with XPath on access rules);
  `app-security` asks to fix it with the rest (its Production line already does). Not measured: a Windows install.
- Since 2026.11.10.5 (mx-codr 1.75.12): `live.md` says that nothing pushes the running app's errors to the agent;
  it runs `./mxcodr-live logs --errors --since-turn` itself (the extension no longer attaches them to the person's
  message). Since 1.75.11 (same bundle number then) it also says to write files with the Write or Edit tool.
- Since 2026.11.10.4 (mx-codr 1.75.2): the kit's `oql()`, its per-test session check and the teardown work inside
  the extension's test box too (`./mxcodr-live tests run`, the Tests tab, films, `tests affected`). The box still may
  not read the hub's folder nor reach the admin port; the run outside it answers instead (owner decision 2026-11-10,
  option B; `spikes/studio-pro-ext/translator/src/oql-channel.mjs`). The run gives the box three variables:
  `MXCODR_OQL_ASK` (a folder with a random name under `.mxcodr/tests/`, which the box may write), `MXCODR_OQL_ANSWER`
  (a folder in the run's own temp folder, which the box may only read) and `MXCODR_OQL_KEY` (32 random bytes). `oql()`
  writes `{key, query}` as `<id>.part`, renames it to `<id>.json` and waits (synchronously, up to 60 s) for
  `<id>.json` in the answer folder: `{rows}` or `{error}`, which it throws as `oql: <error>`. Order: the channel, else
  the live-tool record (a run outside the box, as 2026.11.10.3 made it), else `./mxcli oql` (file mode). The run
  checks each request: a regular file (no link, no FIFO), at most 16 KiB, the run's key, one `select` (the prefix
  `./mxcodr-live oql` and the host check, and no `;`), at most 8192 characters; at most 4 MiB of rows, 15 s, 5000
  reads per run; only this app's runtime, through the same route as `./mxcodr-live oql`. `.mxcodr/oql-channel.log`
  holds the id, length, status, row count and time, never a query or a row. The comment about the query before
  `--json` stays: a live tool older than 1.75.2 still takes the word after `--json` as its value.
- Since 2026.11.10.3: in a live app the kit reaches the live tool again, in a Playwright run outside the extension's
  test box (the agent's own `npx playwright test`, a terminal). Since live.60 (2026-11-08) the extension's
  tools are in its runtime in the person's user folder and setup deletes `<app>/.mxcodr/live`, but `tests/mx.ts` still
  looked there, so `oql()`, `sessionsLeft` and the teardown fell back to `./mxcli oql`, which cannot reach Studio Pro's
  run: every spec using `oql()` failed with "cannot connect to Mendix admin API at localhost:8090" (measured on 11.12.1,
  2026-11-10). Setup's `wireTools` now writes `.mxcodr/live-tool.json` (`runtime`, `tool`, `progress`); the kit runs
  `tool` with the Node that runs the tests, no shell (Windows' `mxcodr-live.cmd` would need cmd.exe and its quoting),
  and without the variables the wrapper clears. A record that names no tool on this computer fails with "Check setup",
  never with `./mxcli`. The live `playwright.config.ts` takes the progress reporter's path from `progress` (it was
  silently left out the same way; `./mxcodr-live tests run` always added its own); `wireTestsTab` moves a config wired
  with the old line over. File mode has no record and keeps `./mxcli oql`. The query goes before `--json`
  (`mxcodr-live`'s option reader takes the word after `--json` as its value). Not changed: inside the box
  (`./mxcodr-live tests run`, the Tests tab) `oql()` still cannot read Studio Pro's run, by design since live.66/67
  (the box may not read the hub's token nor reach the admin port), so a spec that calls `oql()` fails there and the
  session check and teardown say off/unknown. Measured on 11.12.1: direct run 2 passed, `sessions left: 0`, the
  progress reporter wrote `run.json` by agent; the same spec through `tests run` 0 passed.
- Since 2026.11.10.2: a kit file an earlier install or setup wrote and nobody edited is replaced with the current kit, so
  the `signOut` fix below (and any later one) reaches apps installed before it. `overlay/lib/kit-shipped.json` holds
  the sha256 of every version of each kit file mx-codr ever wrote (plain, live with that commit's `KIT_EDITS`, and
  `tests/playwright.config.ts` as setup's `wireTestsTab` wired it), taken from git history (all refs, also the
  `mxcodr-v2/` folder before 2026-11-01) and the working tree by `node mxcodr/tools/kit-shipped.mjs`, which only
  ever adds entries. The text is hashed with CRLF read as LF (an app's git with autocrlf checks a kit file out CRLF);
  a CRLF file is replaced keeping CRLF. Any other text is the person's: kept byte for byte and named once (one line,
  and `testKitEdited` in `installed.json`), so they know the kit's fix is not in it. A link is never written through;
  an unedited teardown or config is held back when the person's edited `tests/mx.ts` lacks a name it imports. After
  changing a kit template or `KIT_EDITS`, rerun the script: `test/kit-update.test.mjs` fails while the current kit's
  hashes are missing.
- Since 2026.11.10.1: the kit's `signOut` leaves the app for `about:blank` and ends the session with the logout POST
  and the session's CSRF token (window.mx's, else the one kept at sign-in, else one read for the cookie), instead of
  `mx.logout()`. Measured on Mendix 11.12.1 with project security off: `mx.logout()` ended the anonymous session, then
  the app it reloads started a new one at once, so every test of a spec that signed out in `test.afterEach` failed
  the per-test session check (`left 1 session(s) alive ..., user(s): Anonymous_<uuid>`) and the teardown counted them;
  the same happens to a signed-in user in an app with a guest role. With the fix the same spec ran green with
  `sessions left: 0`. Since 2026.11.10.2 apps whose `tests/mx.ts` is an unedited earlier kit get it too.
- Since 2026.11.08.1: a ninth skill, `java-action-docs`, installed by default. Every Java action the agent creates
  or changes is documented in the model (what it does, its side effects, what it returns, when it fails; each
  parameter; the return value's name) and commented in its javasource file (the steps inside the user code, a javadoc
  on every helper in the extra code). The rule file's skill line names it. Its discovery, effect and negative cases
  (`test/skill-cases/java-action-docs.mjs`, a real Claude Code turn each) passed.
- Since 2026.11.05.2: the CE0117 hints, the one change of the A/B candidate 2026.11.05.1 that measured a gain
  (failing calls with CE0117 21 -> 7 over 3+3 runs of invoice-chase-precise, Sonnet, isolated;
  harness-eval/results/context/ab-2026-11-05-precise.md). `spacing-and-layout` and `durable-tests/reference/mendix-dom.md`
  no longer teach `formatDecimal(x, '#,##0.00')` in a page's text, which is CE0117 there: bind the attribute with
  `format (decimalPrecision: 2, groupDigits: true)`. `naming-and-captions` adds to its self-check: a non-String `{1}`
  in `show message`, `log` or `validation feedback`, and `count(...)` inside an expression, both pass `./mxcli check`
  and fail the build with CE0117. The rest of the candidate (skills read when their part starts, a `tests/mx.ts`
  index, the other error hints) measured no gain and is not in.
- Since 2026.11.04.3: pinned to mxcli **0.30.0** (probed 2026-11-04 on a fresh 11.12.1 app: install with the download,
  skill folder names, `init --all-tools`/`--sync-skills` survival, `oql --json` stdout, `run --local`, the theme
  layout and the brain plan lines `tests/coverage.mjs` reads are unchanged; the bundle's 36 MDL examples check as on
  0.29). `app-security` asks for `./mxcli lint` and a fix of every SEC010-SEC012 finding (SEC011, new: a data source
  XPath over an association the role may not read opens to an error dialog at Production, which `mx check` and the
  build miss); `reuse-and-snippets` writes snippet arguments as `params: (Order = $Order)` (the `{...}` form is
  deprecated, MDL-DEPR126).
- Since 2026.11.04.2: `naming-and-captions` makes activity captions as hard a rule as decision captions (runs so9-so11
  captioned 96-99% of decisions but 25-46% of activities): the opening rule names both, a *Before you finish a
  flow* self-check (every statement but `return`, `raise error`, structure and loops has an `@caption` above it,
  none a Mendix default) with one before/after example, and the worked examples caption their `declare` and `log`.
- Since 2026.11.04.1: **coverage**, opt-in (`docs/plans/built/plan-coverage-stage1.md`). The installer asks on a
  terminal, after the agent question, whether to hold the agent to a test per requirement (`--coverage` /
  `--no-coverage` decide without asking; no terminal and no flag: off). On: the agent numbers the requirements
  R1..Rn, captures them into the project brain by area (`./mxcli brain capture "R12 ..." --slice 01-<area> -a
  @Module.Document`) and promotes them itself in the same turn (`requirements-interview`, installed only then);
  every test title cites what it asserts (`[R12]`, several as `[R3][R4]`); and the rule file's done sentence
  becomes "`node tests/coverage.mjs` shows `0 missing`" instead of a table the agent prints. `tests/coverage.mjs`
  is plain code: requirements from `docs/brain/plan/*.md` (only entries with mxcli's `Anchors: ... · id` line),
  titles from `playwright test --list --reporter=json` (no running app, no test, fixture or teardown run; a
  skipped test cites nothing); exit 1 on a requirement no title cites, a tag naming no requirement, a number used
  twice, a requirement without a number or an empty ledger; `--json` for a scorer; dropped (`(dropped: ...)` in
  the heading), open and unanchored entries are information. Off installs byte for byte what bundle .24 did.
- Since 2026.11.01.24: the installer asks which coding agent(s) will work in the app (a numbered list,
  Claude Code, Cursor, Codex, opencode, Pi; several as `1,5`; Enter keeps the last install's, else Claude Code),
  on a terminal with no `--agent`, before the theme question (`overlay/lib/agents.mjs`). A Pi session had run
  without the harness: the install had silently defaulted to Claude Code, so Pi found no `AGENTS.md` block and
  no `.agents/skills/`. `--agent` now ADDS to the last install's agents (an earlier agent's rule and skills stay);
  an agent is removed only when deselected on the question or named with `--remove-agent`, and the summary says
  so. With `--yes` or no terminal the last install's agents (else Claude Code) stay and a `!` note names them and
  how to add another (`./mxcodr/install.sh --agent pi`). The summary's `Now` has one line per agent: the command
  that starts it, where its rule and skills are, and that a session open before the install must be restarted.
- Since 2026.11.01.23: a new app lands in a folder an earlier `mxcli new`/`init` left files in (no `.mpr`, but
  `.ai-context/`, `.claude/skills/`, `.classpath`... as when a person deleted the app by hand and the hidden
  files stayed): those leftovers get the new app's copies instead of being "the folder's own" (rule in
  `isScaffoldLeftover`: only what mxcli writes and nobody edits; `.claude/rules/`, a `CLAUDE.md`/`AGENTS.md`
  with text of the person's own and a `.gitignore` with lines of their own are kept). A leftover `mprcontents/`
  is moved aside to `mprcontents.old/`. Notes that list paths show at most five, then `and N more (list in
  .mxcodr/install.log)`; the full lists go to `.mxcodr/install.log`. The move into the folder is
  all-or-nothing: planned first, the `.mpr` last, every move undone on a failure, and Ctrl-C waits for the
  moves, so a failed or interrupted run never leaves scaffold files without an app.
- Since 2026.11.01.22: the installer's output looks like v1's (`overlay/lib/ui.mjs`, a port of v1's
  `install/ui.sh`): the mx-codr wordmark and version, the `▪ target` line, one progress bar over the steps
  (percent, the running step, its phase from `mxcli new`, the elapsed time once a step passes 5 s), a green `✔`
  line per step, yellow `!` notes, a red `✘` failure on stderr with the fix below it, and v1's summary (`What
  landed`, `Now`, `Next`, `Good to know`) with v2's content. The slow tools (mxcli download, `mxcli new`, MxBuild,
  the runtime cache, `mxcli init --sync-skills`, `--boot`) run without blocking, so the bar keeps moving. Off a
  terminal, with `NO_COLOR` or `TERM=dumb`: plain `· step` / `✔ step` lines, no escape codes, no bar; without a
  UTF-8 locale (cmd.exe) ASCII icons, as v1. The theme question now comes before the slow steps, as v1 asked
  its questions first. The `mxcodr install:` prefix is gone; failures still exit 2.
- Since 2026.11.01.21: the installer runs with no arguments and creates the app when there is none, as v1 did:
  `cd <folder> && bash mxcodr/install.sh` installs into the current folder (or the one holding `mxcodr/` when run
  from inside it); with no `.mpr` there it runs `mxcli new` in a temporary folder and moves the app in, keeping
  every file already there (`MX_VERSION`, default 11.12.1 on every platform; `APP_NAME`, default the folder name
  in letters and digits). On Windows a Studio Pro of that version must be installed, else it stops and lists the
  installed ones. `--no-app` stops instead; `-h`/`--help` prints the usage. Git Bash paths reach Node as Windows paths.
- Since 2026.11.01.20: the read-whole sentence now covers only the project skills in `.claude/skills/`; of mxcli's
  own skills in `.ai-context/skills/` the agent reads only the section it needs (so9 read them whole too, about
  30k tokens of early context carried through ~150 calls; tokens went 53M -> 78M).
- Since 2026.11.01.19: the always-on rule says to read each skill whole, one file per read, never through `head`,
  `cut` or a combined `cat` (so8 cut `naming-and-captions` at 30 lines and decision captions fell from 96% to 43%);
  `naming-and-captions` states the decision-caption rule in its first lines.
- Since 2026.11.01.18: the menu is grouped under sub-menus (Administration, business areas; home pages,
  My account and Log out on top), measured: Mendix drops a group a role cannot open (`spacing-and-layout`).
- Since 2026.11.01.17: pop-ups never carry the signed-in bar or sign-out, even when the request says every
  page (`spacing-and-layout`); a requested header still goes in.
- Since 2026.11.01.16: `film-tests` is back as the eighth skill, with `tests/film.mjs` on the v2 kit, written on
  every install (see *Film a test*).
- Since 2026.11.01.12 (v1 features back): the installer offers six looks again (`--theme <name>`, or asked
  once on a terminal; `node .mxcodr/theme.mjs` changes it later; no terminal or `--yes` leaves the look
  as `mxcli new` made it). `spacing-and-layout` spells out the stacked-lists-in-tabs rule (the heading
  becomes the tab caption; side-by-side columns and lists already in a tab do not count; a phone form with
  its related list) and gives every chart `heightUnit: 'pixels', height: 360`.
- Since 2026.11.01.11 (installer probes of 2026-11-01): an `AGENTS.md` with no mxcli section (absent, or
  written by hand) gets mxcli's empty markers first and our block after them, and `mxcli init --sync-skills`
  now runs after our files so it fills that section; a later `mxcli init` keeps our block (and the text that was
  there). `installed.json` `testKit` lists the kit files that are the kit's, kept ones included (a reinstall
  wrote `[]`). With the person's own `tests/mx.ts` the kit's teardown and config, which import from it, are not
  written, and one line says so. A kept `tests/package.json` pinning another Playwright gets the pin hint.
- Since 2026.11.01.10 (after so4): the rule file ends on a hard finish condition (a table `requirement -> test
  that asserts it`, then one `npx playwright test --shuffle` run shown green with `sessions left: 0`, never
  silencing the kit); `signOut` never returns silently; specs that import `test` and `expect` from `./mx` get a
  per-test session check naming the leaking test and its users; `apiContext` stays plain (Basic-auth calls create
  no session, measured); `durable-tests` opens with the finishing steps; `app-security` no longer asks for a REST
  client document (CE7247).

A person installs this into a Mendix app once. From then on the coding agent that builds in the app reads
one short rule file on every turn and finds our skills next to mxcli's. It builds with mxcli, checks its own
work, keeps those checks as plain Playwright tests and shapes the app the way the skills describe.
**Nothing runs behind the agent's back**: no hooks, no refusals, no verdict, no settings edits.

## What is in the bundle

    install.sh                     checks Node >= 20, then runs overlay/install.mjs
    overlay/install.mjs            the installer
    overlay/lib/                   mx.mjs (PIN, BUNDLE), rules.mjs (rule file text and its format check),
                                   skills.mjs (which skills are installed), coverage.mjs (the coverage
                                   question and choice), requests.mjs, cache.mjs,
                                   theme.mjs (the looks; copied into the app as .mxcodr/theme.mjs),
                                   ui.mjs (what the installer prints: v1's banner, bar, marks, summary)
    overlay/themes/                catalog.json, per theme <name>.css (tokens) and <name>.skin.scss (frame),
                                   logos/<name>/, the preview page and its screenshots
    overlay/templates/mxcodr.md    the always-on rule file, 25 lines
    overlay/templates/live.md      live mode only (the Studio Pro extension): .claude/rules/mxcodr-live.md
    overlay/lib/live.mjs           live mode only: the edits of the rule file and the skills
    overlay/templates/keep-tests.md its first 7 lines, byte for byte the sk2 rule
    overlay/templates/tests/       the starter test kit
    overlay/lib/kit-shipped.json   sha256 of every kit version shipped (an unedited one is replaced)
    tools/kit-shipped.mjs          writes kit-shipped.json from git history; rerun after a kit change
    overlay/templates/film.mjs     the film recorder, installed as tests/film.mjs
    overlay/templates/coverage.mjs the coverage check, installed as tests/coverage.mjs (coverage on), with
                                   coverage-done.md and coverage-durable-tests.md, the two texts it swaps in
    overlay/skills/                our skills
    test/                          the bundle's own tests (node --test)

## What is installed, per agent

| agent (`--agent`) | always-on rule | our skills |
|---|---|---|
| Claude Code (`claude`, the default) | `.claude/rules/mxcodr.md` | `.claude/skills/<name>/` (beside mxcli's) |
| Cursor (`cursor`) | `.cursor/rules/mxcodr.mdc` (`alwaysApply: true`) | `.cursor/skills/<name>/` |
| Codex (`codex`), Pi (`pi`) | a block in `AGENTS.md` between `<!-- mxcodr:start -->` and `<!-- mxcodr:end -->`, after mxcli's section | `.agents/skills/<name>/` |
| opencode (`opencode`) | the same `AGENTS.md` block | `.opencode/skills/<name>/` (beside mxcli's) |

- **The rule file** (`overlay/templates/mxcodr.md`): the 7-line keep-tests rule, then how to write the suite
  on `tests/mx.ts`, prove a refusal as the wrong role without weakening the app, run the whole suite in the
  foreground, finish only after a table `requirement -> test that asserts it` (coverage on: after
  `node tests/coverage.mjs` shows `0 missing`) and one green `--shuffle` run
  with `sessions left: 0` (never silencing the kit's checks), and stop processes only with `./mxcli run stop` or
  their own PID; last, one paragraph naming the skills by trigger word. The `.mdc` and the `AGENTS.md` block
  are made from it in `overlay/lib/rules.mjs`. The installer checks every file it writes: first byte `#`, no
  frontmatter (the `.mdc`: only Cursor's own), no body line equal to `---`, the first 7 body lines equal to
  the keep-tests rule. The `AGENTS.md` block is written only for Codex, opencode or Pi.
- **The skills** (`overlay/skills/`, the list in `overlay/lib/skills.mjs`):
  - `durable-tests`: what deserves a test, on the kit, one worker, the whole suite shuffled at the end;
    `reference/mendix-dom.md`, how Mendix renders for tests
  - `app-security`: Production security, roles, demo users, row isolation, refusals proven by attempt
  - `spacing-and-layout`: Atlas spacing, one layout, menu per role, Back, signed-in user, icons,
    stacked lists in tabs, totals as tiles, charts 360 px high
  - `naming-and-captions`: variable names, a business-words caption on every activity and decision (a self-check
    before a flow is done), widgets `<Page>_<What><Type>`
  - `module-structure`: which module, the starting folders, `<Module>Ext` for Marketplace changes
  - `reuse-and-snippets`: reuse a microflow, share a page, extract a snippet
  - `files-and-images`: uploads, images, documents, a generated PDF
  - `java-action-docs`: every Java action's documentation, in the model (the action, its parameters, the return
    value's name, side effects, failures) and in its javasource file (steps in the user code, javadoc on helpers);
    cases in `test/skill-cases/java-action-docs.mjs` (discovery, effect, negative; a real Claude Code turn each)
  - `film-tests`: lists the tests and films the one the person picks (or all), only when asked

  `requirements-interview` (ask before building; with coverage, numbered requirements captured and promoted
  into `docs/brain/plan/`) is installed **only with coverage on** (`skillsFor` in `overlay/lib/skills.mjs`).
- **Coverage on** (`overlay/lib/coverage.mjs`) changes three texts and adds one file, nothing else: the rule
  file's done sentence (lines 13-16) is `overlay/templates/coverage-done.md`, same line count, so it stays 25
  lines; `durable-tests`' first finishing step is `overlay/templates/coverage-durable-tests.md` (the `[R12]` title
  convention and `node tests/coverage.mjs` instead of a printed table, so the agent never reads two definitions
  of done); `requirements-interview` is installed; and `tests/coverage.mjs` (`overlay/templates/coverage.mjs`) is
  written on every install, like the film recorder. When `docs/brain/` is missing the installer runs `mxcli
  brain init`. Switched off on a reinstall: `tests/coverage.mjs` goes, the plain texts come back, `docs/brain/`
  stays. The choice is recorded in `installed.json` (`coverage`) once made, asked or by flag, and kept on a
  reinstall unless a flag changes it; an install that defaulted to off records nothing.
- **The starter test kit** (`overlay/templates/tests/`): `tests/mx.ts` (sign-in and sign-out that never leak
  a session, `test`/`expect` with a per-test session check that names the leaking test, `oql()` over `./mxcli oql --json`, `sessionsLeft`, grid rows, cells and filters, Combobox,
  inputs, dialogs, the menu, `apiContext`, recording and forging a button's call, `retrieveByIds`; each
  helper commented with the Mendix fact it relies on, no app names), `tests/mx.teardown.ts` (prints
  `sessions left: N`, fails the run on a leak and names the users), `tests/playwright.config.ts` (one worker, `baseURL` from
  `APP_URL`, the teardown) and `tests/package.json` (`@playwright/test` pinned to 1.64.1, which has
  `--shuffle`). An absent file is written; one already there is replaced only when its text is a version mx-codr
  shipped (`overlay/lib/kit-shipped.json`, see *Since 2026.11.10.2*), and an edited one is the app's own. No
  `tests/playwright.config.ts` when the app has a Playwright config at its root, and no `tests/package.json`
  when it has a `package.json` or Playwright config there (the installer prints the pin to add instead).
  When `tests/mx.ts` is the person's own (not in the last `installed.json` and not a text mx-codr shipped), the teardown
  and config, which import from it, are not written either; the installer says so (move `tests/mx.ts` aside and
  install again to get the kit). A kept `tests/package.json` that pins another `@playwright/test` gets the pin
  hint (`npm install -D -E @playwright/test@1.64.1` in `tests/`).
- **The film recorder** (`overlay/templates/film.mjs`): `tests/film.mjs`, written on **every** install and
  reinstall (unlike the kit it is the bundle's, so an edit there is replaced; it is written also when the kit is
  the app's own). v1's `tests/film.sh` is removed on upgrade.
- **`.mxcodr/`** holds `installed.json` (bundle, mxcli path and version, db, agents, skills, `coverage` when chosen, the kit files
  that are the kit's, written now or kept from before, `theme`, requests), `theme.mjs` and `themes/` (to
  change the look later), `bin/mxcli` when mxcli had to be downloaded, and `install.log` (the paths a new app
  replaced or kept, when it found any).

All of these survive `./mxcli init --all-tools` and `./mxcli init --sync-skills` (mxcli 0.31.0 rewrites
`settings.json`, `.cursorrules`, `opencode.json` and the inside of its own markers, none of which we touch).
`mxcli init` regenerates an `AGENTS.md` without its markers whole, so when the file is absent or has none the
installer writes mxcli's empty markers first and our block after them; `--sync-skills` then fills the section.
`test/init-survival.test.mjs` proves both when mxcli is on PATH.

## What the installer does

    cd <folder> && bash mxcodr/install.sh [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--coverage | --no-coverage] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]

No app is needed: copy `mxcodr/` into an empty folder (or the folder of an app) and run it there. The folder is
the current one, or the one holding `mxcodr/` when run from inside it; it can also be named first
(`bash mxcodr/install.sh <app folder> ...`). Defaults: `--agent claude` (or the last install's), the database as
in step 2, no theme question without a terminal or with `--yes`. On Windows, run it from Git Bash.

0. **A new app** when the folder has no `.mpr` (more than one is an error): `mxcli new <name> --version <v>` in a
   temporary folder, then moved in (all-or-nothing, the `.mpr` last); a file already there is kept and the
   scaffold's copy dropped, so `mxcodr/` is never touched, except leftovers of an earlier mxcli scaffold, which
   get the new copies (full lists in `.mxcodr/install.log`). `<v>` is `MX_VERSION`, else 11.12.1 on every platform. `<name>` is `APP_NAME`,
   else the folder name in letters and digits (`App` in front when it starts with a digit). On Windows the
   version's Studio Pro must be installed (`C:\Program Files\Mendix\<v>*\modeler\mx.exe` or the same under
   `%LOCALAPPDATA%\Programs\Mendix`); none: it stops and lists what is installed, and never installs one.
   There `mxcli new` skips its first build, and a per-user Studio Pro (which mxcli cannot see) creates the app with
   its own `mx.exe create-project`, then `mxcli init`. `--no-app` stops here instead, writing nothing.
1. **mxcli**: a found mxcli 0.31.0 (the recorded one, PATH, the app's `./mxcli`), else a download into
   `.mxcodr/bin/`. `./mxcli` becomes that binary when it is an earlier bundle's shim, a link to nowhere, or a
   binary that does not run here (`mxcli new` on macOS can leave a Linux one); someone else's wrapper stays.
2. **Database**: `--db`, else the last install's, else postgres when port 5432 answers, else hsqldb.
2b. **Coverage**: `--coverage` / `--no-coverage`, else the last install's choice, else asked once on a terminal
   after the agents (Enter = no); no terminal (or `--yes`) and no flag: off. What on changes: *What is in the
   bundle*, Coverage on.
3. **The app's look** (`overlay/lib/theme.mjs`): `--theme <number|name>`, else the last install's (its
   frame refreshed, the app's logo kept), else asked once when stdin is a terminal, before the slow steps
   start (the list in colour, the preview page opened, Enter = atlas). No terminal or `--yes`: nothing is applied and `installed.json`
   records `"theme": "as-is"`, so unattended eval runs keep `mxcli new`'s look. Whatever is recorded is
   not asked again on a later install; `--theme` or `node .mxcodr/theme.mjs` chooses then. Only files under
   `theme/` change, never the model; a failing mxcli is said, never fatal. See *Change the look later*.
4. **Caches**: `mxcli setup mxbuild` and `mxcli run --local --setup`, so the agent's first boot is fast.
5. **Upgrade cleanup**: removes what earlier bundles installed: the v2 gate (`./mxgate`, `.mxgate/`, whose
   downloaded mxcli moves to `.mxcodr/bin/` first), v1's rule files, `tools/mdl-checks/`, `tests/gate.sh`,
   `tests/gate/`, `tests/rulebook/`, `tests/checks/`, v1's opencode and Pi plugins, an empty `rules.local.md`,
   the `mxgate` block in `AGENTS.md`, and only our hooks and permissions in `.claude/settings.local.json`,
   `.codex/hooks.json` and `.cursor/hooks.json`. The app's tests, `docs/requests/` and `docs/brain/` are
   never touched.
6. **Rule file and skills** per agent, as in the table; every skill of ours is first removed from every skills
   folder (the retired `test-first-delivery` included). Then the starter test kit and `tests/film.mjs` (with
   coverage on also `tests/coverage.mjs`, and `mxcli brain init` when `docs/brain/` is missing), then
   `mxcli init --sync-skills .`, so mxcli's own skills and its sections of `CLAUDE.md`/`AGENTS.md` match the
   pinned binary (after our files: it fills the mxcli markers step 6 may have written). Then
   `.mxcodr/theme.mjs` and `.mxcodr/themes/`.
7. **`--request <file>`**: the request saved word for word as `docs/requests/NN.md`.
8. **`--boot`**: `mxcli run --local --detach` (Mendix's default ports when free, else three free ones from
   18080), `mxcli run wait --ready`, `mxcli run stop`.

## Live mode (the Studio Pro extension)

The extension's pane sets an app up with this bundle while Studio Pro has the app open (decision 14 of
`docs/plans/open/plan-studio-pro-extension.md`). It calls the installer's own functions (`writeRules`, `copySkills`,
`copyTestKit`, `copyFilm`, `upgradeCleanup`, `ensureLocalMxcli`) with `live: true`; `main()` and its caches, database
and theme steps are not used. Live mode needs Studio Pro 11.12.1 or later (live.75), on Windows and Mac (the extension's
`setup/version.mjs` `MIN_STUDIO_PRO`; the pane, its setup and its installers refuse older ones with one message). What
live mode changes in the texts (`overlay/lib/live.mjs`):

- the rule file: Stop the app with `./mxcodr-live app stop`; the done sentence accepts `sessions left: unknown` only
  when `./mxcodr-live oql` cannot read Studio Pro's run (the kit's `oql()` uses it when the app has `.mxcodr/live-tool.json`, which setup writes);
- `durable-tests`: `./mxcodr-live check` / `exec`, `./mxcodr-live app run|status|restart` instead of `./mxcli run`,
  the session count from the teardown line, CE0463 fixed by the person in Studio Pro;
- `files-and-images`: the agent installs the File Uploader itself with `./mxcodr-live marketplace install 235351`
  (Studio Pro's own Marketplace import, through its internal `mendix.MarketplaceInstallApi`; publishers Mendix or
  Mendix Labs only, an existing module refused, no upgrades; Studio Pro must be signed in and mxcli logged in);
  asking the person is the fallback when the command refuses;
- `module-structure`: `MyFirstModule` is dropped only after the person said yes, and only when it is still Mendix's
  untouched starter; a module with the person's work is never dropped: the agent proposes a name and the person
  renames it in Studio Pro (the live push does not rename a module: `RENAME MODULE` would leave references to a
  module Studio Pro does not have);
- `film-tests`, `module-structure`, `spacing-and-layout`: the same command swaps; `film-tests` also says that in the
  pane one test or a file's tests are filmed with `./mxcodr-live tests film <file>[:line]` (Studio Pro's run, the Tests
  tab's one-run-at-a-time rule; the person watches the film in a Studio Pro tab), `--all` staying `node tests/film.mjs`;
- `durable-tests` also: when `tests/.env` has no `DEMO_PASSWORD` (Studio Pro's New App gives the demo users random
  passwords), the agent sets one itself: a random password in `tests/.env` (git-ignored by the extension's setup), set
  on every demo user with `./mxcodr-live exec` (`create or modify demo user`), then `./mxcodr-live app restart`; it never
  asks the person for a password and never prints one (`./mxcodr-live exec` masks passwords in its output);
- the starter test kit (`copyTestKit(..., { live: true })`, `KIT_EDITS`): `playwright.config.ts` also writes a JSON
  report and progress lines to `.mxcodr/tests/` (what the pane's Tests tab reads, so the agent's own runs show up there)
  and a screenshot of a failed test; `mx.ts`'s sign-in failure says `./mxcodr-live app restart`. `tests/film.mjs`
  (`copyFilm(..., { live: true })`, `FILM_EDITS`): Studio Pro runs the app. Kit files are written when absent and
  replaced when unedited (a plain kit file becomes the live one); a
  `tests/playwright.config.ts` kept from before (the plain kit, or one with the person's edits) gets the json and
  progress reporters wired in by the extension's setup (`wireTestsTab`: the kit's anchors, else a one-line
  `reporter:` spliced; anything else stays as it is, with a note), so every Playwright run shows in the tab. The live
  config also traces every test (`trace: { mode: 'on', snapshots: true, ... }` in `use`; a config wired before gets
  that line from setup, one with its own `trace` keeps it): the progress reporter maps each test to the pages,
  microflows, entities and published services it touched (`.mxcodr/tests/coverage-map.json`) for
  `./mxcodr-live tests affected`;
- no npm (Studio Pro brings Node but none; the extension's setup puts Playwright in `tests/node_modules`, and its
  ffmpeg only when the person turns videos on, mx-codr 1.75.16): the live rule file says never to run Playwright itself, only `./mxcodr-live tests`; `durable-tests`,
  `film-tests`, the kit's `package.json` description (`KIT_EDITS`) and `tests/film.mjs`'s missing-Playwright error
  (`FILM_EDITS`) name Install Playwright / Update mx-codr instead of `npm install`; `test/live.test.mjs` builds every
  live text and finds no `npx playwright` or `npm install`;
- the affected tests instead of the whole suite (`RULE_EDITS`, `durable-tests` edits, the live rule file): the
  rule file's "run the whole suite once" and the done sentence's `npx playwright test --shuffle` become
  `./mxcodr-live tests affected` (tests whose own source, or their file's shared code or helpers, changed since they
  last ran, whether committed or not; never-run and failed tests first; tests whose model documents changed since
  they last ran), ending with its own run's line `affected: N run, N passed, 0 failed (M not selected)`; while
  working the agent runs only the test it works on (`./mxcodr-live tests run <file>:<line>` or `--grep`), and
  nothing broader once `tests affected` is green unless the person asks. Both deploy a model saved after the last
  deploy first (`deployment/model/model.mdp` older than the `.mpr`/`mprcontents/`: one `app run`, nothing runs
  when it fails), stop a run of chosen tests after 2 failures, and list each failed test with its error lines,
  screenshot and error context. A page that only got new widgets (ALTER PAGE INSERT) runs the tests that name
  them plus one smoke test per spec file of the tests that only pass through it (`--thorough`: all of them); the full suite is proposed to the person with its count, estimate and last
  full run, never started unasked, and recommended strongly after a whole-app change (security, roles, access rules,
  navigation, the after-startup microflow, a layout, the theme). File mode keeps the shuffled whole suite;
- `.claude/rules/mxcodr-live.md` (`overlay/templates/live.md`): CE0463 (a changed widget definition) is `./mxcodr-live fix widgets` (Studio Pro's own
  Update all widgets through the extension, live.43; the person's App > Update all widgets only when it says so), never `./mxcli fix widgets`; when a command cannot reach Studio Pro, its own instruction passed on word for word (live.73); what a turn changed from `./mxcodr-live changes list` / `changes show --turn <id>`, never git, with the actions Studio Pro regenerated at a build marked as its own (live.74); the `exec` verdicts, `./mxcodr-live problems` after
  every exec, `./mxcodr-live mxcheck` for the full check (it overrides `CLAUDE.md`'s `~/.mxcli/mxbuild/` mx path, which
  has no `mx` on a Mac with Studio Pro 11.16), `logs` when a run or a test fails on the server, `open` and `save` (ask first),
  `open <file>[:line]` (a file of the app in an editor tab inside Studio Pro, a theme `.scss`/`.css`/`.js`/`.json` in Studio Pro's own editor; the person may edit and save it there), the app commands,
  Playwright against Studio Pro's URL, the demo password, the Tests tab (`./mxcodr-live tests status|run|clear`),
  `./mxcodr-live tests affected` instead of the whole suite (the full suite only as a proposal), films
  (`./mxcodr-live tests film <file>[:line]`, only when the person asks; Watch film in the Tests tab), microflow
  tests with `./mxcodr-live test` on a copy, never `mxcli init`, a task list (Claude Code's TaskCreate/TaskUpdate) for any
  task of three or more steps and after an approved plan (live.33; `templates/plan-first.md` is the pane's switchable
  "Plan first for bigger requests" rule, written as `.claude/rules/mxcodr-plan.md`), only the person commits, in Studio Pro (Version
  Control > Commit), and nobody runs `git init`: version control is Studio Pro's (Upload to Version Control
  Server, offered by the pane's ⋯ > Check setup); the extension never makes a repository or a commit (live.26).
- hooks, live mode only (the extension's setup writes them into `.claude/settings.local.json`, one `PreToolUse`
  entry on `Bash`; file mode installs no hook): the git guard (`translator/bin/git-guard.mjs`: since live.30 an
  allowlist of read-only git, everything else is the person's in Studio Pro's Version Control) and, since LIVE 15, the sed guard (`translator/bin/sed-guard.mjs`):
  on macOS a GNU-style `sed -i 's/…/…/' file` is refused before it runs (BSD sed takes the word after `-i` as the
  backup suffix and fails with "invalid command code"), with "macOS sed needs a backup suffix: use the Edit tool,
  or `sed -i '' …`." Refused: `-i` (also `-Ei`, `-ni`) followed by a script, an address or another option, and
  `--in-place`; allowed: `-i ''`, `-i.bak`, `-i .bak`, `gsed`, sed without `-i`, sed only in text; any other
  platform passes everything, and an unclear command passes;

- skills switched off in the extension's Rules tab (`overlay/lib/skilloff.mjs`, the `skillsOff` option of
  `ruleText`, `writeRules` and `copySkills`; the extension only): their folder is `.mxcodr/skills-off/<name>/`, the
  rule file's paragraph naming the skills leaves them out (re-wrapped; the whole paragraph goes when none is left),
  the live rule file's films bullet goes with `film-tests`. With none switched off (file mode, always) every output
  is byte for byte what it was;

`mxcodr/test/live.test.mjs` applies every edit (rule file, skills, test kit, film recorder) and checks that no
file-mode command is left in the live texts and that file mode writes the template bytes.

## Film a test

A person who wants to *see* a test asks the agent in plain words: "film the order approval test", "show me
how the customer test works", "record all the tests". The `film-tests` skill has the agent list the tests
(`node tests/film.mjs --list`), ask which one unless the request names it, and film it. The agent never
films on its own.

The film is the test as it is, slowed: a title card names the test for three seconds, an animated pointer
travels to each element before it is clicked or filled, each action waits 1000 ms, and the test's title
stays in a small label at the bottom. Typed values never show as captions (Playwright's action callouts are
off). By hand, in the app folder, with the app running:

    node tests/film.mjs --list                # every test, numbered, with file:line
    node tests/film.mjs 7                     # test 7; or words of its title, or orders.spec.ts:57
    node tests/film.mjs --pace 1500 7         # slower (ms per action; 0 = the test's own speed)
    node tests/film.mjs --all                 # every test with a browser, in the background (--status, --stop)

The video lands in `.mxcli/films/<title>.mp4` (ffmpeg converts it; without ffmpeg there is only the `.webm`,
which opens in Chrome or Firefox, not QuickTime). `.mxcli/` is in mxcli's `.gitignore`. A failing test keeps
its film, which shows where it stopped.

Normal runs are unaffected: `tests/playwright.config.ts` has no video or slow-down. While it films,
`film.mjs` writes a temporary `.film.config.ts` beside the app's config (spreading it and adding only
`use.video` with `show.actions` and `show.test`) and one wrapper per spec in `.film/` (a `beforeEach` that
shows the title card, then the spec imported unchanged), and removes both afterwards.

## Change the look later

Six themes (`overlay/themes/catalog.json`): **atlas** (Mendix's own Atlas: `mxcli theme remove` takes
away mxcli's theme), **navy**, **teal**, **amber**, **plum**, **forest**. Each but atlas is created once with
`mxcli theme create <name> --from <name>.css --base signal`; its frame (`<name>.skin.scss`: top bar, active
menu item, outline buttons, control heights; only Atlas variables, so an Atlas update keeps working) is
written into the scaffold's partial, replacing an earlier bundle's, then `mxcli theme apply <name>
--variant light`. The mx-codr mark in the theme's colours replaces Mendix's logo and icons in `theme/web/`.

    node .mxcodr/theme.mjs              # the themes, each as a slice of the app in its colours, and the one now
    node .mxcodr/theme.mjs preview      # every theme on a real app, in the browser
    node .mxcodr/theme.mjs <n|name>     # apply it; installed.json records it, so a reinstall keeps it

Run it in the app folder. Under `mxcli run --local --watch` the new look shows after a reload.

The Studio Pro extension's Look tab (live mode) uses the same library in one flow: pick a theme in the gallery
(that applies nothing, it loads the theme's values into the knobs), adjust the knobs with a live preview beside
them, then Apply to app (the stock theme when no knob changed, else `custom`). The knobs make a theme `custom` from tokens only (`customTokens`, `customSkin`, `makeCustom`: brand colour and its derived
tones, `--mxt-radius`, `--mxt-font` among IBM Plex Sans / Open Sans / the computer's UI font, and the `--variant`).

## Develop

    node --test 'mxcodr/test/*.test.mjs'   # rule format, skills-clean, install placement, test kit (and its update of unedited kit files), film recorder, coverage, themes, live mode, init survival (mxcli on PATH)

A change: edit `overlay/`, raise `BUNDLE` in `overlay/lib/mx.mjs` (`YYYY.MM.DD.N`), run the tests, then
install into an app with `install.sh` and measure with `harness-eval/bin/run.sh`.

v1 (the gate, hooks, checkers and rulebook) was removed on 2026-11-01. It is in the tags `v1-best-hb1`
(bundle 2026.10.25.13, best b2b-full result) and `v1-last`: `git worktree add ../mxcodr-v1 v1-best-hb1`.
