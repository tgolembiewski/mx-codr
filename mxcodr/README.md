# mx-codr harness (v2, skills only)

Bundle **2026.11.21.3** (`overlay/lib/mx.mjs`, `BUNDLE`), pinned to mxcli **0.32.0** (`PIN`). The design is
`docs/plans/open/plan-harness-v2-skills-only.md` (owner decision 2026-10-31: the gate goes).

- Live mode (2026-11-05, same bundle 2026.11.05.2, nothing changes for file mode): the Studio Pro extension
  (`spikes/studio-pro-ext/`) installs this bundle from its pane with `live: true` in `ruleText`, `writeRules` and
  `copySkills`. The edits are in `overlay/lib/live.mjs` (each names the exact text it replaces and throws when it is
  gone); `overlay/templates/live.md` becomes `.claude/rules/mxcodr-live.md`; `overlay/lib/mx.mjs` gains `PIN_SHA256`
  (the release digests of the pinned mxcli, which the extension's setup checks its download against). A file-mode install
  writes byte for byte what it did: 321 files over 12 agent and coverage combinations (rule files, skills, test kit, film recorder, coverage check; re-measured for stage 4, and again for stage 4c's films) compared with the committed
  bundle, 0 differ. See *Live mode* below.
- 2026.11.21.3 (2026-11-21): **the copies in the app are split into parts; nothing they do changes** (round 2 of the
  readability refactor). `tests/film.mjs` keeps its header (its `--help`), the running of a film and `FILM_EDITS`'
  three anchors; its parts are in `tests/film/` (`timing.mjs`, `pick.mjs`, `run-texts.mjs`, `slowing.mjs`, from
  `overlay/templates/film/`). `.mxcodr/skill-gate.mjs` keeps the hook (`runHook`); its parts are in
  `.mxcodr/skill-gate/` (`needs.mjs`, `reads.mjs`, `decide.mjs`, `codex.mjs`, `hooks.mjs`, `common.mjs`, from
  `overlay/lib/skill-gate/`). Both scripts re-export everything they exported. `copyFilm` and `installSkillGate`
  write the parts first and replace the folder whole (a link there is removed, never written through); the folder
  goes when Claude Code is deselected, and the extension's setup removes `.mxcodr/skill-gate/` with the file-mode
  copy and git-ignores `/tests/film/` beside `/tests/film.mjs`. Proof: every export and constant of both scripts the
  same as at c478827d, and their runs in an app (`film.mjs` help and refusals, the gate's deny, read, reset and
  fail-open) the same (`test/parity.test.mjs`); the rest of an install byte for byte the same. The kit
  (`templates/tests/`) is not split (`mx-impl.ts` is 378 lines, no function over 60): `kit-shipped.json` is unchanged.
- 2026.11.21.2 (2026-11-21): **a film records at almost the test's own speed; the slowing is done on the video**.
  Measured on a Mendix app (MxCodrTMasterMind, 20 tests without OQL, plain run 33.6 s): one test of 9 actions took
  20.9 s to film against a 2.2 s plain run (3.4 s title card, 9.4 s of 1 s pace, 5.5 s end hold, 0.5 s ffmpeg, the
  rest start-up and the app), `--all` 394 s (a Playwright process per test). Now the run shows each action's pointer
  and an orange frame round its element for `LIVE_PACE` (150 ms), the card 0.7 s and the end 0.4 s
  (`MXCODR_FILM_HOLD_MS`, the same variable the kit's `signOut` already reads: no kit change), and a timeline
  reporter and the wrapper's marks (the card, each sign-out to `about:blank`, the test function's end) give the
  times. `filmPlan` (pure) turns them into the film: the blank start cut, the card held 2.5 s, each action
  (its annotation and 0.1 s of what it did) in slow motion for `--pace` ms (default 1000), a wait over 1.5 s
  three times faster beyond that, a sign-out inside the test held 1.5 s, the end screen (passed or failed) held
  `max(5000, 2 × pace)` ms; `makeFilm` does it in one ffmpeg pass (a `setpts` sum, 25 fps, x264 veryfast,
  0.15-0.8 s a film). The video's zero is "Create page" with `LAG_S` -0.07 s (16 colour changes on a fake app,
  ±0.02 s); held frames are taken in the middle of the short live holds. `--all` is one Playwright run (one worker,
  one browser) and each film is made while the next test records. After: the same test 5.9 s, `--all` 90 s; every
  film had each action on screen at least 1.0 s and its end screen 5.0 s (frames sampled). Without ffmpeg the raw
  `.webm` stays (the test's own speed) and `film.mjs` says so; a film whose timeline is missing is converted as
it is with its last frame held. The new frame times are one `setpts` sum summed as a balanced tree: ffmpeg's
expression parser refuses a flat sum of about 100 terms (ffmpeg 9.0.2: 90 parse, 100 do not), which a test of about
50 actions reaches; a long filter goes in a file (`-/vf`, else `-filter_script:v`). Also fixed: `--all` stopped after a few tests with
  "the app stopped answering" while it answered (a kept-alive connection the app had closed failed the first
  fetch); `answers` tries three times. `tests/film.mjs` is rewritten on every install; the Tests tab's films use
  the same functions (LIVE 102).
- 2026.11.21.1 (2026-11-21): **a film holds the screen a test ends on**. The result screen of a filmed test (passed,
  or where it failed) vanished at once: Playwright runs `afterEach` hooks innermost first, and the spec's import in
  film.mjs's wrapper is evaluated before the wrapper's own hooks, so the kit's `signOut` (a describe's or the file's
  `afterEach`) left the page before the wrapper's 2 s pause, which then filmed `about:blank` (measured on a fake app:
  0 s of the passed screen, 0.5 s of the failed one). Now `wrapperText` sets `MXCODR_FILM_HOLD_MS` and its
  `beforeEach` adds the hold to the callbacks Playwright awaits right after the test function and before any
  `afterEach` (`testInfo._onDidFinishTestFunctionCallbacks`, the set its own `screenshot: 'only-on-failure'` uses;
  internal, feature-detected, checked against the pinned 1.64.1 by `test/film.test.mjs`). The kit's `signOut`
  (`mx-impl.ts`) holds as long before it leaves a page, for a sign-out inside the test (a role switch too) and a
  Playwright without that set; a page held once, or on `about:blank`, is not held again, and a normal run (no
  variable) never waits. The hold is `max(5500, 2 × pace)` ms on every film, `--pace 0` included (a 5000 ms hold
  showed 4.9 s on the video): measured at 5.4-6.0 s of the result screen before the sign-out, describe- and
  file-level, passed and failed, pace 1000 and 0, and with the internal set switched off. A plain timer, so no step
  in the report or the trace. The `--all` estimate counts the hold. An app's unedited shipped `mx-impl.ts`/`mx.ts`
  becomes the new one on the next install or setup (`overlay/lib/kit-shipped.json` regenerated); an edited one is
  the person's and keeps its `signOut`, and its films still hold through the wrapper unless that `signOut` runs
  inside the test body. `tests/film.mjs` is rewritten on every install.
- 2026.11.20.6 (2026-11-20): **a click on a missing element fails in 10 s**. The kit's `playwright.config.ts` has
  `actionTimeout: 10_000` (was 20_000), with a comment saying why: a click or fill on an element that never appears (a
  wrong widget name, a dialog not open yet) waited 20 s per failure, and an agent iterating on a spec lost minutes; a
  warm Mendix action takes well under 1 s. `expect: { timeout: 15_000 }` (a cold runtime's render) and the test
  `timeout: 90_000` stay. `KIT_EDITS`' screenshot edit anchors on the new value; setup's `wireTestsTab` puts the
  screenshot and trace lines after a kept config's own `actionTimeout` whatever its value, and keeps that value (a
  config the person edited stays at 20 s). An app whose config is an unedited shipped kit gets the new one on the next
  install or setup (`overlay/lib/kit-shipped.json` regenerated). A bare click or fill as a spec's first step after
  `goto` on a cold runtime, with no `expect` before it, can now time out: wait for the page with `expect` first.
  `test/test-kit.test.mjs` and `test/live.test.mjs` pin it.
- 2026.11.20.5 (2026-11-20): **no `FINDINGS.md` in live mode**. mxcli init's CLAUDE.md and AGENTS.md ("Finishing a
  change", step 3) have agents append to `FINDINGS.md`; on a large app it grew to 13.5 KB in a day, read whole before
  each append and by nobody else (setup git-ignores it). A 2-line bullet in `templates/live.md`, right after the `mx`
  override (so in the AGENTS.md live block for Codex and Pi too): step 3 does not apply, the finding goes into the
  answer, the brain takes only its rule's three triggers. mxcli's own section is untouched. The live rule grows by 230
  bytes (17,828). `test/live.test.mjs` pins it. File mode is unchanged.
