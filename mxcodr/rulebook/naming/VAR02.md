---
step: naming
level: block
check: check_mdl.cjs#variableFindings
key: none
---

# VAR02 — no _List, _Object or _Obj suffix on a variable

## What it checks
No variable names ending in _List, _Object or _Obj: $OverdueInvoices, not $Invoice_List.

## Fix
`$OverdueInvoices`, not `$Invoice_List`.

## Local
# level: block

