---
step: layout
level: block
check: layout_rules/inputs.cjs#textInputFindings
key: none
---

# TEXT01 — a text area for a long String

## What it checks
A long text attribute (more than 500 characters, or unlimited) is edited in a multi-line text area, not a one-line text box.

## Fix
`replace txtX with { textarea txtX (...) }`.

## Local
# level: block

