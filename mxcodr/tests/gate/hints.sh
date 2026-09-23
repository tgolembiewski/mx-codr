# tests/gate/hints.sh -- what a Mendix error code means, in one line each.
# Sourced by tests/gate.sh (for a failed boot) and by tests/precheck.sh (for the errors a
# script would add to the build). Functions only, no variables of its own: the two callers
# reach this file by different paths and neither has an app running when it does.
#
# A hint earns its place by having cost a session time. Keep them to one line, name the
# skill that has the syntax, and say the fix rather than the rule.

# Prints a hint for each CE code in <file>, once per code, in the order they appear.
mdl_ce_hints() {   # mdl_ce_hints <file>
  local code
  [ -f "$1" ] || return 0
  for code in $(grep -oE '\[CE[0-9]+\]' "$1" 2>/dev/null | tr -d '[]' | awk '!seen[$0]++'); do
    case "$code" in
      CE0161) echo "   hint CE0161 (XPath): tokens are quoted -- '[%CurrentUser%]', '[%CurrentDateTime%]' -- never CurrentUser() or \$currentUser; paths use full names (Module.Assoc/Module.Entity); a token compares only to a value of its type. Skill: xpath-constraints" ;;
      CE0117) echo "   hint CE0117 (expression): check each operand's type (a reference compares with = empty, a decimal does not fit an integer), function names, and enumeration values written Module.Enum.Value. Skill: write-microflows" ;;
      CE1613) echo "   hint CE1613: a page or microflow names an attribute, association or document that does not exist (not created yet, or renamed) -- DESCRIBE the entity it points at" ;;
      CE0007) echo "   hint CE0007: an access rule names module roles of another module -- grant only this module's roles; for Administration.* give the user role Administration.User instead" ;;
      CE0642) echo "   hint CE0642: a required widget property is missing (a combo box or input needs a Caption/Label)" ;;
      CE2729) echo "   hint CE2729: a page reaches something its viewers may not use. The message names both halves -- grant the microflow to that role and the entity it returns: 'grant execute on microflow Mod.DS_X to Mod.Role;' and 'grant Mod.Role on Mod.Entity (read *);'. A non-persistent entity behind a data view needs the grant as much as a stored one, and every role that can open the page needs it. Skill: manage-security" ;;
      CE7247) echo "   hint CE7247: that name is reserved by the Mendix platform and quoting does not rescue it -- Owner, Type and Default have to be renamed (Staff, ResourceType, Standard); other keywords only need quotes. Full list: ./mxcli syntax keywords" ;;
    esac
  done
}
