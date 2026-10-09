# FOLDER01 — every document in <business folder>/UI, FNC or ENV
step: folders
level: block
check: check_folders.cjs#findings
key: none

## What it checks
Every document sits in a folder named after the business process (Orders, Customers), split into three subfolders: UI for pages and snippets, FNC for microflows and nanoflows, ENV for everything else. The finding prints the moves to make.

## Fix
The `move ... to folder` lines given, all in one script; new documents with `create ... folder 'Orders/FNC'`.

## Local
# level: block