- 2026.11.20.4 (2026-11-20): the project-files grep in `templates/live.md` also leaves out `.mxcli` (mxcli's own caches
  in the app folder: catalog.db, unit-contents.db, widget definitions). `test/live.test.mjs` pins it. In the extension
  (live.91) a read's copy now also follows `widgets/` and `modules/`, and a busy `.mpr` is waited for up to 5 s
  (`spikes/studio-pro-ext/README.md`, "Reads mirror widgets/ and modules/").
- 2026.11.20.3 (2026-11-20): **search the project's files without reading the copies**. On the owner's Windows VM
  (Pi, a large app) two agent greps over the app folder, `grep -rlniE "..." . | grep -v "mprcontents|..."`, took 100.7 s
  each: grep reads everything before the filter after the pipe, the extension's own copies of the app included.
  `templates/live.md` gets one 3-line bullet after the read bullet: `grep -rn --exclude-dir={.mxcodr,.mxcodr-test,
  mprcontents,deployment,node_modules,.git,vendorlib,theme-cache,.mendix-cache} '<pattern>' .`, never `| grep -v`; not
  `git grep` (the owner's choice: it misses untracked and ignored files such as `tests/.env`). The brace list expands
  in bash and zsh only, so the bullet's third line gives PowerShell and `sh` one `--exclude-dir=<name>` per folder. The read bullet (now 9 lines, still
  before the quality bullet) names what the dump leaves out (System, add-on modules, image and icon collections, page
  templates, building blocks) and says to run `./mxcodr-live query "search '<text>'"` before calling something absent.
  `test/live.test.mjs` pins both. In the extension (live.88) the shadow and the model dump's source copy moved out of
  the app into the person's app-state folder (`spikes/studio-pro-ext/README.md`, "The copies live in the person's
  folder"); since live.93 the model dump reads the app itself, guarded against Studio Pro's saves, and only the shadow
  remains (same README, "Copies checked against their own .mpr ... (live.93)"). Measured on a copy of a large app on a Mac (BSD grep, warm cache): the piped form 16.8 s before the move and
  7.2 s after; the `--exclude-dir` form 2.6 s after; `.mxcodr/model/` alone 0.1 s.
- 2026.11.20.2 (2026-11-20): **read only the lines you need from `.mxcodr/model/`**. An A/B of the read changes
  (bundle 2026.11.18.9 against 2026.11.20.1, CarFleet, three read-only tasks) found that Claude Code took the dump
  route but its tokens did not fall: it read whole files with `cat`, so the same text reached the context as before.
  `templates/live.md`'s read bullet (still 7 lines, before the quality bullet) now says: one `grep -rn` (several names
  in one pattern), then only the lines around the hits (Read with offset and limit, or `sed -n 40,90p` on several
  files in one command), a whole file only when all of it is needed; `INDEX.tsv` lists the files. `test/live.test.mjs`
  pins it. Measured with the same setup (Claude Code, Sonnet, 3 tasks x 5 runs): no change. The median was 367k
  input tokens against 350k, with 8 tool calls each and a 30/30 blind score. The agent still used `cat` on the files
  (about 69 against 70 times). CarFleet's files are 1-5k characters, and the bill follows API turns times the re-sent
  rules, not the model text. The bullet stays as the owner asked. Whether it saves context on a large app, where files
  are long, was not measured. In the
  extension (live.85) a read that finds no shadow copies once (`translator/src/sync.mjs` `syncForRead`).
- 2026.11.20.1 (2026-11-20): **shorter harness text agents read** (an analysis of four sessions: the always-loaded
  live rule, the gated skills and `tests/mx.ts` were 25-45% of tool output, the live rule re-sent on every call).
  `templates/live.md` keeps one pointer per rare event (24.4k -> 16.9k characters); the steps for CE0463/CE6087/CE4899/
  CE7247, the Marketplace update and review, the legacy Data grid and `bson dump` are printed by `./mxcodr-live problems`,
  `exec`, `marketplace update` and `translate` themselves (translator). The seven gated skills carry no rule twice
  (94.7k -> 83.9k characters, the kit table included). `tests/mx.ts` is the helper list (one typed re-export with a doc
  line per helper, 23.2k -> 5.4k), the code is in the new `tests/mx-impl.ts` (`TEST_KIT`, `kit-shipped.json`, never
  edited like `mx.ts`: `mxcodr.md`, `durable-tests`). The skill gate gains `reset`: a compaction clears the session's
  read skills (Claude Code: SessionStart `compact` in `.claude/settings.local.json`; Codex: PreCompact in the
  extension). In the extension (live.84): Pi refuses edits of the harness's files, and Codex names one fixed launcher
  path, so its AGENTS.md no longer changes with the runtime.
- 2026.11.19.1 (2026-11-19): **read the model from disk**. A Pi session on a large app (Windows VM, 3 h) spent 12 of
  96 active minutes and a quarter of its context on model reads: 98 queries, 30 of them one DESCRIBE re-run to page
  through it, 17 run in `for` loops, and 57 greps of binary `mprcontents/` files. The Studio Pro extension now keeps
  the model as text in `.mxcodr/model/` (one file per document, `INDEX.tsv`; `spikes/studio-pro-ext/README.md`, "The
  model on disk"). `templates/live.md`'s read bullet (one line before, 7 now, early in the file, before the quality
  bullet: Codex cuts `AGENTS.md` at its size cap and the live block comes last) says: grep `.mxcodr/model/`
  (`INDEX.tsv` first) and read the one file, never grep `mprcontents/`; `./mxcodr-live query` for a fresh read before
  a change, for `search` / `show references to` / `show context of` / a catalog select, and when the dump lags;
  several statements in one query, never a loop; never a query re-run to page it (read or grep the `.mxcodr/out/` file
  it names); a refused read lists the valid forms. Live mode only; Codex and Pi read it in the `AGENTS.md` live block
  (setup copies `mxcodr-live.md` there). `test/live.test.mjs` pins the bullet, its length and its place.
- 2026.11.18.9 (2026-11-19): **build an anchor under exactly its name**. The owner's Windows test (Codex, AssetBench):
  R2..R7 were built under other names than the plan's anchors (`Flota.ACT_WydajSamochod` planned,
  `Flota.ACT_Samochod_Wydaj` built; `MojeSamochody` never built), so the Brain tab said "Not built" while their tagged
  tests passed. `templates/brain.md`'s exception now reads "Except: build an anchor under exactly its name; if named
  otherwise, or a finished requirement has none, run at once `./mxcli brain edit <id> -a @<the document you built>`
  (id: `brain list`)." To make room: "1. A feature request not in the requirement list", "an odd mxbuild error or
  Marketplace version", the panel block reflowed (one line saved). 26 lines, 2,447 characters; the size cap 2,400 ->
  2,450 (`test/brain.test.mjs`). The Studio Pro extension's Brain tab now also counts a requirement done by its tagged
  tests' last results (`spikes/studio-pro-ext/README.md`, "Brain progress also from tests").
