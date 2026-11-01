---
name: spacing-and-layout
description: "A finished-looking screen: Atlas Spacing instead of CSS, everything inside one layout grid, one layout for every page, a real navigation menu per role with icons and Log out last, Users and My account, a Back button top left on a page another page opens, who is signed in top right, an icon on every button, grids that filter themselves, long text in a text area, totals as tiles, stacked lists in tabs. Use before writing or altering any page, snippet, layout or menu."
---

# Spacing and layout

A screen can pass `mx check`, lint and every test and still look broken. Widget syntax is in mxcli's
`create-page` and `alter-page`; colour, type and branding in `atlas-design`.

## Spacing between widgets

**When widgets share a line, give them `margin-right` between them and the same `margin-bottom` on
all of them.** Inline means buttons, link buttons, paragraph text, images, checkboxes: Atlas puts
them on one line, and that line wraps when the window narrows.

```sql
actionbutton InvoiceDetail_EditButton (Caption: 'Edit', Action: show page Sales.Invoice_Edit(Invoice = $Invoice),
  Icon: 'Atlas_Core.Atlas_Filled.pencil', DesignProperties: ('Spacing': ('margin-right': 'S', 'margin-bottom': 'S')))
actionbutton InvoiceDetail_DeleteButton (Caption: 'Delete', Action: call microflow Sales.ACT_Invoice_Delete(Invoice = $Invoice),
  Icon: 'Atlas_Core.Atlas_Filled.trash-can', DesignProperties: ('Spacing': ('margin-right': 'S', 'margin-bottom': 'S')))
actionbutton InvoiceDetail_SendButton (Caption: 'Send', Action: call microflow Sales.ACT_Invoice_Send(Invoice = $Invoice),
  Icon: 'Atlas_Core.Atlas_Filled.email', DesignProperties: ('Spacing': ('margin-bottom': 'S')))
```

Each part left out has failed: no `margin-right`, the buttons touch; `margin-bottom` on one only, they
sit ten pixels out of line; none at all, a narrow window wraps the row against itself.

That is Studio Pro's own **Spacing** design property, not `Class:`, `Style:` or custom CSS.

- Sides: `margin-top|right|bottom|left`, the same as `padding-`; on any widget, row or column.
- Values: **`None` `S` `M` `L`** only. Atlas Core defines nothing else; `mxcli check` accepts `'XL'`
  and `mx check` then fails with CE6083 "Design property Spacing is not supported by your theme".
- A heading with something under it gets `margin-bottom` (`S` or `M`). So does a button or line of
  text right above or under a grid, list or card, a grid header's buttons included: Atlas gives
  neither side a vertical margin, so without it they touch.

Block widgets carry the theme's spacing; margins on them make it worse: inputs in a data view, `datagrid`,
`listview`, `gallery`, `layoutgrid`, `container`, `snippetcall`, a grid row or column, a footer or header.

## Structure: one layout grid, one layout

**When you place widgets on a page, put them all inside one `layoutgrid`,** the top row and heading too. The grid
makes the screen responsive (column widths put two things side by side on a desktop and stack them on
a phone), and it is the page's side margin: the Atlas_Core layouts add none, so a widget placed
straight on the page sits against the menu and the window edge. Pop-ups are framed by their own padding.

```sql
layoutgrid InvoiceOverview_PageLayout {
  row {
    column (DesktopWidth: 8) {
      dynamictext InvoiceOverview_HeadingText (Content: 'Invoices', RenderMode: H2, DesignProperties: ('Spacing': ('margin-bottom': 'S')))
    }
    column (DesktopWidth: 4) {
      actionbutton InvoiceOverview_PrintButton (Caption: 'Print', Action: call microflow Sales.ACT_Invoice_PrintList,
        Icon: 'Atlas_Core.Atlas_Filled.print', DesignProperties: ('Spacing': ('margin-bottom': 'S')))
    }
  }
  row {
    column (DesktopWidth: 12) {
      datagrid InvoiceOverview_InvoicesGrid (DataSource: database from Sales.Invoice) {
        column (Attribute: Number, Caption: 'Number') { textfilter InvoiceOverview_NumberFilter }
      }
    }
  }
}
```

