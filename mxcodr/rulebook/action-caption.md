# action-caption — every activity has a business @caption
step: naming
level: warn
check: check_mdl.cjs#actionFindings
key: none
baseline: captions

## What it checks
Every activity (retrieve, create, change, commit, delete, show page, call…) has a caption in business words, like "Find the customer's open invoices".

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

