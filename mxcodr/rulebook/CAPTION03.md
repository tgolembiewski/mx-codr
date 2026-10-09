# CAPTION03 — every decision has a @caption
step: naming
level: warn
check: check_mdl.cjs#decisionFindings
key: none
baseline: captions

## What it checks
Every decision has a caption.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

