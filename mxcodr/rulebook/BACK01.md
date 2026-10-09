# BACK01 — a Back button, top left, on every page another page opens
step: layout
level: block
check: layout_rules/page_top.cjs#backButtonFindings
key: none

## What it checks
A page opened from another page has a Back button, top left. Pop-ups don't need one: they close with their X.

## Fix
First widget `actionbutton btnBack (Caption: 'Back', Action: close page, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')`; pop-ups excepted.

## Local
# level: block

