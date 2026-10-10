---
step: scope
level: warn
check: check_scope.cjs#findings
key: none
---

# SCOPE01 — a data source microflow limits its rows to the user when the page's role is row-scoped

## What it checks
Points out a page whose data source microflow retrieves records that the page's role should only partly see. A microflow ignores access rules, so the retrieve itself must limit the records to the user.

## Fix
Constrain its retrieve (`= '[%CurrentUser%]'` or `= $SignedInCustomer`): microflows ignore entity access; `MDL_SCOPE=error` blocks.

## Local
# level: warn

