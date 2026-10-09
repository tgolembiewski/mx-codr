---
step: layout
level: block
check: layout_rules/urls.cjs#urlFindings
key: document
---

# URL01 — every page that can have a URL has one

## What it checks
Every normal page has a URL, so it can be bookmarked, shared and reloaded. A page with a parameter gets the parameter in its URL, like order/{Order/Id}. Pop-ups, login pages and pages whose parameter can't be in a URL are skipped. The finding prints the line that adds the URL.

## Fix
The `alter page` it prints; the same `Url:` in the page's create.

## Local
# level: block
# except: Module.Document   # why