**One layout for every page that is not a pop-up**: two layouts make the menu change shape as the user
moves. Pick it at the start, `Atlas_Core.Atlas_Default` (sidebar, hamburger on a phone) or
`Atlas_Core.Atlas_TopBar` for a top bar, and give every new page that `Layout:`, a template home page
too. Pop-ups, the login page and phone or tablet pages differ on purpose. To move existing pages:
`alter pages in Sales set layout = Atlas_Core.Atlas_Default where layout = Atlas_Core.Atlas_TopBar;`,
and the same `Layout:` in the scripts that create them, or a re-run moves them back.

**A heading on a page.** The page `Title:` feeds only the browser tab: a page with no heading widget
opens unlabelled. Either an `H1`-`H3` `dynamictext` in each page, or one header snippet every page calls
(see `reuse-and-snippets`), one way per app. A header (or signed-in bar) the request puts on every page
includes pop-ups: they call the same snippet.

**A page a person navigates to has a URL** (`Url: 'orders'`), so it can be bookmarked, shared and
reloaded; a page with an object parameter carries it, `Url: 'order/{Order/Id}'`. Pop-ups, the login
page and pages whose parameter cannot sit in a URL have none.

## Create and edit forms: pop-up or full page

**Pop-up** when the form is the object's own fields and fits a dialog without scrolling: one data view,
its inputs in one column, no grid, list, tabs or nested data view, no wide free text; it opens over the
list the user came from. **Full page** when the object is edited with related objects (a header with its
lines, a record with its attachments), the form needs tabs or a wide layout, or Save is out of sight.

```sql
create or modify page Sales.Customer_NewEdit (
  Params: ( $Customer: Sales.Customer ), Title: 'Edit customer',
  Layout: Atlas_Core.PopupLayout, PopupWidth: 600, PopupResizable: true
) {
  layoutgrid CustomerNewEdit_FormLayout {
    row {
      column (DesktopWidth: AutoFill) {
        dataview CustomerNewEdit_CustomerForm (DataSource: $Customer) {
          textbox CustomerNewEdit_NameInput (Label: 'Name', Attribute: Name)
          textarea CustomerNewEdit_NotesInput (Label: 'Notes', Attribute: Notes)
          footer {
            actionbutton CustomerNewEdit_SaveButton (Caption: 'Save', Action: save changes close page, ButtonStyle: Primary,
              Icon: 'Atlas_Core.Atlas_Filled.floppy-disk', DesignProperties: ('Spacing': ('margin-right': 'S')))
            actionbutton CustomerNewEdit_CancelButton (Caption: 'Cancel', Action: cancel changes close page,
              Icon: 'Atlas_Core.Atlas_Filled.remove')
          }
        }
      }
    }
  }
};
```

- A pop-up uses a layout of type `ModalPopup` (`Atlas_Core.PopupLayout`), which blocks the screen
  behind it; type `Popup` is not modal, never for a form (`SHOW LAYOUTS`, column Type). A full page
  uses the app's one layout. Only the layout differs; Save and Cancel close it either way.
- No `Url:` on a pop-up. `PopupWidth` / `PopupHeight` are optional (600 x 600) and case-sensitive.
- When Save runs a microflow that commits and closes the pop-up, commit with `refresh`
  (`commit $Customer refresh;`), or the list behind it shows the change only after a reload; the same
  for a delete in a page flow (`delete $Customer refresh;`), or the grid keeps the row.
- A form that differs for a new object (login fields only on create) cannot test `createdDate = empty`:
  the system sets it at create. Set a Boolean such as `IsBeingCreated` in the create flow, clear it on save.

