# CAPTION07 — no @caption on a loop: mxcli drops it, the annotation carries the text
step: naming
level: block
check: check_mdl.cjs#loopFindings
key: none

## What it checks
A loop has no caption: mxcli drops loop captions, so the text belongs in the annotation.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: block

