/**
 * checks/plugins/command_guards.cjs -- the plugins' checks of a tool call that need no shell: what a
 * command reads, waits for, writes before an exec, and the messages a block carries.
 */

const { existsSync } = require("node:fs")
const { join } = require("node:path")

// The words that send a call to the guard: the same list as the `case` at the top of
// guard-harness-env.sh. The plugins (OpenCode, Pi) once missed the token and baseline words, so
// `echo $MENDIX_PAT` and `--write-baseline` reached the shell unguarded there (2026-10-17 review).
const GUARD_WORDS = /harness\.env|paths-baseline|mxcli\/applied|write-baseline|tests[\/\\]|mdl-checks|lint-rules|lint-config|settings\.local\.json|hooks\.json|extensions|plugin|\b(find|grep|egrep|fgrep|rg|ag|fd|mdfind|locate) |\/(System|Applications|Library|usr|opt|private|tmp|Users|home)\/|~\/|\$HOME|auth\.json|MENDIX_PAT|env|set|export|declare|marketplace-login-needed/

function mayTouchHarness(text) {
  return GUARD_WORDS.test(text)
}

// `...; sleep 12; bash tests/gate.sh` or `sleep 30; tail .mxcli/gate-boot.log`: the gate waits for
// the runtime and for --watch itself. Two Pi sessions did
// this anyway, against the rule file; a block says it at the moment it happens.
const SLEEP_BEFORE_GATE =
  "Blocked: drop the `sleep` -- tests/gate.sh waits for the runtime and for --watch to apply the latest change itself, and says so; a hand-rolled wait only adds seconds. Run the same command without it."

function isSleepBeforeGate(command) {
  return typeof command === "string" && /\bsleep\s+\d/.test(command)
    && /tests\/gate\.sh|gate-boot\.log|runtime\.log/.test(command)
}

// `grep -a 'parseDateTime' ./mxcli`: the binary is over 100 MB, and a room-booking session (2026-10-13)
// spent 13 of its 37 minutes in two such greps, looking for what a function and `show message` take.
const BINARY_SEARCH =
  "Blocked: that searches the mxcli binary (over 100 MB, minutes per search, and what it finds is not documentation). " +
  "What MDL accepts: `./mxcli syntax <topic>` and tools/mdl-checks/syntax-digest.md. Whether a function or a statement " +
  "works: write it into a two-line script and run `./mxcli check <script>.mdl -p <App>.mpr --references`; " +
  "what it does at runtime: a test of the feature, `bash tests/gate.sh --only <feature>`."

// The command searches or dumps the mxcli program file itself: one of the files it reads is mxcli.
// For grep and its kin the first word that is not an option is the pattern (`grep mxcli tests/x.sh`
// looks for the word, and passes), unless -e or -f gives it; strings, xxd, hexdump and od read every
// word. Redirections are not files: `strings -a mxcli 2>/dev/null | grep ...` went through when only
// the last word was looked at (file-image session, 2026-10-13).
const BINARY_TOOLS = /^(?:\S*\/)?(grep|egrep|fgrep|rg|ugrep|ag|strings|xxd|hexdump|od)$/
const MXCLI_FILE = /^(?:\.\/|\S*\/)?mxcli(?:\.exe)?$/
function isBinarySearch(command) {
  if (typeof command !== "string") return false
  // `2>&1`, `>&2` first, so the split on `&` below does not cut them in two.
  const text = command.replace(/\d*>&\d*/g, " ")
  return text.split(/\|\||&&|[|;&\n]/).some((part) => {
    const words = (part.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ""))
    const tool = BINARY_TOOLS.exec(words[0] || "")
    if (!tool) return false
    const args = []
    for (let i = 1; i < words.length; i++) {
      const w = words[i]
      if (/^\d*[<>]{1,2}$/.test(w)) { i++; continue }   // `> file`, `2> file`: the next word is the target
      if (/^\d*[<>]{1,2}\S/.test(w)) continue           // `2>/dev/null`, `>out.txt`
      args.push(w)
      // An option that takes a value (`-A 3`, `-m 1`, `--context 2`): the value is no file and no pattern.
      if (/^(?:-[ABCmd]|--(?:after|before)?-?context|--max-count)$/.test(w) && i + 1 < words.length) args.push("-" + words[++i])
    }
    const grepLike = !/^(strings|xxd|hexdump|od)$/.test(tool[1])
    const patternGiven = args.some((w) => /^-(?:[A-Za-z]*[ef]|-regexp|-file)/.test(w))
    let positional = args.filter((w) => !w.startsWith("-"))
    if (grepLike && !patternGiven) positional = positional.slice(1)
    return positional.some((w) => MXCLI_FILE.test(w))
  })
}

