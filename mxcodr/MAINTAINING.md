# Maintaining the harness

For whoever changes `mxcodr/`. What a person who *uses* the harness reads is the `README.md` of the
mx-codr repository; what the agent reads is `rules/`, `skills/` and the rule cards.

## The four parts, and where each lives

| Part | Runs | Files |
|---|---|---|
| **Installer** | once per app, by the person | `install.sh` (sources `install/*.sh` in order; its header lists them) |
| **Hooks** | around every agent tool call | `hooks/*.sh` (Claude, Codex, Cursor), `plugins/*.js` (OpenCode, Pi); shared decisions in `checks/plugins/harness-core.cjs` and `checks/hook_tool.cjs` |
| **Gate** | `bash tests/gate.sh` in the app | `tests/gate.sh` and `tests/gate/*.sh`; the Node it calls in `checks/` |
| **Rules** | read by the gate and the person | one card per rule in `rulebook/<step>/<CODE>.md` |

Installed into an app, `checks/` becomes `tools/mdl-checks/`, `tests/` becomes the app's `tests/`,
`rulebook/` becomes `tests/rulebook/`, `skills/` goes to `.claude/skills/` (and the other hosts'),
and `rules/mdl-skills.md` to `.claude/rules/`.

## How the gate runs

`main()` at the bottom of `tests/gate.sh` is the whole gate in four numbered phases:

1. **Model checks start in the background.** They need no app: mx check, catalog, coverage, naming,
   layout, security, scope, paths, folders, unused. Each one is a `check_<name>` function in
   `tests/gate/` that calls a Node checker; `run_cached` (in `tests/gate/checks.sh`) replays a pass
   while its inputs are unchanged.
2. **The app.** Found on its port, booted, or restarted (`tests/gate/app.sh`).
3. **Preflights, then the suite.** Sessions, a stale model, the environment (`tests/gate/preflight.sh`),
   then every `tests/verify-*.test.sh` (`tests/gate/tests.sh`).
4. **The verdicts.** Collected; on a full gate with nothing red the microflow tests run
   (`tests/gate/mftest.sh`). Then `print_verdict_and_exit` (`tests/gate/verdict.sh`) prints `DONE`,
   `NOT DONE — failed: …` or `NOT DONE — could not run: …`. It writes `.mxcli/last-gate.txt` for the next session.

`--only <test>` runs one test plus the model checks that need no app, and ends in `PASSED`, never `DONE`.

## A rule, end to end

A card's header names the code that produces the finding:

```
---
step: layout
level: block
check: layout_rules/urls.cjs#urlFindings
key: document
---
```

- `step` is the gate step that runs it; `level` is `block`, `warn`, `info` or `off`.
- The person changes the level, or excepts one document, under `## Local` in the installed card. The
  agent never can, because the hooks refuse edits to `tests/rulebook/`.
- `checks/rulebook.cjs` reads the cards and hands each checker its levels (`--levels`) and exceptions.

To add a layout rule:

1. Write the finding in `checks/layout_rules/<topic>.cjs`. Each finding is `{check: 'CODE', message, …}`,
   and the message carries the fix.
2. Add a line to `LAYOUT_RULES` in `checks/check_layout.cjs`: when it runs and where its findings go.
   Its place in the table is the order its findings print.
3. Write the card `rulebook/layout/CODE.md`.
4. Regenerate the agent's pages: `node checks/rulebook.cjs rulebook docs tests`, run from `mxcodr/`.
5. Add a test in `tests/performance/test_layout.py` (in the development repository) that fails
   without the rule.

Other steps follow the same pattern with their own checker: `security_rules.cjs`, `catalog_rules.cjs`,
`check_paths.cjs`, `check_folders.cjs`, `check_unused.cjs`, `check_mdl.cjs` (naming).

## When mxcli changes

Raising `MXCLI_TESTED` is more than a version number:

1. In an app installed with the new mxcli, record its lint rules:
   `./mxcli lint -p <app>.mpr --list-rules | grep -E '^\s+[A-Z]+[0-9]+ ' | sed 's/^ *//'` into
   `tests/performance/fixtures/lint/rules-<version>.txt` (development repository).
2. `test_every_mxcli_lint_rule_has_a_card_with_its_level` then names every new rule without a card and
   every card whose rule is gone. Decide each new rule: a card in `rulebook/lint/` at `warn` when it adds
   something the harness does not check, `off` with the reason when not. Never leave one to LINT01.
3. Regenerate the syntax digest, review `checks/mdl-pitfalls.md`, run the audit, and record the describe
   fixture of the new version (`tests/performance/fixtures/describe-<version>/`).

## Things that bite

- **Bash 3.2.** macOS ships it, so no `mapfile`, `${x,,}` or associative arrays. Under `set -u`, write
  an array that may be empty as `${arr[@]+"${arr[@]}"}`.
- **Windows Git Bash.** Paths, `node` lookup and process handling differ. The installer and the gate
  are tested in the Windows VM before a PR that touches them.
- **Tests lift gate functions out by name.** `tests/performance/harness_base.py` extracts a function
  from `tests/gate.sh` and `tests/gate/*.sh` with the pattern `^name() … ^}`. A renamed or moved
  function, or one whose closing `}` is not at column 0, breaks the tests. The `HELPERS` table there
  lists what each extracted function needs.
- **`gate.sh --help` prints lines 2-24.** Keep the header 23 lines long.
- **The frozen checkers.** `tests/performance/fixtures/node-reference/` is the checkers as they were
  after the Node port. `check_mdl`, `check_layout`, `view_access` and `gate_helpers` must print the
  same as it, byte for byte. When a change is meant to alter their output, copy the changed file
  there in the same commit.
- **Size caps.** The tests cap these files:
  - `rules/mdl-skills.md` and `.mdc` under 9000 characters;
  - `checks/reminder.txt` (printed into every prompt) under 1200;
  - `skills/test-first-delivery/SKILL.md` under 10000;
  - `tests/checks/layout.md` under 4500.

  Some phrases in them are pinned by tests. Trim the text; do not raise the cap.
