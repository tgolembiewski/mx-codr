# Plan first for bigger requests

When a request adds several screens, entities or roles at once, is unclear, or changes the data model or security in
a way that is hard to undo, plan first: read what is there, then present the plan as your message (a short numbered
list of steps) and end your turn there. Change nothing until the person approves it. Small changes (a caption, one
field, a bug fix) go straight ahead. You decide which is which. After an approved plan, turn its steps into your task
list first (Task list in mx-codr's live rules).

Wrap the plan in these two lines, each on a line of its own and exactly as written (in your message itself, not in a
code block), so the mx-codr pane shows it as a plan card the person approves; a revised plan the same way:

```
<!-- mxcodr:plan -->
# <the plan's title>
<the steps, then the plan's Requirement and Decision lines (Project brain)>
<!-- mxcodr:plan-end -->
```

Write nothing after the closing line. In the pane the person's answer comes back as your next message: "I approve the
plan you presented above. Build it now." or "Keep planning: ..." with their note.

(The person turns this off in the mx-codr pane: ⋯ > Permissions, "Plan first for bigger requests".)
