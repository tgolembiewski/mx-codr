---
step: precheck
level: block
check: gate_scripts.cjs#testFirst
key: none
---

# TEST01 — a test exists before a new page or ACT_ microflow

## What it checks
Test first: before a new page or a new ACT_ microflow is added, a browser test for it must already exist. Fixing something that is already in the app is fine.

## Fix
Write `tests/verify-<feature>.test.sh` first, run it (red), then exec; fixing a page already in the model passes.

## Local
# level: block

