/**
 * checks/plugins/bash_runner.cjs -- the bash every hook step of the plugins runs through. On Windows
 * Git Bash is probed once, when the module loads.
 */

const { spawnSync } = require("node:child_process")
const { existsSync } = require("node:fs")

// Windows: Git Bash is often not on a GUI process's PATH, so probe the install directories too.
function resolveBash() {
  if (process.platform !== "win32") return "bash"
  // PATH last: its first bash.exe is often System32's WSL launcher.
  const candidates = [
    `${process.env.ProgramFiles || "C:\\Program Files"}\\Git\\bin\\bash.exe`,
    `${process.env["ProgramFiles(x86)"] || ""}\\Git\\bin\\bash.exe`,
    `${process.env.LOCALAPPDATA || ""}\\Programs\\Git\\bin\\bash.exe`,
    "bash.exe",
  ]
  for (const candidate of candidates) {
    if (candidate !== "bash.exe" && !existsSync(candidate)) continue
    const probe = spawnSync(candidate, ["-c", "exit 0"], { timeout: 15000 })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
}

const BASH = resolveBash()
const NO_BASH =
  "The Mendix harness runs its checks as bash scripts, and no bash was found. " +
  "Install Git for Windows and make sure bash.exe is on the PATH."

// command: argv array or `bash -c` string; timeout in ms. Returns { status, out }; never throws.
function run(command, cwd, timeout, input) {
  if (!BASH) return { status: 1, out: NO_BASH }
  // -c, not -lc: a login shell re-reads the profile (moves cwd, reorders PATH, slow).
  // Paths go as argv, never quoted into -c: a directory named $(...) would run code.
  const argv = Array.isArray(command) ? command : ["-c", command]
  const result = spawnSync(BASH, argv, {
    cwd,
    input,
    timeout: timeout ?? 120000,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
  return {
    status: result.status ?? 1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  }
}

module.exports = { resolveBash, run }
