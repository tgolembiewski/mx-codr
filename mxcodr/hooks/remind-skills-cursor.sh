#!/usr/bin/env bash
# Cursor sessionStart hook (Cursor has no per-prompt context injection): prints {"additional_context": "<rules>"}. Exit 0.
# .cursor/rules/mdl-skills.mdc keeps the rules attached to later requests.
set -uo pipefail

# Prints the first Python that actually runs (Windows may have only a Store stub); inlined so the hook is self-contained.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # The python.org installer (also via winget) does not add Python to PATH; search its install dirs too.
  local local_app="${LOCALAPPDATA:-}"
  local_app="${local_app//\\//}"
  for candidate in \
      "$local_app/Programs/Python"/Python3*/python.exe \
      "$local_app/Programs/Python/Launcher/py.exe" \
      "/c/Program Files"/Python3*/python.exe \
      "/c/Program Files (x86)"/Python3*/python.exe; do
    [ -x "$candidate" ] || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}
PY="$(mdl_find_python || true)"
PY="${PY:-python3}"

cat <<'MSG' | "$PY" -c 'import json,sys; print(json.dumps({"additional_context": sys.stdin.read().strip()}))'
Project rules (full text: `.cursor/rules/mdl-skills.mdc`). 1. Start with `bash tests/orient.sh`, not by exploring by hand. 2. Before building or changing any feature read `test-first-delivery` (`.ai-context/skills/<name>/SKILL.md`): write tests/verify-<feature>.test.sh, run `bash tests/gate.sh --only <feature> --boot-if-needed`, watch it FAIL first, then iterate on that ONE script. 3. Before creating a module or changing a Marketplace module (`<Module>Ext`): `module-structure`; before a page: `spacing-and-layout` (side-by-side widgets need `DesignProperties` Spacing, never CSS); before a microflow: `naming-and-captions` (a business `@caption` on every decision AND action). Read exactly those four files up front and nothing else, one file per command (never one combined `cat`). 4. Syntax: `./mxcli syntax <topic>`, then `./mxcli check <script>.mdl -p <app>.mpr --references` before every exec (a hook runs `tests/precheck.sh` for you -- mx check on a copy; do not call it by hand); do not sweep SKILL.md files. 5. Done = `bash tests/gate.sh` (suite + mx check + lint + coverage + naming + layout + security) ends in `DONE`.
MSG
