# tests/gate/layout.sh -- the layout step: check_layout and the navigation and sign-out input it gathers
# Sourced by tests/gate.sh after checks.sh (the runner, step_run and the shared describe helpers); defines functions only.

# layout_unread <what> <codes> -- a describe that failed while gathering extra input for the layout
# check. It does not stop the check (one widget mxcli cannot describe would block every DONE), but
# the rules that read that input may have missed something, and the gate says which.
layout_unread() {
  local what="$1" codes="$2" first
  first="$(head -1 "$WORK/layout-$what.broken" 2>/dev/null)"
  echo "   - layout: some $what could not be read (${first:-describe failed}), so $codes may have missed a finding there" >> "$WORK/layout.unread"
  return 0
}

# Adds to nav_args (never replaces it: the caller has put --own-modules there already): the menu icons (NAV05) and the snippets' buttons (ICON01) always; the Log out and role-home rules (NAV01-NAV03) only
# when project security is on, since only then do users sign in. Returns 1, with the summary
# written, when security is on and the navigation cannot be read.
layout_sign_out_inputs() {
  local level
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -i 'Security Level' | head -1)"
  # No level means the command failed. It used to read as "security off", which skips the
  # sign-in rules (NAV01, NAV03, the accounts and home pages): a pass for a check that never ran.
  if [ -z "$level" ]; then
    echo "layout: could not run -- SHOW PROJECT SECURITY printed no level" > "$WORK/layout.summary"
    return 1
  fi
  case "$level" in
    *[Oo]ff*)
      # Without sign-in only the icons are checked, and a navigation that cannot be read does not block.
      "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null \
        && nav_args+=(--navigation "$WORK/navigation.mdl")
      # Snippets carry buttons too (ICON01); unreadable ones do not block, and are named.
      describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || layout_unread snippets ICON01
      nav_args+=(--sign-out-sources "$WORK/snippets")
      return 0 ;;
  esac
  if ! "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null; then
    echo "layout: could not run -- DESCRIBE NAVIGATION failed" > "$WORK/layout.summary"
    return 1
  fi
  # A sign-out button in a snippet (a shared header, say) also counts; unreadable snippets do not
  # block, and are named.
  describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || layout_unread snippets "ICON01, NAV01"
  nav_args+=(--navigation "$WORK/navigation.mdl" --sign-out-sources "$WORK/snippets" --users-sign-in)
  # Every user role with its module roles: ACCOUNT03, HOME01 and MODULE01 read them.
  # A listing or a role that cannot be read stops the check: without them ACCOUNT03, HOME01 and
  # MODULE01 find nothing, which read as a pass.
  local role guest roles
  : > "$WORK/userroles.mdl"
  if ! roles="$("$MXCLI" -p "$MPR" --json -c "SHOW USER ROLES" 2>/dev/null)" \
     || ! roles="$(printf '%s' "$roles" | "$NODE" "$MDL_SHELL_HELPERS" role-names 2>/dev/null)"; then
    echo "layout: could not run -- SHOW USER ROLES did not return a JSON list" > "$WORK/layout.summary"
    return 1
  fi
  while IFS= read -r role; do
    [ -n "$role" ] || continue
    if ! "$MXCLI" -p "$MPR" -c "DESCRIBE USER ROLE $role" >> "$WORK/userroles.mdl" 2>/dev/null; then
      echo "layout: could not run -- DESCRIBE USER ROLE $role failed" > "$WORK/layout.summary"
      return 1
    fi
  done <<< "$roles"
  nav_args+=(--user-roles "$WORK/userroles.mdl")
  # NAV06: who may open each page and microflow the menu links to, so the checker knows which
  # entries each role sees. An unreadable answer counts as "everyone" and can only add findings.
  local kind target
  while read -r kind target; do
    printf '%s %s\t' "$kind" "$target"
    "$MXCLI" -p "$MPR" --json -c "SHOW ACCESS ON $kind $target" 2>/dev/null | tr -d '\n\r'
    echo
  # mxcli 0.25 writes an item's action as `OnClick: show page M.P` and may put it on its own line.
  done < <(grep -iE "^[[:space:]]*menu[[:space:]]+item[[:space:]]+'|OnClick:" "$WORK/navigation.mdl" \
             | sed -E "s/^[[:space:]]*menu[[:space:]]+item[[:space:]]+'[^']*'//" \
             | grep -oiE "(page|microflow)[[:space:]]+[A-Za-z0-9_]+\.[A-Za-z0-9_]+" | sort -u) > "$WORK/menu-access.tsv"
  nav_args+=(--menu-access "$WORK/menu-access.tsv")
  guest="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -iE '^(Guest|Anonymous) (User )?Role:' | head -1 | sed -E 's/^[^:]*:[[:space:]]*//')"
  if [ -n "$guest" ]; then nav_args+=(--guest-role "$guest"); fi
  # ACCOUNT01-02: only when the Administration module is there to link to.
  if "$MXCLI" -p "$MPR" --json -c "SHOW PAGES IN Administration" 2>/dev/null | grep -q '"Administration.Account_Overview"' \
     && "$MXCLI" -p "$MPR" --json -c "SHOW MICROFLOWS IN Administration" 2>/dev/null | grep -q '"Administration.ManageMyAccount"'; then
    nav_args+=(--admin-module)
  fi
  return 0
}

