#!/usr/bin/env bash
# tests/rules.sh -- the rulebook, read only: every rule of the gate as the person set it.
#
#   bash tests/rules.sh                 one line per rule: code, step, level (and the default when changed), exceptions
#   bash tests/rules.sh list [step]     the same, one step
#   bash tests/rules.sh explain CODE    the card: what it checks, the fix, the ## Local section
#   bash tests/rules.sh check           validate every card (the gate does this too; a broken card stops every model check)
#
# The cards are tests/rulebook/<group>/<CODE>.md (layout, naming, security, paths, catalog, folders, app). A level or an exception is changed by editing the card's
# ## Local section -- by the person, never by a session (the guard blocks it); a session that finds
# a rule wrong for this app says so in its report with the line to add.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
. tests/portable.sh
NODE="${NODE:-$(mdl_find_node || true)}"
[ -n "$NODE" ] || { echo "rules: node is needed to read tests/rulebook/" >&2; exit 2; }
[ -d tests/rulebook ] || { echo "rules: no tests/rulebook/ here -- run the installer (bash mxcodr/install.sh .)" >&2; exit 2; }
cmd="${1:-list}"; shift || true
case "$cmd" in
  list|explain|check|levels|excepts|changes) exec "$NODE" "$MDL_RULEBOOK" tests/rulebook "$cmd" "$@" ;;
  -h|--help|help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "rules: list [step] | explain CODE | check" >&2; exit 2 ;;
esac
