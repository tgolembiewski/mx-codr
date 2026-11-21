# While Studio Pro has this app open, change it with ./mxcodr-live

You work in the mx-codr pane inside Studio Pro (`MXCODR_TERMINAL=1`), or a `*.mpr.lock` file sits next to the
`.mpr`: Studio Pro has the app open. It owns the model and runs the app. Then:

- The app open in Studio Pro is the only app you build in. Never create another Mendix project or `.mpr`
  (`mxcli new`, a copy of the app, a scratch project), not even when the request names another Studio Pro version
  or asks for "a new app": build in this app, and when the request names a different Studio Pro version than this
  app's (`./mxcodr-live status` says it), say so in your summary.
- When you cannot reach Studio Pro (`./mxcodr-live status` fails), stop and tell the person what is wrong (the
  pane's checklist, its own instruction word for word) instead of building elsewhere.
- Write each model change as an MDL script file and run `./mxcodr-live exec <script.mdl>`. Never
  `./mxcli exec`, `mxcli -c` with a change, `./mxcli marketplace install` or any other write to the `.mpr`:
  mxcli refuses, and a write behind Studio Pro's back would be lost at its next save. Never `--force` or
  `MXCLI_ALLOW_STUDIO_PRO_OPEN`, and never `--mcp`.
- Create or change files (`mdlsource/*.mdl`, tests) with the Write or Edit tool, never with shell redirection,
  `printf`, `echo >` or heredocs: those ask the person every time. Write creates the folder too (no `mkdir`).
- Run each `./mxcodr-live` command as a command of its own: no `|`, `&&`, `;` or `| tail` around it. Chained
  with anything else it runs inside Claude Code's sandbox, which cannot reach Studio Pro; the error then says so.
- `exec` prints one line per statement: `landed`, `landed*` (Studio Pro stored it slightly differently),
  `no change`, `refused by mxcli`, `refused`, `Studio Pro error` or `conflict`, and stops at the first
  statement that does not land. The statements before it are already in Studio Pro: fix the failing one
  and run only it and the ones after it, in a new script.
- `conflict` means the person has unsaved edits in a document the statement touches: ask them to save
  (Ctrl/Cmd+S, or Save all on the pane's unsaved-changes bar) and run it again. Nothing was written.
- Reading the model: `.mxcodr/model/` has one file per document (`INDEX.tsv` lists them); never grep `mprcontents/`.
  Find what you need with one `grep -rn` (several names in one pattern), then read only the lines around the hits (Read
  with offset and limit, or `sed -n 40,90p` on several files in one command); a whole file only when you need all of
  it. It leaves out System, add-on modules (`modules/*.mxmodule`), image and icon collections, page templates and
  building blocks: when a grep there finds nothing, `./mxcodr-live query "search '<text>'"` before you call it absent.
  Use `./mxcodr-live query` (a copy of what Studio Pro saved) to read a document fresh before you change it, for
  `search '<text>'`, `show references to M.Name`, `show context of M.Name` or a catalog select, and when `INDEX.tsv`'s
  state line or `./mxcodr-live model status` says it lags. Several statements in one query, never a loop; never re-run
  one to page it: read the `.mxcodr/out/` file it names. Check a script first with `./mxcodr-live check <script.mdl>`.
- Searching the project's files (tests, Java, theme): `grep -rn --exclude-dir={.mxcodr,.mxcodr-test,.mxcli,mprcontents,deployment,node_modules,.git,vendorlib,theme-cache,.mendix-cache} '<pattern>' .`,
  never `grep -r ... . | grep -v ...`: the filter after the pipe does not stop the reading (100 s on a large app). The
  `{...}` list needs bash or zsh; in PowerShell or sh give one `--exclude-dir=<name>` per folder.
- `./mxcodr-live status` says whether Studio Pro is connected, its version, the open editors, and how many
  files are uncommitted. When a command says it cannot reach Studio Pro, pass on its own instruction to the
  person word for word; do not add steps of your own.
- What a turn changed (the person asks why files changed): `./mxcodr-live changes list` (the pane's turns, newest last)
  or `./mxcodr-live changes show --turn <id>`, never git (the app may not be a repository). Files with `"by":
  "studio-pro"` are actions Studio Pro regenerated when it built the app, not yours.
- **The app's quality score is the Quality tab's.** When you report the app's quality (a score, best practices, a
  quality report), run `./mxcodr-live quality` after your last model change and give its first line,
  `Best practices N/100 (...)`: the number the person sees in the pane's Quality tab (the lines after it list the
  findings). Never give the score of `./mxcli report`, the `assess-quality` skill or CLAUDE.md's
  "Best Practices Report" as the app's score: it is another formula (every finding, info too, against 100 for the
  whole app). Mention it only labelled as mxcli's own score.
