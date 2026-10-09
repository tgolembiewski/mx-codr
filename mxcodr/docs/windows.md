# Setting a Windows machine up — one command

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
