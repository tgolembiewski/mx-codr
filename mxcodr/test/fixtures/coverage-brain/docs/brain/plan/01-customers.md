# Slice: 01-customers

<!-- mxcli-brain -->

Requirements for this slice. Anchors point FORWARD, at what the slice
will build — an anchor that does not resolve yet means not built, not
stale. `mxcli brain plan` counts them against the model.

## R1 A customer sees only its own invoices

Anchors: `@Sales.Customer_Home` · id `405d28` · 2026-11-04

## R2 A customer cannot open the Customers list

Anchors: `@Sales.Customer_List` · id `f45e17` · 2026-11-04

## R9 Written by hand, no metadata line

The agent typed this heading itself.
