# mx-codr

**Your AI agent builds the Mendix app. mx-codr gives it the rules, skills and tests to build it well.**

mx-codr v2 is a small installer. You run it once in a Mendix app. From then on the coding agent that
works in the app reads one short always-on rule file, finds nine skills next to mxcli's own, and gets a
starter Playwright test kit. **Nothing runs behind the agent's back**: no gate, no hooks, no refusals, no
edits to your agent's settings.

The bundle is **2026.11.08.1**, pinned to [mxcli](https://github.com/mendixlabs/mxcli) 0.30.0.

## What you get

- **An installer** (`mxcodr/install.sh`) that checks Node, finds or downloads mxcli, warms the MxBuild and
  runtime caches, and writes everything below for the agents you choose.
- **One always-on rule file** (about 25 lines): keep tests, prove a refusal as the wrong role, run the whole
  suite once at the end, show a table "requirement -> test that asserts it".
- **Nine skills**: `durable-tests`, `app-security`, `spacing-and-layout`, `naming-and-captions`,
  `module-structure`, `reuse-and-snippets`, `files-and-images`, `java-action-docs`, `film-tests`.
- **A starter test kit** in `tests/` (`mx.ts`, `mx.teardown.ts`, `playwright.config.ts`, `package.json`):
  sign-in and sign-out that never leak a session, grid and form helpers, OQL checks, and a teardown that
  prints `sessions left: N`. Files are written only when absent and are yours from then on.
- **Films of tests**: ask the agent "film the order approval test", or run `node tests/film.mjs --list` and
  `node tests/film.mjs <number>` yourself. The run is slowed, with a title card and a pointer, and lands in
  `.mxcli/films/` (`.webm`, plus `.mp4` when ffmpeg is installed). Normal test runs are not affected; see
  *Film a test* in `mxcodr/README.md`.
- **Six looks for the app** (themes): atlas (Mendix's own), navy, teal, amber, plum, forest.

## Install

You need Node 20 or later. Copy the `mxcodr/` folder into the folder of your app (an empty folder is fine)
and run it from there:

    git clone https://github.com/tgolembiewski/mx-codr.git
    mkdir -p MyApp && cp -R mx-codr/mxcodr MyApp/
    cd MyApp && ./mxcodr/install.sh --db hsqldb --agent claude

With no `.mpr` in the folder the installer creates the app with `mxcli new` (Mendix `MX_VERSION`, default 11.12.1;
name `APP_NAME`, default the folder name), keeping your own files; `--no-app` stops instead. The folder can also
be named: `bash mx-codr/mxcodr/install.sh /path/to/MyApp ...`.

On Windows, run it from Git Bash. Then start a **new** agent session in the app folder: an agent reads its
rules and skills when the session starts.

| Agent | `--agent` | Rule file | Skills |
|---|---|---|---|
| Claude Code (default) | `claude` | `.claude/rules/mxcodr.md` | `.claude/skills/` |
| Cursor | `cursor` | `.cursor/rules/mxcodr.mdc` | `.cursor/skills/` |
| Codex | `codex` | block in `AGENTS.md` | `.agents/skills/` |
| opencode | `opencode` | block in `AGENTS.md` | `.opencode/skills/` |
| Pi | `pi` | block in `AGENTS.md` | `.agents/skills/` |

Without `--agent` the installer asks on a terminal which agent(s) will work in the app (numbers or names, several at once: `1,5`). Give several agents with commas: `--agent claude,codex`. On a re-install `--agent` adds to the agents installed before; `--remove-agent <name>` removes one.

Options: `--db hsqldb|postgres`, `--theme <name>`, `--yes`, `--boot`, `--request <file>`.

**`--theme <name>`** chooses the app's look (`atlas`, `navy`, `teal`, `amber`, `plum`, `forest`, or its
number). On a terminal the installer asks once; with no terminal, or with `--yes`, the look stays as
`mxcli new` made it. Change it later in the app folder: `node .mxcodr/theme.mjs <name>`.

Run the installer again to upgrade or repair. It also removes what v1 installed.

## Measured

The same long prompt (`b2b-full`, a B2B order app with 84 requirements), built unattended by Claude Code:

| | time | tokens | requirements built | requirements tested |
|---|---|---|---|---|
| v2 (run so5) | 56 min | 58M | 80 of 84 | 65 of 84 |
| v1 (best run, hb1) | 101 min | 134M | 81 of 84 | 80 of 84 |

v2 is about twice as fast on less than half the tokens and builds about as much. It tests less: 65 of 84
requirements against v1's 80. That is the price of dropping the gate.

## Want v1 back?

v1 (the gate `tests/gate.sh`, hooks, checkers, the rulebook) is no longer in the tree. It is kept in the tag
`v1-last` (bundle 2026.10.25.13):

    git checkout v1-last                      # read it
    git worktree add ../mx-codr-v1 v1-last    # or have it next to this checkout

## More

- [`mxcodr/README.md`](mxcodr/README.md): what the bundle contains and what the installer does, step by step
- [`docs/harness-rules.html`](docs/harness-rules.html): the rule file line by line, the skills, the test kit
- [`docs/harness-wiring.html`](docs/harness-wiring.html): how install, agents and measuring fit together

Develop: `node --test 'mxcodr/test/*.test.mjs'`.