# The layout step: check_layout.cjs over every page's `describe` -- navigation, accounts, the page top,
# spacing, grids, names, text inputs, URLs (NAV, ACCOUNT, USER, BACK, SPACE, GRID, NAME, TEXT, URL ...).
check_layout() {
  [ -f tools/mdl-checks/check_layout.cjs ] || {
    echo "layout: could not run -- tools/mdl-checks/check_layout.cjs is missing" > "$WORK/layout.summary"
    return 2; }
  local gate out code
  modules_or_status layout; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;   # no user modules: a real pass, summary already written
    *) return "$gate" ;;
  esac
  if ! describe_all layout "$WORK/pages" "PAGES"; then
    echo "layout: could not run -- $(head -1 "$WORK/layout.broken")" > "$WORK/layout.summary"
    head -5 "$WORK/layout.broken" | sed 's/^/  - /' > "$WORK/layout.detail"
    return 2
  fi
  if ! ls "$WORK"/pages/*.mdl >/dev/null 2>&1; then
    echo "layout: no page to check" > "$WORK/layout.summary"; return 0
  fi
  local -a nav_args=(--own-modules "$USER_MODULES")
  rm -f "$WORK/layout.unread"
  layout_sign_out_inputs || return 2
  # MODULE01: the empty template's module, still in an app that has its own.
  if "$MXCLI" -p "$MPR" --json -c "SHOW MODULES" 2>/dev/null | grep -q '"MyFirstModule"'; then
    nav_args+=(--template-module)
  fi
  # The project's own layouts, for a menu built from buttons (NAV04); unreadable ones do not block.
  describe_all layout-layouts "$WORK/layouts" "LAYOUTS" || layout_unread layouts NAV04
  ls "$WORK"/layouts/*.mdl >/dev/null 2>&1 && nav_args+=(--layouts "$WORK/layouts")
  # Flows open pages too (`show page` in an ACT_ microflow), for the Back-button rule (BACK01),
  # and write entities, for buttons that change a grid's rows outside its header (GRID02).
  describe_all layout-flows "$WORK/layout-flows" "MICROFLOWS NANOFLOWS" || layout_unread flows "BACK01, GRID02"
  ls "$WORK"/layout-flows/*.mdl >/dev/null 2>&1 && nav_args+=(--opened-from "$WORK/layout-flows")
  # The entities say how long the text a textbox edits may be (TEXT01, TEXT02).
  describe_entities_into "$WORK/layout-entities" || layout_unread entities "TEXT01, TEXT02"
  ls "$WORK"/layout-entities/*.mdl >/dev/null 2>&1 && nav_args+=(--entities "$WORK/layout-entities")
  # Widget names (NAME01/02): warnings until the first DONE, then a new or changed page needs them.
  # tests/rulebook/layout/NAME02.md at `block`: every page needs them; NAME01 and NAME02 `off`: not checked.
  local names_levels names_mode=warn
  names_levels="$(mdl_rulebook levels layout 2>/dev/null)"
  case "$names_levels" in *'"NAME02":"block"'*) names_mode=error ;; esac
  case "$names_levels" in *'"NAME01":"off"'*) case "$names_levels" in *'"NAME02":"off"'*) names_mode=0 ;; esac ;; esac
  case "$names_mode" in
    0) ;;
    error) nav_args+=(--names error --page-hashes "$CACHE_DIR/layout.pages.json") ;;
    *) nav_args+=(--names warn --page-hashes "$CACHE_DIR/layout.pages.json")
       [ -f "$CACHE_DIR/names-baseline.json" ] && nav_args+=(--names-baseline "$CACHE_DIR/names-baseline.json") ;;
  esac
  rulebook_ok layout || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args layout)
  mkdir -p "$CACHE_DIR" 2>/dev/null
  out="$("$NODE" tools/mdl-checks/check_layout.cjs "$WORK/pages" "${nav_args[@]}" ${rb[@]+"${rb[@]}"} \
    --expect-pages "$(cat "$WORK/layout.count" 2>/dev/null || echo 0)" 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "layout: could not run -- check_layout.cjs exited $code" > "$WORK/layout.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/layout.detail"
    return 2
  fi
  echo "layout: $(printf '%s\n' "$out" | head -1)" > "$WORK/layout.summary"
  printf '%s\n' "$out" | grep -E '^\s+[-!] ' | head -12 > "$WORK/layout.detail"
  # Every finding, where a session reads them all without running the checker: the detail shows
  # twelve, and on InvoiceB2B a session hunted the checker's source for the other five URL01 pages.
  mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$out" > .mxcli/layout.txt 2>/dev/null
  local shown total
  shown="$(grep -c . "$WORK/layout.detail")"; total="$(printf '%s\n' "$out" | grep -cE '^\s+[-!] ')"
  [ "$total" -gt "$shown" ] && echo "   ... $shown of $total findings shown; all of them: .mxcli/layout.txt" >> "$WORK/layout.detail"
  # How a page renders (ALERT01) is a warning, a failure at `block` in tests/rulebook/layout/ALERT01.md.
  local look
  look="$(printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[ALERT01\]' | sed -E 's/^[[:space:]]+! /   - /')"
  local alert; alert="$(mdl_rule_mode ALERT01)"
  if [ -n "$look" ] && [ "$alert" = "error" ]; then
    printf '%s\n' "$look" >> "$WORK/layout.detail"
    gate=1
  elif [ -n "$look" ] && [ "$alert" != "0" ]; then
    printf '%s\n' "$look" > "$WORK/layout.warnings"
  fi
  # A textbox whose attribute's name says it holds prose (TEXT02) is a hint, shown with the warnings.
  printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[TEXT02\]' | sed -E 's/^[[:space:]]+! /   - /' >> "$WORK/layout.warnings"
  # Widget names: one line with the count and five examples, not hundreds (an app built before the
  # rule has a name to change on nearly every widget).
  local names_total names_repeated
  names_total="$(printf '%s\n' "$out" | grep -cE '^[[:space:]]+! \[NAME02\]')"
  names_repeated="$(printf '%s\n' "$out" | grep -cE '^[[:space:]]+! \[NAME01\]')"
  if [ "$names_total" -gt 0 ] || [ "$names_repeated" -gt 0 ]; then
    { echo "   - [NAME01/NAME02] $names_total widget name(s) do not read <Page>_<What><Type>, $names_repeated name(s) are used on more than one page (skill naming-and-captions, 'Widget names'); a page new or changed after the next DONE needs them. The first five:"
      printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[NAME02\]' | head -5 | sed -E 's/^[[:space:]]+! /     /'
    } >> "$WORK/layout.warnings"
  fi
  [ -s "$WORK/layout.warnings" ] || rm -f "$WORK/layout.warnings"
  [ -s "$WORK/layout.unread" ] && cat "$WORK/layout.unread" >> "$WORK/layout.warnings"
  return "$gate"
}