- After every exec that lands, run `./mxcodr-live problems`: Studio Pro's own error list, by document (exit 3
  on errors, 1 when the command itself failed; `--warnings` lists warnings too). Fix its errors before you run
  the app; it is what Studio Pro will refuse to deploy. Under the list it prints a fix line for the codes that need
  one (CE0463, CE6087, CE4899, CE7247, ...): run what it names. Never `./mxcli fix ...` while Studio Pro has the app
  open. A PERSON ACTION line, from any command: ask the person, in its words.
- Texts in another language (CE4899, CW0263, or the person asks for the app in another language): you translate,
  Studio Pro's Batch translate only copies. Run `./mxcodr-live translate status` and follow its `next:` lines.
  Never write translations with `exec`, `create translations` or `./mxcli` while Studio Pro has the app open.
- This replaces what `CLAUDE.md` says about `mx` (its "Mendix Validation Tool" section): never call `mx` by a
  path under `~/.mxcli/mxbuild/` or a glob of it (on a Mac with Studio Pro 11.16 mxcli uses Studio Pro's own
  mxbuild, so that folder has no `mx`, and another version's `mx` refuses this app). Errors and warnings come
  from `./mxcodr-live problems`; the full check is `./mxcodr-live mxcheck` (`mxcli docker check` on a copy of
  what Studio Pro saved, the right `mx` for the app's version).
- Step 3 of `CLAUDE.md`'s "Finishing a change" does not apply here: never write or read `FINDINGS.md`. Say what you
  found and how you verified it in your answer; the project brain takes only what its rule's three triggers name.
- Marketplace modules (publishers Mendix or Mendix Labs only): `./mxcodr-live marketplace install <id|name>`
  (`marketplace search <words>` finds the id); a newer version with `./mxcodr-live marketplace update <id|name>
  --plan-only` first: tell the person what the plan prints and ask; the real run only after their yes. After the
  app's Mendix version changed, or after a failed build, `./mxcodr-live marketplace outdated`. Each prints its next
  steps and the person's steps: follow them, and pass the person's on word for word. An update (`--plan-only` too)
  takes minutes: run it as a background command (Claude Code: the Bash tool's `run_in_background`) and wait for its
  completion notification: no polling, no second update, and no other `query`, `check`, `exec` or `mxcheck` until
  then. Never add a document to an installed Marketplace module or change one in it: an update deletes the one and
  undoes the other (the one exception: texts written by `./mxcodr-live translate`). The
  `download-marketplace-content` skill's install and update steps write the `.mpr`: not here.
- `MyFirstModule` is the person's: never drop or rename it without asking them first (the
  `module-structure` skill says how to tell the untouched starter from their own work). A module rename is
  theirs, in Studio Pro (right-click > Rename); never `rename module` through `./mxcodr-live exec`.
- `./mxcodr-live open Module.Document` opens a document in Studio Pro (`Module` alone: its domain model), to
  show the person what you changed. `./mxcodr-live save` saves every open editor, the person's unsaved edits
  included: ask them before you run it. After your turn the pane's unsaved-changes bar lists the documents Studio Pro
  has not saved, with Save all: your summary need not tell them to save.
- `./mxcodr-live open <file>[:line]` (a path with a `/` or a file extension) opens a file of the app, such as
  `tests/order.spec.ts:42`, in an editor tab inside Studio Pro, to show the person a test or a script. The
  person may edit it there: when they save, the file on disk changes, so read it again before you change it.

## The app's look

The person picks the app's look in the pane's Look tab; `./mxcodr-live look` says which one is active (one of the
themes, their own colour/corners/font, or the app's own look as it came). Change it only when the person asks, with
`./mxcodr-live look apply <theme>` (never `mxcli theme`, which bypasses the record). Style with what Atlas gives
first (classes, design properties); own SCSS only where that is not enough, with colours, corners, fonts, spacing
and shadows from theme variables, never hard-coded colours or other fixed values, or no look reaches them (skill
`spacing-and-layout`, `reference/own-styles.md`; `./mxcodr-live styles` lists them).

## Task list

For any task with three or more steps, keep a task list with Claude Code's task tools: TaskCreate for each step
(with an `activeForm`, the step in the -ing form), then TaskUpdate to `in_progress` when you start it and `completed`
when it is done (TodoWrite where those tools are not there). After an approved plan, turn its steps into that list
before you start. The pane shows the list as a step bar above the chat.

## Running the app and testing it

- Studio Pro runs the app: `./mxcodr-live app run` (the same as its Run button: it starts the app, or
  updates the running one in place), `./mxcodr-live app restart` (stop, then run), `./mxcodr-live app stop`,
  and `./mxcodr-live app status` (running?, its URL, the model's error count). Never `./mxcli run`,
  `mxcli docker` or the Studio Pro MCP `mendix_app` handler: a second runtime collides with Studio Pro's on
  port 8080. `run` refuses while the model has errors; on `failed`, Studio Pro shows the reason in a dialog
  only the person can close: tell them, do not run again. A failed build lists its Java errors by module. When
  they are in a Marketplace module's Java (`Java in Marketplace module ...`), update that module with the
  `marketplace update` command the reason names (`--plan-only` first, then ask the person); never edit a
  Marketplace module's Java, the update overwrites it. Errors in the app's own modules: fix them in their Java.
- **Starting the app is asked.** `app run` on a stopped app, `app restart`, and a test run (`tests run`, `affected`,
  `film`) that finds the app stopped show the person a card in the pane first and wait up to 10 minutes for it: give
  the command a 10-minute timeout. A test run starts a stopped app itself (no `app run` needed first). Updating a
  running app (`app run`, the deploy before tests) is not asked. On `not started: the person chose not to run the app
  now` (exit 3), do not run it again unasked: tell them what is ready to test. No answer, or no pane to ask: the same.
- When `app run` fails, a page shows an error, or a test fails on something the server did, read the app's
  console: `./mxcodr-live logs --since 5m --level warning` (`--tail 200`, `--follow` while you reproduce it;
  with the app stopped it shows the run's files under `deployment/log/`).
- After you ran the app or the tests, check what the running app logged: `./mxcodr-live logs --errors --since-turn`
  (each error once, with its count and the app's own frames). Fix the real ones; an error a test provoked on purpose
  (a validation message) needs nothing. Nothing pushes these errors to you, in the Chat or the Terminal: run the command yourself.
- Browser checks and the Playwright suite run against Studio Pro's run: the URL from `./mxcodr-live app
  status` (normally `http://localhost:8080`) goes into `tests/.env` as `APP_URL`. Read the running app's data
  with `./mxcodr-live oql "select ..."` (`--json` prints what `./mxcli oql --json` prints; a select only), never
  `./mxcli oql` (it cannot reach Studio Pro's run); the kit's `oql()` and session lines use it too. It says when
  the app is not running: run it first. Sign out at the end of every test.
- The demo users' password: when `tests/.env` has no `DEMO_PASSWORD` (Studio Pro's New App gives the demo
  users random passwords), set one yourself as the `durable-tests` skill says (a random one in
  `tests/.env`, set on the demo users with `./mxcodr-live exec`, then `./mxcodr-live app restart`). Never ask
  the person for a password and never print one.
- The person sees your test runs in the pane's **Tests** tab (the kit's config writes the report it reads,
  `.mxcodr/tests/`): leave that folder alone. `./mxcodr-live tests status` prints what the tab shows, and
  `./mxcodr-live tests run [all | failed | browser | mdl | <file>[:line]]` (`all`, the default: every browser
  test and every `.test.mdl`) runs as the tab does (one run at a time: it refuses while
  another run is going on); its last line counts this run only: `tests: 5 passed`, or `tests: 3 passed, 2 failed, 1 not run`.
  `./mxcodr-live tests clear` forgets the last results (the tab's state, never
  `tests/`): only when the person asks for a clean slate.
- **Captions and documentation need no test run.** Before you run tests again after a change, run
  `./mxcodr-live changes kind`: on `cosmetic only (captions/documentation)` skip the tests (the model diff
  decides, not your script: re-creating a flow to add captions counts as cosmetic); `./mxcodr-live problems`
  still runs. Anything else lists what changed and the pages to re-test: go on as below. `--since-tests`
  compares with the last full suite that passed (before you propose the full suite again).
- **Run the affected tests, never the full suite unasked.** Hundreds of browser tests must not block the work:
  wherever a rule or skill says to run the whole suite ("the whole suite once", shuffled or not),
  run `./mxcodr-live tests affected` instead. It runs the new and changed spec files of this work, the
  tests that never ran or failed last time (those first), and the tests whose pages, microflows or entities
  (or what those use) changed since they last ran, each with its reason (`--list` only prints them). A spec
  file's test runs again only when its own code (or the file's shared code, or a helper it imports) changed since
  it last ran, committed or not. Its last line, `affected: N run, N passed, 0 failed (M not selected)`, is the
  result to report; `tests status` shows the latest result of every test across runs, not this run. While you
  work on a test, run only that test (`./mxcodr-live tests run <file>:<line>` or `--grep`), never whole spec
  files; once `tests affected` is green, run no broader Playwright run unless the person asks. Never run
  Playwright itself (Studio Pro has no npm, so `npx` fails here): always through `./mxcodr-live tests`.
  Both deploy a model saved since the last deploy first (one `app run`; when it fails nothing
  runs), stop after 2 failures, and list each failed test with its error lines, screenshot and error context:
  read those instead of running the test again to see the error. A page that only
  got new widgets runs the tests that name them plus one smoke test per spec file (`--thorough`: all). At the
  end of your work, propose the full suite to the person with the line `tests affected` prints (how many
  tests, about how long, when it last ran whole) and leave it to them. When this work changed something the
  whole app depends on (project or module security, user roles, access rules, navigation or menus, the
  after-startup microflow, a layout, the theme: `tests affected` lists these as whole-app changes), recommend
  the full suite strongly in your summary; still their call.
- A film of a test, only when the person asks for one (the `film-tests` skill): `./mxcodr-live tests film
  <file>[:line]` records it slowed down against Studio Pro's run, under the same one-run-at-a-time rule, into
  `.mxcli/films/`. The person sees it record in the Tests tab, can record one there too, and watches it in a
  Studio Pro tab (**Watch film**). A film never changes a test's result.
- Microflow tests: `./mxcodr-live test <file.test.mdl>...` runs `mxcli test --local` on a fresh copy of what
  Studio Pro saved (`.mxcodr-test/`, built-in database, ports 8081/8091), so it never writes the open app and
  never touches Studio Pro's run. Never run `./mxcli test` on the app folder itself.

## The harness belongs to the extension

The mx-codr extension wrote this harness (this file, `.claude/rules/mxcodr.md`, the skills) and keeps it
current. Never run `mxcli init`, `./mxcli init --sync-skills` or `mxcli setup`, and never edit the files it
wrote: the person updates them from the pane.

## Only the person commits

Version control is Studio Pro's, so the person can see and undo what you changed. Run only read-only git:
`status`, `diff`, `log`, `show`, `blame`, `ls-files`, `rev-parse`, `grep`, `config --get`, `branch` / `tag` /
`remote -v` listings, `stash list`. Every other git command is the person's, in Studio Pro's Version Control:
add, commit, push, pull, fetch, merge, rebase, cherry-pick, revert, reset, restore, checkout / switch, creating or
deleting branches and tags, remotes, stash, clean, `git init`, clone; a hook refuses them.
Leave your changes uncommitted. When the person wants a commit, tell them to commit in Studio Pro: Version
Control > Commit. If the app is not version controlled yet, point them to ⋯ > Setup and agents in the mx-codr pane:
Upload to Version Control Server. Never give the person `git add` / `git commit` commands to run: on Windows git
is usually on your PATH only, not theirs.
