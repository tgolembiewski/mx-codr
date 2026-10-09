# SCRIPT01 — each document is created by one script in mdlsource/
step: precheck
level: block
check: gate_helpers.cjs#duplicateDefinitions
key: none
fixed: yes

## What it checks
Each page, microflow, entity or constant is created in only one script in mdlsource/. If two scripts both create the same page, running the older one again silently throws away the newer version. One-off repair scripts kept elsewhere are not compared.

## Fix
Change it there or with `alter`, never a second `create or modify` in a later script.

## Local
# this rule has no level to set; it is what DONE means

