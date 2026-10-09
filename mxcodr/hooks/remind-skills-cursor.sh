#!/usr/bin/env bash
# Cursor sessionStart hook (Cursor has no per-prompt context injection): prints {"additional_context": "<rules>"}. Exit 0.
# .cursor/rules/mdl-skills.mdc keeps the rules attached to later requests.
set -uo pipefail

# NODE and HOOK_TOOL (hook_tool.cjs, the small jobs: read a field, wrap a message).
. "$(dirname "${BASH_SOURCE[0]}")/hook-env.sh"

# shellcheck source=remind-skills-lib.sh
. "$(dirname "$0")/remind-skills-lib.sh"
mdl_mark_session
mdl_reminder '.cursor/rules/mdl-skills.mdc' \
  'read `test-first-delivery` (`.ai-context/skills/<name>/SKILL.md`)' \
  '(a hook runs `tests/precheck.sh` for you -- mx check on a copy; do not call it by hand)' \
  | "$NODE" "$HOOK_TOOL" wrap additional_context
