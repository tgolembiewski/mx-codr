---
step: precheck
level: block
check: bash:tests/precheck.sh#stale_units
key: none
---

# STALE01 — a re-run script does not undo later changes to its documents

## What it checks
An old script cannot be run again if that would undo changes made to its pages or microflows later. Moving a document to another folder does not count as a change.

## Fix
A new `alter` script, or DESCRIBE those documents into it first.

## Local
# level: block

