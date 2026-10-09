# TEST01 — a test exists before a new page or ACT_ microflow
step: precheck
level: block
check: gate_helpers.cjs#testFirst
key: none

## What it checks
Test first: before a new page or a new ACT_ microflow is added, a browser test for it must already exist. Fixing something that is already in the app is fine.

## Fix
Write `tests/verify-<feature>.test.sh` first, run it (red), then exec; a fix to a page already in the model passes; `MDL_TEST_FIRST=0` turns it off.

## Local
# level: block

