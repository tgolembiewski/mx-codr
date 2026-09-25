# install/step_skills.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 13: copy the skills, lint rules, checkers and the session rule. Runs as it is read.

# --- 13. Step: copy skills, lint rules, checkers and the session rule ---
# Copies, not symlinks, so a plain clone of the app has the skills.
SKILL_DIRS=(.claude/skills .agents/skills .ai-context/skills)

ui_begin "installing skills"
installed_skills=0
for skill in "$SRC"/skills/*/; do
  name="$(basename "$skill")"
  for dest in "${SKILL_DIRS[@]}"; do
    mkdir -p "$APP/$dest/$name"
    cp "$skill/SKILL.md" "$APP/$dest/$name/SKILL.md"
    # reference/*.md: the detail a skill's SKILL.md links to (read on demand, not up front).
    if [ -d "$skill/reference" ]; then
      mkdir -p "$APP/$dest/$name/reference"
      cp "$skill/reference/"*.md "$APP/$dest/$name/reference/"
    fi
  done
  installed_skills=$((installed_skills + 1))
done
ui_done "skills" "$installed_skills $I_ARROW each of ${SKILL_DIRS[*]}"

ui_begin "installing lint rules"
mkdir -p "$APP/.claude/lint-rules"
cp "$SRC"/lint-rules/*.star "$APP/.claude/lint-rules/"
rules=$(ls -1 "$SRC"/lint-rules/*.star | wc -l | tr -d ' ')
ui_done "lint rules" "$rules $I_ARROW .claude/lint-rules/"

ui_begin "installing checkers"
mkdir -p "$APP/tools/mdl-checks"
cp -R "$SRC"/checks/. "$APP/tools/mdl-checks/"
cp "$SRC/VERSION" "$APP/tools/mdl-checks/VERSION"
# The mxcli build this bundle was validated with; orient.sh compares ./mxcli against it.
[ -f "$SRC/MXCLI_TESTED" ] && cp "$SRC/MXCLI_TESTED" "$APP/tools/mdl-checks/MXCLI_TESTED"
checks=$(ls -1 "$SRC"/checks/*.py | wc -l | tr -d ' ')
ui_done "checkers" "$checks $I_ARROW tools/mdl-checks/"

# In .claude/rules/ because mxcli init regenerates CLAUDE.md.
ui_begin "installing the session rule"
mkdir -p "$APP/.claude/rules"
cp "$SRC/rules/mdl-skills.md" "$APP/.claude/rules/mdl-skills.md"
ui_done "session rule" "1 $I_ARROW .claude/rules/mdl-skills.md"
