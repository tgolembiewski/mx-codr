# VIEW01 — a row-scoped role does not read a view over everyone's rows
step: security
level: block
check: view_access.cjs#findings
key: none

## What it checks
A role that may only see its own records cannot read a view entity that adds up everybody's records, like a total of all customers' invoices.

## Fix
Constrain the rule, or revoke it and read the view in a data-source microflow.

## Local
# level: block

