# tests/lib/scenario.sh -- part of tests/lib.sh, which sources it; never run it on its own.
# scenario '<js body>': builds one playwright-cli run from the settings, tests/scenario-helpers.js
# and the body, runs it, fails with a readable message, and prints the body's return value.

# --- 7. scenario ---
# scenario '<js body>' -- run the body in one playwright-cli process; print its return as JSON, fail() on error.
# Steps: write the JavaScript to a file, run it, fail on an error, print the result.
scenario() {
  local body="$1"
  local code_file output
  code_file="$(mdl_tmpfile mdl-scenario)"
  # The visual checks' mode, once per test script (the gate exports it for the whole suite).
  [ -n "${_MDL_VISUAL_MODE:-}" ] || _MDL_VISUAL_MODE="$(mdl_rule_mode VIS01 VIS02 VIS03 VIS04 LOOK01 LOOK02)"
  # Written to a file: bodies contain double quotes.
  _mdl_scenario_js "$body" > "$code_file"

  # So the EXIT trap can delete it (it holds the password) after a timeout.
  _MDL_SCENARIO_FILE="$code_file"
  _MDL_SCENARIO_START="$(date '+%Y-%m-%d %H:%M:%S')"
  output="$(_mdl_run_code_file "$code_file")"
  # Outside the runner (peek.sh, a test run by hand after the gate) nothing opened the browser, and
  # two sessions retried the same command on "Browser 'default' is not open". Open it and run once more.
  if _mdl_browser_not_open "$output"; then
    _mdl_bounded 30 playwright-cli open
    output="$(_mdl_run_code_file "$code_file")"
  fi
  rm -f "$code_file"; _MDL_SCENARIO_FILE=""

  # Called directly, not in $(...): fail() must end the script, not a subshell.
  _mdl_fail_on_scenario_error "$output"
  _mdl_scenario_result "$output"
}

# _mdl_run_code_file <file> -- run the scenario from its file. As an argument the whole script,
# the test password in it, showed in `ps` for as long as it ran. A playwright-cli too old to know
# --filename says "Unknown option", and only then is the script passed the old way.
_mdl_run_code_file() {
  local out
  out="$(playwright-cli run-code --filename "$1" 2>&1)"
  case "$out" in
    *"Unknown option"*|*"unknown option"*) out="$(playwright-cli run-code "$(cat "$1")" 2>&1)" ;;
  esac
  printf '%s\n' "$out"
}

# _mdl_browser_not_open <output> -- true when playwright-cli refused because no browser is open.
_mdl_browser_not_open() {
  case "$1" in
    *"is not open, please run open first"*|*"Browser 'default' is not open"*) return 0 ;;
  esac
  return 1
}

# _mdl_scenario_js <body> -- the whole async function: settings, helpers, then the body in try/catch.
_mdl_scenario_js() {
  local body="$1"
  printf 'async () => {\n'
  _mdl_js_settings
  _mdl_js_helpers
  _mdl_js_film_pace
  # verify shows only the last stderr line, so the catch adds url and user to the error.
  printf '  try {\n'
  # The body runs as its own function so its `return` comes back here: then the page it ended
  # on is measured (look), whatever the test checked, and the measurement rides on the result.
  printf '  const __mdl_value = await (async () => {\n%s\n  })();\n' "$body"
  printf '  await look("end");\n'
  printf '  return __mdl_attach_visual(__mdl_value);\n'
  _mdl_js_catch_and_sign_out
  printf '}\n'
}

