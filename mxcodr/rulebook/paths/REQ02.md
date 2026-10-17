---
step: paths
level: block
check: requirement_rules.cjs#requirementFindings
key: document
---

# REQ02 — each agreed requirement has a test

## What it checks
Each requirement in docs/brain/plan is named by a test, and the code under its `# requirement:` line holds one of the requirement's own words, so none drops out or is named without a check. At `requirements: assume` nothing may wait in the brain's queue, since nobody else promotes it.

## Fix
`# requirement: <id>` above the step that checks it; its fail message in the requirement's words.

## Local
# level: block
# except: <id>   # why
