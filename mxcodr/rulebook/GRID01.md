# GRID01 — a column with a filter keeps its Attribute
step: layout
level: block
check: layout_rules/controls.cjs#columnFilterFindings
key: none

## What it checks
A data grid column that has a filter is still bound to its attribute. Without it the filter shows "Unable to get filter store" and does nothing.

## Fix
`column colX (Attribute: X) { textfilter fltX (Attribute: X) }`; without it: "Unable to get filter store".

## Local
# level: block

