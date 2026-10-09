---
step: security
level: block
check: security_rules.cjs#findings
key: none
---

# FILTER01 — an own-rows page filter is backed by the access rule

## What it checks
If a page shows a user only their own records (with [%CurrentUser%] in its XPath), the entity's access rule limits them the same way. A filter on a page is not security: another page or the browser could still read everything.

## Fix
Write the role's rule again with it: `grant read (...) on entity M.E to M.R where <the page's XPath>;` -- a second, constrained rule beside the old one changes nothing, rules add up. Not raised when the role has another page that lists every row.

## Local
# level: block

