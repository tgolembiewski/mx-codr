# install/mxcli.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# mxcli: find the newest runnable one, download and verify a release, offer an update.

# --- mxcli: download, verify, choose, update ---
# The harness is verified against ONE mxcli release, named by $SRC/MXCLI_TESTED ("<tag> <build-date>").
# The installer downloads that release and offers to swap any other ./mxcli for it -- a newer
# mxcli can change what DESCRIBE prints, and a checker that cannot read it goes quiet instead of
# failing. MXCLI_TESTED is raised only after the harness has been adapted to the new release.
# MXCLI_TAG overrides it for one run (a person trying a build on purpose).

# mxcli_compat_tag -- the release tag this harness works with, or nothing.
mxcli_compat_tag() {
  local tag=""
  if [ -n "${MXCLI_TAG:-}" ]; then printf '%s\n' "$MXCLI_TAG"; return 0; fi
  [ -f "$SRC/MXCLI_TESTED" ] && read -r tag _ < "$SRC/MXCLI_TESTED" 2>/dev/null
  [ -n "$tag" ] || return 1
  printf '%s\n' "$tag"
}

# mxcli_release_url -- download URL of the compatible mxcli binary for this OS and CPU.
mxcli_release_url() {
  local os arch
  case "$(uname -s 2>/dev/null)" in
    Darwin)               os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *)                    os=linux ;;
  esac
  case "$(uname -m 2>/dev/null)" in
    arm64|aarch64) arch=arm64 ;;
    *)             arch=amd64 ;;
  esac
  printf 'https://github.com/mendixlabs/mxcli/releases/download/%s/mxcli-%s-%s%s\n' \
    "$(mxcli_compat_tag || echo v0.27.0)" "$os" "$arch" "$EXE"
}

# sha256_of <file> -- the file's SHA-256, or nothing; never fails. Git for Windows has
# sha256sum but no shasum, macOS the other way round. Under set -e and pipefail the missing one
# ended the install silently, right after the mxcli download.
sha256_of() {
  local sum=""
  sum="$(sha256sum "$1" 2>/dev/null | cut -d" " -f1)" || sum=""
  [ -n "$sum" ] || sum="$(shasum -a 256 "$1" 2>/dev/null | cut -d" " -f1)" || sum=""
  [ -n "$sum" ] || sum="$("${NODE:-node}" "$SRC/install/install_tool.cjs" sha256-file "$1" 2>/dev/null)" || sum=""
  printf '%s\n' "$sum"
}

# ui_fail when the sha256 differs from MXCLI_SHA256; with it unset the download is only reported.
mxcli_verify_download() {   # mxcli_verify_download <file>
  local want="${MXCLI_SHA256:-}" got
  if [ -z "$want" ]; then
    ui_note "mxcli came from the $(mxcli_compat_tag || echo '?') release and is not checksum-verified (set MXCLI_SHA256 to pin it)"
    return 0
  fi
  got="$(sha256_of "$1")"
  if [ "$got" != "$want" ]; then
    rm -f "$1"
    ui_fail "The mxcli download does not match MXCLI_SHA256." "  expected $want" "  got      ${got:-nothing}"
  fi
}

# mxcli_describe <binary> -- "<build-date> <version>", or nothing when it cannot run here.
mxcli_describe() {
  local out ver date
  [ -n "${1:-}" ] && [ -x "$1" ] || return 1
  out="$("$1" --version 2>/dev/null | head -1)" || return 1
  ver="$(printf '%s' "$out" | sed -n 's/^mxcli version \([^ ]*\).*/\1/p')"
  date="$(printf '%s' "$out" | sed -n 's/.*(\([0-9][0-9-]*T[0-9:]*Z\)).*/\1/p')"
  [ -n "$ver" ] && [ -n "$date" ] || return 1
  printf '%s %s\n' "$date" "$ver"
}

# mxcli_compatible_local -- set MXCLI_BEST/MXCLI_BEST_DESC to the first runnable candidate that IS
# the compatible release (a newer one is no better); sets MXCLI_CANDIDATES.
mxcli_compatible_local() {
  local candidate desc want
  MXCLI_BEST=""; MXCLI_BEST_DESC=""
  want="$(mxcli_compat_tag || true)"
  # Every place mxcli may be, in order; mxcli_for_project reuses this list.
  MXCLI_CANDIDATES=("$APP/mxcli$EXE" "$(command -v "mxcli$EXE" 2>/dev/null || true)"
                    "$SRC/../mxcli$EXE" "$SRC/mxcli$EXE")
  for candidate in "${MXCLI_CANDIDATES[@]}"; do
    desc="$(mxcli_describe "$candidate")" || continue
    [ -n "$want" ] && [ "${desc#* }" = "$want" ] || continue
    MXCLI_BEST="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
    MXCLI_BEST_DESC="$desc"
    return 0
  done
  return 1
}

# mxcli_compat_release -- "<tag> <sha256> <url>" of the compatible release's binary for this
# machine, or nothing; fields validated.
mxcli_compat_release() {
  [ -z "${MDL_NO_UPDATE_CHECK:-}" ] || return 1
  have curl || return 1
  local tag api asset line got_tag sha url
  tag="$(mxcli_compat_tag)" || return 1
  api="${MXCLI_RELEASES_API:-https://api.github.com/repos/mendixlabs/mxcli/releases/tags/$tag}"
  asset="$(basename "$(mxcli_release_url)")"
  line="$(curl -fsSL -m 10 "$api" 2>/dev/null | "$NODE" "$SRC/install/install_tool.cjs" release-asset "$asset" 2>/dev/null)" || return 1
  read -r got_tag sha url <<< "$line"
  [ "$got_tag" = "$tag" ] || return 1
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [ -z "${MXCLI_RELEASES_API:-}" ]; then
    case "$url" in https://github.com/mendixlabs/mxcli/releases/download/*) ;; *) return 1 ;; esac
  fi
  printf '%s %s %s\n' "$tag" "$sha" "$url"
}

