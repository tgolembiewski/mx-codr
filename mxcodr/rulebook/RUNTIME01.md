# RUNTIME01 — no server error logged while the suite ran
step: tests
level: warn
check: gate_helpers.cjs#runtimeErrors
key: none

## What it checks
While the tests ran, the Mendix server logged no errors. A test can pass while something failed in the background.

## Fix
The log line names the microflow or page; `MDL_RUNTIME_ERRORS=error` makes it block.

## Local
# level: warn