# The JS constants: BASE, USER, PASSWORD, ACTION_TIMEOUT, RELEASE, REUSE, and vars (SV_* values).
_mdl_js_settings() {
  # JSON-encoded: these values are data, and an apostrophe must not end the JS string.
  printf '  const MDL_CFG = JSON.parse(%s);\n' "$(mdl_json_string \
    "$(mdl_json_object BASE "$BASE_URL" USER "$TEST_USER" PASSWORD "$TEST_PASSWORD")")"
  printf '  const BASE = MDL_CFG.BASE;\n'
  printf '  const USER = MDL_CFG.USER;\n'
  printf '  const PASSWORD = MDL_CFG.PASSWORD;\n'
  # sign_in_as('<user>'): every TEST_PASSWORD_<user>= of tests/credentials.env, read as data.
  local cred_pairs=() cred_line cred_user cred_pw
  if [ -f "${CREDENTIALS:-}" ]; then
    # `|| [ -n ... ]`: a file whose last line has no newline still gives that line (a session's
    # credentials.env lost its last password that way, InvoiceChase 2026-10-09).
    while IFS= read -r cred_line || [ -n "$cred_line" ]; do
      case "$cred_line" in TEST_PASSWORD_*=*) ;; *) continue ;; esac
      cred_user="${cred_line%%=*}"; cred_user="${cred_user#TEST_PASSWORD_}"
      cred_pw="${cred_line#*=}"; cred_pw="${cred_pw%\"}"; cred_pw="${cred_pw#\"}"
      [ -n "$cred_user" ] && cred_pairs+=("$cred_user" "$cred_pw")
    done < "$CREDENTIALS"
  fi
  printf '  const PASSWORDS = JSON.parse(%s);\n' "$(mdl_json_string "$(mdl_json_object ${cred_pairs[@]+"${cred_pairs[@]}"})")"
  printf '  const ACTION_TIMEOUT = %s;\n' "$(mdl_json_number "${ACTION_TIMEOUT_MS:-8000}" 8000)"
  printf '  const RELEASE = %s;\n' "$_MDL_RELEASE"
  printf '  const REUSE = %s;\n' "$_MDL_REUSE"
  # look(): VIS01..VIS04 all `off` in tests/rulebook turns the measuring off; MDL_VISUAL_REVIEW=agent adds screenshots.
  printf '  const VISUAL = %s;\n' "$([ "$(_mdl_visual_mode)" = "0" ] && echo false || echo true)"
  printf '  const VISUAL_DIR = %s;\n' "$(mdl_json_string "$(_mdl_visual_dir)")"
  printf '  const TEST_NAME = %s;\n' "$(mdl_json_string "$(_mdl_test_name)")"
  # vars.<NAME>: every SV_<NAME> shell variable, JSON-encoded -- `SV_PW="$pw" scenario '...'`, then
  # vars.PW in the body. Splicing '"$var"' into the body cost three models minutes each.
  local name pairs=()
  for name in $(compgen -v SV_ 2>/dev/null); do
    pairs+=("${name#SV_}" "${!name}")
  done
  printf '  const vars = JSON.parse(%s);\n' "$(mdl_json_string "$(mdl_json_object ${pairs[@]+"${pairs[@]}"})")"
}

# MDL_FILM_PACE_MS (tests/film.sh): before each click, fill, key press or pick the pointer goes to
# the element, and the action is followed by a pause, so a film can be followed by eye. The pace
# lives on the Locator and Page prototypes in playwright-cli's process, which outlive this run, so
# every scenario sets it -- 0 outside a film, and the wrappers then call straight through.
_mdl_js_film_pace() {
  printf '  const FILM_PACE = %s;\n' "$(mdl_json_number "${MDL_FILM_PACE_MS:-0}" 0)"
  cat <<'PACE'
  const pageProto = Object.getPrototypeOf(page);
  for (const proto of [Object.getPrototypeOf(page.locator('body')), pageProto]) {
    proto.__mdlFilmPace = FILM_PACE;
    if (proto.__mdlFilmPaced) continue;
    proto.__mdlFilmPaced = true;
    const onPage = proto === pageProto;
    for (const name of ['click', 'dblclick', 'tap', 'fill', 'type', 'pressSequentially', 'press',
                        'selectOption', 'check', 'uncheck', 'setChecked']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = async function (...args) {
        const ms = proto.__mdlFilmPace;
        if (!ms) return original.apply(this, args);
        const pg = onPage ? this : this.page();
        // The film's step list: the verb and the element's label -- never a typed value.
        const target = onPage ? pg.locator(args[0]).first() : this;
        // Its own name first; an unnamed control (a combo box's empty input) takes its field's label.
        const label = await target.evaluate(el => {
          const t = v => String(v || '').replace(/\s+/g, ' ').trim();
          const byId = id => t(id && document.getElementById(id) && document.getElementById(id).innerText);
          const field = el.closest('.form-group, .mx-formgroup');
          const fieldLabel = field && field.querySelector('label') ? t(field.querySelector('label').innerText) : '';
          return (t(el.getAttribute('aria-label')) || byId(el.getAttribute('aria-labelledby')) ||
            (el.labels && el.labels[0] ? t(el.labels[0].innerText) : '') || t(el.getAttribute('placeholder')) ||
            t(el.innerText) || t(el.getAttribute('title')) || fieldLabel).slice(0, 60);
        }, null, {timeout: 1000}).catch(() => '');
        const key = onPage ? args[1] : args[0];
        const verb = {click: 'Click', dblclick: 'Double-click', tap: 'Tap', fill: 'Type in', type: 'Type in',
          pressSequentially: 'Type in', press: `Press ${key}${label ? ' in' : ''}`, selectOption: 'Choose',
          check: 'Tick', uncheck: 'Untick', setChecked: 'Set'}[name];
        const steps = (pageProto.__mdlFilmSteps = pageProto.__mdlFilmSteps || []);
        const step = label ? `${verb} "${label}"` : verb;
        if (steps[steps.length - 1] !== step) steps.push(step);
        // The pointer travels to what is about to be used, then the action, then a pause.
        await (onPage ? this.hover(args[0], {timeout: 1500}) : this.hover({timeout: 1500})).catch(() => {});
        await pg.waitForTimeout(Math.round(ms / 2));
        const result = await original.apply(this, args);
        await pg.waitForTimeout(ms);
        return result;
      };
    }
  }
PACE
}

