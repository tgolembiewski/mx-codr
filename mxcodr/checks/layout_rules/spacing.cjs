// SPACE01-03 (Atlas spacing between widgets on a line and under headings), HEAD01 (a page
// with no heading), ALERT01 (a box class on inline text). check() runs them over every page.
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { columnFilterFindings } = require('./controls.cjs');
const { SPACING_VALUES, isHeading, parse, runsOf, siblings, spacingOf } = require('./pages.cjs');

const spaced = (widget, key) => {
  const s = spacingOf(widget);
  return s.has(key) ? s.get(key) : 'None';
};

// SPACE02: a spacing value Atlas does not define.
function invalidValueFindings(widgets) {
  const failures = [];
  const allowed = py.sorted([...SPACING_VALUES]).join(', ');
  for (const widget of widgets) {
    for (const [key, value] of spacingOf(widget)) {
      if (!SPACING_VALUES.has(value)) {
        failures.push({
          check: 'SPACE02',
          line: widget.line,
          message: `${widget.page}: ${widget.type} '${widget.name}' sets ${key}: '${value}',` +
            ' which Atlas does not define -- use one of' +
            ` ${allowed}`,
        });
      }
    }
  }
  return failures;
}

// SPACE01: heading with a sibling below.
function headingFindings(page, group) {
  const failures = [];
  group.slice(0, -1).forEach((widget, index) => {
    if (!isHeading(widget)) return;
    if (spaced(widget, 'margin-bottom') !== 'None') return;
    failures.push({
      check: 'SPACE01',
      line: widget.line,
      message: `${page}: heading '${widget.name}' has nothing under it but` +
        ` ${group[index + 1].type} '${group[index + 1].name}' --` +
        " add DesignProperties: ['Spacing': ['margin-bottom': 'S']]",
    });
  });
  return failures;
}

// SPACE01: the last widget in a run has nothing to collide with.
function runGapFindings(page, run) {
  const failures = [];
  for (const widget of run.slice(0, -1)) {
    if (spaced(widget, 'margin-right') !== 'None') continue;
    const following = run[run.indexOf(widget) + 1];
    failures.push({
      check: 'SPACE01',
      line: widget.line,
      message: `${page}: ${widget.type} '${widget.name}' sits on one line with` +
        ` ${following.type} '${following.name}' and no gap between them` +
        " -- add DesignProperties: ['Spacing': ['margin-right': 'S']]",
    });
  }
  return failures;
}

// SPACE03: unequal vertical margins misalign the run; no margin-bottom makes wrapped rows touch.
function runAlignmentFindings(page, run) {
  const vertical = new Map();
  for (const w of run) vertical.set(w.name, [spaced(w, 'margin-top'), spaced(w, 'margin-bottom')]);
  const shown = [...vertical].map(([name, [top, bottom]]) => `${name} ${top}/${bottom}`).join(', ');
  const names = run.map(w => w.name).join(' and ');
  const distinct = new Set([...vertical.values()].map(v => JSON.stringify(v)));
  if (distinct.size > 1) {
    return [{
      check: 'SPACE03',
      line: run[0].line,
      message: `${page}: ${names} sit on one line with` +
        ' different vertical spacing, so they render at different heights' +
        ` (margin-top/bottom: ${shown}). Make those equal, and use` +
        ' margin-right for the gap between them',
    }];
  }
  if ([...vertical.values()].every(([, bottom]) => bottom === 'None')) {
    return [{
      check: 'SPACE03',
      line: run[0].line,
      message: `${page}: ${names} share a line and none` +
        ' carries margin-bottom, so on a narrow window the line wraps and' +
        ' the second row sits against the first -- add' +
        " ['margin-right': 'S', 'margin-bottom': 'S'] to each" +
        ' (the last one needs the bottom margin only)',
    }];
  }
  return [];
}

// {page: has a heading} (a Map); parsed widgets, since text "page <name>" also matches `grant view on page`.
function headedPages(widgets) {
  const headed = new Map();
  for (const widget of widgets) {
    if (!widget.page) continue;
    if (!headed.has(widget.page)) headed.set(widget.page, false);
    // A shared header snippet counts as a heading.
    if (widget.type === 'header' || isHeading(widget) ||
        (widget.type === 'snippetcall' && re.search(String.raw`Snippet:\s*[\w.]*(header|title|masthead)`, widget.text, 'i'))) {
      headed.set(widget.page, true);
    }
  }
  return headed;
}

// HEAD01: a page with no heading.
function missingHeadingWarnings(headed) {
  const warnings = [];
  for (const page of py.sorted([...headed.keys()])) {
    if (!headed.get(page)) {
      warnings.push({
        check: 'HEAD01',
        line: 0,
        message: `${page} renders no heading widget. Stock Atlas layouts show the app` +
          ' brand, not the page title, so a page with no heading opens' +
          ' unlabelled -- unless this app puts headings in a shared snippet',
      });
    }
  }
  return warnings;
}

// Atlas classes that draw a box around their content: they need a block element to hold it.
const BLOCK_CLASS_RE = re.compile(String.raw`Class:\s*'(?P<classes>[^']*\b(?:alert(?:-[\w-]+)?|card|well)\b[^']*)'`);

// ALERT01: a box class on an inline text widget. A cancellation notice written as
// `dynamictext (Class: 'alert alert-danger')` drew its red box over the line below it and
// the status badge beside it; the gate saw nothing, because the MDL was valid.
function blockClassFindings(widgets) {
  const warnings = [];
  for (const widget of widgets) {
    if (widget.type !== 'dynamictext' && widget.type !== 'text') continue;
    const found = BLOCK_CLASS_RE.search(widget.text);
    if (!found) continue;
    warnings.push({
      check: 'ALERT01',
      line: widget.line,
      message: `${widget.page}: ${widget.name} carries '${found.group('classes')}' on a ${widget.type},` +
        ' which renders inline, so the box overlaps what is around it -- put the class on a' +
        ` container and the text inside it: container ctNotice (Class: '${found.group('classes')}')` +
        ` { ${widget.type} ${widget.name} (...) } (skill spacing-and-layout, 'Alerts and notices')`,
    });
  }
  return warnings;
}

// [failures, warnings, page count].
function check(lines) {
  const widgets = parse(lines);
  const failures = invalidValueFindings(widgets);
  for (const [[page], group] of siblings(widgets)) {
    if (group.length < 2) continue;
    failures.push(...headingFindings(page, group));
    for (const run of runsOf(group)) {
      if (run.length < 2) continue;
      failures.push(...runGapFindings(page, run));
      failures.push(...runAlignmentFindings(page, run));
    }
  }
  failures.push(...columnFilterFindings(lines));
  const headed = headedPages(widgets);
  return [failures, [...missingHeadingWarnings(headed), ...blockClassFindings(widgets)], headed.size];
}

module.exports = { check };
