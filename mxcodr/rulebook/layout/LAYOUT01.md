---
step: layout
level: block
check: layout_rules/layouts.cjs#oneLayoutFindings
key: none
---

# LAYOUT01 — one layout for every page that is not a pop-up

## What it checks
All normal pages use the same layout, so the menu looks and behaves the same everywhere. Pop-ups, the login page and phone pages may differ.

## Fix
Pick one (`Atlas_Core.Atlas_Default`) and set it on every page.

## Local
# level: block

