---
step: layout
level: block
check: layout_rules/layouts.cjs#layoutMenuFindings
key: none
---

# NAV04 — no menu built from buttons in a layout

## What it checks
The menu is a real Mendix navigation menu, not a row of buttons built into a layout (that has no mobile menu and no highlighted item).

## Fix
Put those pages in the navigation profile's menu; the layout keeps Atlas's own menu.

## Local
# level: block

