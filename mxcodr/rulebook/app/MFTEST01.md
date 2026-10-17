---
step: tests
level: block
check: bash:tests/gate/mftest.sh#run_microflow_tests
key: none
---

# MFTEST01 — the microflow tests pass

## What it checks
The microflow tests under tests/ (`*.test.mdl`, `*.test.md`) pass, and each one asserts something. They run once the rest of a full gate is green, on a copy of the project with its own runtime and scratch database, so the app and its data are not touched. A pass is replayed until the model or a test file changes.

## Fix
Fix the flow, or the test if the need changed; output: .mxcli/microflow-tests.txt.

## Local
# level: block
