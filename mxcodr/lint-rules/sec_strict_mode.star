# Shipped by the harness as an OVERRIDE of the rule mxcli installs: mxcli's copy (v0.23.0 and
# earlier) says strict mode "enforces additional XPath constraint validation" and cites
# CVE-2023-23835, which the Mendix reference guide contradicts, and its suggestion still says the
# setting is not reachable from MDL. Reported upstream; drop this file once mxcli's own copy is
# corrected.
# SEC005: Strict Mode Disabled
#
# Strict mode (React client only, Production security level) restricts the client data APIs --
# data.action, data.create, data.commit, data.remove, data.rollback and data.get -- so an entity
# is reachable only through what the model defines: a microflow, a nanoflow, a widget or a page.
# It also analyses the model, so only entities inside editable widgets can be saved or rolled
# back: a Save or Cancel button in a layout becomes a consistency error, and a few platform
# widgets lose the features that call the blocked APIs (the File Uploader's delete, Web Actions'
# "Take picture"). It is about the client's reach, NOT about XPath constraints -- those are
# enforced by the security level, and an earlier version of this rule said otherwise.
#
# https://docs.mendix.com/refguide/strict-mode/

RULE_ID = "SEC005"
RULE_NAME = "StrictModeDisabled"
DESCRIPTION = "Strict mode is off - the client data APIs can reach entities outside the modelled paths"
CATEGORY = "security"
SEVERITY = "warning"

def check():
    sec = project_security()
    if sec == None:
        return []

    if sec.strict_mode:
        return []

    # Studio Pro offers the setting at Production only, so that is where the warning belongs.
    if sec.security_level != "CheckEverything":
        return []

    return [violation(
        message="Strict mode is off, so the client data APIs (data.create, data.commit, data.remove, data.get, ...) can act on entities outside the paths the model defines.",
        location=location(module="", document_type="security", document_name="ProjectSecurity"),
        suggestion="Turn it on with `ALTER PROJECT SECURITY STRICT MODE ON;` (mxcli 0.23+). It needs the React client, and it refuses a Save or Cancel button that sits in a layout rather than a snippet: https://docs.mendix.com/refguide/strict-mode/",
    )]
