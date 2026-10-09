# catalog -- rules the model catalog answers (`catalog_rules.cjs`); mxcli lint on request

One line per code of the `catalog` step; every code blocks DONE unless marked warning. The card: `tests/rulebook/<CODE>.md`.

| Code | Wants | Fix |
|---|---|---|
| `LINT01` | off unless the rulebook turns it on: mxcli's own lint advice, on request | Set `level: warn` below to see them under the gate's warnings, `block` to make lint errors block. |
| `SEC007` | anonymous users cannot read every row of an entity (DIVD-2022-00019) | An XPath constraint on the anonymous role's read rule, or revoke the grant if the data is not public. |
| `UI001` | a data grid filters itself, not through a hand-built filter bar | One filter in the column (`textfilter`, `numberfilter`, `datefilter`, `dropdownfilter`, for an association `(Association: ..., datasource: database ..., CaptionAttribute: ...)`); never a filter bar over a helper entity. |
