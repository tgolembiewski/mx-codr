# install/mxcli.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# mxcli: find the newest runnable one, download and verify a release, offer an update.

# --- 7. Report-only prerequisites, and mxcli: download, verify, choose, update ---
# Report-only: a reboot or licence click stands between the install command and a working tool.
dep_report_only() {      # dep_report_only <label> <detect> <winget> <brew> <apt>
  eval "$2" >/dev/null 2>&1 && return 0
  local command=""
  case "$(pkg_manager)" in
    winget) command="winget install -e --id $3" ;;
    brew)   command="brew install $4" ;;
    apt)    command="${SUDO}apt-get install -y $5" ;;
    dnf)    command="${SUDO}dnf install -y $5" ;;
  esac
  DEPS_MISSING+=("$1 -- ${command:-install it by hand}  (not installed for you)")
  return 1
}

# mxcli_release_url -- download URL of the mxcli binary for this OS and CPU.
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
    "${MXCLI_TAG:-nightly}" "$os" "$arch" "$EXE"
}

# ui_fail when the sha256 differs from MXCLI_SHA256; with it unset the download is only reported.
# sha256_of <file> -- the file's SHA-256, or nothing; never fails. Git for Windows has
# sha256sum but no shasum, macOS the other way round. Under set -e and pipefail the missing one
# ended the install silently, right after the mxcli download.
sha256_of() {
  local sum=""
  sum="$(sha256sum "$1" 2>/dev/null | cut -d" " -f1)" || sum=""
  [ -n "$sum" ] || sum="$(shasum -a 256 "$1" 2>/dev/null | cut -d" " -f1)" || sum=""
  [ -n "$sum" ] || sum="$("${PY:-python3}" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null)" || sum=""
  printf '%s\n' "$sum"
}

mxcli_verify_download() {   # mxcli_verify_download <file>
  local want="${MXCLI_SHA256:-}" got
  if [ -z "$want" ]; then
    ui_note "mxcli came from the ${MXCLI_TAG:-nightly} release and is not checksum-verified (set MXCLI_SHA256 to pin it)"
    return 0
  fi
  got="$(sha256_of "$1")"
  if [ "$got" != "$want" ]; then
    rm -f "$1"
    ui_fail "The mxcli download does not match MXCLI_SHA256." "  expected $want" "  got      ${got:-nothing}"
  fi
}

# Use the newest runnable mxcli and offer to update ./mxcli (MDL_NO_UPDATE_CHECK=1 skips the online check).

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

# mxcli_newest_local -- set MXCLI_BEST/MXCLI_BEST_DESC to the newest runnable candidate (tie: earlier wins); sets MXCLI_CANDIDATES.
mxcli_newest_local() {
  local candidate desc
  MXCLI_BEST=""; MXCLI_BEST_DESC=""
  # Every place mxcli may be, in order; mxcli_for_project reuses this list.
  MXCLI_CANDIDATES=("$APP/mxcli$EXE" "$(command -v "mxcli$EXE" 2>/dev/null || true)"
                    "$SRC/../mxcli$EXE" "$SRC/mxcli$EXE")
  for candidate in "${MXCLI_CANDIDATES[@]}"; do
    desc="$(mxcli_describe "$candidate")" || continue
    candidate="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
    # ISO build dates compare correctly as strings.
    if [ -z "$MXCLI_BEST" ] || [[ "${desc%% *}" > "${MXCLI_BEST_DESC%% *}" ]]; then
      MXCLI_BEST="$candidate"; MXCLI_BEST_DESC="$desc"
    fi
  done
  [ -n "$MXCLI_BEST" ]
}

