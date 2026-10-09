---
step: layout
level: block
check: layout_rules/grids.cjs#headerButtonFindings
key: none
---

# GRID02 — a button that changes a grid's rows sits in its header

## What it checks
A button that changes what a grid shows (New, Delete selected…) sits in the grid's own header, not somewhere else on the page.

## Fix
`controlbar` in the datagrid; `$dgX` or a page parameter.

## Local
# level: block