## Inputs, captions and what is shown

- **A long text gets a text area**, a `textbox` is one line that scrolls sideways and loses line breaks:
  an attribute over 500 characters or unlimited (a bare `String`), or one named like prose
  (Description, Notes, Comment, Reason), is edited in a `textarea`.
- **Captions and labels are words**: `Caption: 'Due date'`, never the attribute name `DueDate`.
- **Money and totals get a pattern**: `formatDecimal($Order/Total, '#,##0.00')` shows `55,500.00`, not `9810`.
- **A widget nobody can see proves nothing.** No `Visible: false` widgets on a page, and no test reads
  data through one; show it, or drop it and check the data in the test.
- **A button that sets one status disappears once the object has it** (Send sets Sent, Finish sets
  Finished): `set (Visible: $Invoice/Status != Sales.InvoiceStatus.Sent) on InvoiceDetail_SendButton`
  in `alter page`, the same `Visible:` in the create script, and the flow checks the status too.
  "Disabled" in the request: keep it visible, `DynamicClasses: if $currentObject/Status =
  Sales.InvoiceStatus.Sent then 'disabled' else ''` (Atlas `.btn.disabled` stops the click; the flow refuses too).
- **An alert, card or well style goes on a container**, the text inside it: on a `dynamictext` the
  class lands on an inline span, so the box lies over the line below. A `badge` stays on the text.

```sql
container OrderDetail_CancelNoticeBox (Class: 'alert alert-danger',
  Visible: $Order/Status = Sales.OrderStatus.Cancelled,
  DesignProperties: ('Spacing': ('margin-bottom': 'M'))) {
  dynamictext OrderDetail_CancelNoticeText (Content: 'This order was cancelled.')
}
```

## Grids

- **A grid filters itself.** When a grid is filtered, use its own filter widgets (`textfilter`,
  `numberfilter`, `datefilter`, `dropdownfilter`), never text boxes and checkboxes over a helper
  entity. When a grid's rows grow with use (most overview and detail grids), give each attribute
  column a filter. A column with a filter keeps its `Attribute:`, or the filter shows "Unable to get
  filter store". When the request asks for a filter bar above the table, put the same widgets in the
  grid's `controlbar`, each linked to its column; filters in one bar combine with AND.
- **Buttons that change a grid's rows go in its header** (New, Delete selected, Mark paid): the
  grid's `controlbar`. It is not row-scoped: pass the grid's selection or a page parameter;
  `$currentObject` does not resolve there (CE0117). A button for one row stays in that row.
- **A DateTime column shows the time when a form edits the time.** Data grid 2 shows a DateTime as a
  date only, so 10:00-11:00 reads as two equal dates. Show it through a dynamic text, with the
  `$currentObject/` path (a bare attribute is CE0117).

```sql
datagrid OrderOverview_OrdersGrid (DataSource: database from Sales.Order, Selection: single) {
  controlbar {
    actionbutton OrderOverview_NewOrderButton (Caption: 'New order', Action: call microflow Sales.ACT_Order_New, ButtonStyle: Primary,
      Icon: 'Atlas_Core.Atlas_Filled.add', DesignProperties: ('Spacing': ('margin-right': 'S', 'margin-bottom': 'S')))
    actionbutton OrderOverview_MarkPaidButton (Caption: 'Mark paid', Action: call microflow Sales.ACT_Order_MarkPaid(Order = $OrderOverview_OrdersGrid),
      Icon: 'Atlas_Core.Atlas_Filled.checkmark', DesignProperties: ('Spacing': ('margin-bottom': 'S')))
    dropdownfilter OrderOverview_StatusFilter (attrchoice: linked, attributes: [Sales.Order.Status], multiSelect: true)
    dropdownfilter OrderOverview_CustomerFilter (association: Sales.Order_Customer, datasource: database Sales.Customer, captionattribute: Name)
  }
  column (Attribute: Number, Caption: 'Number') { textfilter OrderOverview_NumberFilter }
  column (Attribute: Status, Caption: 'Status')
  column (Attribute: Order_Customer/Name, Caption: 'Customer')
  column (Attribute: DeliverAt, Caption: 'Delivery', ShowContentAs: dynamicText, DynamicText: '{1}',
    DynamicTextParams: ({1} = formatDateTime($currentObject/DeliverAt, 'd MMM yyyy, HH:mm'))) { datefilter OrderOverview_DeliverAtFilter }
}
```

