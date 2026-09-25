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
  show errors, your `.mpr` is not touched. After each one the agent is told whether it applied.
- **A proper Mendix app.** One menu for all roles, icons, one layout, Back buttons,
  "Users" and "My account" for signed-in users, no leftover `MyFirstModule`.
- **A readable model.** Business captions, process folders, reused snippets and
  sub-microflows, Atlas spacing.
- **Any agent, any OS.** Claude Code, Codex, Cursor, OpenCode or Pi, on macOS, Linux or
  Windows.

## Get started

Copy the `mxcodr/` folder into your Mendix project — or into an empty folder, and the
installer creates the app for you. Then, from that folder:

**macOS and Linux**

```bash
bash mxcodr/install.sh --with-deps
```

**Windows** — open PowerShell **as administrator** and run:

```powershell
powershell -ExecutionPolicy Bypass -File mxcodr\bootstrap.ps1
```

Windows has no bash out of the box, so `bootstrap.ps1` first installs Git for Windows
(which brings Git Bash), Python and Node with winget, then runs the same installer.
Administrator rights are needed because winget installs Docker Desktop. Already have
Git Bash? Run `bash mxcodr/install.sh --with-deps` from Git Bash instead.

Start a new agent session and ask for a feature. That's it.

## What it enforces

The gate checks every rule below. If one is broken, it stays red and tells the agent
what to fix. Codes in brackets are what the gate prints.

**Done**
- A failing test before each feature; a test for every page and action microflow.
- Mendix's consistency check at 0 errors; project security at Production.
- Only the full gate says DONE. Running one test says PASSED.
- A microflow debugger left on stops the gate before the tests: a breakpoint would hang them.

**Structure**
- Process folders, `ACT_`/`SUB_` microflows under 15 activities, nothing at module root.
- `MyFirstModule` removed once the app has its own module (`MODULE01`).
- PascalCase names, `ENUM_`/`SNIPPET_` prefixes, `_NewEdit`/`_View`/`_Overview` pages.
- A business caption on every activity; decisions as questions; a note on every loop.
- Reuse: snippets and sub-microflows instead of copies; data grids use column filters
  (`UI001`, `GRID01`).

**Screens**
- One menu for all roles on a standard Atlas layout (`NAV03`, `NAV04`), an icon on every
  item (`NAV05`), Log out last (`NAV01`, `NAV02`).
- "Users" for admins and "My account" for everyone once people sign in
  (`ACCOUNT01`-`03`); admins start on a page of the app (`HOME01`).
- One layout for all pages except pop-ups (`LAYOUT01`).
- A Back button top left on every page opened from another page (`BACK01`), and on the right
  of the same top row, under the language selector, who is signed in: a user icon and e-mail
  that opens My account (`USER01`).
- An icon on every button (`ICON01`); Atlas spacing, no custom CSS (`SPACE01`-`03`).
- Pages checked as they render: after every test the gate measures the page for widgets
  that overlap, sideways scrolling and cut-off text (`VIS01`-`03`), and flags an alert
  class on plain text (`ALERT01`). With `MDL_VISUAL_REVIEW=agent`, a model that reads
  images also judges a screenshot of each page (`LOOK01`-`02`). Warnings for now.
- Server errors logged while the tests ran are listed (`RUNTIME01`): a test can pass while the
  page behind it threw. Microflow tests (`*.test.mdl`) are named, with the command that runs
  them, since the gate cannot run them next to the app.

The agent learns these from six *skills* (short guides) that the installer puts in
place. You don't need to read them.

## The installer sets everything up

You don't install the pieces one by one. The installer checks what this machine has,
fetches what is missing, and tells you plainly about anything it could not do.

