---
step: catalog
level: off
check: mxcli
key: none
---

# LINT01 — mxcli's own lint advice, on request

## What it checks
mxcli's own lint rules (./mxcli lint --list-rules names them). Advice, so the gate does not run them unless asked: set level: warn below to see their findings under the gate's warnings, block to make lint errors block.

## Fix
Set `level: warn` below to see them under the gate's warnings, `block` to make lint errors block.

## Local
# level: off

