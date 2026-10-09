# placeholder-variable — a variable name says what it holds
step: naming
level: block
check: check_mdl.cjs#variableFindings
key: none

## What it checks
No variables named like $Int1, $tmp or $x. A name says what the variable holds, like $OpenInvoiceCount.

## Fix
`$OpenInvoiceCount`, not `$Int1`, `$tmp`, `$x`.

## Local
# level: block