// The harness's own code: the gate, its checkers and hooks. A room-booking session (2026-10-13) read
// 21 of those files, 170 kB, "so the pages pass on the first try" -- context resent every turn, while
// what each check wants is written for it in tests/checks/<step>.md and every finding carries its fix.
const HARNESS_SOURCE =
  "Blocked: that reads the harness's own code (the gate, its checkers, its hooks). It is not the spec, and every " +
  "line read is resent with each turn. What a check wants and how to fix it: tests/checks/<step>.md, or " +
  "`bash tests/rules.sh explain <CODE>`; a finding of the gate names its fix. Build the feature, then run the gate."

// mxcodr/ is the bundle the installer leaves in the app: the same code, read there by a stock-catalog
// session after tools/mdl-checks/ was blocked (2026-10-13). Its cards and skills (.md) stay readable.
const SOURCE_PATH = /(?:^|[\s"'=(\/])(?:tools\/mdl-checks\/(?:[^\s"';|&)]*\.(?:cjs|js|sh)\b|layout_rules\b|hooks\b|plugins\b)|mxcodr\/(?:checks|hooks|plugins|install|tests)\/(?:[^\s"';|&)]*\.(?:cjs|js|sh|py)\b|layout_rules\b)|tests\/gate(?:\.sh\b|\/)|tests\/precheck\.sh\b)/
const READERS = /^(?:\S*\/)?(?:cat|head|tail|sed|awk|less|more|nl|bat|grep|egrep|fgrep|rg|ag|ugrep|wc|cut|strings|python3?|node)$/

