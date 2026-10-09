# hooks/hook-env.sh -- sourced by the hooks (never run on its own): finds Node and hook_tool.cjs.
# Sets NODE (a node that runs, else plain `node`) and HOOK_TOOL (an absolute path: a hook may cd
# into the project after this). Installed beside the hooks in tools/mdl-checks/hooks/; hook_tool.cjs
# is one directory up, in the bundle under checks/. guard-harness-env.sh keeps its own copy of
# mdl_find_node on purpose: the guard must work even when nothing else of the harness is there.

# Prints a node that runs (the same function as tests/portable.sh, compared by a test).
mdl_find_node() {
  if command -v node >/dev/null 2>&1; then
    printf 'node\n'
    return 0
  fi
  # The Node.js installer (also via winget) puts node on PATH only for shells started after it.
  local local_app="${LOCALAPPDATA:-}" candidate
  local_app="${local_app//\\//}"
  for candidate in "/c/Program Files/nodejs/node.exe" "$local_app/Programs/nodejs/node.exe"; do
    [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}
NODE="$(mdl_find_node || true)"
NODE="${NODE:-node}"
HOOK_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/hook_tool.cjs"
[ -f "$HOOK_TOOL" ] || HOOK_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../checks" 2>/dev/null && pwd)/hook_tool.cjs"