# mxcli_download_compat -- put the compatible release into ./mxcli, checksum-verified against the
# release. Returns 1 (with the reason in DEPS_MISSING) when it cannot.
mxcli_download_compat() {
  local release tag sha url tmp got
  release="$(mxcli_compat_release)" || return 1
  read -r tag sha url <<< "$release"
  tmp="$(mktemp "${TMPDIR:-/tmp}/mxcli-download.XXXXXX")"
  if ! curl -fsSL -m 600 -o "$tmp" "$url" 2>/dev/null; then
    rm -f "$tmp"
    DEPS_MISSING+=("mxcli $tag -- the download failed, so ./mxcli$EXE was left as it was.")
    return 1
  fi
  got="$(sha256_of "$tmp")"
  if [ "$got" = "$sha" ] && mxcli_put_in_project "$tmp"; then
    rm -f "$tmp"
    ui_note "./mxcli$EXE is mxcli $tag, the version this harness works with (checksum verified against the release)"
    return 0
  fi
  rm -f "$tmp"
  DEPS_MISSING+=("mxcli $tag -- the download did not match the release checksum, so ./mxcli$EXE was left as it was.")
  return 1
}

# mxcli_put_in_project <file> -- replace ./mxcli, keeping the old one beside it under its version.
mxcli_put_in_project() {
  local source="$1" target="$APP/mxcli$EXE" old backup
  if old="$(mxcli_describe "$target")"; then
    backup="$APP/mxcli.$(printf '%s' "${old#* }" | tr -c 'A-Za-z0-9._-' '_')$EXE"
    [ -e "$backup" ] || cp "$target" "$backup" 2>/dev/null || true
  fi
  cp "$source" "$target.new" && chmod +x "$target.new" && mv -f "$target.new" "$target"
}

# mxcli_label <desc> -- "v0.22.0, built 2026-09-14", or "none" for an empty one.
mxcli_label() {
  if [ -n "${1:-}" ]; then printf '%s, built %s' "${1#* }" "${1%%T*}"; else printf 'none'; fi
}

# mxcli_offer_update -- make ./mxcli the compatible release: copy one found on this machine, or
# download it. Any other version is swapped, newer ones too; the old binary is kept beside it.
# Sets MXCLI_BEST*. Returns 0.
mxcli_offer_update() {
  local project_desc="" want prompt
  want="$(mxcli_compat_tag || true)"
  project_desc="$(mxcli_describe "$APP/mxcli$EXE" || true)"
  mxcli_compatible_local || true
  [ -n "$want" ] || return 0
  [ -n "$project_desc" ] && [ "${project_desc#* }" = "$want" ] && return 0
  # No ./mxcli yet: put the compatible release there, never an older or newer one from the PATH.
  if [ ! -e "$APP/mxcli$EXE" ]; then
    [ -z "${MDL_DEPS_DRY_RUN:-}" ] || { ui_note "would put mxcli $want into ./mxcli$EXE"; return 0; }
    if [ -n "$MXCLI_BEST" ] && mxcli_put_in_project "$MXCLI_BEST"; then
      ui_note "./mxcli$EXE is mxcli $want (copied from $MXCLI_BEST)"
    else
      mxcli_download_compat || true
    fi
    mxcli_compatible_local || true
    return 0
  fi

  prompt="    This harness works with mxcli $want; this project's ./mxcli$EXE is $(mxcli_label "$project_desc"). Swap it for $want? [Y/n] "
  if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    ui_note "would make ./mxcli$EXE mxcli $want"
  elif [ -z "${MDL_ASSUME_YES:-}" ] && ! [ -t 0 ]; then
    ui_note "this harness works with mxcli $want; this project uses $(mxcli_label "$project_desc"). Re-run interactively, or with MDL_ASSUME_YES=1, to swap it."
  elif ask "$prompt" y; then
    if [ -n "$MXCLI_BEST" ] && [ "$MXCLI_BEST" != "$APP/mxcli$EXE" ] && mxcli_put_in_project "$MXCLI_BEST"; then
      ui_note "./mxcli$EXE is now mxcli $want (copied from $MXCLI_BEST)"
    else
      mxcli_download_compat || true
    fi
    mxcli_compatible_local || true
  fi
  return 0
}

# first_executable <path>... -- print the first non-empty, executable path; return 1 if none.
first_executable() {
  local candidate
  for candidate in "$@"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

# mxcli_for_project -- print the mxcli to use: the compatible release (./mxcli first), else ./mxcli
# if it runs at all, else the first executable candidate.
# Needs mxcli_compatible_local to have run: it sets MXCLI_BEST and MXCLI_CANDIDATES.
mxcli_for_project() {
  if [ -n "${MXCLI_BEST:-}" ]; then
    printf '%s\n' "$MXCLI_BEST"
  elif mxcli_describe "$APP/mxcli$EXE" >/dev/null; then
    printf '%s\n' "$APP/mxcli$EXE"
  else
    # Nothing answered --version.
    first_executable "${MXCLI_CANDIDATES[@]}"
  fi
}
