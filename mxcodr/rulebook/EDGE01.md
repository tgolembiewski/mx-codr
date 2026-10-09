# EDGE01 — every widget sits inside a layout grid
step: layout
level: block
check: layout_rules/edges.cjs#edgeFindings
key: none

## What it checks
Everything on a page sits inside a layout grid, so nothing is glued to the edge of the window.

## Fix
`layoutgrid pageGrid { row rowTop { column colTop (DesktopWidth: 12) { ... } } }` around the page's widgets, the top row too.

## Local
# level: block

