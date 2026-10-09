# naming -- microflows and nanoflows (`check_mdl.cjs --skill naming`, skill `naming-and-captions`)

One line per code of the `naming` step; every code blocks DONE unless marked warning. The card: `tests/rulebook/<CODE>.md`.

| Code | Wants | Fix |
|---|---|---|
| `CAPTION01` | warning: every activity has a business @caption | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION02` | warning: no activity keeps Mendix's default caption | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION03` | warning: every decision has a @caption | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION04` | warning: a decision's caption ends with a question mark | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION05` | warning: a decision's caption is a question in words, not the expression | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION06` | warning: every loop has an @annotation saying what it walks | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION07` | no @caption on a loop: mxcli drops it, the annotation carries the text | Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block). |
| `CAPTION08` | warning: a case split's caption is not its own expression (mxcli overwrote it) |  |
| `DS01` | a list takes its rows from the database, not from a flow that only retrieves them | The `DataSource: database ...` it prints; `'[%CurrentObject%]'` for the enclosing object -- blocks DONE. |
| `ERR01` | warning: every error handler is noticed | `log error 'Saving failed: ' + $latestError/Message;` and `raise error;`; `on error continue` is mxcli's lint CONV014. |
| `EVENT01` | an event handler never commits its own object with events | `commit $Order without events;` in an after-commit handler; a before-commit handler only changes attributes -- blocks DONE. |
| `EVENT02` | a before handler that can refuse raises an error | `... on before commit call M.BCO_X($currentObject) raise error`, or the check in the ACT_ microflow with `validation feedback` -- blocks DONE. |
| `EVENT03` | warning: no without events on an entity whose handler does work | Set those values in the flow, or drop `without events`; inside the entity's own handler it is the fix, not a finding. |
| `EVENT04` | warning: no plain Save button on an entity a before handler can refuse | Save through an `ACT_` microflow: `validation feedback $X/Attr message '...';`, then commit; the handler stays as the last guard. |
| `PERF02` | warning: no loop over database rows that only adds them up | An OQL view entity computes totals in one query; `count()`/`sum()` after the retrieve is no faster. |
| `PERF03` | warning: no database call per row inside such a loop | One retrieve before the loop (XPath over the association), or an OQL view. |
| `PERF05` | warning: no whole table retrieved and then filtered with an if | The condition in the retrieve's XPath. |
| `PERF06` | warning: no loop that only keeps the largest or smallest value | `retrieve $Last from M.E where [...] sort by M.E.Attr desc first;`. |
| `PERF07` | warning: every query is served by an index | The line it prints: `alter entity M.E add index if not exists (A, B);`, `=` columns first; a query along an association needs none. |
| `PERF08` | warning: no index that no query needs | The `drop index if exists (...)` it prints, spelled as written; keep it if Java, other OQL or an outside client filters on it. |
| `REFRESH01` | a pop-up's Save commits with refresh | `commit $Invoice refresh;`, `change $Invoice (...) commit refresh;` -- blocks DONE. |
| `VAR01` | a variable name says what it holds | `$OpenInvoiceCount`, not `$Int1`, `$tmp`, `$x`. |
| `VAR02` | no _List, _Object or _Obj suffix on a variable | `$OverdueInvoices`, not `$Invoice_List`. |
