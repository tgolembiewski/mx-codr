---
name: naming-and-captions
description: "Business-readable variable names and captions in microflows — name what a value means rather than restating its type, caption every decision with the question it answers, and caption every retrieve, create, change, commit, delete, call and show-page with a short business operation (never the Mendix default). Use when writing or changing any microflow, nanoflow or rule."
---

# Naming and captions

A microflow is read in Studio Pro as a diagram, by people who did not write it.
What they see is the variable names and the captions on the boxes. If those only
repeat the type and the activity kind, the diagram carries no information and the
reader has to open every shape.

This skill is about making the flow readable from the canvas.

## When to Use This Skill

Use it when:

- Declaring or assigning any variable in a microflow, nanoflow or rule
- Adding a decision (`if`, `case`) to a flow
- Adding a retrieve, create, change, commit or call activity
- Reviewing a flow that is hard to follow

## Variable names

**Name what the value means to the business, in as few words as stay clear.**

Good names are short, unabbreviated, and would make sense to whoever asked for
the feature:

- `$OverdueInvoices`, not `$List1`, `$tmp`, `$x`
- `$UnpaidCount`, not `$Int1`
- `$IsAboveApprovalLimit`, not `$Bool2`

Boolean *attributes* follow the same idea with a fixed prefix — `Is`, `Has`, `Can`,
`Should`, `Was`, `Will` — and lint rule **CONV001** enforces it.

### Do not restate the type in the name

The type is already on the variable. A variable declared `list of Sales.Invoice`
is visibly a list of invoices, so `$Invoice_List` adds nothing a reader did not
already have — it spends the one label you get on information the model already
shows.

Name the thing that distinguishes *this* list from any other list of the same
type:

- `$Invoice_List` → `$OverdueInvoices`
- `$Customer_List` → `$CustomersWithoutEmail`
- `$OrderList2` → `$OrdersAwaitingApproval`

The same applies to single objects: `$Order` is fine when there is one order in
the flow, but when there are two, `$OriginalOrder` and `$ReplacementOrder` beat
`$Order` and `$Order2`.

Where the standard `Entity_List` shape *is* the whole meaning — a plain
"everything of this type" data source — the flow name already says so
(`DS_Invoice_GetAll`), so the variable still does not need to repeat it.

## Activity captions

Mendix auto-generates a caption for every activity, and the default usually
repeats the activity kind and the type: *"Retrieve Invoice"*, *"Change Order"*,
*"Call microflow SUB_Game_Score"*, *"Show page Game_Board"*, *"Change variable"*.
That is the information the shape's own icon and the variable name already carry.

**Every retrieve, create, change, commit, delete, call, show-page and
change-variable (`set`) must have an `@caption` that is a short business
operation** — the same force as a decision caption. A flow that only captions
`if`s is not finished.

Say what the step does in the process, in a verb phrase:

- `'Load the current board'` not `'Retrieve Game'`
- `'Score the seated line'` not `'Call microflow SUB_Game_Score'`
- `'Open the decoding board'` not `'Show page Game_Board'`
- `'Mark hidden peg 1 as taken'` not `'Change variable'`

```mdl
@caption 'Load unpaid invoices'
retrieve $OverdueInvoices from Sales.Invoice where [IsPaid = false];

@caption 'Record the unpaid count'
change $Run (UnpaidCount = $UnpaidCount) commit;
```

Do not ship a caption that restates the Mendix default (activity kind + type).
If the honest caption would be identical to that default, the activity is not
yet named — find the business operation, do not type the default out by hand.

Escape a single quote by doubling it: `@caption 'Load the customer''s invoices'`.

`check_mdl.py --skill naming` fails on a missing action `@caption` and on a
caption that is still the generated default. The gate runs it over every microflow
and nanoflow in the app's own modules on every full run (the `naming:` line of its
summary), so there is nothing to run by hand after a flow lands; the command below is
for checking one draft before it goes in.

## Decision captions

**Every decision's caption is the question it answers**, so both outgoing branches
read as its answer. Note the rule is about *what* the caption says, not whether one
exists: an `if` with no `@caption` does not come out blank — Mendix fills the
caption with the expression itself (`'$Invoice/IsPaid = false'`), which is exactly
the caption that tells a reader nothing.

```mdl
@caption 'Invoice still unpaid?'
if $Invoice/IsPaid = false then
  set $UnpaidCount = $UnpaidCount + 1;
end if;
```

- Say what is decided: `'Order over approval limit?'`
- Not a restatement of the expression: `'TotalAmount > 1000'`
- Not what happens next: `'Go to escalation'` — that is the branch, not the question

This is the guideline [assess-quality](../../../.ai-context/skills/assess-quality/SKILL.md) lists as
**CONV012**, "all decision points must have captions".

