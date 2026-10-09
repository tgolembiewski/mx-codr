---
step: tests
level: block
check: bash:tests/gate/tests.sh#run_suite
key: none
fixed: yes
---

# TESTS01 — every browser test passes

## What it checks
Every browser test passes. Microflow unit tests (*.test.mdl) are not run by the gate; it shows the command that runs them.

## Fix
Read the failing scenario's own message; the test names the widget and the page.

## Local
# this rule has no level to set; it is what DONE means

