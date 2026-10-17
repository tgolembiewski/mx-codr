/**
 * checks/plugins/harness-core.cjs -- what the OpenCode plugin and the Pi extension share: the bash
 * runner, the guard call, the decisions before and after an `mxcli exec`, the reminder and the
 * gate's follow-up message. Installed as tools/mdl-checks/plugins/harness-core.cjs; the two
 * plugins load it with createRequire from either place (the bundle, or an installed project).
 * CommonJS, so no top-level await or bundler-specific ESM feature is needed in the hosts' loaders.
 *
 * The parts live beside it: bash_runner.cjs, command_guards.cjs, request_archive.cjs and
 * gate_verdict.cjs. This file decides, and exports what the plugins call from all of them.
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs")
const { join, dirname } = require("node:path")
const { run } = require("./bash_runner.cjs")
const {
  mayTouchHarness, SLEEP_BEFORE_GATE, isSleepBeforeGate, BINARY_SEARCH, isBinarySearch, HARNESS_SOURCE,
  readsHarnessSource, newTestNote, STEPS_BEFORE_EXEC, readOnlyStep, stepsBeforeExec, heredocScript, HEREDOC_UNQUOTED,
  scriptWrittenBeforeExec, resolvePwd, EXEC_THROUGH_VARIABLE, inlineMdl, isMxcliExec, mdlScripts,
} = require("./command_guards.cjs")
const { markSession, saveRequest } = require("./request_archive.cjs")
const {
  MAX_GATE_ROUNDS, GATE_DONE, GATE_TIMEOUT_MS, OUTPUT_LIMIT,
  filmsRecording, personOnly, personOnlyMessage, gateFailureMessage, reminder,
} = require("./gate_verdict.cjs")

const PRECHECK_TIMEOUT_MS = 180000

// guard-harness-env.sh: the session may not change what judges it -- tests/harness.env, the
// harness's own checkers and scripts, the hook configs. The reason, or null.
function harnessEnvBlocked(root, tool, args) {
  const text = JSON.stringify(args ?? {})
  if (!mayTouchHarness(text)) return null
  const guard = join(root, "tools", "mdl-checks", "hooks", "guard-harness-env.sh")
  if (!existsSync(guard)) return null
  const payload = JSON.stringify({ tool_name: tool, tool_input: args ?? {} })
  const { status, out } = run([guard.replace(/\\/g, "/")], root, 30000, payload)
  return status === 2 ? out : null
}

// Writes the heredoc's script so the precheck checks what the command is about to exec.
function writeHeredocScript(root, found) {
  const file = join(root, found.path)
  mkdirSync(dirname(file), { recursive: true })
  // `cat >>`: the script grows by the heredoc, as the command would grow it.
  writeFileSync(file, (found.append && existsSync(file) ? readFileSync(file, "utf8") : "") + found.body)
}

// The app needs a Marketplace module and mxcli is not logged in: tests/marketplace-login.sh holds
// every build, gate and Marketplace call back until the person has run ./mxcli auth login.
const MARKETPLACE_CALL = /mxcli(\.exe)? (exec|marketplace|catalog)\b|(^|[\s;&|(])(bash|sh)\s+(\.\/)?tests\/gate\.sh|(^|[\s;&|(])\.\/tests\/gate\.sh/
function marketplaceWait(root, command) {
  if (typeof command !== "string" || !MARKETPLACE_CALL.test(command)) return null
  const script = join(root, "tests", "marketplace-login.sh")
  if (!existsSync(script)) return null
  const { status, out } = run([script.replace(/\\/g, "/"), "before", command], root, 30000)
  return status === 3 && out ? out.trim() : null
}

// True while a Marketplace login is pending: the end-of-turn gate then stays quiet, so the session
// stops and waits for the person. A DeepSeek session asked for the login and stopped; the gate
// failed at the end of its turn, sent it back to work, and it went looking for a way round.
function marketplacePending(root) {
  return marketplaceWait(root, "bash tests/gate.sh") !== null
}

// The decision before a bash call: a reason to block, or null. Shared word for word by the
// OpenCode plugin (throws it) and the Pi extension (returns { block, reason }).
function blockReason(root, tool, args) {
  const blocked = harnessEnvBlocked(root, tool, args)
  if (blocked) return blocked
  if (readsHarnessSource(tool, args)) return HARNESS_SOURCE
  if (tool !== "bash") return null
  const command = args && args.command
  if (isSleepBeforeGate(command)) return SLEEP_BEFORE_GATE
  if (isBinarySearch(command)) return BINARY_SEARCH
  const waiting = marketplaceWait(root, command)
  if (waiting) return waiting
  const inline = inlineMdl(command)
  if (!isMxcliExec(command) && inline.length === 0) return null
  const precheck = join(root, "tests", "precheck.sh")
  if (!existsSync(precheck)) return null
  const scripts = (isMxcliExec(command) ? mdlScripts(command) : []).map((script) => resolvePwd(root, script))
  if (scripts.length === 0 && inline.length === 0) return null
  if (scripts.some((script) => script.includes("$"))) return EXEC_THROUGH_VARIABLE
  const heredoc = heredocScript(command)
  if (heredoc && heredoc.unquoted) return HEREDOC_UNQUOTED(heredoc.unquoted)
  if (heredoc) writeHeredocScript(root, heredoc)
  else {
    const written = scriptWrittenBeforeExec(command, scripts)
    if (written) return written
  }
  const inlineArgs = inline.flatMap((text) => ["--inline", text])
  const { status, out } = run([precheck.replace(/\\/g, "/"), "--for-exec", ...scripts, ...inlineArgs], root, PRECHECK_TIMEOUT_MS)
  if (status === 0 || out.includes("precheck: could not run")) return null
  return (
    // The same head as the shell hooks (hooks/before-mxcli-exec-core.sh): a build error, a document
    // created twice (SCRIPT01) and a page with no test yet (TEST01) all land here.
    "Blocked by the precheck (nothing changed in the model). Do what it says below, then exec again:\n" +
    (stepsBeforeExec(command) && !heredoc ? STEPS_BEFORE_EXEC : "") + out.slice(-OUTPUT_LIMIT)
  )
}

// After an `mxcli exec`: what after-mxcli-exec.sh adds to the tool result (the exec footer with the
// restart advice and the coverage report), or null.
function afterExecText(root, command, output) {
  const hook = join(root, "tools", "mdl-checks", "hooks", "after-mxcli-exec.sh")
  if (!existsSync(hook)) return null
  // Forward slashes: bash treats backslashes as escapes. Claude-shaped payload with the real
  // command, so the restart advice sees the scripts, and the tool output, so the hook can say in
  // one line whether the exec applied.
  const payload = JSON.stringify({ tool_input: { command }, tool_response: { output: output || "" } })
  const { out } = run([hook.replace(/\\/g, "/")], root, undefined, payload)
  return out || null
}

// What the plugins and hook_tool.cjs call, from this file and its parts.
module.exports = {
  MAX_GATE_ROUNDS, GATE_DONE, GATE_TIMEOUT_MS,
  run, harnessEnvBlocked, blockReason, afterExecText, writeHeredocScript, marketplacePending,
  mayTouchHarness, readOnlyStep, isSleepBeforeGate, isBinarySearch, BINARY_SEARCH, readsHarnessSource, HARNESS_SOURCE,
  newTestNote, stepsBeforeExec, STEPS_BEFORE_EXEC, EXEC_THROUGH_VARIABLE, scriptWrittenBeforeExec, heredocScript,
  HEREDOC_UNQUOTED, resolvePwd, inlineMdl, isMxcliExec, mdlScripts,
  markSession, saveRequest,
  filmsRecording, gateFailureMessage, reminder, personOnly, personOnlyMessage,
}