- 2026.11.18.8 (2026-11-19): **the app's quality score is the Quality tab's**. The owner's Windows test (Codex):
  at the end of the build the agent reported "74/100" from `mxcli report` (mxcli's CLAUDE.md "Best Practices Report",
  its `assess-quality` skill) while the pane's Quality tab showed Best practices 86/100, another formula (errors and
  warnings per 100 documents of the app's own modules, info free; mxcli's counts every finding against 100).
  `templates/live.md` gains one bullet (6 lines, early, before `problems`: Codex reads `AGENTS.md` only up to its
  size cap, and the live block's end is past it in CarFleetCodexSol's 36 KB file): to report the app's quality, run `./mxcodr-live quality` after the
  last model change and give its first line, `Best practices N/100 (...)`; never the score of `./mxcli report`, the
  `assess-quality` skill or CLAUDE.md's "Best Practices Report", named only as mxcli's own score. Live mode only (file
  mode has no Quality tab); Codex reads it in the `AGENTS.md` live block. `templates/mxcodr.md` and file mode are
  unchanged. The command and the tab print one number (`spikes/studio-pro-ext/README.md`, "The agent reports the
  tab's score").
- 2026.11.18.7 (2026-11-19): **a plan's requirements name the document that builds them**. The owner's Windows
  test (Codex, AssetBench): the plan card's brain block showed "Progress cannot be tracked for this one yet." under
  each of R1-R13, because Codex wrote every `Requirement:` line without `| anchor`, which the rule allowed ("no anchor
  yet: leave out ` | anchor ...`"). (1) `templates/brain.md`: the anchor is the NEW page or microflow that will build
  the requirement, though it does not exist yet (`@AssetBench.Samochod_Lista`), left out only when the requirement
  has no document of its own. (2) One exception to "never edit an entry unasked": a requirement the agent finished
  that has no anchor gets `./mxcli brain edit <id> -a @<its document>` (id from `brain list`). Measured with mxcli
  0.32.0 on a scratch brain (`brain init -C`, capture, promote, `edit <id> -a @Cars.Car_Overview`): the anchor is
  replaced, the id, title, body and place kept; not tried against a real `.mpr`. It writes the committed shard
  without the person's approval, also with `MXCODR_PANEL=1`. The rule grows to 26 lines, 2,397 characters (size test:
  2,300 -> 2,400). `templates/mxcodr.md` and the plan-first templates are unchanged. The extension's pane says it
  once instead of per row (`spikes/studio-pro-ext/README.md`).
- 2026.11.18.6 (2026-11-18): **the skill gate for Codex, and one skill per command**. CarFleet's Codex session
  (CarFleetCodexSol, 2026-11-18 20:38:53Z) read `naming-and-captions`, `reuse-and-snippets` and `spacing-and-layout`
  in one code-mode `exec` cell (`Promise.allSettled` over seven `exec_command` calls, each `max_output_tokens: 7500`);
  the cell's own budget (10,000 tokens unless its first line is `// @exec: {"max_output_tokens": N}`) cut the
  12,236-token output ("…2236 tokens truncated…"), most of `spacing-and-layout` never reached the model, and the app
  got 26 action buttons with no spacing between them. (1) `templates/mxcodr.md`, still 38 lines: each skill whole and
  in its own read or command, never several in one call (no combined `cat`, no `Promise.all`, no loop); Claude
  Code: the Read tool; Codex: one `exec_command` per file with `max_output_tokens: 30000` and an `exec` script that
  starts with `// @exec: {"max_output_tokens": 30000}`; a truncated output is read on by line ranges before
  building; the gate sentence names Codex in the pane. (2) `lib/skill-gate.mjs` gains a Codex adapter
  (`pre|post --agent=codex`, `--shell=powershell` on Windows). Measured with Codex 0.167.0 in a scratch folder: its
  hooks get `tool_name` `Bash` for `exec_command` (`tool_input` `{command}` only) and `apply_patch` (`{command}`: the
  patch), PostToolUse's `tool_response` is the output as the model sees it (Codex's truncation marks included), the
  `exec` cell itself gets no hook but is in `transcript_path` before its commands' hooks run and its output before
  the next cell's, and exit 2 with the reason on stderr blocks a nested command and an `apply_patch` ("Command
  blocked by PreToolUse hook: <reason>"). A read counts when one command reads one gated SKILL.md
  (`.agents/skills/` or `.claude/skills/`; `cat`, `nl`, `type`, `Get-Content`, or a range: `sed -n 'A,Bp'`,
  `head`, `tail -n +K`, `Select-Object -Skip/-First`, `Get-Content -TotalCount`), its output has no truncation
  mark and shows the range's last line, and, in a cell, once that cell's output is in the transcript with neither a
  mark nor that line missing (a read and a write in the same cell do not count); ranges count once they cover the
  file. The evidence, three clean command outputs in a cut cell, records nothing. Gated as for Claude Code: model
  writes (`./mxcodr-live exec`, `mxcli exec`, `mxcli -c`) and test specs added, updated or moved to by `apply_patch`
  (or a patch through the shell). The deny names the `.agents/skills/` files and says how to read them (one per
  command, both 30000 knobs, line ranges after a cut). Fails open; `MXCODR_SKILL_GATE=0` switches it off. Wired
  only by the extension (`.codex/hooks.json`, trusted with the guards); file mode installs no Codex hooks (Codex
  would not run them untrusted). Pi and Copilot have no gate.