| | What the installer does |
|---|---|
| **Your Mendix app** | Creates one with `mxcli new` if the folder has none (Mendix 11.12.1 unless you set `MX_VERSION`) |
| **mxcli** | Uses the newest mxcli on the machine, offers the latest release when it is newer, and verifies the download's checksum |
| **Docker** | Installs it when it is missing. It is optional: see [Running without Docker](mxcodr/README.md#running-without-docker) |
| **Python, Node, Playwright and its browser** | Installs them with `--with-deps` — the checkers and browser tests run on them |
| **MxBuild** | Downloads the one for your Mendix version with `--with-deps`, so `mx check` runs |
| **PostgreSQL** | Sets it up when you work without Docker, with `--with-deps` |
| **Skills, lint rules, checkers, hooks** | Puts them where each of the five agents looks for them |
| **Windows** | Applies the junctions and ARM64 fixes that Studio Pro's mxbuild needs |

What cannot be installed unattended — a JDK, a Docker daemon that has to be started
if you use one — is listed at the end with the command to run.

## How a feature gets built

```
 you ask ─▶ agent writes a test ─▶ test fails (red) ─▶ agent builds it in MDL
                                                              │
      DONE ◀── gate: tests · mx check · lint · coverage · naming · layout ◀── test passes
```

You never run the checks yourself. The agent runs the gate, and the hooks make sure
it does.

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

Nothing in this harness is a tool you operate. There is no Python script to invoke,
no checker to remember the arguments of, no order to run things in. After
`install.sh`, every piece is found and used by the agent on its own:

| What | How the agent finds it |
|---|---|
| The six rules, in prose | `SKILL.md` files in the three directories each host looks in |
| The always-loaded reminder | `.claude/rules/` and `.cursor/rules/`, and Pi's system prompt through its extension, on every turn |
| The syntax sessions look up most | a digest from the project's own mxcli, loaded into the session: `.claude/rules/`, `.cursor/rules/`, `opencode.json`, Pi's system prompt |
| `MOD001`, `REU001`, `UI001` | `mxcli lint` discovers `.claude/lint-rules/*.star` by itself |
| `check_mdl.py`, `check_test_coverage.py`, `check_layout.py` | the skills that need them name the exact command; the gate runs them too |
| The gate | host hooks fire it, and the `test-first-delivery` skill tells the agent to |

The Python checkers exist because some rules cannot be expressed as lint rules —
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
bash mxcodr/install.sh --with-deps
```

and then working with your agent as usual.

## Requirements

| | Why |
|---|---|
| **mxcli** | everything runs through it |
| **Mendix Studio Pro** or a cached mxbuild | `mx check` validates the model |
| **PostgreSQL** | the app's database, and a separate `<project>_test` one |
| **bash** | the harness is shell scripts — Git Bash on Windows |
| **Python 3** | for the checkers the gate and the agent call; you never invoke it |
| **Node + playwright-cli** | the browser tests |
| **A JDK** | matching the Mendix version; Studio Pro installs one |
| **Docker** | installed by default; optional: see [Running without Docker](mxcodr/README.md#running-without-docker) |

`--with-deps` installs the ones that can be installed unattended. It never installs
a JDK — that wants a licence click.

## Install

Copy `mxcodr/` into your Mendix project and run the installer **from the project
folder, one level above `mxcodr/`** — not from inside `mxcodr/`:

```bash
cd MyApp                              # the folder with MyApp.mpr and mxcodr/
bash mxcodr/install.sh --with-deps
```

`cd mxcodr && bash install.sh` still installs into the folder above, but then the
target is guessed rather than named, and with no app there it stops to ask.

```
bash mxcodr/install.sh [path-to-project] [--no-app] [--with-deps]

  path-to-project  where to install (default: the current directory, or the
                   parent project when run from inside the bundle)
  --no-app         never create a Mendix app; require one to be there already
  --with-deps      install missing prerequisites with this machine's package
                   manager. Without it they are only reported.
```

With no `.mpr` in the target and `--with-deps`, it creates a Mendix app for you.

### Windows

There is no bash on Windows until something installs it, so there is a second
entry point for that one job:

```powershell
powershell -ExecutionPolicy Bypass -File mxcodr\bootstrap.ps1     # from the project folder
```

It installs Git for Windows, Python and Node with winget, then hands over to
`bash install.sh --with-deps`.

**Run it from an elevated terminal.** winget's Docker Desktop install asks for
administrator rights, and unelevated it fails with `exit code: 4294967291` and is
reported as missing.

If you already have Git Bash, skip `bootstrap.ps1` and run `bash mxcodr/install.sh` from the project folder.

### What lands in the project, and who reads it

```
.claude/skills/<name>/       Claude Code
.agents/skills/<name>/       Codex, Pi, and other tools on the open SKILL.md standard
.ai-context/skills/<name>/   mxcli, Cursor, OpenCode, Windsurf, Aider
.claude/rules/               the always-loaded rule and the syntax digest (Cursor's copies in .cursor/rules/,
                             Pi gets it through its extension)
.claude/lint-rules/          found by `mxcli lint` with nothing to register
tools/mdl-checks/            the Python checkers the skills cite
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

One command, seven checks, run concurrently — the browser suite, `mx check`, `mxcli
lint`, test coverage, naming/captions, page layout and the security level. Every step
runs even when another fails, so one call reports the whole picture, and a red run ends with the list of what still
blocks DONE. Exit 0 only when all seven pass. Below them come warnings that do not block
DONE yet: how the pages rendered (`VIS`, `LOOK`), errors the server logged (`RUNTIME01`) and
tests that were never seen to fail.

```
== gate
   tests: Total: 12  Passed: 12  Failed: 0  Time: 2m14s
   mx check: 0 errors
   lint: 59 issues: 0 errors, 24 warnings, 35 info
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
bash tests/gate.sh --restart          # stop this project's app and boot it again
bash tests/gate.sh --only <feature>   # one test, warm browser, red loop (ends PASSED, never DONE)
bash tests/orient.sh                  # what is in this project
bash tests/diagnose.sh                # why is the app not answering
```

## Configuration

`tests/harness.env` is written by the installer and read by every harness script.
The environment still wins, so any of it can be overridden for one run.

| Key | What it is |
|---|---|
| `MDL_MXBUILD_PATH` | the Studio Pro or cached mxbuild `mx check` runs |
| `MDL_DB_HOST` / `_NAME` / `_USER` / `_PASSWORD` | the database |
| `JAVA_HOME` | a JDK on a path with **no spaces** (see below) |
| `MDL_BOOT_COMMAND` | how the gate boots the app when nothing answers |
| `MDL_VISUAL` / `MDL_RUNTIME_ERRORS` | the rendered-page and server-error checks: warnings by default, `error` blocks DONE, `0` turns them off |
| `MDL_VISUAL_REVIEW` | `agent`: a model that reads images also judges a screenshot of each page |
| `MDL_ALLOW_GREEN_FIRST` | tests that are green by nature, so the gate does not warn that they never failed |
| `MDL_REQUIRE_PRODUCTION` | `0` for an app that deliberately has no users at all |

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

## Rebuilding the bundle

`mxcodr/` is a copy of files that live in the harness repo — `mxcodr/README.md` has the
table of which file comes from where. Edit it there, not here.

The long scripts are split into short parts: `install.sh` sources `install/*.sh`, `tests/lib.sh`
sources `tests/lib/*.sh` and `checks/check_layout.py` imports its rules from
`checks/layout_rules/`. The map of what is where is under "What is in here" in `mxcodr/README.md`.
