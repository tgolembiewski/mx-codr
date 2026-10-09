# NAV06 — no icon twice in what one role sees
step: layout
level: block
check: layout_rules/navigation.cjs#duplicateIconFindings
key: none

## What it checks
No two menu items that the same user can see have the same icon.

## Fix
The other icon the message suggests.

## Local
# level: block

