---
step: layout
level: block
check: layout_rules/spacing.cjs#check
key: none
---

# SPACE02 — only Atlas spacing values (None, S, M, L)

## What it checks
Spacing uses only the Atlas sizes None, S, M or L. Other values make the Mendix build fail.

## Fix
Sides `margin-`/`padding-` `top|right|bottom|left`, values `None S M L`; never a `Class:` or CSS for spacing.

## Local
# level: block

