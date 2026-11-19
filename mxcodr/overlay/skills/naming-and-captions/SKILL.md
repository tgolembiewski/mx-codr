---
name: naming-and-captions
description: "Business-readable names and captions: a variable says what it holds, never its type; every activity and decision carries a caption in business words, a decision's as a question; a loop's text in its annotation; every widget named `<Page>_<What><Type>`, unique in the app. Use when writing or changing any microflow, nanoflow, rule or page."
---

# Naming and captions

A microflow is read in Studio Pro as a diagram, by people who did not write it: they see the variable names and
the captions on the boxes. This skill makes the flow, and the page, readable from the canvas without opening a shape.

## Caption every activity as you write it

**Every retrieve, create, change, commit, delete, rollback, call, show page, close page, show message,
log, list operation, validation feedback, `declare` and `set` gets an `@caption` on the line above it, typed
together with the statement**: a short verb phrase saying what the step does for the business (`Record the
approval`), never Mendix's default (`Change Order`, *"Call microflow SUB_User_DisplayName"*). A call that
stores its result and a create (`$Line = create ...`) count too. Every decision's `@caption` is the question
it answers (`Waiting for approval?`, below). Activities are the ones that get forgotten:

- `'Load the current board'` not `'Retrieve Game'`; `'Open the decoding board'` not `'Show page Game_Board'`
- `'Score the seated line'` not `'Call microflow SUB_Game_Score'`; `'Mark hidden peg 1 as taken'` not `'Change variable'`

