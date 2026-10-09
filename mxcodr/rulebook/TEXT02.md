# TEXT02 — a text area for a prose-named attribute
step: layout
level: warn
check: layout_rules/inputs.cjs#textInputFindings
key: none

## What it checks
Points out a one-line text box for a field named like free text (Description, Notes, Reason).

## Fix
A textarea if people write more than a line.

## Local
# level: warn

