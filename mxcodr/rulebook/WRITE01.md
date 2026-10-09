# WRITE01 — a role does not write what only server-side flows set
step: security
level: warn
check: security_rules.cjs#findings
key: none

## What it checks
Points out a role that may change fields only the system should set, like a total or a status. The finding names the fields to remove and the associations to keep.

## Fix
Leave those attributes out of the rule's write list; a microflow without `@applyentityaccess` still sets them (one with it, or a nanoflow, needs the right and is never flagged). A `write (...)` list drops what it does not name: keep in it the associations the finding lists, or a picker or a "new" button that sets one turns read-only.

## Local
# level: warn

