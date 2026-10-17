/**
 * checks/plugins/request_archive.cjs -- what the plugins keep of a session: its id, and each request
 * the person makes, word for word, in the project brain.
 */

const { spawnSync } = require("node:child_process")
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmdirSync } = require("node:fs")
const { join, dirname } = require("node:path")

// The agent session's id into .mxcli/session.id (tests/db-snapshot.sh: one database snapshot per
// session, rolled back after its first DONE). Written only when it changed.
function markSession(root, id) {
  const safe = String(id || "").replace(/[^A-Za-z0-9._-]/g, "")
  if (!root || !safe) return
  try {
    const file = join(root, ".mxcli", "session.id")
    if (existsSync(file) && readFileSync(file, "utf8") === safe) return
    mkdirSync(join(root, ".mxcli"), { recursive: true })
    writeFileSync(file, safe)
  } catch { /* not ours to fail on */ }
}

// Each request the person makes, word for word, in docs/brain/requests/NN.md: a session per request
// sees only the model and the plan, and the details an agent did not record as requirements -- one
// Employee, one Manager and two customers; a filter bar above the table -- were lost between sessions
// in two B2B runs (2026-10-15). A short reply ("go ahead") is not a request; a repeat is not saved twice.
const REQUEST_MIN_CHARS = 80
// docs/brain/ is mxcli's: `mxcli brain init` refuses a docs/brain/ it did not write (its README.md
// carries <!-- mxcli-brain -->). The archive below made one before init had run, so a later init
// failed and a session cleared it with `rm -rf docs/brain`, archive and all (Qwen3.8-27B, 2026-10-17).
// Run init first; a docs/brain/ that holds only the archive is set aside for it and put back.
function brainReady(root, mpr) {
  const brain = join(root, "docs", "brain")
  try { if (readFileSync(join(brain, "README.md"), "utf8").includes("<!-- mxcli-brain -->")) return true } catch {}
  const bin = [join(root, "mxcli.exe"), join(root, "mxcli")].find((b) => existsSync(b))
  if (!bin) return false
  let aside = null
  if (existsSync(brain)) {
    const entries = readdirSync(brain)
    if (entries.some((n) => n !== "requests")) return false
    if (entries.includes("requests")) {
      aside = join(root, ".mxcli", "requests-aside-" + process.pid)
      mkdirSync(dirname(aside), { recursive: true })
      renameSync(join(brain, "requests"), aside)
    }
    rmdirSync(brain)
  }
  spawnSync(bin, ["brain", "init", "-p", join(root, mpr)], { cwd: root, timeout: 30000, stdio: "ignore" })
  if (aside) {
    mkdirSync(brain, { recursive: true })
    renameSync(aside, join(brain, "requests"))
  }
  return existsSync(join(brain, "README.md"))
}

function saveRequest(root, text) {
  const body = String(text || "").trim()
  if (!root || body.length < REQUEST_MIN_CHARS) return null
  // A host's own message in the prompt slot is not the person's request: Claude Code hands a finished
  // background task back as <task-notification>, and b2b-f4 archived two of them (2026-10-16).
  if (/^<(task-notification|system-reminder|local-command|command-name|bash-|user-prompt-submit)/i.test(body)) return null
  try {
    const mpr = readdirSync(root).find((n) => n.endsWith(".mpr"))
    if (!mpr) return null
    brainReady(root, mpr)
    const dir = join(root, "docs", "brain", "requests")
    mkdirSync(dir, { recursive: true })
    const files = readdirSync(dir).filter((n) => /^\d+\.md$/.test(n)).sort()
    const last = files.length ? readFileSync(join(dir, files[files.length - 1]), "utf8") : ""
    if (last.split("\n\n").slice(1).join("\n\n").trim() === body) return null
    const n = String(files.length + 1).padStart(2, "0")
    const file = join(dir, n + ".md")
    writeFileSync(file, "# Request " + n + " -- " + new Date().toISOString().slice(0, 10) + "\n\n" + body + "\n")
    return file
  } catch {
    return null
  }
}

module.exports = { markSession, brainReady, saveRequest }