# The visual checks' mode from the rulebook (warn, error or 0), read once per test run.
_mdl_visual_mode() {
  printf '%s\n' "${_MDL_VISUAL_MODE:-$(mdl_rule_mode VIS01 VIS02 VIS03 VIS04 LOOK01 LOOK02)}"
}

# Where look() saves screenshots; empty unless MDL_VISUAL_REVIEW=agent.
_mdl_visual_dir() {
  [ "${MDL_VISUAL_REVIEW:-}" = "agent" ] && [ "$(_mdl_visual_mode)" != "0" ] || return 0
  mkdir -p "$APP_DIR/.mxcli/visual" 2>/dev/null && printf '%s' "$APP_DIR/.mxcli/visual"
}

# The running test's name: verify-050-customer-order for tests/verify-050-customer-order.test.sh.
_mdl_test_name() {
  local name
  name="$(basename "${0:-scenario}")"
  name="${name%.test.sh}"
  printf '%s' "${name//[^A-Za-z0-9_-]/_}"
}

# The JS helpers a body calls, from tests/scenario-helpers.js.
_mdl_js_helpers() {
  [ -f "$_MDL_LIB_DIR/scenario-helpers.js" ] \
    || fail "tests/scenario-helpers.js is missing -- re-run the installer"
  sed '1,/^\/\/ ---- helpers (lib.sh copies from the next line on) ----$/d' "$_MDL_LIB_DIR/scenario-helpers.js"
}