## Lists, totals and tabs

- **A list item with buttons is one row that does not wrap**: texts in a box on the left, buttons in one
  on the right. A text with `RenderMode: Paragraph` or `H4`-`H6` starts its own line: no margins needed.

```sql
listview MyJobs_JobsList (DataSource: database from Field.RepairJob) {
  container MyJobs_JobsCardBox (DesignProperties: ('Flex container': 'Horizontal (row)',
      'Align items X': 'Space between (only for horizontal containers)', 'Align items Y': 'Center',
      'Disable row wrap': ON, 'Spacing': ('padding': 'M'))) {
    container MyJobs_JobsInfoBox {
      dynamictext MyJobs_NumberText (Content: '{1}', RenderMode: H4, ContentParams: ({1} = Number))
      dynamictext MyJobs_StatusText (Content: 'Status {1}', RenderMode: Paragraph, ContentParams: ({1} = Status))
    }
    container MyJobs_JobsActionsBox {
      actionbutton MyJobs_OpenButton (Caption: 'Open', Action: show page Field.Job_Detail(Job = $currentObject),
        Icon: 'Atlas_Core.Atlas_Filled.view')
    }
  }
}
```

- **Totals are tiles.** A view that always holds one row (totals, no group by) is shown as tiles, not
  a list: a data view fed by a microflow, one `card` container a figure, in grid columns.
- **Stacked lists go in tabs.** Two or more lists (data grid, list view, gallery) one under another on
  a page go in one `tabcontainer`: one list a `tabpage`, the heading that stood over the list as its
  `Caption:`, so nobody scrolls past one list to find the next. Not stacked: lists side by side in
  columns of one row (each `DesktopWidth` below 12), or a list already in a tab page. Two lists used
  at once (pick from one, fill the other) go side by side instead. On a phone or tablet page, an
  object's form with a list of its related objects under it goes in tabs too, the object's tab first.
  The widgets keep their names; a test clicks the tab (`.mx-name-<tab>`) before it reads its list.
- **A chart fits one screen.** Every chart (`barchart`, `columnchart`, `linechart`, `areachart`, `piechart`
  ...) gets `heightUnit: 'pixels', height: 360` (300-450) and `widthUnit: 'percentage', width: 100`, never
  the default: its height is a share of the width, taller than the screen on a wide window. A chart of
  the last N months, weeks or days has N bars, empty periods too (a group-by view drops them), labelled
  with text (a number, date or `'yyyy-MM'` label draws a date axis): N non-persistent rows built in the
  data-source microflow, oldest first, 0 when empty, labelled `formatDateTime($Start, 'MMM yyyy')`.