### The two exceptions: `loop` and `case`

**Loop.** A Mendix for-loop has no caption property, so `@caption` on a `loop` is
silently dropped and `mxcli check` reports **MDL042** — but a loop does take an
`@annotation`, which attaches a note exactly as if you had drawn one in Studio Pro:

```mdl
@annotation 'One pass over the customer''s invoices'
loop $Invoice in $Invoices
begin
  set $UnpaidCount = $UnpaidCount + 1;
end loop;
```

An annotation is drawn at the **loop's own `@position`**, not beside it, so at the
default position it can land across the branch labels of a split inside the loop.
Move the loop's position if that happens; leave the rest of the generated layout
alone.

**Case.** An enum or object split takes neither. mxcli always writes the split's own
expression as the caption and discards both `@caption` and `@annotation` on it,
with no warning from `mxcli check`. Measured on 11.13.0: `@caption 'Where does this
invoice stand?'` and `@annotation 'Which state is it in?'` both came back out of
`describe` as `@caption '$Invoice/Status'`. So a split cannot be labelled from MDL
today — label it in Studio Pro if the expression is not enough, and put the meaning
in the branch bodies:

```mdl
-- Not labelled from MDL: mxcli writes '$Order/Status' as this split's caption
-- whatever the script says. Label it in Studio Pro if the expression is not enough.
case $Order/Status
  when Draft then
    set $Handled = false;
  when Approved then
    set $Handled = true;
  when (empty) then
    set $Handled = false;
end case;
```

## Worked example

Everything above in one flow. Before:

```mdl
create microflow Sales.SUB_Invoice_Check (
  $Invoice_List: list of Sales.Invoice
)
returns Integer as $Int1
begin
  declare $Int1 Integer = 0;

  loop $Invoice in $Invoice_List
  begin
    if $Invoice/IsPaid = false then
      set $Int1 = $Int1 + 1;
    end if;
  end loop;

  return $Int1;
end;
```

After:

```mdl
create microflow Sales.SUB_Invoice_CountUnpaid (
  $Invoices: list of Sales.Invoice
)
returns Integer as $UnpaidCount
begin
  declare $UnpaidCount Integer = 0;

  @annotation 'One pass over the customer''s invoices'
  loop $Invoice in $Invoices
  begin
    @caption 'Invoice still unpaid?'
    if $Invoice/IsPaid = false then
      @caption 'Count an unpaid invoice'
      set $UnpaidCount = $UnpaidCount + 1;
    end if;
  end loop;

  return $UnpaidCount;
end;
```

Same logic, and the canvas now answers "what does this flow do?" without opening
a single shape.

## Check it

Captions, annotations and positions are not in the model catalog, so no lint rule
can see them; the check reads the flow back out of the `.mpr`:

```bash
./mxcli -p app.mpr -c "describe microflow Module.Flow" > /tmp/flow.mdl
python3 tools/mdl-checks/check_mdl.py /tmp/flow.mdl --skill naming
```

Exit 0 is clean. It reports placeholder names, type-echo names, a caption that
restates its expression or is not a question, a retrieve/create/change/commit/
delete/call/show-page/`set` without a business-operation `@caption` or with a
Mendix default caption, `@caption` on a loop and a loop without `@annotation`.
Canvas geometry is not checked — mxcli draws it. (In this repo the checker is
`tests/skills/check_mdl.py`; `tools/mdl-checks/` is where `install.sh` puts it in an
installed project.)

## Where the activities go

**Nowhere you have to decide.** Leave `@position` out and mxcli lays the flow out: the
main line wraps onto rows past two canvas widths, a guard's branch drops into the lane
below while the main line carries on above it, a `case` of four or more branches leaves
the decision in three groups so its lines do not cross, and a note sits above the
element it documents (mendixlabs/mxcli#1154).

A statement that carries `@position` is **never moved**, and it is not measured against
what the builder places around it — so a few hand-placed statements in an otherwise
automatic flow are what produces overlapping boxes and lines through activities. Place
everything or nothing, and prefer nothing.

## Validation checklist

- [ ] No variable named `$Int1`, `$List2`, `$tmp` or similar
- [ ] No variable name that only restates its own type (`$Invoice_List`)
- [ ] Every `if` and `while` caption is a question — not the expression Mendix fills in by default
- [ ] Every retrieve, create, change, commit, delete, call, show-page and `set` has a business-operation `@caption` — none read as Retrieve/Change/Commit/Call/Show page + type
- [ ] Loops labelled with `@annotation`, never `@caption`; splits left unlabelled (mxcli drops both)
- [ ] `./mxcli check script.mdl` reports no MDL042