# The end of the try: the catch adds url, user and login message; the finally signs out.
_mdl_js_catch_and_sign_out() {
  cat <<'CATCH'
  } catch (e) {
    const url = page.url();  // synchronous in Playwright; do not await or .catch it
    // mx is absent on login.html, so asking for the user there throws. Neither
    // getUserName() nor getUserAttribute() exists on mx.session in 11.12 -- the
    // name sits in sessionData, as {value: 'demo_administrator'}. Measured.
    const who = await current_user();
    let why = String((e && e.message) || e).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
    // An open dialog is usually the cause ("Password has an issue: ...") and sits behind
    // the page text a timeout quotes, so it goes first.
    const dialog = await page.locator('.modal-dialog:visible, .mx-dialog:visible').allInnerTexts()
      .then(ts => ts.map(t => t.replace(/[\s×]+/g, ' ').replace(/ OK$/, '').trim()).filter(Boolean).join(' / '))
      .catch(() => '');
    if (dialog) why = 'open dialog: "' + dialog.slice(0, 300) + '" | ' + why;
    if (/selectOption/.test(why)) why += ' | a Mendix combo box is not a <select>: use pick_combo(widget, option)';
    // A refused sign-in leaves a message on the login page; without it the failure
    // reads as a plain selector timeout and says nothing about the cause.
    let note = '';
    if (/login/.test(url)) {
      note = await page.locator('.login-message, .alert, #loginMessage, .mx-validation-message').first()
        .innerText({timeout: 500}).then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '');
    }
    throw new Error(why + ' [on ' + url + (who ? ', signed in as ' + who : '') + (note ? ', page says: ' + note : '') + ']');
  } finally {
    // Release the session here, in-process, on success and on failure alike. Only
    // where there was a sign-in: with Security Level: Off there is no session to
    // end and no login page to wait for. The short wait lets the logout request
    // reach the runtime before the process ends -- a navigation right after
    // mx.logout() would cancel it and leave the session counted.
    if (RELEASE && PASSWORD) {
      try {
        await page.evaluate(() => { if (window.mx && window.mx.logout) window.mx.logout(); });
        await page.waitForSelector(LOGIN_FIELD, {timeout: 5000});
      } catch (e) {}
    }
    // The goto guard is this scenario's, not the page's: left in place it refused
    // the next hand-run `playwright-cli run-code` probe as a "mid-journey reload".
    page.goto = page.__mdl_raw_goto;
  }
CATCH
}

# _mdl_fail_on_scenario_error <output> -- fail() when playwright-cli reported an error or no result.
# playwright-cli prints its answer in sections headed "### Result" or "### Error".
_mdl_fail_on_scenario_error() {
  local output="$1"
  if printf '%s' "$output" | grep -q '^### Error'; then
    # Full block to stderr; a one-line summary in fail(), the only line verify reprints.
    printf '%s\n' "$output" | sed -n '/^### Error/,/^###/p' | head -8 >&2
    local why
    why="$(_mdl_error_summary "$output")"
    local refusal logged
    refusal="$(_licence_refusal || true)"
    logged="$(_runtime_errors_since "${_MDL_SCENARIO_START:-}")"
    fail "browser scenario failed: ${logged:+runtime logged during this test: $logged | }${why:-no error text}${refusal:+ -- $refusal}"
  fi
  # Neither marker. "### Ran Playwright code" means the code did run and simply returned nothing:
  # a session read the old "needs: playwright-cli open" hint for that case and went looking at
  # the browser instead of the missing `return` at the end of its scenario.
  if ! printf '%s' "$output" | grep -q '^### Result'; then
    if printf '%s' "$output" | grep -q '^### Ran Playwright code'; then
      fail "browser scenario returned nothing -- end the scenario body with a return, e.g. \`return {ok: true};\` (the checks above it ran; a scenario must return a value)"
    fi
    fail "browser scenario produced no result: $(printf '%s' "$output" | tr '\n' ' ' | tr -s ' ' | cut -c1-200) (running a test outside the runner needs: playwright-cli open)"
  fi
}

# _mdl_error_summary <output> -- the "### Error" text on one line, colours removed, at most 400 chars.
_mdl_error_summary() {
  printf '%s\n' "$1" \
    | sed -n '/^### Error/,/^### [A-Z]/p' | sed '1d;/^### /d' \
    | sed $'s/\033\[[0-9;]*m//g' | tr '\n' ' ' | tr -s ' ' | sed 's/^ //;s/ $//' | cut -c1-400
}

# _mdl_scenario_result <output> -- print the "### Result" section without blank lines.
_mdl_scenario_result() {
  local raw
  raw="$(printf '%s' "$1" | awk '/^### Result/{flag=1; next} /^### /{flag=0} flag' | sed '/^$/d')"
  case "$raw" in *__visual*) ;; *) printf '%s\n' "$raw"; return 0 ;; esac
  # What look() measured goes to .mxcli/visual/findings.jsonl for the gate; the test gets its own value.
  mkdir -p "$APP_DIR/.mxcli/visual" 2>/dev/null
  printf '%s' "$raw" | "$NODE" "$MDL_SHELL_HELPERS" scenario-result "$APP_DIR/.mxcli/visual/findings.jsonl" "$(_mdl_test_name)"
}
