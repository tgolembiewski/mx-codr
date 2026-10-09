# NAME01 — a widget name is used on one page only
step: layout
level: warn
check: layout_rules/names.cjs#nameFindings
key: document

## What it checks
Points out a widget name used on more than one page.

## Fix
Its own `<Page>_<What><Type>` name.

## Local
# level: warn
# except: Module.Document   # why

