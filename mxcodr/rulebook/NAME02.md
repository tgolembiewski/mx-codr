---
step: layout
level: warn
check: layout_rules/names.cjs#nameFindings
key: document
baseline: names
---

# NAME02 — every widget is named <Page>_<What><Type>

## What it checks
Every widget is named after its page, what it is for and its type, in full words, like OrderDetail_GenerateInvoiceButton. Tests find widgets by these names.

## Fix
The name it prints; warns until the first DONE, then blocks a new or changed page. Rename `.mx-name-...` in tests too.

## Local
# level: warn
# except: Module.Document   # why

