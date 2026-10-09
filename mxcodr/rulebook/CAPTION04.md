# CAPTION04 — a decision's caption ends with a question mark
step: naming
level: warn
check: check_mdl.cjs#decisionFindings
key: none
baseline: captions

## What it checks
A decision's caption is a question and ends with "?", like "Is the order approved?".

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