- 2026.11.18.5 (2026-11-18, live mode only; file mode writes what it did): **a Codex, Pi or Copilot plan is the plan
  card**. On Windows with Plan first on, Codex wrote its plan (from 2026.11.18.3's AGENTS.md rule) as plain chat text
  and ended with "after the plan is approved in the panel I will start", while the pane showed no card: only Claude
  Code's ExitPlanMode, or the pane's Plan button, made one. `templates/plan-first-agents.md` now has the agent wrap the
  plan in two lines of their own, `<!-- mxcodr:plan -->` and `<!-- mxcodr:plan-end -->` (a title heading, the steps,
  the Requirement and Decision lines inside; not in a code block) and write nothing after it. The extension's bridges
  turn a final message with them into the same ExitPlanMode card in any mode (Approve and build, Keep planning, the
  brain entries saved on Approve), and the pane leaves the two lines out of the text it shows. Tests:
  `live.test.mjs` (the markers, the same strings as the bridges'; fails on 2026.11.18.4), the extension's
  `codex.test.mjs`, `pi.test.mjs`, `copilot.test.mjs` and the pane's `chat.test.ts`.
- 2026.11.18.4 (2026-11-18, live mode only; file mode writes what it did): **the open app is the only target**. On a
  colleague's machine Codex, given a requirements prompt saying "Use Mendix Studio Pro 11.15.0 ... build a working
  app", created a new Mendix project instead of building in the app open in Studio Pro (cause unconfirmed: likely a
  version other than the open app's, or the bridge unreachable); nothing in the rules said the open app is the only
  one. `templates/live.md` opens its list with two bullets: never another Mendix project or `.mpr` (`mxcli new`, a
  copy, a scratch project), not even for another Studio Pro version or "a new app" (a different version is named in
  the summary); when `./mxcodr-live status` cannot reach Studio Pro, stop and tell the person instead of building
  elsewhere. Codex and Pi get it through the live block in AGENTS.md. Tests: `live.test.mjs` (the installed
  `mxcodr-live.md`) and the extension's setup test (the AGENTS.md live block with Codex); both fail on 2026.11.18.3.
- 2026.11.18.3 (2026-11-18, live mode only; file mode writes what it did): **Plan first for Codex, Pi and Copilot**.
  Measured in a Codex session from the pane (CarFleetCodexSol, Plan first on): the rule reached only Claude Code
  (`.claude/rules/mxcodr-plan.md`, naming EnterPlanMode/ExitPlanMode); Codex wrote the model within a minute, no plan.
  New `templates/plan-first-agents.md`: the same rule in words any agent can follow (present the plan as your message,
  end the turn, change nothing until the person approves). The extension writes it into the app's AGENTS.md between
  `<!-- mxcodr-plan:start/end -->` while the pane's switch is on. `install.mjs` exports `PLAN_START`/`PLAN_END`, and
  `isScaffoldLeftover` reads an AGENTS.md whose only text besides mxcli's section and our block is that block as
  generated. Same release: Codex on preset Trust may run the app and the tests (the extension's Codex rules,
  `spikes/studio-pro-ext/README.md`, "Codex: Plan first and Trust").
- 2026.11.18.2 (2026-11-18): **the skill gate** and the project skills first in the rule file. Measured in CarFleet's
  session (live mode, 2026-11-18): the rule "before building a part, read its project skill" sat mid-file and was
  ignored: `app-security` read before planning, `naming-and-captions` only after the domain model and security were
  executed, `spacing-and-layout` before pages, `module-structure` never (no folders until the person asked),
  `durable-tests` never although the agent wrote `tests/*.spec.ts`. Two causes besides the vague trigger: mxcli's own
  `CLAUDE.md` section says "read a skill's section, not the file" and "`./mxcli syntax` before any skill".
  Now (1) `templates/mxcodr.md` opens with `# Read the project skill before you build its part`: one line per
  skill with its concrete trigger, read whole before the plan and before `./mxcli syntax`, mxcli's "section" advice
  limited to mxcli's own skills in `.ai-context/skills/`; the keep-tests rule follows it unchanged (`checkRule` now
  wants the skills section, then the 7 keep-tests lines; 38 template lines, 32 in the body). `lib/skilloff.mjs` drops a
  switched-off skill's line, the section when none is left. (2) `lib/skill-gate.mjs`, Claude Code hooks in
  `.claude/settings.local.json` (`mxcli init` overwrites `settings.json`, not this file): PostToolUse on
  `Read|Skill` records a gated skill read whole (no limit, or one that covers the file; the Skill tool loading it) in
  `.mxcodr/state/skills-read-<session>/<name>` (one empty file per skill, so parallel Reads all count; a
  read in another folder does not); PreToolUse on `Bash|PowerShell|Write|Edit|MultiEdit` refuses (exit 2,
  the SKILL.md paths to read on stderr) `./mxcodr-live exec`, `mxcli exec` and `mxcli -c` whose MDL needs a skill not
  read yet in this session, and a write of `tests/**/*.spec.ts` before `durable-tests`. The MDL is the script file
  the command names (else the command's own text, a heredoc), comments and quoted strings left out: a new module,
  folder, move or document -> `module-structure` + `naming-and-captions`; roles, grants, access, demo users, project
  security -> `app-security`; pages, snippets, layouts, navigation -> `spacing-and-layout` + `naming-and-captions`;
  `System.FileDocument`/`System.Image`, upload and image widgets -> `files-and-images`; a Java action ->
  `java-action-docs`. Only skills the app has in `.claude/skills/` are asked for (a switched-off one is not); check,
  query, show and describe never are. It fails open (any error, bad input, a missing script, no Node, a state folder it cannot write), and
  `MXCODR_SKILL_GATE=0` in Claude Code's environment switches it off. File mode copies it to `.mxcodr/skill-gate.mjs`
  (`node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" pre|post`, a new installer step); live mode runs the runtime's
  copy through `guard.sh skill-gate pre|post` and removes a file-mode copy. Cursor, Codex, opencode and Pi get the
  rule text, not the gate. The installer writes nothing into `CLAUDE.md` outside mxcli's markers, so no line there.
- 2026.11.18.1 (2026-11-18): `app-docs/fingerprint.mjs` format 2, after the owner was asked to update the docs almost
  every time he opened the Docs tab with nothing changed in the app. Measured on a large real app (Windows, mxcli 0.32): 4 of
  the 5 stale reports in two days named only `app`, 3 of them with no model save in between; swapping only
  `modules/MxCodr.mxmodule` (1.82.74 -> 1.82.72) on a copy flipped `app`: mx-codr's own add-on modules carry the
  package version into `show modules`. mxcli 0.31 -> 0.32 changed 3 of 6 module hashes on unchanged models (DESCRIBE's
  wording), and DESCRIBE names pluggable widgets from the app's widget definitions (mxcli's `.mxcli/widgets` cache).
  Now: `model`, the bytes of the `.mpr` and `mprcontents/` (0.1-0.3 s on that app's 2069 units), is the witness: unchanged
  -> current whatever DESCRIBE says (another mxcli included: the agent writes only the new meta); changed under the
  same mxcli -> the parts that differ (layout only: none); changed under another mxcli -> parts `["model"]`, written
  again. `app` leaves out Type `Add-on` modules and the module `Version` column (1.0.0 on every app module);
  `brain` is `docs/brain/plan/` only (the requirements the page cites; decisions captured elsewhere change nothing).
  `stamp(html, fp)` writes a fingerprint into the meta, each section's `data-hash` and the footer (the extension's
  Mark as current). A page written before format 2 (no witness) is compared on its module parts and on its brain as
  it was then (all of `docs/brain/`), never on `app`, which held the add-on versions and cannot be computed again: no
  bar on first open after the update (a large real app's real page, checked on a copy in the Windows VM: current).
- 2026.11.17.15 (2026-11-17): `live.md`, CE4899 (an empty default-language text, `Empty caption. [German,
  Switzerland]`), CW0263 or a request for another language: the agent translates through `./mxcodr-live translate`
  (`status`, `todo`, its translations into the file the todo names, `apply`, then `problems`); `copy --from` only when
  the person asks for a copy. Texts written by `translate` are the one exception to "never change a Marketplace
  module" (a default-language text must be in the module itself): `marketplace update` compares without them and puts
  them back, and `module-structure`'s `marketplace-check.mjs` lists the documents named in `.mxcodr/translations/`
  as a note, never a warning (another edit in such a document is not told apart there). Never translations through
  `exec`, `create translations` or `./mxcli` while Studio Pro has the app open.
- 2026.11.17.14 (2026-11-17): `live.md`, two rules measured after an OIDC update (CE1613 on a button in a legacy Data
  grid's control bar): mxcli cannot address those buttons (`widget not found`, `SHOW WIDGETS` skips them), so the agent
  never guesses a name and gives the person one exact Studio Pro step, or offers a Data grid 2 replacement in the
  app's own module (a redesign, asked first, never in a Marketplace module); in `bson dump` output a widget is read
  by its whole object, never by the `Name` line nearest a hit (keys are sorted, `Action` before `Name`: the agent
  had picked the "New" button instead of "Edit"), and confirmed with `DESCRIBE`.
- 2026.11.17.13 (2026-11-17): `marketplace update` and `marketplace install` name the modules the new version's
  package calls that the app lacks (`needs UserCommons (not in the app): ./mxcodr-live marketplace install 223053` on
  a large real app's OIDC 5.0.0), and the update refuses while one is missing. `live.md`: install it first (tell the person),
  `--accept-missing-modules` only when the person decided to update without it; `likely too old` is the next update;
  after `marketplace install` a `needs` line is the next install. Also, three-way from the package: Java and
  JavaScript actions are compared with the package's own sources and without the generator's imports (a large real app's
  OIDC: 33 conflicts -> the 16 real ones).
- 2026.11.17.12 (2026-11-17): `marketplace update` stays three-way when Studio Pro's importer refuses the installed
  version's package (a package saved before Mendix 10.21): mxcli reads that package's model directly as the base.
  `live.md`: `Mode: three-way (base read by mxcli from the package)` is three-way too; `Mode: TWO-WAY` only when the
  package cannot be read at all, or `--no-base`. Measured on a large real app's OIDC 2.3.2 -> 5.0.0 (copies, Mac): 1
  addition, 16 real edits (all also changed by 5.0.0: conflicts), 7 upgrade-only differences not counted, 43 s.
- 2026.11.17.11 (2026-11-17): `marketplace update`'s two-way mode moves only on evidence (a large real app, OIDC 2.3.2 ->
  5.0.0: 60 of 61 "only in the app's copy" documents were OIDC's own, and the fifth move failed after 4 had landed).
  `live.md`: in two-way mode a document only in the app's copy moves only when it is the app's; the rest is saved
  under `kept/` and removed by the update; tell the person the moves by type, the kept ones and which the app uses
  (repoint after the update); `MOVE GUARD` -> `--accept-moves` only after the person's yes; `BLOCKED` -> the person
  moves those in Studio Pro first; a stopped move script -> run the `undo-moves.mdl` it names before anything else.
  The extension's side (base list from the installed package, the guard, the undo list, plans never reused after a
  run) is in `spikes/studio-pro-ext/README.md`.
- 2026.11.17.10 (2026-11-17): `marketplace update` runs (live mode only), after a measured slow day on Windows
  (a large real app, Studio Pro 11.12.1: ~89% of each run was mx-codr's own preparation). `live.md`: start an update, with or
  without `--plan-only`, as a background command where the tool has one (Claude Code: `run_in_background`) and wait for
  its completion notification (no polling, no own timeouts, never a second update while one runs: it refuses; no
  `query`, `check`, `exec` or `mxcheck` until then, they would wait for it and give up after 3 minutes); read
  `report.md` for the full lists (stdout now ends with counts, what was NOT done and the report's path); the run after
  a yes reuses the plan while nothing changed; `NEEDS --keep-in`: ask which module. The review bullet points at
  `report.md` for the per-file hints. The extension's side (one shadow sync per phase, plan reuse, early `--keep-in`,
  progress lines, the lock that names its holder, the parent watch) is in `spikes/studio-pro-ext/README.md`.
- 2026.11.17.9 (2026-11-17): CE6087 (design properties renamed in the theme, one error with no document, after almost
  every Atlas or Marketplace update). `live.md`: run `./mxcodr-live fix design-properties` first (Studio Pro's own
  "Update all renamed design properties in project" in the open model, Marketplace modules included: Studio Pro's own
  fix is allowed there, MDL edits are not), never `./mxcli fix design-properties` while Studio Pro has the app open,
  the person's right-click in the Errors pane only on a PERSON ACTION line. The two-way review bullet and
  `marketplace update`'s review summary name `fix design-properties` before `fix widgets` and `problems`.
- 2026.11.17.8 (2026-11-17): two CE cases after a WorkflowCommons / Atlas_Core update (live mode only). `live.md`:
  CE7247 (`... of type 'Reference'`) on an association path in a Data grid 2 column of a Marketplace module's page
  usually means an old Data Widgets (Studio Pro checks the column against `widgets/com.mendix.widget.web.Datagrid.mpk`,
  which the module brings; Datagrid 2.22 has no association types on a column, 2.26 has them, read from the packages):
  `marketplace outdated`, then update Data Widgets (`--plan-only` first, then ask), never edit the Marketplace page; a
  column's "caption is required if 'Can hide'" is the Data grid's own warning, not blocking, left alone. And the review
  of two-way files (an Atlas_Core update too): an app customisation goes into an app-owned copy (a layout in the app's
  theme module) with the app's pages repointed, never back into the Marketplace module; the rest is template drift;
  then `fix widgets` and `problems`. The extension's `marketplace update` prints, per review file, the line counts
  against the new version's DESCRIBE, the first app-only line and the next step (also in `report.md`).
- 2026.11.17.7 (2026-11-17): a build that fails in a Marketplace module's Java. The case: an 11.12.1 app whose Run
  failed with 30 javac errors in old CommunityCommons, OIDC, Email_Connector and MxModelReflection (APIs Mendix 11
  removed), and the agent began editing their Java. The extension's `app run` now lists the errors by module and, for a
  Marketplace module, names `./mxcodr-live marketplace update <id> --plan-only` with the newest version.
  `live.md`: on such a failure, update the module (`--plan-only` first, then ask), never edit a Marketplace module's
  Java (the update overwrites it); errors in the app's own modules are fixed in their Java. A new bullet: after a
  Mendix version change or a failed build, `./mxcodr-live marketplace outdated` (modules behind for the app's Mendix
  version, `OLD` ones made for an older Mendix first), each updated the same way.
- 2026.11.17.6 (2026-11-17): the live texts follow `marketplace update`'s two-way mode. When the installed version's
  package cannot be read (a 3.x package saved before Mendix 10.21, in an 11.x app: exit 117), or with `--no-base`, the
  plan says `Mode: TWO-WAY` and nothing is run again. `live.md`: the agent then tells the person which documents
  were moved to their module (each to check: the app's own, or one the new version dropped) and which were saved for
  review. After the update it compares each file under `.mxcodr/marketplace/<Module>/review/` with the new version
  before changing anything. The live edit of `marketplace-ext.md` says the same in one clause.
- 2026.11.17.5 (2026-11-17): live mode points the agent at the extension's `./mxcodr-live marketplace update <id|name>`
  for a newer version of a module the app has (one that fixes an error, such as CE4271 in WorkflowCommons). The texts
  said an installed module was never updated from the pane. `live.md`: a new bullet. Run `--plan-only` first
  (`--to x.y.z` for a version other than the newest), tell the person what it will move and re-apply, and update only
  after a yes. The update moves the app's additions into the app's own module, has Studio Pro replace the module,
  re-applies the app's edits where the new version left them alone, then prints the error list. On exit 4 the agent
  passes on the person's steps, then runs `--resume`. `live.mjs`: `files-and-images`' live text names the update
  instead of "an update is the person's", and a new live edit of `module-structure/reference/marketplace-ext.md` names
  the update. File mode is unchanged.
- 2026.11.17.4 (2026-11-17, owner decision): `marketplace-check.mjs`'s baseline moves to the app's `.mxcodr/` folder,
  `.mxcodr/marketplace-baseline.json` (created when missing); one beside the `.mpr` (bundles .2/.3) is still read when
  `.mxcodr/` has none, no migration. The CLI is unchanged (`--baseline` as before; the Marketplace update work calls it
  after an install or update). `.mxcodr/` is git-ignored in live mode (the extension's setup writes `/.mxcodr/` into
  `.gitignore`), so there the baseline is per checkout; the file-mode installer adds no ignore line, so it is committed
  unless the person ignores it. The skills-clean and coverage-install tests still refuse `.mxcodr/` in skill texts
  (`.md`); a script beside a skill (`.mjs`, run and never read as advice) may name it, so the path stays a constant in
  the script. Measured: `--baseline` on the scratch app writes `.mxcodr/marketplace-baseline.json`.
- 2026.11.17.3 (2026-11-17): the baseline of `marketplace-check.mjs` can no longer clear the agent's own edits.
  In .2, `--baseline` added a module's current `changed` elements to its existing entry and the reference told the
  agent to run it after a module install, so it could whitelist its own edits in every other module. Now an existing
  entry (same module and version) is never widened, `--baseline` writes no file when no module was checked (a
  logged-out run wrote an empty one) and says what it did on stderr (not into `--json`), and the agent's texts no
  longer mention `--baseline`: the reference says the file records what differed when the app was created and is
  never written or edited by the agent. Taking it is the installer's or the extension's (not built: right after
  `mxcli new` and after `./mxcodr-live marketplace install`); until then edits show as notes. Measured: the
  reference's remedy (`move microflow ... to folder '...' in <Module>`, the same for a snippet) on the scratch app
  clears both `added` warnings and adds no `changed`.
- 2026.11.17.2 (2026-11-17, owner decision): **nothing added to or changed in a Marketplace module.** An app's agent
  had put its own documents in WorkflowCommons and edited snippets there; the module's Marketplace update deleted
  them. The texts: one sentence in the rule file's line 25 (still 25 lines), one in `live.md`'s Marketplace bullet,
  `module-structure`'s Marketplace section (how to tell one: `list modules`, Source `Marketplace v...`; never create
  a document in one; use the module's constants, snippets, startup microflows and `UseMe` folder from the app's
  side; a document that must change is copied into `<Module>Ext`), its `reference/marketplace-ext.md` (moving an
  addition out with `move ... in <Module>`) and one sentence in `reuse-and-snippets`. The warning:
  `module-structure/marketplace-check.mjs -p app.mpr` (read-only, exit 0 whatever it finds), which the skill asks
  the agent to run before work in a module is finished; nothing runs it behind the agent's back. Per Marketplace
  module (content id and version read from its module unit in `mprcontents/`; an MPR v1 app: `list modules`, and
  "not checked") it runs mxcli 0.32's `marketplace diff <id> --module <Name> --json`, which imports the recorded
  package version into a throwaway project and compares DESCRIBE output: `onlyInstalled` (added) is always a
  warning; `modified` is a warning only against a baseline (`marketplace-baseline.json` beside the `.mpr`, since .4 in `.mxcodr/`, written
  by `--baseline`, per module and version; see 2026.11.17.3), else a note without a fix, because a fresh `mxcli new` 11.12.1 app
  already differs in 8 elements of Atlas_Core, FeedbackModule and Administration (Mendix's template ships them
  changed; measured 2026-11-17). Elements mxcli cannot describe (page templates, building blocks) are a note;
  no login, a version the Marketplace no longer lists (NanoflowCommons 6.0.0 under its recorded id) or no content
  id are "not checked", never clean. Measured on a scratch app: an added microflow and snippet, an attribute added
  to `Administration.Account` and an `alter snippet` on `Administration.ReadMe` all reported; 2-10 s a module
  once the package is cached. Tests: `test/marketplace-check.test.mjs` (mxcli's measured JSON as fixtures).
- 2026.11.17.1 (2026-11-17): 2026.11.16.3's paragraph in `durable-tests` (Setup) is gone again. It asked for
  `[R<n>]` in the title of a test that checks a numbered requirement, so the Studio Pro extension's Brain tab could
  show the test under it; the Brain tab no longer shows tests, so the tagging was wasted work for the agent.
  `mxcodr/test/req-tags.test.mjs` and the translator's test of the skill's examples went with it.
  `requirements-interview` and, with coverage on, `templates/coverage-durable-tests.md` keep their own steps as before.
- 2026.11.16.2 (2026-11-16): `--boot`'s port check no longer calls a busy port free. It bound 127.0.0.1 only, and
  on macOS that bind succeeds while `python -m http.server` listens on `*:<port>` (IPv6 dual-stack): measured with
  python on `*:18765`, the old check said free, the new one busy (and free again once python stopped). The probe is
  now `overlay/lib/ports.mjs`, the same logic as the Studio Pro extension's microflow test runs
  (`translator/src/test-ports.mjs`): a bind on 127.0.0.1 first and closed, then a connect on 127.0.0.1 and ::1 (800 ms
  each, at once); busy when the bind fails or a connect answers. No bind on the wildcard address (the Windows firewall
  dialog). Ports, order and fallback unchanged (8080/8090/6543, else three from 18080). `mxcodr/test/ports.test.mjs`
  proves it with real listeners on 127.0.0.1 and on the wildcard address. Nothing else an install writes changes.
  Not measured: Windows.
- 2026.11.16.1 (2026-11-16): pinned to mxcli **0.32.0** (`PIN`, and the six `PIN_SHA256` digests: GitHub's asset
  digests, each checked against the downloaded asset). Measured 2026-11-16 with the darwin-arm64 binary on copies of
  two existing apps: `init .` writes the same `CLAUDE.md`, `AGENTS.md`, `settings.json` and `.gitignore`, and six new
  skills (`genai-runtime`, `report-architecture`, `report-performance`, `report-security`, `report-tests`,
  `report-traceability`; no clash with ours); `init --sync-skills` refreshes the skills and the one changed lint rule
  (`cross_module_data.star`, ARCH001) but, as on 0.30 -> 0.31, not `.claude/commands/*.md` nor the `TAG` default in
  `.claude/bootstrap-mxcli.sh`. The bundle's 37 MDL blocks check exactly as on 0.31 (without a project); its
  access-rule and `[%CurrentUser%]` forms pass `check -p --references` on 0.32's new token checks (MDL-TOKEN01,
  the access-rule token checks), and `'XL'` spacing is still accepted by `check` (only unknown design properties and
  options of non-spacing properties became errors). The skills' catalog queries run (on the larger app: the folder queries and the snippet-users query give the same
  rows, the `SUB_` call query 408 flows instead of 395: 0.32 records more calls, as QUAL004's drop shows); the two over
  `catalog.refs` in `reuse-and-snippets` no longer answer `[]` when the `.mpr` is spelled differently from the run
  that built the catalog (0.31 rebuilt a narrower one for a relative vs an absolute path; 0.32 matches the file). One text changed:
  `app-security` says `check` now refuses `$currentUser` in an access rule (MDL-XPATH04; the skill names no code) and still passes
  `CurrentUser()`; `naming-and-captions` no longer says `@caption` on a `while` passes `check` without a warning
  (MDL042 warns, on 0.31 as on 0.32). Lint: new MPR014/MPR015 (agents without a selected model, consumed MCP services without an
  endpoint), fewer ARCH001, CONV013 and QUAL004 findings (4646 -> 4585 on the larger app). Not measured: a Windows install.
- 2026.11.15.3 (2026-11-15, owner decision: warn only, never block): the styling rule. Atlas first (classes,
  design properties); own SCSS only where that is not enough, with colours, corners, fonts, spacing and shadows from
  theme variables; one file per module with a reason per rule. One sentence in the live rule
  (`overlay/templates/live.md`), the details in `spacing-and-layout`'s new `reference/own-styles.md` (the variables
  to use, the allowed fixed values: circles and pills, colours that carry meaning marked `/* mxcodr: keep */`,
  icons). The extension (live.82) counts fixed values: `./mxcodr-live styles`, the turn card, the Look tab.
- 2026.11.15.2 (2026-11-15): the live rule (`overlay/templates/live.md`) says corners and fonts go through Atlas's
  variables (`var(--btn-border-radius)`, `var(--border-radius-default)`, `var(--font-family-base)`), as colours
  already did: an app rule `.region-content .btn { border-radius: 8px }` kept the Look tab's corners off every
  button (owner report, a test app). The `slight` corners knob is 4px/6px, what the stock themes ship
  (`overlay/lib/theme.mjs`, `KNOBS`; was 4px/8px).
- 2026.11.15.1 (2026-11-15): the `app-docs` skill (installed always since 2026-11-15) with template v4, whose
  data-model drawing uses Studio Pro's domain-model colours and notation (see `app-docs` below); the bump makes an
  existing install take the new skill files.
- Since 2026.11.14.2 (2026-11-14, owner decision): **`requirements-interview` is installed always**, on every
  install with coverage on or off, and in the extension's live setup (it is in `INSTALLED_SKILLS`, which
  `copySkills` and the extension's setup read; `OPTIONAL_SKILLS` is empty). Coverage stays a separate option: it
  still swaps the rule file's done sentence and `durable-tests`' first finishing step and writes
  `tests/coverage.mjs`. The skill's text no longer depends on coverage: running `node tests/coverage.mjs` is said
  to be "with coverage on (the app has `tests/coverage.mjs`)"; an `[R12]` in a test title is harmless without it.
  Its description triggers on a bigger new request only (the first feature of a new app, a change that adds a
  role, a module or a channel; "Not for a fix, a small change or a question about the app"). The rule file's
  skill paragraph does not name it (the description finds it). Tests: `test/brain.test.mjs` (installed for
  every agent with coverage off and in live mode; the description and the coverage-only lines), and the
  coverage-install, install and skills-clean tests follow. No change in `spikes/studio-pro-ext/` is needed: its
  setup copies `INSTALLED_SKILLS` and the pane already labels the skill "Requirements interview".
- Since 2026.11.14.1 (2026-11-14): **the project brain, person and agent together**, the harness side of the
  owner-approved contract of 2026-11-14 (the Studio Pro extension implements the panel side in
  `spikes/studio-pro-ext/`).
  - **brain always**: the installer runs `mxcli brain init -p <app>.mpr` on every install when `docs/brain/` is
    missing, in its own step (`creating the project brain`; the bar has one step more), not only with coverage on.
    `docs/brain/` is still the app's: never overwritten or removed. The summary has a `brain` row (created, kept
    as it was, or not created with a note). `initBrain` stays exported for the extension's setup, which does not
    run `main()`.
  - **The brain rule** (`overlay/templates/brain.md`, 23 lines, 1,894 characters, about 500 tokens), appended
    after one empty line to every shape of the rule text in `ruleText` (after the coverage, live and
    switched-off-skills edits, which never see it): `.claude/rules/mxcodr.md`, the `.mdc`, the `AGENTS.md` block
    (Codex, opencode, Pi), and so Copilot's read of `.claude/rules/` and the extension's live setup. The agent only
    proposes, with `./mxcli brain capture ... --json`, on three triggers: a feature not in the requirement list (a
    numbered requirement `R<n>` in its slice, anchored forward, never at a bare module); a business-rule answer it
    cannot go on without (captured `--open` before asking; a chat answer is `promote`, then `resolve` with the
    person's exact words, since mxcli resolves only a committed entry); corrected twice on the same thing or a
    choice between real alternatives (a finding, at most 3 a turn). Never: promote its own findings, write a status
    into a requirement, edit or drop an entry unasked. With `MXCODR_PANEL=1` (set by the extension for every agent
    it starts) the person approves in the panel, a plan names each new requirement as one line
    `Requirement: R<n> <one sentence> | slice <NN-name> | anchor @Module.Document` (captured and promoted by the
    panel on Approve), and the panel's session-start brain pack replaces reading `docs/brain/` (and mxcli's
    "Project Brain" section), a module shard through `./mxcli brain brief --module <M>`. Without it the person
    approves in the chat and the requirement list is `./mxcli brain list --kind requirement`.
  - 2026-11-19 (bundle 2026.11.18.7), owner: a plan's requirement anchor names the NEW page or microflow that will
    build it, though it does not exist yet, left out only when the requirement has no document of its own; and the
    one unasked edit: a finished requirement without an anchor gets `./mxcli brain edit <id> -a @<its document>` (the
    rule: 26 lines, 2,397 characters; the size test now allows 26 lines and 2,400).
  - 2026-11-14, owner: every entry is a short title (about 8 words) with its details on the second line; plan lines
    take `| why <details>`; decisions are numbered `D<n>` like requirements (the rule: 25 lines, 2,216 characters;
    the size test now allows 26 lines and 2,300).
  - 2026-11-14, after the owner's third test: a requirement is one short sentence naming the outcome (no details), and
    in plan mode a business-rule answer goes into the plan's lines without `--open` (the rule: 23 lines, 1,985 characters).
  - 2026-11-14, after the owner's second test: a new slice takes the next free number (never reused), and a
    finding's second line is the why the panel shows the person to decide by (the rule: 24 lines, 1,977 characters).
  - 2026-11-14, after a real plan: the brain rule (now 23 lines, 1,995 characters) says a requirement's anchor is a NEW
    document or attribute the work creates, never an existing one, and a plan puts each business-rule assumption on
    a line `Decision: <one sentence> | anchor @Module.Document` (anchor optional), which the panel saves on Approve.
  - **`requirements-interview`**: with `MXCODR_PANEL=1` it captures the numbered requirements and does not promote
    them (the panel's end-of-turn card lists them checked; saving it is the person's agreement); without it, as
    before, it asks "Do you agree?" and promotes after the person agrees in the chat. Unattended (nobody can
    answer) it still promotes them itself in the same turn. Numbers continue after the highest in
    `docs/brain/plan/` and in the queue; captures carry `--json`. Open questions: never resolved by the agent; a
    chat answer is promote, then resolve with the person's exact words (the old text resolved directly, which
    fails on a queued entry).
  - `tests/coverage.mjs`'s hint for an empty ledger says, with `MXCODR_PANEL=1`, that the person saves the
    captured requirements in the panel instead of `./mxcli brain promote`; `module-structure` says to capture a
    decision about a kept document, never promoted by the agent.
  - Tests: `test/brain.test.mjs` (brain always, the rule in every agent's text and its contract points and size,
    the interview's panel and no-panel wording), a panel case in `test/coverage.test.mjs`; the rule-format,
    install and coverage-install tests count the brain rule. File mode no longer writes the template byte for byte
    as the rule file: it writes the template, an empty line, then `brain.md`.
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
One thing runs while it builds, in Claude Code (since 2026.11.18.2) and in Codex in the Studio Pro extension (since
2026.11.18.6): the skill gate (`overlay/lib/skill-gate.mjs`) refuses a model change or a test file until the agent
has read the project skill for it whole; no verdict, no other refusals.

## What is in the bundle

    install.sh                     checks Node >= 20, then runs overlay/install.mjs
    overlay/install.mjs            the installer: main() and a re-export of every step
    overlay/install/               its steps, one file per section: new-app.mjs and merge.mjs (0), mxcli.mjs (1),
                                   rules-file.mjs (4), skills-copy.mjs (5), skill-gate-install.mjs (5a),
                                   test-kit.mjs (5b), film-copy.mjs (5c), coverage-copy.mjs (5d), brain.mjs,
                                   upgrade.mjs (6), probe.mjs (ports), run-live.mjs, summary.mjs; common.mjs and
                                   screen.mjs (the one ui and die) are what they share
    overlay/lib/                   mx.mjs (PIN, BUNDLE), rules.mjs (rule file text and its format check),
                                   templates.mjs (reads overlay/templates/ by name), skills.mjs (which skills are installed), coverage.mjs (the coverage
                                   question and choice), requests.mjs, cache.mjs, ports.mjs (is a port
                                   free: the --boot smoke boot's port check),
                                   theme.mjs (the looks; copied into the app as .mxcodr/theme.mjs),
                                   skill-gate.mjs (Claude Code's skill gate; copied into the app as
                                   .mxcodr/skill-gate.mjs, its hooks in .claude/settings.local.json) and
                                   skill-gate/ (its parts, copied as .mxcodr/skill-gate/),
                                   ui.mjs (what the installer prints: v1's banner, bar, marks, summary)
    overlay/themes/                catalog.json, per theme <name>.css (tokens) and <name>.skin.scss (frame),
                                   logos/<name>/, the preview page and its screenshots
    overlay/templates/mxcodr.md    the always-on rule file, 38 lines
    overlay/templates/brain.md     the brain rule, 23 lines, appended to every shape of the rule text
    overlay/templates/live.md      live mode only (the Studio Pro extension): .claude/rules/mxcodr-live.md
    overlay/lib/live.mjs           live mode only: the edits of the rule file and the skills
    overlay/templates/keep-tests.md its 7 lines after the skills section, byte for byte the sk2 rule
    overlay/templates/tests/       the starter test kit
    overlay/lib/kit-shipped.json   sha256 of every kit version shipped (an unedited one is replaced)
    tools/kit-shipped.mjs          writes kit-shipped.json from git history; rerun after a kit change
    overlay/templates/film.mjs     the film recorder, installed as tests/film.mjs; its parts in
                                   overlay/templates/film/, installed as tests/film/
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

- **The rule file** (`overlay/templates/mxcodr.md`): first (since 2026.11.18.2) which project skill to read whole
  before which part, one line per skill with its trigger, before the plan and before `./mxcli syntax` (mxcli's
  "read a section" only for its own skills), each in its own read or command with Codex's two output limits named
  (since 2026.11.18.6), and that the skill gate (Claude Code; Codex in the extension) holds the agent to it; then the
  7-line keep-tests rule, then how to write the suite
  on `tests/mx.ts`, prove a refusal as the wrong role without weakening the app, run the whole suite in the
  foreground, finish only after a table `requirement -> test that asserts it` (coverage on: after
  `node tests/coverage.mjs` shows `0 missing`) and one green `--shuffle` run
  with `sessions left: 0` (never silencing the kit's checks), and stop processes only with `./mxcli run stop` or
  their own PID; last, the Marketplace and app-docs line. Then, after one empty line, the brain
  rule (`overlay/templates/brain.md`, see *Since 2026.11.14.1*). The `.mdc` and the `AGENTS.md` block
  are made from it in `overlay/lib/rules.mjs`. The installer checks every file it writes: first byte `#`, no
  frontmatter (the `.mdc`: only Cursor's own), no body line equal to `---`, the skills section followed by the 7 lines of
  the keep-tests rule (or those 7 lines first, when every skill in that section is switched off). The `AGENTS.md` block is written only for Codex, opencode or Pi.
- **The skills** (`overlay/skills/`, the list in `overlay/lib/skills.mjs`):
  - `durable-tests`: what deserves a test, on the kit, one worker, the whole suite shuffled at the end;
    `reference/mendix-dom.md`, how Mendix renders for tests
  - `app-security`: Production security, roles, demo users, row isolation, refusals proven by attempt
  - `spacing-and-layout`: Atlas spacing, one layout, menu per role, Back, signed-in user, icons,
    stacked lists in tabs, totals as tiles, charts 360 px high
  - `naming-and-captions`: variable names, a business-words caption on every activity and decision (a self-check
    before a flow is done), widgets `<Page>_<What><Type>`
  - `module-structure`: which module, the starting folders, nothing added to or changed in a Marketplace module
    (`<Module>Ext` for a changed copy); `marketplace-check.mjs` beside it warns about what is there anyway
  - `reuse-and-snippets`: reuse a microflow, share a page, extract a snippet
  - `files-and-images`: uploads, images, documents, a generated PDF
  - `java-action-docs`: every Java action's documentation, in the model (the action, its parameters, the return
    value's name, side effects, failures) and in its javasource file (steps in the user code, javadoc on helpers);
    cases in `test/skill-cases/java-action-docs.mjs` (discovery, effect, negative; a real Claude Code turn each)
  - `film-tests`: lists the tests and films the one the person picks (or all), only when asked
  - `requirements-interview`: ask before a bigger new request, then numbered requirements captured into
    `docs/brain/plan/`, promoted by the person in mx-codr's panel with `MXCODR_PANEL=1`, else by the agent after
    the person agreed in the chat (installed always since 2026.11.14.2; before, only with coverage on).
  - `app-docs` (installed always since 2026-11-15): the app's documentation, `docs/app-docs.html`, one self-contained
    page (each module's data model as a drawing, how it is built, things to know, where to start, requirements) from
    `template.html` beside the skill; only on request (the extension's Docs tab, or the person's words), then updated
    at the end of every turn that changed the model (the rule file's last sentence, dropped when the skill is switched
    off). `fingerprint.mjs` beside it hashes the model per module without layout lines, plus the app settings, the module
    list without add-ons and the requirements (`docs/brain/plan/`), with the model's own files as the witness (format
    2: unchanged files -> current, whatever mxcli version); the agent writes it into the page's meta and the Docs tab computes it again (live mode:
    `./mxcodr-live docs fingerprint|check`, the same file). Every Mendix name is an `a.mx` link the tab opens in Studio
    Pro. The template's `@media print` rules make the extension's PDF (light theme, a section per page, the drawing
    whole). The skill's section Comments: the person's comments in `docs/app-docs.comments.json`, fixed or answered.
    The drawing (template v4) uses Studio Pro's domain-model colours (`--dm-*` tokens, light and dark): indigo
    entities, amber temporary ones, the blue generalization tag, `Name (Type)` attribute lines, circled 1 / * ends and
    association names in red-bordered boxes.
    Tests: `test/app-docs.test.mjs`; cases in `test/skill-cases/app-docs.mjs` (by hand, a real app copy).
- **Coverage on** (`overlay/lib/coverage.mjs`) changes two texts and adds one file, nothing else: the rule
  file's done sentence (lines 13-16) is `overlay/templates/coverage-done.md`, same line count, so it stays 25
  lines; `durable-tests`' first finishing step is `overlay/templates/coverage-durable-tests.md` (the `[R12]` title
  convention and `node tests/coverage.mjs` instead of a printed table, so the agent never reads two definitions
  of done); and `tests/coverage.mjs` (`overlay/templates/coverage.mjs`) is
  written on every install, like the film recorder. (`mxcli brain init` when `docs/brain/` is missing runs on
  every install since 2026.11.14.1, with coverage on or off.) Switched off on a reinstall: `tests/coverage.mjs` goes, the plain texts come back, `docs/brain/`
  stays. The choice is recorded in `installed.json` (`coverage`) once made, asked or by flag, and kept on a
  reinstall unless a flag changes it; an install that defaulted to off records nothing.
- **The starter test kit** (`overlay/templates/tests/`): since 2026.11.20.1 `tests/mx.ts` is the short list a spec
  needs (one typed re-export per helper, its signature and a one-line doc comment) and `tests/mx-impl.ts` holds the
  code; specs import from `./mx` only. The helpers (sign-in and sign-out that never leak
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
  install again to get the kit), and no `tests/mx-impl.ts` unless that `mx.ts` imports `./mx-impl`. The thin
  `tests/mx.ts` is written or updated only beside the kit's own `tests/mx-impl.ts` (a file of that name the kit did
  not write holds it back, with a line). A kept `tests/package.json` that pins another `@playwright/test` gets the pin
  hint (`npm install -D -E @playwright/test@1.64.1` in `tests/`).
- **The film recorder** (`overlay/templates/film.mjs`): `tests/film.mjs`, written on **every** install and
  reinstall (unlike the kit it is the bundle's, so an edit there is replaced; it is written also when the kit is
  the app's own). v1's `tests/film.sh` is removed on upgrade. Since 2026.11.21.3 its parts are in `tests/film/`
  (from `overlay/templates/film/`): each written the same way, and a file of the person's beside them stays.
- **`.mxcodr/`** holds `installed.json` (bundle, mxcli path and version, db, agents, skills, `coverage` when chosen, the kit files
  that are the kit's, written now or kept from before, `theme`, requests), `theme.mjs` and `themes/` (to
  change the look later), `bin/mxcli` when mxcli had to be downloaded, and `install.log` (the paths a new app
  replaced or kept, when it found any).

All of these survive `./mxcli init --all-tools` and `./mxcli init --sync-skills` (mxcli 0.32.0 rewrites
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
1. **mxcli**: a found mxcli 0.32.0 (the recorded one, PATH, the app's `./mxcli`), else a download into
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
   folder (the retired `test-first-delivery` included). Then the starter test kit and `tests/film.mjs`,
   `mxcli brain init` when `docs/brain/` is missing (every install), with coverage on also `tests/coverage.mjs`, then
   `mxcli init --sync-skills .`, so mxcli's own skills and its sections of `CLAUDE.md`/`AGENTS.md` match the
   pinned binary (after our files: it fills the mxcli markers step 6 may have written). Then
   `.mxcodr/theme.mjs` and `.mxcodr/themes/`. With Claude Code among the agents, the skill gate:
   `.mxcodr/skill-gate.mjs` (its parts in `.mxcodr/skill-gate/` since 2026.11.21.3, the folder replaced whole) and its
   two hooks in `.claude/settings.local.json` (earlier ones replaced, the person's
   settings kept; without Claude Code both go; a settings file that is not JSON is left alone and said).
7. **`--request <file>`**: the request saved word for word as `docs/requests/NN.md`.
8. **`--boot`**: `mxcli run --local --detach` (Mendix's default ports when free, else three free ones from
   18080; free: a bind on 127.0.0.1 works and nothing answers a connect on 127.0.0.1 or ::1), `mxcli run wait --ready`, `mxcli run stop`.

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
  Mendix Labs only, an existing module refused; Studio Pro must be signed in and mxcli logged in); a newer version of
  a module the app has goes in with `./mxcodr-live marketplace update` (since bundle 2026.11.17.5);
  asking the person is the fallback when the command refuses;
- `module-structure/reference/marketplace-ext.md`: a newer version through `./mxcodr-live marketplace update` (additions
  moved out first, edits run again afterwards; in two-way mode nothing is run again, differing documents saved for review);
- `live.md` itself (since bundle 2026.11.17.7): a build that fails in a Marketplace module's Java is fixed by updating
  that module, never by editing its Java; `./mxcodr-live marketplace outdated` after a Mendix version change or a failed
  build; since 2026.11.17.8, CE7247 on a Marketplace page's Data grid column -> update Data Widgets, the "Can hide"
  caption warning left alone, and two-way review files: app customisations into app-owned copies, the rest accepted;
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
  and a screenshot of a failed test; `mx-impl.ts`'s sign-in failure says `./mxcodr-live app restart`. `tests/film.mjs`
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
  Update all widgets through the extension, live.43; the person's App > Update all widgets only when it says so), never `./mxcli fix widgets`; CE6087 (renamed design properties) is `./mxcodr-live fix design-properties` (Studio Pro's own renamer, Marketplace modules included; since 2026.11.17.9), never `./mxcli fix design-properties`; when a command cannot reach Studio Pro, its own instruction passed on word for word (live.73); what a turn changed from `./mxcodr-live changes list` / `changes show --turn <id>`, never git, with the actions Studio Pro regenerated at a build marked as its own (live.74); the `exec` verdicts, `./mxcodr-live problems` after
  every exec, `./mxcodr-live mxcheck` for the full check (it overrides `CLAUDE.md`'s `~/.mxcli/mxbuild/` mx path, which
  has no `mx` on a Mac with Studio Pro 11.16), `logs` when a run or a test fails on the server, `open` and `save` (ask first),
  `open <file>[:line]` (a file of the app in an editor tab inside Studio Pro, a theme `.scss`/`.css`/`.js`/`.json` in Studio Pro's own editor; the person may edit and save it there), the app commands,
  Playwright against Studio Pro's URL, the demo password, the Tests tab (`./mxcodr-live tests status|run|clear`),
  `./mxcodr-live tests affected` instead of the whole suite (the full suite only as a proposal), films
  (`./mxcodr-live tests film <file>[:line]`, only when the person asks; Watch film in the Tests tab), microflow
  tests with `./mxcodr-live test` on a copy, never `mxcli init`, a task list (Claude Code's TaskCreate/TaskUpdate) for any
  task of three or more steps and after an approved plan (live.33; `templates/plan-first.md` is the pane's switchable
  "Plan first for bigger requests" rule, written as `.claude/rules/mxcodr-plan.md`; since 2026.11.18.3
  `templates/plan-first-agents.md`, the same rule without Claude Code's tool names, goes into AGENTS.md between
  `<!-- mxcodr-plan:start/end -->` for Codex, Pi and Copilot; since 2026.11.18.5 their plan is wrapped in
  `<!-- mxcodr:plan -->` / `<!-- mxcodr:plan-end -->`, which the pane shows as the plan card), only the person commits, in Studio Pro (Version
  Control > Commit), and nobody runs `git init`: version control is Studio Pro's (Upload to Version Control
  Server, offered by the pane's ⋯ > Check setup); the extension never makes a repository or a commit (live.26).
- hooks (the extension's setup writes them into `.claude/settings.local.json`; of these, file mode installs only the
  skill gate): the skill gate (since bundle 2026.11.18.2, `overlay/lib/skill-gate.mjs` run from the runtime through
  `translator/bin/guard.sh skill-gate pre|post`, two entries of their own, a file-mode copy in the app removed; since
  2026.11.18.6 also for Codex in `.codex/hooks.json`, `guard.sh skill-gate pre|post --agent=codex`, on Windows
  `translator/bin/skill-gate.cmd`), and in
  one `PreToolUse` entry on `Bash|PowerShell` the git guard (`translator/bin/git-guard.mjs`: since live.30 an
  allowlist of read-only git, everything else is the person's in Studio Pro's Version Control) and, since LIVE 15, the sed guard (`translator/bin/sed-guard.mjs`):
  on macOS a GNU-style `sed -i 's/…/…/' file` is refused before it runs (BSD sed takes the word after `-i` as the
  backup suffix and fails with "invalid command code"), with "macOS sed needs a backup suffix: use the Edit tool,
  or `sed -i '' …`." Refused: `-i` (also `-Ei`, `-ni`) followed by a script, an address or another option, and
  `--in-place`; allowed: `-i ''`, `-i.bak`, `-i .bak`, `gsed`, sed without `-i`, sed only in text; any other
  platform passes everything, and an unclear command passes;

- skills switched off in the extension's Rules tab (`overlay/lib/skilloff.mjs`, the `skillsOff` option of
  `ruleText`, `writeRules` and `copySkills`; the extension only): their folder is `.mxcodr/skills-off/<name>/`, the
  rule file's first section naming the skills loses their lines (the whole section goes when none is left), the
  skill gate stops asking for them (they are not in `.claude/skills/`),
  the live rule file's films bullet goes with `film-tests`. With none switched off (file mode, always) every output
  is byte for byte what it was;

`mxcodr/test/live.test.mjs` applies every edit (rule file, skills, test kit, film recorder) and checks that no
file-mode command is left in the live texts and that file mode writes the template bytes.

## Film a test

A person who wants to *see* a test asks the agent in plain words: "film the order approval test", "show me
how the customer test works", "record all the tests". The `film-tests` skill has the agent list the tests
(`node tests/film.mjs --list`), ask which one unless the request names it, and film it. The agent never
films on its own.

The film is the test as it is, slowed afterwards: the test records at almost its own speed (each action's pointer
and an orange frame round its element shown 150 ms, a short title card and end), and ffmpeg then makes the
film: a title card names the test for 2.5 s, each action plays in slow motion for 1000 ms (`--pace`), a wait over
1.5 s plays faster, and the test's title stays in a small label at the bottom. The screen the test ends on, passed
or failed, stays at least 5 s (also at `--pace 0`, which slows no action). Typed values never show as captions
(Playwright's action callouts are off). Recording takes about the test's own time plus a few seconds; `--all`
films every test in one Playwright run. By hand, in the app folder, with the app running:

    node tests/film.mjs --list                # every test, numbered, with file:line
    node tests/film.mjs 7                     # test 7; or words of its title, or orders.spec.ts:57
    node tests/film.mjs --pace 1500 7         # slower film (ms per action; 0 = the test's own speed)
    node tests/film.mjs --all                 # every test with a browser, in the background (--status, --stop)

The video lands in `.mxcli/films/<title>.mp4` (ffmpeg slows and converts it; without ffmpeg there is only the
raw `.webm` at the test's own speed, which opens in Chrome or Firefox, not QuickTime). `.mxcli/` is in mxcli's `.gitignore`. A failing test keeps
its film, which shows where it stopped.

Normal runs are unaffected: `tests/playwright.config.ts` has no video or slow-down. While it films,
`film.mjs` writes a temporary `.film.config.ts` beside the app's config (spreading it and adding only
`use.video` with `show.actions` and `show.test`, and its timeline reporter) and one wrapper per spec in `.film/`
(a `beforeEach` that shows the title card and marks the card, the sign-outs and the test's end, then the spec
imported unchanged), and removes both afterwards. The short end hold runs right after the test function, before
any `afterEach`; the kit's `signOut` holds as briefly when `MXCODR_FILM_HOLD_MS` is set (only in a film) and the
page was not held yet. `filmPlan` and `makeFilm` then slow the raw video into the film.

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
