# install/step_harness.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Steps 15-16: install the test harness, record the install, check the environment. Runs as it is read.

# --- 15. Step: install the test harness ---
# Core scripts are upgraded in place; other files are copied only when absent. verify-*.test.sh are the app's own.
ui_begin "installing the test harness"
mkdir -p "$APP/tests"
suite_written=0
for source_file in "$SRC"/tests/*; do
  name="$(basename "$source_file")"
  target="$APP/tests/$name"
  case "$name" in
    gate.sh|orient.sh|diagnose.sh|precheck.sh|peek.sh|lib.sh|portable.sh|scenario-helpers.js|run-docker.sh|gate|lib) ;;
    *) if [ -e "$target" ]; then continue; fi ;;
  esac
  if [ -d "$source_file" ]; then
    # tests/gate/ and tests/lib/: the parts of gate.sh and lib.sh, upgraded in place like them.
    mkdir -p "$target" && cp -R "$source_file"/. "$target"/
    suite_written=$((suite_written + 1))
    continue
  fi
  cp "$source_file" "$target"
  chmod +x "$target" 2>/dev/null || true
  suite_written=$((suite_written + 1))
done

# Rewrite old test comparisons against True/False: lib.sh's field() now prints true/false.
migrated=""
for script in "$APP"/tests/verify-*.test.sh; do
  [ -f "$script" ] || continue
  if grep -qE '= "(True|False)"' "$script" 2>/dev/null; then
    perl -pi -e 's/= "True"/= "true"/g; s/= "False"/= "false"/g' "$script" 2>/dev/null \
      && migrated="$migrated $(basename "$script")"
  fi
done
[ -z "$migrated" ] || ui_note "field() booleans are now true/false; rewrote the comparison in:$migrated"

# LF line endings: CRLF breaks bash scripts.
if [ ! -e "$APP/.gitattributes" ] && [ -f "$SRC/.gitattributes" ]; then
  cp "$SRC/.gitattributes" "$APP/.gitattributes"
fi
ui_done "test harness" "$suite_written $I_ARROW tests/  (verify-*.test.sh left alone)"

# The syntax digest, now rather than at the first orient: Claude Code reads .claude/rules/ only
# when a session starts, so a digest written during the first session would reach only the
# second. Same function orient.sh calls; best effort -- a missing or old mxcli skips it.
if [ -x "$APP/mxcli$EXE" ] && [ -f "$APP/tests/portable.sh" ]; then
  ( cd "$APP" && MXCLI="./mxcli$EXE" && . tests/portable.sh && mdl_syntax_digest ) >/dev/null 2>&1 || true
fi

# --- 16. Step: record the install, then check the environment ---
# INSTALL.json lets the gate detect stale or locally edited harness files.
ui_begin "recording the install"
recorded="$("$PY" "$APP/tools/mdl-checks/record_install.py" "$APP" "$SRC" "$version" 2>/dev/null || true)"
ui_done "install record" "${recorded:-0} files $I_ARROW tools/mdl-checks/INSTALL.json"

ui_begin "checking the environment"

# Repair a .playwright/cli.config.json that pins chromium to a path that does not exist.
playwright_config="$APP/.playwright/cli.config.json"
browser_fixed=""
if [ -f "$playwright_config" ]; then
  browser_fixed="$("$PY" - "$playwright_config" <<'PY_BROWSER'
import glob, json, os, sys

path = sys.argv[1]
try:
    config = json.load(open(path))
except Exception:
    sys.exit(0)
options = config.get("browser", {}).get("launchOptions", {})
current = options.get("executablePath")
if not current or os.path.exists(current):
    sys.exit(0)
# Prefer a headless shell Playwright has already downloaded; otherwise let it choose.
roots = [
    os.path.expanduser("~/Library/Caches/ms-playwright"),   # macOS
    os.path.expanduser("~/.cache/ms-playwright"),           # Linux
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright"),  # Windows
]
candidates = []
for root in roots:
    if not root:
        continue
    for suffix in ("chrome-headless-shell", "chrome-headless-shell.exe"):
        candidates += sorted(glob.glob(os.path.join(
            root, "chromium_headless_shell-*", "chrome-headless-shell-*", suffix)))
if candidates:
    options["executablePath"] = candidates[-1]
    replacement = candidates[-1]
else:
    options.pop("executablePath", None)
    replacement = "Playwright's own browser"
json.dump(config, open(path, "w"), indent=2)
print("%s -> %s" % (current, replacement))
PY_BROWSER
)"
fi

# Report a missing mxbuild for the project's version now, not halfway through a gate.
mxbuild_note=""
mxbuild_note="$("$PY" - "$APP" "$IS_WINDOWS" <<'PY_MXBUILD'
import glob, os, sqlite3, sys

app = sys.argv[1]
mprs = glob.glob(os.path.join(app, "*.mpr"))
if not mprs:
    sys.exit(0)
try:
    con = sqlite3.connect("file:%s?mode=ro" % mprs[0], uri=True)
    version = con.execute("select * from _MetaData limit 1").fetchone()[1]
except Exception:
    sys.exit(0)
cached = os.path.expanduser("~/.mxcli/mxbuild/%s" % version)
if sys.argv[2] == "1":
    # Studio Pro installs in two places; 10.x and 11.x default to the per-user one.
    roots = [os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "Mendix"),
             os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Mendix")]
    cached = ""
    for root in roots:
        if not root:
            continue
        candidate = os.path.join(root, version, "modeler")
        if os.path.isdir(candidate):
            cached = candidate
            break
    cached = cached or os.path.join(roots[0], version, "modeler")
if not os.path.isdir(cached):
    if os.name == "nt" or sys.argv[2] == "1":
        print("Mendix %s: `mx check` needs Studio Pro %s -- the Mendix CDN's mxbuild is "
              "Linux-only, so `mxcli setup mxbuild` cannot help here." % (version, version))
    else:
        print("Mendix %s, no mxbuild cached -- `mx check` will not run until: "
              "./mxcli setup mxbuild -p %s" % (version, os.path.basename(mprs[0])))
PY_MXBUILD
)"

ui_done "environment" "checked"
