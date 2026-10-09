# mx-codr

**Your AI agent builds the Mendix app. mx-codr makes sure it is actually finished.**

Claude Code, Codex, Cursor, OpenCode and Pi can already write Mendix domain models,
microflows and pages. What they don't do on their own is *prove* the work: a test
for every screen, a model that passes Mendix's own checks, microflows a colleague can
read, screens that aren't glued together. mx-codr adds exactly that — one installer,
and one command that answers **DONE** or **NOT DONE**.

It sits on top of [mxcli](https://github.com/mendixlabs/mxcli):
- **mxcli** opens command-line access to a Mendix model
- **mx-codr** adds a **harness** — skills, rules and hooks — to turn it into a
  delivery workflow.

## What you get

- **Tests first.** For each feature the agent first writes a failing browser test, then
  builds until it passes. Every page and action microflow gets a test.
- **One "done" check.** `bash tests/gate.sh` (the *gate*) runs the tests, Mendix's
  consistency check and the rules below in about 30 seconds. Only **DONE** means done.
- **No broken model.** The agent changes the app with small MDL scripts (text files, a
  bit like SQL for a Mendix model). Each is tested on a copy first; if Studio Pro would
  show errors, your `.mpr` is not touched; when fixing one error reveals others, it says which scripts they belong to. After each one the agent is told whether it applied.
- **A proper Mendix app.** One menu for all roles, icons, one layout, Back buttons,
  "Users" and "My account" for signed-in users, no leftover `MyFirstModule`.
- **A readable model.** Business captions, process folders, reused snippets and
  sub-microflows, Atlas spacing.
- **Any agent, any OS.** Claude Code, Codex, Cursor, OpenCode or Pi, on macOS, Linux or
  Windows.

## Get started

Clone this repo anywhere, then run the installer. It asks for your Mendix project folder
(Enter takes the folder you are in), copies `mxcodr/` there and installs. An empty or new
folder gets a new Mendix app.

It also asks how the app should run. **Locally** (the default) the runtime and PostgreSQL run
on your computer, and a model change is live in about a second. **In Docker** everything runs
in containers: nothing else is installed, but every model change is rebuilt and the app
restarted, about 40 seconds (measured), and Docker Desktop must be running.

**macOS and Linux**

```bash
git clone https://github.com/tgolembiewski/mx-codr.git
./mx-codr/mxcodr/install.sh
```

**Windows**: PowerShell **as administrator**, with Mendix Studio Pro installed:

```powershell
git clone https://github.com/tgolembiewski/mx-codr.git
powershell -ExecutionPolicy Bypass -File mx-codr\mxcodr\bootstrap.ps1
```

When it is done, open your agent **in the project folder** and ask for a feature.

## What it enforces

The gate checks every rule below. If one is broken, it stays red and tells the agent
what to fix. Codes in brackets are what the gate prints.

Every rule is a card, `tests/rulebook/<CODE>.md`: what it checks, the fix, how hard it judges
(`level: block | warn | info | off`). Under the card's `## Local` you change the level or except a
document (`except: Orders.Approval_Task   # opened only from the task inbox`); the agent may read
the cards and propose a line for you to paste, never write one. `bash tests/rules.sh` lists them,
`bash tests/rules.sh explain URL01` shows one. mxcli's own lint is not part of the gate: set
`LINT01` to `warn` to see its advice under the gate's warnings.

**Done**
- A failing test before each feature; a test for every page and action microflow.
- Mendix's consistency check at 0 errors; project security at Production.
- A role that sees only its own rows does not read a view of everyone's totals (`VIEW01`), also when its rule limits it to some fields.
- Only the full gate says DONE. Running one test says PASSED.
- A microflow debugger left on stops the gate before the tests: a breakpoint would hang them.
- Lists (data grids, list views, galleries) take their rows from the database with an XPath, not from a microflow or nanoflow that only retrieves them, so the database pages, sorts and filters (`DS01`).
- Mendix's security best practices: no secret in a constant's default (`CRED01`), no guest that writes (`ANON01`), strict mode on (`STRICT01`), an own-rows list backed by its access rule, not only the page (`FILTER01`), no query built from text and a variable (`SQL01`); warnings for a specialised account (`EXTENDS01`), user text shown as HTML (`XSS01`), writable totals and statuses (`WRITE01`), and, for the person, the `MxAdmin` name and a weak password policy (`ADMIN01`, `PWD01`).
- Every document sits in its business folder's `UI` (pages), `FNC` (microflows, nanoflows) or `ENV` (everything else) subfolder (`FOLDER01`); the gate prints the moves.
- An old script run again cannot undo later changes to its pages and flows (`STALE01`): the exec is refused and names what it would overwrite.
- Every testable path has a test: every message the app can show (`OUTCOME01`), every workflow task outcome, decided in a test that signs in as both people (`WF02`), every role-scoped entity read as that role (`ISO01`), every role (`ROLE01`), every published service (`SVC01`). Paths come from the model, so this holds for any app; paths older than the install are warnings, new ones block. A workflow task anyone can decide blocks (`WF01`).
- No microflow, nanoflow, page, snippet, enumeration or Java action is left that nothing uses (`UNUSED01`): no reference in the model, the name nowhere else, and Mendix still builds without it.
- Entity event handlers that loop (commit their own object with events, `EVENT01`) or skip a save in silence (no `raise error`, `EVENT02`); warnings for `without events` skipping a handler, a handler's error behind a Save button, and swallowed errors (`EVENT03`-`04`, `ERR01`).

**Structure**
- Process folders, `ACT_`/`SUB_` microflows under 15 activities, nothing at module root.
- `MyFirstModule` removed once the app has its own module (`MODULE01`).
- PascalCase names, `ENUM_`/`SNIPPET_` prefixes, `_NewEdit`/`_View`/`_Overview` pages.
- A business caption on every activity; decisions as questions; a note on every loop.
- Reuse: snippets and sub-microflows instead of copies; data grids use column filters
  (`UI001`, `GRID01`), and a button that changes a grid's rows sits in the grid's header
  (`GRID02`).

**Screens**
- One menu for all roles on a standard Atlas layout (`NAV03`, `NAV04`), an icon on every
  item (`NAV05`), never the same icon twice in what one role sees (`NAV06`), Log out last
  (`NAV01`, `NAV02`).
- "Users" for admins and "My account" for everyone once people sign in
  (`ACCOUNT01`-`03`); admins start on a page of the app (`HOME01`).
- One layout for all pages except pop-ups (`LAYOUT01`).
- A pop-up's Save commits with `refresh`, so the grid under it shows the new row at once (`REFRESH01`).
- A Back button top left on every page opened from another page (`BACK01`), and on the right
  of the same top row, under the language selector, who is signed in: a user icon and e-mail
  that opens My account (`USER01`).
- Every widget named `<Page>_<What><Type>`, unique in the app (`OrderDetail_GenerateInvoiceButton`, `NAME01`-`02`; warnings until the first DONE).
- An icon on every button (`ICON01`); Atlas spacing, no custom CSS (`SPACE01`-`03`); a button or
  text never touches a grid, list or card above or below it, a grid header's buttons included (`SPACE04`).
- A long text (over 500 characters, or unlimited) is edited in a text area, not a one-line
  text box (`TEXT01`); a field named like prose (Description, Notes, Reason ...) gets a hint (`TEXT02`, a warning).
- Everything on a page inside a layout grid, so nothing touches the edge of the window (`EDGE01`).
- A URL on every page that is not a pop-up, whenever Mendix allows one (no non-persistent parameter), so it can be bookmarked, shared and reloaded (`URL01`).
- A heading on every page (`HEAD01`, a warning).
- Pages checked as they render: after every test the gate measures the page for widgets
  that overlap, sideways scrolling, cut-off text and charts that do not fit one screen
  (`VIS01`-`04`), and flags an alert
  class on plain text (`ALERT01`). With `MDL_VISUAL_REVIEW=agent`, a model that reads
  images also judges a screenshot of each page (`LOOK01`-`02`). Warnings for now.
- Server errors logged while the tests ran are listed (`RUNTIME01`): a test can pass while the
  page behind it threw. Microflow tests (`*.test.mdl`) are named, with the command that runs
  them, since the gate cannot run them next to the app.

The agent learns these from five *skills* (short guides) that the installer puts in
place. You don't need to read them.

**Watch a test run.** Ask the agent to show or film a test. A sixth skill, `film-tests`, lists every
browser test with what it walks through, then records the one you pick as a video with the test's
name and its steps on it (`.mxcli/films/`). By hand: `bash tests/film.sh --list`, then
`bash tests/film.sh <name>`, or `bash tests/film.sh --all` to film every test in the background
(it says how long it will take; `--status` shows progress).

## The installer sets everything up

You don't install the pieces one by one. The installer checks what this machine has,
fetches what is missing, and tells you plainly about anything it could not do.

| | What the installer does |
|---|---|
| **Your Mendix app** | Creates one with `mxcli new` if the folder has none. On a Mac with several Studio Pro versions it always asks which one to use; with one it takes that one; Windows takes the newest. `MX_VERSION` decides without asking |
| **mxcli** | Downloads the one mxcli release the harness works with (`mxcodr/MXCLI_TESTED`, now v0.25.0), checksum-verified, and offers to swap any other `./mxcli`, newer ones too; a new mxcli release is adopted only after the harness reads it. The checks read both the 0.24 and the 0.25 (`mdl 1`) describe format, and the fixes they suggest are written in 0.25's spelling. In an existing project it also refreshes mxcli's own skills to that release (`mxcli init --sync-skills`); folder and `MOVE` mechanics come from mxcli's `organize-project` skill, which the harness no longer ships a copy of |
| **Docker** | Only in Docker mode: installs Docker Desktop when missing and waits for it; with WSL off it says so at once |
| **Node, Playwright and its browser** | Installs the missing ones — the hooks, the checkers and the browser tests run on them |
| **MxBuild** | Downloads the one for your Mendix version, so `mx check` runs |
| **PostgreSQL** | Local mode (the default): sets it up |
| **Skills, rulebook, checkers, hooks** | Puts them where each of the five agents looks for them; the rulebook (one card per rule, `tests/rulebook/`) keeps your `## Local` changes on every upgrade |
| **Windows** | Applies the junctions and ARM64 fixes that Studio Pro's mxbuild needs |

What cannot be installed unattended — a JDK, a Docker daemon that has to be started
if you use one — is listed at the end with the command to run.

## How a feature gets built

```
 you ask ─▶ agent writes a test ─▶ test fails (red) ─▶ agent builds it in MDL
                                                              │
      DONE ◀── gate: tests · mx check · catalog · coverage · naming · layout · security · scope · paths · folders · unused ◀── test passes
```

You never run the checks yourself. The agent runs the gate, and the hooks make sure
it does.

The agent reads one skill before the first feature (`test-first-delivery`); every other
project skill is named by the gate finding that needs it, with the fix in the finding. What each
check code wants is in one file per gate step, `tests/checks/<step>.md`, indexed by
`tests/CHECKS.md`; a red verdict names the file of the step that failed. Measured on seven sessions, a session read about
113 kB before its first change; the new shape is about 48 kB, to be confirmed by an A/B run. The
gate is unchanged.

## Does it make a difference?

Two A/B runs: the same prompt, the same model, a fresh app each time — once without
mx-codr, once with it.

| | Without mx-codr | With mx-codr |
|---|---|---|
| Browser tests written | 0 | 5–7 |
| Gate at the end | **NOT DONE** (no tests, no coverage, spacing errors) | **DONE** |
| First verified DONE | never | after 11.6–12.2 min |
| Whole session | 11.0–11.4 min | 15.2–15.9 min |

About a minute more to reach a *verified* result; the rest of the extra time was the
agent polishing after DONE.

---

## How the pieces fit together

`mxcodr/` is the whole bundle. Everything below is about installing and using it.

[`docs/harness-wiring.html`](docs/harness-wiring.html) shows it moving: pick a moment (a prompt,
a broken `mxcli exec`, the gate, the agent trying to stop) and watch which file calls which, with
the exact text each step puts into the agent's context. Open it in a browser.

Nothing in this harness is a tool you operate. There is no script to invoke,
no checker to remember the arguments of, no order to run things in. After
`install.sh`, every piece is found and used by the agent on its own:

| What | How the agent finds it |
|---|---|
| The rules, in prose | `SKILL.md` files in the three directories each host looks in |
| The always-loaded reminder | `.claude/rules/` and `.cursor/rules/`, and Pi's system prompt through its extension, on every turn |
| The syntax sessions look up most | a digest from the project's own mxcli, with the pitfalls that cost sessions the most time on top, loaded into the session: `.claude/rules/`, `.cursor/rules/`, `opencode.json`, Pi's system prompt |
| Every rule's level and exceptions | one card per rule in `tests/rulebook/<CODE>.md`; `bash tests/rules.sh` lists them |
| `UI001`, `SEC007` | the gate's `catalog` step, over mxcli's model catalog; `MOD001`, `REU001`, `UI001` also run as `.claude/lint-rules/*.star` when you call `./mxcli lint` yourself |
| `check_mdl.py`, `check_test_coverage.py`, `check_layout.py` | the skills that need them name the exact command; the gate runs them too |
| The gate | host hooks fire it, and the `test-first-delivery` skill tells the agent to |

The checkers (Node) exist because some rules cannot be expressed as lint rules —
activity captions are not in the model catalog, test coverage means reading `tests/`
off disk, and the layout rules read whole pages together with the navigation. They are
an implementation detail of those rules, installed at `tools/mdl-checks/` so every host
can cite one path. The agent calls
them. **You never have to.**

The same is true of `tests/gate.sh`. The hooks run it, and the skills tell the agent
to run it before claiming anything is finished. You can run it yourself when you
want to see where a project stands — that is a convenience, not a step.

So the whole of your involvement is, from your project folder:

```bash
bash mxcodr/install.sh
```

and then working with your agent as usual.

## Requirements

| | Why |
|---|---|
| **mxcli** | everything runs through it |
| **Mendix Studio Pro** or a cached mxbuild | `mx check` validates the model; on Windows only Studio Pro |
| **PostgreSQL** | the app's database, and a separate `<project>_test` one |
| **bash** | the harness is shell scripts — Git Bash on Windows |
| **Node + playwright-cli** | the hooks, the checkers the gate calls, and the browser tests; no Python is needed |
| **A JDK** | matching the Mendix version; Studio Pro installs one |
| **Docker** | only if you choose Docker mode |

The installer installs the missing ones that can be installed unattended and leaves
what is already there; `--no-deps` only lists them. It never installs a JDK — that
wants a licence click.

## Install

```
bash mx-codr/mxcodr/install.sh [project-folder] [--no-app] [--no-deps]

  project-folder   the Mendix project; asked for when not given (the current folder is the
                   default). Never the mx-codr clone itself
  --no-app         never create a Mendix app; require one to be there already
  --no-deps        only report missing prerequisites. By default they are installed
                   with this machine's package manager; what is there is left alone.
```

The installer copies `mxcodr/` into the project, so it can be run again from there:
`bash mxcodr/install.sh`.

### The app's look

For a new app the installer offers Mendix's own Atlas (the default) or one of five themes --
navy, teal, amber, plum, forest -- each shown in the terminal in its own colours, with the same
app screen in each in the browser. Change it any time: `bash tests/theme.sh` lists
them, `bash tests/theme.sh teal` switches, and a running app shows it in seconds. The app opens
light even when the OS is dark, and the mx-codr logo and browser icons take the theme's
colours. Inputs, drop-downs and the data grid's filters are all one height (38px). Running the
installer again in an existing app brings its theme up to date.

### Windows

`bootstrap.ps1` asks for the project folder first, installs Git for Windows and
Node with winget, then runs `install.sh`. Run it as administrator: winget
needs it.

**Studio Pro is required on Windows.** `mx check` and the app build use the `mx.exe` and
`mxbuild.exe` that come with it; Mendix publishes them separately for Linux only. That
holds in Docker mode too: the app is built on the computer.
Without it the installer stops at once, before installing anything, and says where to
get it. With several versions installed it reports the newest. The app is created without
mxcli's first build, which hangs on Windows; the first gate run builds it.
While the app is created the bar keeps moving and shows the elapsed time, so a silent
build does not look like a freeze.
The checks run on Node, which writes plain `\n` lines on Windows too, and the gate never calls a
database lock stale while the app runs.

### What lands in the project, and who reads it

```
.claude/skills/<name>/       Claude Code
.agents/skills/<name>/       Codex, Pi, and other tools on the open SKILL.md standard
.ai-context/skills/<name>/   mxcli, Cursor, OpenCode, Windsurf, Aider
.claude/rules/               the always-loaded rule and the syntax digest (Cursor's copies in .cursor/rules/,
                             Pi gets it through its extension)
.claude/lint-rules/          found by `mxcli lint` with nothing to register (not run by the gate)
tests/rulebook/              one card per rule: what it checks, how hard it judges, your exceptions
tools/mdl-checks/            the checkers the skills cite (Node, .cjs)
tests/                       the harness scripts, plus tests/harness.env
.claude/settings.local.json  the hooks (Cursor and Codex get their own; OpenCode and Pi
                             a plugin in .opencode/plugin/ and .pi/extensions/)
```

Three copies of the same skills, because each tool looks somewhere different. All
of it is discovered — nothing here needs registering, importing or configuring.

The harness scripts are replaced on every install: a fix in `gate.sh` that never
reaches an installed project is not a fix. Your own `verify-*.test.sh` and
`credentials.env` are never overwritten.

## The gate

One command, eleven checks, run concurrently — the browser suite, `mx check`, the catalog
rules (`UI001`, `SEC007`), test coverage, naming/captions, page layout, security, scope, paths,
folders and unused documents. Every step
runs even when another fails, so one call reports the whole picture, and a red run ends with the list of what still
blocks DONE. Exit 0 only when all of them pass. Below them come warnings that do not block
DONE yet: how the pages rendered (`VIS`, `LOOK`), errors the server logged (`RUNTIME01`) and
tests that were never seen to fail.
The agent fixes them along with its next fix, never in a gate run of their own. Whatever is
left at DONE goes into its report as the next thing to fix.
Row-by-row database work is listed among them with its fix: a loop that sums retrieved rows, a database call per row, or a
whole table filtered with `if`, or a loop that only keeps the largest value (`PERF02`/`03`/`05`/`06`);
the fix named is an OQL view, an XPath, or one sorted retrieve with `limit 1`.
A query no database index serves is listed too (`PERF07`), with the index it wants: its `=`
columns first, then the range or sort column. An index no query needs is listed as well (`PERF08`).
Both read view entities' OQL too, and skip a query that follows an association: Mendix indexes those.
A second DONE on an unchanged model and unchanged tests says that the repeat proves nothing new.
When `--watch` misses an exec, the gate restarts the app so the tests run on the current model.
The model checks read the model with one mxcli call per module, not one per document (11 s became 2 s).
When Studio Pro has the project open, the gate and each exec say so: what Studio Pro saves next
replaces what mxcli wrote.
Captions are warnings until the first DONE; after it, the agent is told once to add the missing
ones, and a microflow it adds or changes needs them before the next DONE.
A check that could not run (a crashed checker, a model that could not be read) is never a pass:
the gate says "could not run" and does not say DONE.
The guard also reads a `cd` before a write, a link to a guarded file, a copy into its directory and
inline code that writes `tests/harness.env`; the test password no longer shows in `ps`.
A checker that recognises none of the documents mxcli described (a describe format it does not
read) says "could not run" instead of passing.
The Cursor hook applies the same rules before an `mxcli exec` as the Claude Code hook.
On Windows the view and index checks now run: the names the gate lists no longer end in a carriage return.
After an exec, the agent is told when it re-created a page another script alters, or granted
access another script revoked.

```
== gate
   tests: Total: 12  Passed: 12  Failed: 0  Time: 2m14s
   mx check: 0 errors
   catalog: PASS  0 catalog finding(s) block, 0 warning(s)
   coverage InvoiceDesk: PASS  14/14 elements covered by 12 test script(s)
   naming: PASS  0 failure(s) over 246 lines
   layout: PASS  0 failure(s) over 11 page(s)
   security: level Production
   DONE — every check passed
```

The agent runs this. The installed hooks run it too, and refuse to let Codex,
Cursor, OpenCode or Pi finish a turn while it is red. When you want to look yourself:

```bash
bash tests/gate.sh                    # the done gate
bash tests/gate.sh --boot-if-needed   # boot the app first if nothing answers
bash tests/gate.sh --restart          # stop this project's app and boot it again (Windows too)
bash tests/gate.sh --only <feature>   # one test, warm browser, red loop (ends PASSED, never DONE)
bash tests/gate.sh --changed          # the tests a model change touched since they last ran (never DONE)
bash tests/orient.sh                  # what is in this project
bash tests/diagnose.sh                # why is the app not answering
```

A failing test always says why, on one line: one that stops on a silent command names its line and command.
The precheck also covers MDL given with `mxcli -c`, and tells errors already in the model from the script's own.
It also asks for the test first: an exec that creates a new page or `ACT_` microflow waits until a `# covers:` line of some `tests/verify-*.test.sh` names it (`TEST01`; `MDL_TEST_FIRST=0` turns it off).
An exec whose script a step in the same command writes (an edit, a `mv`, a redirect) is refused: the precheck runs before the command and would check the old file.
When a trial-licence runtime runs out of sessions ("Maximum number of sessions exceeded"), the gate names that as the cause of the failed sign-ins instead of the features, and says `--restart` clears them. Only a refusal logged during this run counts: an old one left in the log no longer blames later runs.
A hint under a build error follows the error's text, not only its code: CE7247 is a reserved name or an invalid URL, and each gets its own advice.
When the app needs a Marketplace module and mxcli is not logged in, the harness stops the session with a short instruction (create a token, run `./mxcli auth login` in your own terminal) and holds every build back until you have; `MDL_MARKETPLACE_LOGIN=report` in tests/harness.env is for unattended runs, or when you would rather skip the module. Only a real exec starts the wait, never a precheck the agent runs by hand. The token itself stays out of the session.
A blocked exec says when the command's earlier steps (an edit) did not run either; a scenario opens the browser when none is open; `# covers:` names may be separated by commas or spaces.

## Configuration

**The rules: `tests/rulebook/`.** One card per rule; its `## Local` section is yours and survives
every upgrade. `level: warn` makes a blocking rule a warning, `level: block` makes a warning block,
`level: off` turns a rule off, `except: Module.Document  # why` skips one document. A broken card
stops every model check with the card and line. `bash tests/rules.sh check` validates the folder.

`tests/harness.env` is written by the installer and read by every harness script.
It is yours: the agent may read it, but a hook blocks it from editing the file or setting a gate switch inline -- and from editing the harness's own checkers and scripts (`MDL_HARNESS_EDITS=allow` in this file lifts that part).
The same hook blocks a search or read outside the project (`find /`, the mxcli source, Studio Pro's files): nothing there answers a Mendix question, and a whole-disk scan runs for minutes.
The environment still wins, so any of it can be overridden for one run.

| Key | What it is |
|---|---|
| `MDL_MXBUILD_PATH` | the Studio Pro or cached mxbuild `mx check` runs |
| `MDL_DB_HOST` / `_NAME` / `_USER` / `_PASSWORD` | the database |
| `JAVA_HOME` | a JDK on a path with **no spaces** (see below) |
| `MDL_BOOT_COMMAND` | how the gate boots the app when nothing answers |
| `MDL_VISUAL` / `MDL_RUNTIME_ERRORS` | the rendered-page and server-error checks: warnings by default, `error` blocks DONE, `0` turns them off |
| `MDL_VISUAL_REVIEW` | `agent`: a model that reads images also judges a screenshot of each page |
| `MDL_CAPTIONS` | the caption rules of the naming check: warnings by default, `error` blocks DONE |
| `MDL_SCOPE` | `SCOPE01`, a page's data source microflow that ignores its role's row scope: a warning by default, `error` blocks DONE |
| `MDL_UNTESTED` | paths deliberately left without a test (a document, `Module.Workflow/Task`, `Module.Entity\|Module.Role`, `role:<UserRole>`), so the `paths` step passes them |
| `MDL_DB_RESET` | `session`: the database is snapshotted at the start of each agent session and rolled back after its first DONE, so test data does not pile up (local PostgreSQL) |
| `MDL_PATHS` | `error`: the paths older than the install block DONE too, not only new ones |
| `MDL_KEEP_UNUSED` | documents kept on purpose though nothing uses them yet (`Mod.Doc,Mod.Other`), so `UNUSED01` passes them |
| `MDL_CLOSE_BROWSER` | `1`: close the test browser after each suite and on `--stop` (off: `--only` reuses it) |
| `MDL_ALLOW_GREEN_FIRST` | tests that are green by nature, so the gate does not warn that they never failed |
| `MDL_REQUIRE_PRODUCTION` | `0` for an app that deliberately has no users at all |
| `APP_PORT` | the app's port, 8081 by default; a second project running beside the first needs its own, e.g. `8082` (the admin API follows at +9). The gate refuses to test another project's app on its port |

## Windows: what the installer repairs, and what it cannot

Four things stand between a Windows machine and a running Mendix app, and none of
them reports itself usefully. The installer fixes three, without being asked.

| | Symptom if unfixed |
|---|---|
| A JDK on a path with spaces | mxbuild splits its own command line, so `C:\Program Files (Arm)\zulu21` arrives as four unrecognised arguments and it exits printing usage |
| No Gradle in the mxbuild cache | `No supported Gradle installation found`, raised after mxbuild is already answering, so it reads as a model problem |
| ARM Studio Pro ships `win-arm64` tools only | mxbuild launches `win-x64` and dies with `Win32Exception (2)` before it listens |

Junctions, so nothing is copied and no administrator rights are needed.

**The fourth cannot be fixed from outside mxcli.** Its liveness probe is
`os.Process.Signal(0)`, and Windows rejects every signal except `Kill` — so a
perfectly healthy mxbuild and a perfectly healthy runtime both read as *"exited
during startup"* on the first poll. This is not an ARM quirk; no Windows machine
can boot an app with `mxcli run --local`.

The harness works around it for booting: the installer writes
`MDL_BOOT_COMMAND="bash tests/run-app.sh"`, which drives mxbuild and the standalone
runtime over the M2EE admin API instead. `gate.sh --boot-if-needed` then works.

There is no equivalent for **`mxcli test --local`**, which boots the app itself.
Microflow tests need a patched mxcli on Windows until the fix is upstream.

### Two more Windows notes

**Ports.** Studio Pro running an app holds 8080 and 8090. The harness defaults to
8081, which still collides on the admin port. Pass `APP_PORT` / `ADMIN_PORT` if you
are running both at once.

**Screenshots** need `playwright` (the npm package), not `playwright-cli` (the
session tool `mxcli playwright` drives). Having only the second is what makes
Playwright look installed while `mxcli run --local --screenshot` does nothing. Its
Chromium is a separate download, pinned per package, so one tool's browser does not
satisfy the other.

## If a test run fails partway, check `AfterStartupMicroflow`

`mxcli test` points the project's after-startup microflow at its own injected
`MxTest.RegisterEndpoint` while tests run. A run that dies before cleanup leaves it
there, overwriting whatever the app had — with no record of the old value. The next
run then fails somewhere else entirely, because it reads the leftover as your
setting.

```bash
./mxcli -p <app>.mpr -c 'SHOW SETTINGS'     # look at AfterStartup
./mxcli -p <app>.mpr -c "ALTER SETTINGS MODEL AfterStartupMicroflow = 'Module.Microflow'"
```

mxcli does warn that the project was left modified. It does not say what the value
was, so note it before running tests against a project you care about.

## One source per host-repeated piece

The per-prompt reminder (`checks/reminder.txt`), the before-exec hook's decisions
(`hooks/before-mxcli-exec-core.sh`) and the plugins' logic (`checks/plugins/harness-core.cjs`) each
exist once; the Claude, Codex, Cursor, OpenCode and Pi entry points only adapt them to their
host. A change to what the harness says or checks is one edit.

## Rebuilding the bundle

`mxcodr/` is a copy of files that live in the harness repo — `mxcodr/README.md` has the
table of which file comes from where. Edit it there, not here.

The long scripts are split into short parts: `install.sh` sources `install/*.sh` (whose small jobs
are in `install/install_tool.cjs` and `install/hosts/`), `tests/lib.sh`
sources `tests/lib/*.sh` and `checks/check_layout.cjs` requires its rules from
`checks/layout_rules/`. The map of what is where is under "What is in here" in `mxcodr/README.md`.
