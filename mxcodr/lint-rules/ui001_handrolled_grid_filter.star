# UI001: A data grid filtered by hand instead of by its own column filters
#
# A DataGrid2 filters itself. Each column takes a filter widget — `textfilter`,
# `dropdownfilter` (enumeration, or an association with `Association:` +
# `datasource:` + `CaptionAttribute:`), `datefilter`, `numberfilter` — and the grid
# does the filtering against the database, keeps the chosen values in the user's
# personalisation and clears them itself.
#
# The pattern this rule catches builds that by hand instead: a non-persistent
# "filter" entity, input widgets bound to its attributes, an apply microflow on
# every OnChange, and an XPath on the grid that reads the filter object back.
#
# Measured on one generated app (B2BOrders.Order_List): eleven Boolean/String/Date
# attributes on a helper entity, three microflows (66 lines of MDL), six checkboxes,
# a combobox, two date pickers, a Clear button and 1,100 characters of XPath in the
# grid's data source — replaced by three lines, one per filtered column. The page
# went from 136 lines to about a third of that.
#
# What it does NOT flag: a data view over a PERSISTENT entity around a grid. That is
# a context object (the customer whose orders these are), not a filter bar. Nor does
# it flag a module where any column filter is already used — one is enough to show
# the author knows the mechanism and meant the rest.
#
# Scope is the MODULE, not the page: the reuse-and-snippets skill puts the grid in a
# snippet and the filter bar on the page that calls it, and a widget carries no
# reference to the snippet it calls, so a page-scoped rule misses exactly the shape
# the other skills ask for.

RULE_ID = "UI001"
RULE_NAME = "HandRolledGridFilter"
DESCRIPTION = "A data grid should use its own column filters, not a hand-built filter bar over a helper entity"
CATEGORY = "design"
SEVERITY = "warning"

# The grid, and the filter widgets that belong inside its columns.
GRID_TYPES = ("com.mendix.widget.web.datagrid.Datagrid",)
FILTER_MARKERS = ("datagriddropdownfilter", "datagriddatefilter",
                  "datagridtextfilter", "datagridnumberfilter")

# Widgets that a hand-built filter bar is made of. A filter bar is inputs bound to
# the helper entity's attributes; a grid's own columns bind the entity being listed.
INPUT_TYPES = ("Forms$CheckBox", "Forms$DatePicker", "Forms$TextBox",
               "Forms$DropDown", "Forms$RadioButtonGroup",
               "com.mendix.widget.web.combobox.Combobox")

# Two inputs on one helper entity is a bar; one is someone setting a single value.
MIN_INPUTS = 2


def entity_of_attribute(attribute_ref):
    """'Module.Entity.Attribute' -> 'Module.Entity'; empty when it is not that shape."""
    if not attribute_ref:
        return ""
    parts = attribute_ref.split(".")
    if len(parts) < 3:
        return ""
    return ".".join(parts[:-1])


def check():
    violations = []

    # Entities the model does not store: the helper a filter bar is built on.
    # entity_type reads "Persistent" / "NonPersistent" — not the upper-case spelling
    # the rule-writing guide suggests, which silently makes every entity match.
    non_persistent = {}
    for entity in entities():
        if entity.entity_type == "NonPersistent":
            non_persistent[entity.qualified_name] = True

    # Grouped by module: see the note above on snippets.
    grids = {}          # module -> a grid widget in it
    filters_seen = {}   # module -> True when a column filter is already used
    helper_inputs = {}  # module -> {helper entity: [(container, widget name)]}
    first_input = {}    # module+helper -> the widget to report the location of

    for widget in widgets():
        module = widget.module_name
        if not module:
            continue

        widget_type = widget.widget_type or ""
        lowered = widget_type.lower()

        for marker in FILTER_MARKERS:
            if marker in lowered:
                filters_seen[module] = True

        if widget_type in GRID_TYPES:
            grids[module] = widget
            continue

        if widget_type not in INPUT_TYPES:
            continue
        owner = entity_of_attribute(widget.attribute_ref)
        if not owner or owner not in non_persistent:
            continue
        by_entity = helper_inputs.get(module, {})
        names = by_entity.get(owner, [])
        names.append(widget.name)
        by_entity[owner] = names
        helper_inputs[module] = by_entity
        if module + "|" + owner not in first_input:
            first_input[module + "|" + owner] = widget

    for module in grids:
        if filters_seen.get(module, False):
            continue  # a column filter is already used here
        by_entity = helper_inputs.get(module, {})
        for helper in by_entity:
            names = by_entity[helper]
            if len(names) < MIN_INPUTS:
                continue
            widget = first_input[module + "|" + helper]
            violations.append(violation(
                message="'{}' has {} hand-built filter input(s) bound to the non-persistent entity '{}' ({}), and data grid '{}' in this module has no column filter.".format(
                    widget.container_qualified_name, len(names), helper,
                    ", ".join(sorted(names)[:4]), grids[module].name),
                location=location(
                    module=widget.module_name,
                    document_type=widget.container_type if widget.container_type else "Page",
                    document_name=widget.container_qualified_name,
                ),
                suggestion="Put the filter in the column it belongs to and delete the helper entity, its apply microflow and the XPath that reads it: column colStatus (attribute: Status) { dropdownfilter fltStatus }, column colCreated (attribute: DateCreated) { datefilter fltCreated (FilterType: between) }, column colCustomer (attribute: Order_Customer/Name) { dropdownfilter fltCustomer (Association: Module.Order_Customer, datasource: database Module.Customer, CaptionAttribute: Name) }",
            ))

    return violations