# mxcli_latest_release -- "<published-at> <tag> <sha256> <url>" of the latest release, or nothing; fields validated.
mxcli_latest_release() {
  [ -z "${MDL_NO_UPDATE_CHECK:-}" ] || return 1
  have curl || return 1
  local api="${MXCLI_RELEASES_API:-https://api.github.com/repos/mendixlabs/mxcli/releases/latest}"
  local asset line published tag sha url
  asset="$(basename "$(mxcli_release_url)")"
  line="$(curl -fsSL -m 10 "$api" 2>/dev/null | "$PY" -c 'import json, sys
asset = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for item in data.get("assets") or []:
    digest = str(item.get("digest") or "")
    if item.get("name") == asset and digest.startswith("sha256:"):
        print(data.get("published_at", ""), data.get("tag_name", ""), digest[7:],
              item.get("browser_download_url", ""))
        break
else:
    sys.exit(1)' "$asset" 2>/dev/null)" || return 1
  read -r published tag sha url <<< "$line"
  [[ "$published" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || return 1
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [ -z "${MXCLI_RELEASES_API:-}" ]; then
    case "$url" in https://github.com/mendixlabs/mxcli/releases/download/*) ;; *) return 1 ;; esac
  fi
  printf '%s %s %s %s\n' "$published" "$tag" "$sha" "$url"
}

# mxcli_older_than_release <desc> <published-at> <tag> -- older only if not that tag and built >12h before release.
mxcli_older_than_release() {
  local date="${1%% *}" ver="${1#* }"
  [ "$ver" = "$3" ] && return 1
  "$PY" -c 'import datetime, sys
parse = lambda text: datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
sys.exit(0 if parse(sys.argv[1]) + datetime.timedelta(hours=12) < parse(sys.argv[2]) else 1)' \
    "$date" "$2" 2>/dev/null
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

# mxcli_offer_update -- offer a newer release or local build over ./mxcli; sets MXCLI_BEST*. Returns 0.
mxcli_offer_update() {
  local project_desc="" latest published tag sha url tmp got prompt
  project_desc="$(mxcli_describe "$APP/mxcli$EXE" || true)"
  mxcli_newest_local || true

  if latest="$(mxcli_latest_release)"; then
    read -r published tag sha url <<< "$latest"
    if [ -z "$MXCLI_BEST_DESC" ] || mxcli_older_than_release "$MXCLI_BEST_DESC" "$published" "$tag"; then
      prompt="    mxcli $tag is available (this project uses $(mxcli_label "$project_desc")). Download it into ./mxcli$EXE? [Y/n] "
      if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
        ui_note "would download mxcli $tag into ./mxcli$EXE"
      elif [ -z "${MDL_ASSUME_YES:-}" ] && ! [ -t 0 ]; then
        ui_note "mxcli $tag is available; this project uses $(mxcli_label "$project_desc"). Re-run interactively, or with MDL_ASSUME_YES=1, to update."
      elif ask "$prompt" y; then
        tmp="$(mktemp "${TMPDIR:-/tmp}/mxcli-download.XXXXXX")"
        if curl -fsSL -m 600 -o "$tmp" "$url" 2>/dev/null; then
          got="$(sha256_of "$tmp")"
          if [ "$got" = "$sha" ] && mxcli_put_in_project "$tmp"; then
            ui_note "./mxcli$EXE updated to $tag (checksum verified against the release)"
          else
            DEPS_MISSING+=("mxcli $tag -- the download did not match the release checksum, so ./mxcli$EXE was left as it was.")
          fi
        else
          DEPS_MISSING+=("mxcli $tag -- the download failed, so ./mxcli$EXE was left as it was.")
        fi
        rm -f "$tmp"
        mxcli_newest_local || true
        return 0
      fi
    fi
  fi

  if [ -n "$MXCLI_BEST" ] && [ "$MXCLI_BEST" != "$APP/mxcli$EXE" ] && [ -e "$APP/mxcli$EXE" ] \
     && { [ -z "$project_desc" ] || [[ "${MXCLI_BEST_DESC%% *}" > "${project_desc%% *}" ]]; }; then
    prompt="    This project's ./mxcli$EXE is $(mxcli_label "$project_desc"); $MXCLI_BEST is $(mxcli_label "$MXCLI_BEST_DESC"). Use the newer one? [Y/n] "
    if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
      ui_note "would copy mxcli ${MXCLI_BEST_DESC#* } into ./mxcli$EXE"
    elif [ -z "${MDL_ASSUME_YES:-}" ] && ! [ -t 0 ]; then
      ui_note "a newer mxcli ($(mxcli_label "$MXCLI_BEST_DESC")) is at $MXCLI_BEST; this project uses $(mxcli_label "$project_desc"). Re-run interactively, or with MDL_ASSUME_YES=1, to update."
    elif ask "$prompt" y; then
      if mxcli_put_in_project "$MXCLI_BEST"; then
        ui_note "./mxcli$EXE updated to ${MXCLI_BEST_DESC#* }"
        mxcli_newest_local || true
      fi
    fi
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

# mxcli_for_project -- print the mxcli to use: ./mxcli if it runs, else MXCLI_BEST, else the first executable candidate.
# Needs mxcli_newest_local to have run: it sets MXCLI_BEST and MXCLI_CANDIDATES.
mxcli_for_project() {
  if mxcli_describe "$APP/mxcli$EXE" >/dev/null; then
    printf '%s\n' "$APP/mxcli$EXE"
  elif [ -n "${MXCLI_BEST:-}" ]; then
    printf '%s\n' "$MXCLI_BEST"
  else
    # Nothing answered --version.
    first_executable "${MXCLI_CANDIDATES[@]}"
  fi
}