Nor a caption that only restates its line (*"Save the ticket"* over `commit $Ticket`, *"Work out the
value"* over a `set`) or a placeholder: say why the step runs (*"Record who closed the ticket"*). If the
honest caption equals the default, find the business operation.

```mdl
  @caption 'Waiting for approval?'
  if $Order/ApprovalStatus != Sales.ApprovalStatus.Pending then
    return false;
  end if;
  @caption 'Find who is deciding'
  $DeciderName = call microflow Sales.SUB_User_DisplayName();
  @caption 'Load the order''s lines'
  retrieve $OrderLines from Sales.OrderLine where Sales.OrderLine_Order = $Order;
  @caption 'Record the approval'
  change $Order (ApprovalStatus = Sales.ApprovalStatus.Approved, DecisionBy = $DeciderName) commit;
  @caption 'Open the approved order'
  show page Sales.Order_Details (Order = $Order);
```

## Before you finish a flow

No lint rule sees activity captions (CONV012 is decisions only). Read the flow back (`./mxcli -p app.mpr -c
"describe microflow Module.Flow"`) and check, line by line: **every statement has an `@caption` line
directly above it** -- except `return`, `raise error`, the structure (`begin`, `end ...`, `else`, `when`)
and loops, which take an `@annotation`. One statement without, or with a caption that is the default
(`Commit $Line`), and the flow is not done: add the caption and read it again.

One more thing `./mxcli check` passes and the build fails with CE0117: a `{1}` in `show message`, `log` or `validation feedback` that is not a String (`with ({1} = toString($LineCount))`, not `$LineCount`).
`check` refuses the other CE0117 causes, so write them right first: `count` in its own step (`$LineCount = count $Lines;`), an `if` operand in parentheses (`'Total: ' + (if $Paid then 'paid' else 'open')`), and no OQL in an expression: `startsWith`/`endsWith`/`contains` for `like`, `$N >= 1 and $N <= 5` for `between`, `$N = 1 or $N = 2` for `in (...)`, `$S = empty` for `is null`.

## Variable names

**Name what the value means to the business, in as few words as stay clear.**

Good names are short, unabbreviated, and would make sense to whoever asked for the feature:

- `$OverdueInvoices`, not `$List1`, `$tmp`, `$x`
- `$UnpaidCount`, not `$Int1`
- `$IsAboveApprovalLimit`, not `$Bool2`

Boolean *attributes* follow the same idea with a fixed prefix — `Is`, `Has`, `Can`, `Should`, `Was`, `Will` — and lint rule **CONV001** enforces it.

### Do not restate the type in the name

The type is already on the variable: `$Invoice_List`, `$Order_Object` or `$Order_Obj` spends the one
label you get on what the model already shows. Name what distinguishes *this* list from any other list of
the same type:

- `$Invoice_List` → `$OverdueInvoices`
- `$Customer_List` → `$CustomersWithoutEmail`
- `$OrderList2` → `$OrdersAwaitingApproval`

`$Order` is fine when there is one order in the flow; with two, `$OriginalOrder` and `$ReplacementOrder`
beat `$Order` and `$Order2`.

When two members take the same new value (`Quantity` and `NetValue` from one change), compute it once into a named
variable and use the variable in both: repeated arithmetic in one change has read a stale value (`8,250.00` for `6,900.00`).

## Widget names

Mendix keeps a widget name unique on its page only, so `heading`, `btnBack` and `ctPageTop`
end up on every page, and `k1Value` says nothing. A test's `.mx-name-...`, a failure and a log
line then point at a dozen places. **Name every widget `<Page>_<What><Type>`:**

- **Page**: the page's name without module and underscore -- `Order_Detail` is `OrderDetail`.
  In a snippet: its name without `SNIPPET_`, plus `Snippet` -- `CurrentUserSnippet`.
  The page part makes the name unique in the app.
- **What**: whole business words -- the attribute, the action, what it shows.
- **Type**: one word at the end.

| Widget | Type word | Widget | Type word |
|---|---|---|---|
| actionbutton | `Button` | datagrid | `Grid` |
| linkbutton | `Link` | listview, gallery | `List` |
| textbox, textarea | `Input` | dataview | `Form` |
| combobox | `Picker` | container, groupbox | `Box` |
| datepicker | `Date` | layoutgrid | `Layout` |
| checkbox, radiobuttons | `Choice` | snippetcall | `Snippet` |
| dynamictext, text | `Text` | grid filter | `Filter` |
| image | `Image` | tabcontainer / tab page | `Tabs` / `Tab` |

```sql
create page Shop.Order_Detail (Title: 'Order', Layout: Atlas_Core.Atlas_Default, Params: ( $Order: Shop.Order )) {
  layoutgrid OrderDetail_PageLayout {
    row { column (DesktopWidth: 12) {
      dataview OrderDetail_OrderForm (DataSource: $Order) {
        dynamictext OrderDetail_TitleText (Content: 'Order {1}', ContentParams: ({1} = Number), RenderMode: H2)
        combobox OrderDetail_PriorityPicker (Label: 'Priority', Attribute: Priority)
        actionbutton OrderDetail_GenerateInvoiceButton (Caption: 'Generate invoice', Action: close page)
      }
    } }
  }
};
```

A tile, a value or a section heading is named after what it shows: `Dashboard_OverdueKpiBox`,
`Dashboard_OverdueValueText` -- never `ctKpi3`, `k3Value`, a number at the end or Studio Pro's
`textBox1`. Name them as you write the page: a name repeated on a second page, or one off the
pattern, is a rename later, and renaming a widget breaks a test that finds `.mx-name-<old>`:
rename both.

## Quotes and line breaks in captions and texts

Escape a single quote by doubling it: `@caption 'Load the customer''s invoices'`. A backslash is no
escape in an MDL string: `'a\nb'` is four characters, so a text built with `\n` or `\t` shows them as
they are. Build multi-line text (a generated document) in the Java action that makes it.

## Decision captions

**Every decision's caption is the question it answers**, so both outgoing branches read as its answer.
An `if` with no `@caption` does not come out blank: Mendix fills the caption with the expression itself
(`'$Invoice/IsPaid = false'`), which tells a reader nothing. The decision's `@caption` goes on the line
directly above the `if`, after any `@position`; an `@annotation` goes after the caption, never before it
(before, mxcli turns it into a free note attached to nothing).

```mdl
@caption 'Invoice still unpaid?'
if $Invoice/IsPaid = false then
  set $UnpaidCount = $UnpaidCount + 1;
end if;
```

- Say what is decided, ending with `?`: `'Order over approval limit?'`
- Not a restatement of the expression: `'TotalAmount > 1000'`
- Not what happens next: `'Go to escalation'` — that is the branch, not the question

mxcli lints it as **CONV012**, "all decision points must have captions". Before finishing, `./mxcli lint`
must show no CONV012; every `if` you wrote has a caption.

### The exception: `loop` and `while`

A Mendix loop has no caption property, so `@caption` on a `loop` or `while` is dropped (`mxcli check` warns)
-- but a loop takes an `@annotation`, a note as if drawn in Studio Pro:

```mdl
@annotation 'Fill the chart one month at a time, oldest first'
while $MonthBack >= 0
begin
  set $MonthBack = $MonthBack - 1;
end while;
```

An annotation is drawn at the **loop's own `@position`**, not beside it, so at the default position it
can land across the branch labels of a split inside the loop. Move the loop's position if that happens;
leave the rest of the generated layout alone.

## Flows that are safe to read

Where the flow does something the canvas does not say:

- **An error handler is noticed.** When you add an `on error` handler, have it log, show a
  message, `raise error;` or return, and let its log name the error itself
  (`$latestError/Message`, or `$latestHttpResponse` after a REST call), not only that
  something failed. `on error continue` with nothing else hides the failure (lint CONV014).
- **An after-commit handler commits its own object `without events`**; with events it
  starts itself again, without end. A before-commit handler only changes attributes.
- **A before-commit handler that can return false is registered with `raise error`**,
  or the save is skipped and the user gets no message. Better still, put the check in
  the `ACT_` microflow behind the Save button with `validation feedback`, and keep the
  handler as the last guard: a plain Save button over such an entity shows only "An
  error has occurred".
- **`without events` on an entity whose handler sets or checks something** skips that
  work silently. Set those values in the flow, or keep the events; inside the entity's
  own handler `without events` is right.

```mdl
@caption 'Store the order'
commit $Order
  on error begin
    @caption 'Record why the order was not stored'
    log error 'Saving order {1} failed: {2}' with ({1} = $Order/Number, {2} = $latestError/Message);
    raise error;
  end error;
```

## Let the database do it

A loop over database rows reads well and runs slowly. When the flow only needs a total, a count, the
newest row or a subset, ask the database for exactly that:

- Totals and counts over many rows: an OQL view entity (mxcli's `write-oql-queries`)
  computes them in one query; `count()` or `sum()` after a full retrieve is no faster.
- No retrieve, Java action or data-reading sub-microflow per row inside a loop: one
  retrieve before the loop, over the association, or an OQL view.
- A subset: put the condition in the retrieve's XPath, not in an `if` after it.
- The largest or smallest: one sorted retrieve of the first row, not a loop that keeps
  the highest value.
- An index for each search the app makes, `=` columns first; drop an index no search
  uses (it only slows saving), unless Java, OQL or an outside client filters on it.
- A grid, list view or gallery whose data source flow only retrieves rows takes a
  `database` data source instead (`'[%CurrentObject%]'` for the enclosing object), so
  the database pages, sorts and filters; drop the old flow in the same script.
- A grid over a view entity shows the view's own columns: compute a value in the view's
  OQL, not in a column expression through an association, which fails at runtime
  (`Operator * not supported in expression *(, 100)`).

```mdl
@caption 'Find the latest reminder for the invoice'
retrieve $LatestReminder from Chasing.Reminder
  where [Chasing.Reminder_Invoice = $Invoice]
  sort by Chasing.Reminder.SentOn desc
  first;
```

## Where the activities go

**Nowhere you have to decide.** Leave `@position` out and mxcli lays the flow out
(mendixlabs/mxcli#1154). A statement that carries `@position` is **never moved**, so a few
hand-placed statements in an automatic flow overlap boxes and lines. Place everything or
nothing; prefer nothing.

## Validation checklist

- [ ] No variable named `$Int1`, `$tmp`, or only its own type (`$Invoice_List`); no loop does what one retrieve could
- [ ] Every widget named `<Page>_<What><Type>` (`OrderDetail_GenerateInvoiceButton`)
- [ ] Every `if` caption is a question — not the expression Mendix fills in by default
- [ ] Every activity (every statement but `return`, `raise error`, structure and loops) has a business-operation `@caption` — none read as Retrieve/Change/Commit/Call/Show page + type
- [ ] Loops labelled with `@annotation`, never `@caption`
- [ ] `./mxcli check script.mdl` warns about no dropped loop caption
