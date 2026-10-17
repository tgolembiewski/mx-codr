# install/compaction.sh -- part of install.sh, which sources the parts in order; never run it on its own.
#
# When the coding agents summarize (compact) their conversation. Each tool call re-reads the whole
# conversation, and a host that compacts only near the model's window re-reads up to ~245k tokens a
# turn on DeepSeek's 262k window. Compacting at 70% of the window, measured on InvoiceChase
# (2026-10-12, Pi, DeepSeek 4.1 Flash): 17.5M tokens against 25.7M, 153 turns against 173, as many
# requirements and tests -- but the second run at 70% (G8) took 252 turns and 26.9M tokens: each
# compaction the model has to rebuild what it knew, and the turns it adds can eat the saving. Lower
# (~47%, G6) it lost its thread. Not proven, so off unless the person turns it on: the installer
# asks (no by default), remembers the answer in tests/harness.env (MDL_COMPACTION=on|off) and writes
# each host's own setting only where the person has not set one.
# Pi only, for now: Claude Code (`autoCompactWindow`) and Codex (`model_auto_compact_token_limit`)
# take a token count, not a share of the window, and the installer does not know which model the
# person will run there; neither was measured. OpenCode and Cursor document no threshold.

# choose_compaction -- sets COMPACTION to on or off. MDL_COMPACTION in the environment wins, then the
# answer an earlier install kept in tests/harness.env; otherwise the person is asked (no by default;
# with no terminal, or MDL_ASSUME_YES, off).
choose_compaction() {
  local saved reply
  COMPACTION="off"
  case "${MDL_COMPACTION:-}" in
    on|off) COMPACTION="$MDL_COMPACTION"; return 0 ;;
  esac
  saved=""
  if [ -f "$APP/tests/harness.env" ]; then
    saved="$(sed -nE 's/^[[:space:]]*MDL_COMPACTION=["'"'"']?(on|off).*/\1/p' "$APP/tests/harness.env" 2>/dev/null | tail -1)" || saved=""
  fi
  if [ -n "$saved" ]; then COMPACTION="$saved"; return 0; fi
  if [ ! -t 0 ] || [ -n "${MDL_ASSUME_YES:-}" ]; then return 0; fi
  printf '  Let Pi summarize its conversation at 70%% of the model'"'"'s window, instead of at its edge?\n'
  printf '  %s(a shorter context each turn, but in two of three runs more turns; not proven to save;\n' "$C_GREY"
  printf '  MDL_COMPACTION in tests/harness.env changes it later)%s [y/N] ' "$C_RESET"
  read -r reply
  case "${reply:-n}" in y|Y|yes|YES) COMPACTION="on" ;; esac
}

# apply_compaction -- writes each host's setting when COMPACTION is on, and records the choice.
apply_compaction() {
  [ -n "${COMPACTION:-}" ] || return 0
  ui_begin "setting agent compaction"
  if [ -f "$APP/tests/harness.env" ] && ! grep -q '^MDL_COMPACTION=' "$APP/tests/harness.env"; then
    printf '\n# When the coding agents compact their context (install/compaction.sh): on = at 70%% of the window.\nMDL_COMPACTION=%s\n' "$COMPACTION" >> "$APP/tests/harness.env"
  fi
  [ "$COMPACTION" = "on" ] || { ui_done "Agent compaction" "off (MDL_COMPACTION=off)"; return 0; }
  local done_for="" pi_models="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/models.json" n
  # Pi: per model of the person's models.json, reserveTokens = 30% of its window.
  if [ -f "$pi_models" ]; then
    n="$("$NODE" "$SRC/install/install_tool.cjs" pi-compaction "$APP/.pi/settings.json" "$pi_models" 2>/dev/null)"
    [ "${n:-0}" -gt 0 ] 2>/dev/null && done_for="${done_for}Pi ($n models) "
  fi
  if [ -n "$done_for" ]; then ui_done "Agent compaction" "${done_for}at 70% of the window"
  elif [ -f "$pi_models" ]; then ui_done "Agent compaction" "already set at 70% of the window"
  else ui_done "Agent compaction" "on, but nothing to set: no Pi models.json at $pi_models"; fi
}
