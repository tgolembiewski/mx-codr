# SPACE01 — a margin after an inline widget and under a heading
step: layout
level: block
check: layout_rules/spacing.cjs#check
key: none

## What it checks
Widgets next to each other have space between them, and a heading has space under it. Spacing uses Atlas's spacing settings.

## Fix
`DesignProperties: ('Spacing': ('margin-bottom': 'S'))` on the heading.

## Local
# level: block

