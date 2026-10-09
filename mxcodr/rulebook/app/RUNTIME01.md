---
step: tests
level: warn
check: gate_runtime.cjs#runtimeErrors
key: none
---

# RUNTIME01 — no server error logged while the suite ran

## What it checks
While the tests ran, the Mendix server logged no errors. A test can pass while something failed in the background.

## Fix
The log line names the microflow or page; `MDL_RUNTIME_ERRORS=error` makes it block.

## Local
# level: warn