// True when the call reads that code: a read tool on one of its files, or a shell step whose first
// word reads files (cat, sed, grep, ...) and names one. Running it (`bash tests/gate.sh`,
// `node tools/mdl-checks/x.cjs` with arguments that are not a read) passes.
function readsHarnessSource(tool, args) {
  if (!args) return false
  if (tool === "read" || tool === "Read" || tool === "view") {
    const path = String(args.path || args.filePath || args.file_path || "").replace(/\\/g, "/")
    return SOURCE_PATH.test(" " + path)
  }
  if (tool !== "bash" || typeof args.command !== "string") return false
  return args.command.split(/\|\||&&|[|;&\n]/).some((part) => {
    const words = part.trim().replace(/^(?:do|then|else|\{|\()\s+/, "").split(/\s+/)
    if (!READERS.test(words[0] || "")) return false
    // `node tools/mdl-checks/x.cjs ...` runs a checker; `node -e "...readFileSync(...)"` reads one.
    if (/^(?:\S*\/)?(?:node|python3?)$/.test(words[0]) && !/^-[ec]$/.test(words[1] || "")) return false
    return SOURCE_PATH.test(" " + words.slice(1).join(" "))
  })
}

// After a new test file is written: run it now, while the feature it checks does not exist yet.
// Two room-booking sessions (2026-10-13) wrote five to seven tests at once, built every feature,
// and only then ran them -- green; proving each red afterwards took a break-and-undo per test, 5 and
// 19 minutes. A red run before the feature costs one gate run for all of them.
function newTestNote(root, tool, args) {
  if (!args) return ""
  let path = ""
  if (/^(write|Write|create|edit|Edit|MultiEdit|edit_file|write_file)$/.test(String(tool))) {
    path = String(args.path || args.filePath || args.file_path || args.target_file || "")
  } else if (/^(bash|Bash|shell|run_terminal_cmd)$/.test(String(tool)) && typeof args.command === "string") {
    // `cat > tests/verify-x.test.sh <<'EOF'`, `tee tests/verify-x.test.sh`: a test written from the shell.
    const w = /(?:>|\btee\s+(?:-a\s+)?)\s*["']?((?:[^\s"';|&<>]*\/)?tests\/verify-[^\s"';|&<>/]+\.test\.sh)/.exec(args.command)
    path = w ? w[1] : ""
  }
  const m = /(?:^|\/)tests\/(verify-[^/]+)\.test\.sh$/.exec(path.replace(/\\/g, "/"))
  if (!m) return ""
  const red = join(root, ".mxcli", "red-first", m[1])
  if (existsSync(red) || existsSync(red + ".green")) return ""
  return `${m[1]} has not run yet: run it now, before building what it checks -- ` +
    `\`bash tests/gate.sh --only ${m[1].replace(/^verify-/, "")}\` (several new tests: one \`bash tests/gate.sh --tests-only\`) ` +
    "records its red run in seconds. Once the feature exists, proving a test red takes a break-and-undo of the feature."
}

// `for f in a b; do mxcli exec mdlsource/$f.mdl`: the scripts are a variable, so precheck sees none.
// A blocked command runs none of its steps: GLM sent `python3 <edit> ... ; ./mxcli exec` seven
// times, was blocked before the edit ran, and debugged an edit that was never applied.
const STEPS_BEFORE_EXEC =
  "Nothing in this command ran, the steps before the exec included (an edit there never happened): the script was checked as it is on disk. Run those steps on their own, then the exec as its own command.\n"
// A step that reads and writes nothing -- `./mxcli check`, head, tail, grep, wc, ls, cat or echo with
// no redirection into a file: "an edit there never happened" sent Qwen 3.6 after an edit it had
// never made when only `./mxcli check ... | head` stood before the exec (2026-10-15).
function readOnlyStep(step) {
  if (/(^|[^0-9&])>/.test(step.replace(/[12]?>&[12]/g, ""))) return false
  return /^((\.\/)?mxcli(\.exe)?\s+(check|syntax)\b|(head|tail|grep|wc|ls|cat|echo)\b|sed\s+-n\b)/.test(step)
}
function stepsBeforeExec(command) {
  const m = /(?:^|[\s;&|(])(?:\.\/)?mxcli(?:\.exe)?\s+exec\b/.exec(command || "")
  if (!m) return false
  const trivial = /^((export\s+)?[A-Za-z_]\w*=("[^"]*"|'[^']*'|\S*)\s*)*$|^cd\s+\S+$/
  return command.slice(0, m.index).split(/&&|\|\||[;|\n]/).some((step) => !trivial.test(step.trim()) && !readOnlyStep(step.trim()))
}

// A step before the exec that writes one of its scripts (an edit, a move, a new file): the precheck
// runs before the command, so it checked the old file -- or, for a file the step creates, found none
// and let the exec through unchecked. A DeepSeek session ran `mv 05b.mdl 04c.mdl && mxcli exec
// 04c.mdl` and a python heredoc edit followed by the exec; the second put four build errors into
// the model. A step that only reads the script (grep, cat) is fine.
const WRITES_BEFORE_EXEC = /<<|(^|[\s;&|(])(mv|cp|tee|rm|ln|rsync|install|patch|ed|perl|python3?|node|ruby|git)\s|(^|[\s;&|(])sed\s+(-[a-zA-Z]*\s+)*-i/
// A command that writes one script with a quoted heredoc and execs it, and nothing else:
//   [mkdir -p d &&] cat > mdlsource/x.mdl <<'EOF' ... EOF [&&|;|newline] ./mxcli exec mdlsource/x.mdl [-p ...] [| tail ...]
// `cat >>` (an addition to a script, then its exec) is the same shape (room-booking s1, 2026-10-15).
// The hook writes the file itself (the same bytes the command writes a moment later), prechecks it
// and lets the command through: one call per script instead of two (27 refusals in two B2B runs,
// 21 of them this shape, 2026-10-15). An unquoted delimiter is refused: the shell would expand
// every $Var of the MDL. Only a .mdl outside the harness's own folders, so the guard keeps its say.
// Returns { path, body } for the shape, { unquoted: path } for the unquoted one, else null.
const HEREDOC_SCRIPT = /^(?:\s*(?:mkdir\s+-p\s+\S+|cd\s+\S+|(?:export\s+)?[A-Za-z_]\w*=\S*)\s*(?:&&|;|\n)\s*)*cat\s+(?:(>>?)\s*(\S+)\s+<<\s*(['"]?)([A-Za-z_]\w*)\3|<<\s*(['"]?)([A-Za-z_]\w*)\5\s+(>>?)\s*(\S+))[ \t]*\n([\s\S]*?)\n\4?\6?[ \t]*\n\s*(?:&&|;)?\s*(?:\.\/)?mxcli(?:\.exe)?\s+exec\s+(\S+)(?:\s+-p\s+\S+)?(?:\s+2>&1)?(?:\s*\|\s*(?:tail|head|grep|cut|sed\s+-n)[^\n;&|]*)?\s*$/
const HARNESS_FOLDERS = /^(tests|tools|mxcodr|\.claude|\.cursor|\.codex|\.opencode|\.pi|\.agents|\.ai-context)(\/|$)/
function heredocScript(command) {
  const m = HEREDOC_SCRIPT.exec(command || "")
  if (!m) return null
  const path = m[2] || m[8], quote = m[2] ? m[3] : m[5], append = (m[2] ? m[1] : m[7]) === ">>", execPath = m[10]
  if (!path || path !== execPath || !/\.mdl$/.test(path)) return null
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..") || HARNESS_FOLDERS.test(path)) return null
  if (!quote) return { unquoted: path }
  return { path, body: m[9] + "\n", append }
}
const HEREDOC_UNQUOTED = (path) =>
  "Blocked: the heredoc that writes " + path + " has an unquoted delimiter, so the shell would expand every $Variable of the MDL " +
  "before mxcli saw it. Write it as `cat > " + path + " <<'EOF'` (quoted), then the exec may stay in the same command."

function scriptWrittenBeforeExec(command, scripts) {
  const m = /(?:^|[\s;&|(])(?:\.\/)?mxcli(?:\.exe)?\s+exec\b/.exec(command || "")
  if (!m) return null
  const before = command.slice(0, m.index)
  const name = (script) => script.split("/").pop()
  const mentions = (script) => before.includes(script) || before.includes(name(script))
  // `> x.mdl` writes it; `2>/dev/null` next to a `grep x.mdl` does not.
  const redirected = (script) => new RegExp(">>?\\s*\\S*" + name(script).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(before)
  const hit = scripts.find((script) => redirected(script) || (WRITES_BEFORE_EXEC.test(before) && mentions(script)))
  if (!hit) return null
  return (
    "Blocked: a step before the exec writes " + hit + " (an edit, a move or a new file), and the " +
    "precheck runs before the command -- it would check the old file, or none. Nothing in this " +
    "command ran. Run that step on its own, then `./mxcli exec " + hit + "` as its own command."
  )
}

// `$PWD/mdlsource/x.mdl` is the project itself, not a loop variable.
function resolvePwd(root, script) {
  return script.replace(/^(\$\{PWD\}|\$PWD|\$\(pwd\))(?=\/)/, root.replace(/\\/g, "/"))
}

const EXEC_THROUGH_VARIABLE =
  "Blocked: that exec names its script through a variable (`$f.mdl` in a loop), so the precheck cannot see which script runs and the model would change unchecked. Exec each script by its own path, one command per script: ./mxcli exec mdlsource/41_pages.mdl -p App.mpr"

// MDL given to mxcli with -c that changes the model: CREATE, ALTER, DROP, GRANT, REVOKE, MOVE,
// RENAME. It went round the precheck, and one broken access rule written that way blocked every
// later exec with an error that was not in its script.
const WRITE_MDL = /^\s*(create|alter|drop|grant|revoke|move|rename)\b/i
function inlineMdl(command) {
  if (typeof command !== "string" || !/mxcli(\.exe)?\b/.test(command)) return []
  // Only the -c of mxcli itself, as hook_tool.cjs inline-mdl reads it: `grep -c "drop microflow" x.mdl`
  // in the same command was taken for MDL and blocked a read-only command (InvoiceChaseReq, 2026-10-12).
  const words = command.match(/"(?:[^"\\]|\\.)*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|&]+/g) || []
  const found = []
  let seenMxcli = false
  words.forEach((word, i) => {
    if (/(^|\/)mxcli(\.exe)?$/.test(word)) seenMxcli = true
    else if ([";", "|", "&&", "||", "\n"].includes(word)) seenMxcli = false
    else if (seenMxcli && word === "-c" && i + 1 < words.length) {
      const raw = words[i + 1]
      const text = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(["\\$`])/g, "$1")
        : raw.startsWith("'") ? raw.slice(1, -1) : raw
      if (WRITE_MDL.test(text)) found.push(text)
    }
  })
  return found
}

function isMxcliExec(command) {
  return typeof command === "string" && /mxcli(\.exe)? exec/.test(command)
}

// The .mdl words of a bash command, quotes stripped; a glob passes through unchecked. A microflow
// test (`*.test.mdl`) is never an exec script.
function mdlScripts(command) {
  const words = command.match(/"[^"]*"|'[^']*'|\S+/g) || []
  const scripts = words
    .map((word) => word.replace(/^["']|["']$/g, ""))
    .filter((word) => word.endsWith(".mdl") && !word.endsWith(".test.mdl"))
  return [...new Set(scripts)]
}

module.exports = {
  GUARD_WORDS, mayTouchHarness,
  SLEEP_BEFORE_GATE, isSleepBeforeGate, BINARY_SEARCH, isBinarySearch, HARNESS_SOURCE, readsHarnessSource,
  newTestNote, STEPS_BEFORE_EXEC, readOnlyStep, stepsBeforeExec, heredocScript, HEREDOC_UNQUOTED,
  scriptWrittenBeforeExec, resolvePwd, EXEC_THROUGH_VARIABLE, inlineMdl, isMxcliExec, mdlScripts,
}
