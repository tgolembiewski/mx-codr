---
name: reuse-and-snippets
description: "When to reuse a microflow, when to share a page, and when to extract a snippet instead of copying widgets. Use when creating or changing a page, snippet or microflow, and whenever the same widget block or business step is about to appear in a second place."
---

# Reuse and snippets

Copy-paste is the cheapest thing to do today and the most expensive thing to own.
This skill is the rule for when to extract something shared — and, just as
importantly, when not to.

## When to Use This Skill

Use it when:

- The same business step is about to appear in a second microflow
- The same widget block is about to appear on a second page
- You are building a second screen that resembles one that already exists
- You are reviewing a page or microflow that looks duplicated

## The test that decides it

**Reuse when the two copies are the same *business* thing, not when they merely
look alike.** Two blocks of identical widgets that belong to different business
owners will diverge on the next change request, and a shared snippet then becomes
a knot of conditional visibility. Two blocks that mean the same thing will change
together whether or not you extracted them.

Ask: *when this changes, must the other one change too?*

- **Yes** — extract. One definition, used twice.
- **No** — leave the duplication. It is two things that happen to look alike.
- **Do not know yet** — leave it. Extract on the second real change, not on the
  first resemblance.

## Microflows

Reuse a microflow rather than copying it when it is the same business step.
Once a second flow needs that logic, extract it into a `SUB_` microflow and call
it from both.

The prefixes (`ACT_`, `SUB_`, `DS_`, `VAL_`) and the standard shapes live in
[patterns-crud](../../../.ai-context/skills/patterns-crud/SKILL.md) — follow them rather than inventing a
parallel convention here.

```mdl
-- The shared business step, defined once
create microflow Sales.SUB_Order_ApplyDiscount (
  $Order: Sales.Order
)
returns Boolean as $Applied
begin
  declare $Applied Boolean = true;
  change $Order (TotalAmount = $Order/TotalAmount * 0.9);
  return $Applied;
end;
```

Both `ACT_Order_Save` and `ACT_Order_Confirm` then call
`Sales.SUB_Order_ApplyDiscount` instead of each carrying its own copy of the
calculation.

Before you extract, find out who else already does this:

```bash
./mxcli -p project.mpr -c "search 'discount'"
./mxcli -p project.mpr -c "show callers of Sales.SUB_Order_ApplyDiscount"
```

A `SUB_` with exactly one call site and no prospect of a second is not reuse — it
is an extra hop. Count **call sites, not calling flows**: ten calls from one seed
flow, each with different arguments, is reuse of the most literal kind, while one
call from one flow is a hop. Extract for a real second call site, or to name a step
that is genuinely hard to read inline.

Lint rule **REU001** counts *distinct callers*, so it reports the ten-calls-from-one-
flow case as a single caller. That is a known false positive at `info` level; read it
as "look at this", not "inline this".

## Pages

Share a page only when it is genuinely the same job.

A page that is 80% the same but needs a different title, a different button and
one hidden field is **two pages**, not one shared page with three conditions on
it. The conditions are what make a shared page unmaintainable, and they multiply
with every later variation.

What is usually shareable is not the page — it is a region of it. That is a
snippet.

## Snippets

**When a block of widgets appears on more than one screen, extract a snippet and
include it with `snippetcall`.**

Name it with the `SNIPPET_` prefix. This project's linter enforces that in
[`conv005_snippet_prefix.star`](../../../.claude/lint-rules/conv005_snippet_prefix.star),
so a snippet named `Order_Header` is reported even though some bundled examples
use the shorter form.

```mdl
create snippet Sales.SNIPPET_OrderHeader
(
  params: ( $Order: Sales.Order )
)
{
  layoutgrid OrderHeaderSnippet_HeaderLayout {
    row {
      column (desktopwidth: 12) {
        dynamictext OrderHeaderSnippet_HeadingText (content: 'Order', rendermode: H3)
      }
    }
  }
}
```

Used from every page that needs it:

```mdl
snippetcall OrderDetail_OrderHeaderSnippet (snippet: Sales.SNIPPET_OrderHeader, params: {Order: $Order})
```

A snippet with a parameter is what lets the same block render different data on
each screen, which is what keeps you from needing a second near-identical snippet.
The full page-side syntax is in [overview-pages](../../../.ai-context/skills/overview-pages/SKILL.md).

One trap, measured on 11.13.0: inside a snippet's `params`, a **quoted** entity
name fails to resolve — `params: { $Invoice: RT."Invoice" }` exits with
`entity not found: RT."Invoice"` even though the entity exists. Write the entity
unquoted there (`RT.Invoice`), whatever the general quoting advice says.

A snippet used by two processes belongs in the module's `_Shared/` folder — see
[module-structure](../module-structure/SKILL.md).

## Snippets, not fragments

A `define fragment` is **not** a way to share a view. Fragments are script-scoped
and transient: they are expanded into deep-cloned copies at execution time and
never exist in the app, so a later change to the fragment does not reach the pages
that used it. See [fragments](../../../.ai-context/skills/fragments/SKILL.md).

- **Snippet** — a real document in the model, edited once, live on every page that
  calls it. This is what "views should use snippets" means.
- **Fragment** — a scripting convenience for writing repetitive MDL in one file.

If the requirement is that the screens stay in step, it must be a snippet.

## The circular case

When a navigation snippet references pages (`show page`) and those pages reference
the snippet (`snippetcall`), neither can be created first. The placeholder pattern
in [overview-pages](../../../.ai-context/skills/overview-pages/SKILL.md) solves it: create a placeholder
snippet, create the pages, then fill the snippet in with
`create or modify snippet`.

Use `create or modify`, never `create or replace`, for that fill-in step —
`replace` mints a new UUID and silently breaks every page already pointing at the
old one. That warning is spelled out in `overview-pages`; read it there before
attempting the pattern.

## Check it

Both reuse rules read the model, so they are lint rules:

```bash
./mxcli lint -p app.mpr | grep -E 'REU001|CONV005'
```

`REU001` — a snippet used by fewer than two pages, or a `SUB_` with fewer than two
distinct callers. `CONV005` — a snippet not named `SNIPPET_…`. Both need a FULL
catalog for the reference counts; `mxcli lint` builds it on its own.

## Validation checklist

- [ ] The extracted thing answers "yes" to *when this changes, must the other change too?*
- [ ] A new `SUB_` has, or will genuinely have, more than one call site
- [ ] `show callers of` was consulted before duplicating an existing microflow
- [ ] A repeated widget block is a snippet, not a copied block and not a fragment
- [ ] Every snippet is named `SNIPPET_…`
- [ ] Near-identical pages were kept separate rather than merged behind conditions
- [ ] `./mxcli check script.mdl -p project.mpr --references` passes
