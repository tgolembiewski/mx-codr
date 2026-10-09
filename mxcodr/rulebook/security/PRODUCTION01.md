---
step: security
level: block
check: bash:tests/gate/security.sh#security_level
key: none
---

# PRODUCTION01 — project security is at Production (and VIEW01 is checked)

## What it checks
App security is set to Production. At Prototype level Mendix ignores the XPath constraints on access rules, so a test can pass on an app that shows everyone's data.

## Fix
`alter project security level PRODUCTION;` in the first script (`MDL_REQUIRE_PRODUCTION=0` only for an app with no users).

## Local
# level: block

