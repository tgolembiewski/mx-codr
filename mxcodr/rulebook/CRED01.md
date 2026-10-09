---
step: security
level: block
check: security_rules.cjs#findings
key: document
---

# CRED01 — no secret in a constant's default value

## What it checks
A constant meant for a secret (a password, token or API key) has no default value. A default ends up in every build and backup. The value is set per environment instead.

## Fix
`DefaultValue: ''` in the script that creates the constant, and that script exec'd again (there is no `alter constant`; a second `create` elsewhere is SCRIPT01); the value per environment: locally `alter settings constant @M.C value '...' in configuration 'Default';` (a run configuration's value stays out of the package), on a server at deployment.

## Local
# level: block
# except: Module.Document   # why