```sql
dataview SalesDashboard_TotalsForm (DataSource: microflow Sales.DS_SalesTotals) {
  layoutgrid SalesDashboard_TotalsLayout { row { column (DesktopWidth: 4) {
    container SalesDashboard_OpenBox (Class: 'card') {
      dynamictext SalesDashboard_OpenText (Content: '{1}', RenderMode: H2, ContentParams: ({1} = OpenCount))
      dynamictext SalesDashboard_OpenLabelText (Content: 'Open orders')
    }
  } } }
}
layoutgrid CustomerDetail_PageLayout { row { column (DesktopWidth: 12) {
  tabcontainer CustomerDetail_ListsTabs {
    tabpage CustomerDetail_OrdersTab (Caption: 'Orders') {
      datagrid CustomerDetail_OrdersGrid (DataSource: database from Sales.Order where [Sales.Order_Customer = $Customer]) { column (Attribute: Number, Caption: 'Number') }
    }
    tabpage CustomerDetail_InvoicesTab (Caption: 'Invoices') {
      datagrid CustomerDetail_InvoicesGrid (DataSource: database from Sales.Invoice where [Sales.Invoice_Customer = $Customer]) { column (Attribute: Number, Caption: 'Number') }
    }
  }
  barchart CustomerDetail_MonthsChart (widthUnit: 'percentage', width: 100, heightUnit: 'pixels', height: 360) {
    series CustomerDetail_MonthsSeries (dataSet: 'static', DataSource: database from Sales.MonthTotal, staticXAttribute: Label, staticYAttribute: Total, staticName: 'Revenue')
  }
} } }
```

## Buttons have icons

When you add an `actionbutton` or `linkbutton`, give it an icon from `Atlas_Core.Atlas_Filled` that
shows what it does (`Icon: 'Atlas_Core.Atlas_Filled.floppy-disk'`):

| The button | Icon |
|---|---|
| Back (`close page`) | `chevron-left` |
| Save / Cancel, Close / Delete, Remove | `floppy-disk` / `remove` / `trash-can` |
| New, Add / Edit / Open, View | `add` / `pencil` / `view` |
| Next, Move to ... / Approve, Submit / Reject | `arrow-right` / `checkmark` / `thumbs-down` |
| Send, Email / PDF / Invoice | `email` / `file-pdf` / `cash-payment-bill` |
| Download, Export / Upload, Import | `download-bottom` / `upload-bottom` |
| Search / Filter / Print / Refresh, Reset / Copy | `search` / `filter` / `print` / `refresh` / `copy` |
| Log out | `logout` |

Anything else: `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled` lists the names.

## Back, top left, on a page another page opens

When a page is opened from another page or a microflow (`show page`), its first widget is a **Back**
button, top left above the heading, or a detail page reached from a list is a dead end:
`actionbutton X_BackButton (Caption: 'Back', Action: close page, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')`.
`close page` returns to wherever the user came from; never a `show page` back to a fixed page. A menu
or home page needs none, even when a flow shows it again; a pop-up closes with its X. When users sign
in, Back shares the top row with who is signed in: [reference/signed-in-user.md](reference/signed-in-user.md).

## When users sign in: menu and signed-in user

- **The menu** is the navigation profile's own, on the app's one layout: one menu for every role
  (Mendix hides what a role cannot open), an icon per item, different icons for what one role sees,
  every role's home page in it, Users for administrators, My account for everyone, Log out last. Never
  a row of buttons built into a layout. Every role that signs in includes `Administration.User`, and
  a role holds `Administration.Administrator`. When the app has sign-in, administrators start on a
  page of the app's own module. How, with the MDL: [reference/menu.md](reference/menu.md); read it
  before writing or changing the menu.
- **Who is signed in**, top right of every page (the login page aside; pop-ups too when the request says
  every page), clicking through to My account: the entity, data-source microflow, snippet and top row
  are in [reference/signed-in-user.md](reference/signed-in-user.md); read it before the first page.

## The app starts every time

When the app has an after-startup microflow (a seed), it returns true on every path: false stops the
app, so a seed that returns false once its rows exist fails every restart after the first.

## Phone and offline

When the app has a phone, tablet or offline profile, read mxcli's `manage-navigation` (profiles, sync,
progressive web app); phone pages list items as list-view cards, not a grid, under a one-row top bar.

## Fixing an existing page

`alter page`'s `set` takes no `DesignProperties` map: `describe page` to a file, add the property,
`./mxcli check` and `./mxcli exec` it (`choose-edit-mode` for a page you did not write). Then look in
the browser, narrow too: a grid with more columns than a phone fits cuts content off sideways.
