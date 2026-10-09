# SPACE03 — the same vertical spacing on widgets that share a line
step: layout
level: block
check: layout_rules/spacing.cjs#check
key: none

## What it checks
Widgets on the same line have the same spacing above and below them, so they line up.

## Fix
Give them the same `margin-top`/`margin-bottom`.

## Local
# level: block

