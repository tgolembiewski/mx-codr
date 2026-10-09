# STRICT01 — strict mode is on
step: security
level: block
check: security_rules.cjs#findings
key: none

## What it checks
Strict mode is on. Without it, a clever user can read and change data through the browser in ways the pages never offer.

## Fix
`alter app security ( StrictMode: TRUE );`.

## Local
# level: block

