// The naming-and-captions rules check_mdl.cjs runs on flow MDL: captions on decisions, loops and
// actions (CAPTION01-08), variable names (VAR01, VAR02), and a commit without `refresh` in a
// microflow that closes its page (REFRESH01). Each rule takes the dump's lines and returns findings.
'use strict';
const py = require('./py_compat.cjs');
const { rx } = py;
const { perfFindings } = require('./perf_rules.cjs');

// Any `@word rest`; group 1 is the word (caption, annotation, position).
const ANNOTATION_RE = rx(String.raw`^\s*@(\w+)\s*(.*)$`);
const CAPTION_RE = rx(String.raw`^\s*@caption\s+'(.*)'\s*$`, 'i');
const DECISION_RE = rx(String.raw`^\s*(if|case)\b`, 'i');
// A `while` is a loop, not a decision: mxcli writes no caption for it -- `@caption` passes
// `check` and `exec` and is gone from `describe`, with no MDL042 to say so -- while
// `@annotation` survives. Treated as a decision, it failed CAPTION03 with no way to pass:
// a Pi session spent 45 minutes on three such findings.
const LOOP_RE = rx(String.raw`^\s*(loop|while)\b`, 'i');
// Activity lines; `create` needs a qualified entity so `create microflow` is not matched.
const ACTION_RE = rx(String.raw`^\s*(?:` +
  String.raw`retrieve\b|` +
  String.raw`change\s+\$|` +
  String.raw`commit\s+\$|` +
  String.raw`delete\s+\$|` +
  String.raw`(?:\$\w+\s*=\s*)?create\s+\w+\.|` +
  String.raw`show\s+page\b|` +
  String.raw`set\s+\$|` +
  String.raw`(?:\$\w+\s*=\s*)?call\s+(?:microflow|nanoflow)\b` +
  ')', 'i');
// Mendix default captions: verb + one name ("Retrieve Invoice") or a fixed phrase ("Commit object").
const DEFAULT_ACTION_CAPTION_RE = rx(String.raw`^(?:` +
  String.raw`(?:Retrieve|Change|Commit|Delete|Create)\s+[A-Z][\w.]*|` +
  'Change variable|' +
  'Commit object|' +
  'Delete object|' +
  String.raw`Show page(?:\s+\S+)?|` +
  String.raw`Call (?:microflow|nanoflow)(?:\s+\S+)?` +
  ')$', 'i');
// Type word plus digits: $Int1, $List2, $Var10.
const PLACEHOLDER_VAR_RE = rx(String.raw`\$(?:int|bool|boolean|str|string|dec|decimal|date|datetime|list|obj|object|var|num|item)\d+\b`, 'i');
const THROWAWAY_VAR_RE = rx(String.raw`\$(?:tmp|temp|foo|bar|x|y|z|aa)\b`, 'i');
const TYPE_ECHO_VAR_RE = rx(String.raw`\$\w+_(?:list|object|obj)\b`, 'i');
// A comparison in a caption: <, >, <=, >=, != or " = ".
const COMPARISON_RE = rx(String.raw`[<>]=?|!=|\s=\s`);

// [regex, rule code, message label] for variable names.
const VARIABLE_RULES = [
  [PLACEHOLDER_VAR_RE, 'VAR01', 'placeholder variable name -- name what it holds, e.g. $OpenInvoiceCount'],
  [THROWAWAY_VAR_RE, 'VAR01', 'throwaway variable name -- name what it holds, e.g. $DueDate'],
  [TYPE_ECHO_VAR_RE, 'VAR02', 'variable name only restates its type -- name what it holds, e.g. $OverdueInvoices'],
];

// A finding: {check, message, line}, in that key order (it is printed as JSON).
const finding = (check, message, line = null) => ({ check, message, line });

// Python's s[:n], by code point.
const head = (s, n) => [...s].slice(0, n).join('');

function stripComments(text) {
  text = py.re.sub(String.raw`/\*.*?\*/`, '', text, 0, 's');
  // Authored scripts quote identifiers, describe output does not; MDL strings use single quotes.
  text = text.split('"').join('');
  const kept = py.splitlines(text).filter(line => !py.lstrip(line).startsWith('--'));
  return kept.join('\n');
}

// [kind, raw line] of the @-annotations directly above lines[index].
function precedingAnnotations(lines, index) {
  const found = [];
  let cursor = index - 1;
  while (cursor >= 0) {
    const line = lines[cursor];
    if (!py.strip(line)) { cursor -= 1; continue; }
    const match = ANNOTATION_RE.match(line);
    if (!match) break;
    found.push([match.group(1).toLowerCase(), line]);
    cursor -= 1;
  }
  return found;
}

// Text of the parsable @caption, else "".
function captionText(annotationLines) {
  for (const [kind, raw] of annotationLines) {
    if (kind === 'caption') {
      const match = CAPTION_RE.match(raw);
      if (match) return match.group(1);
    }
  }
  return '';  // no @caption, or one that does not parse
}

const annotationKinds = annotations => annotations.map(([kind]) => kind);

// `mdl 1;` heads every document mxcli v0.25 describes; v0.24 wrote none.
const MDL1_HEADER = rx(String.raw`^\s*mdl\s+1\s*;\s*$`, 'i');
const isMdl1 = lines => lines.some(line => MDL1_HEADER.match(line));

// The expression of the split at lines[index]: what Mendix shows as its caption by default. An
// `if` runs on to its `then`, over several lines when the expression does.
function splitExpression(lines, index) {
  const first = py.strip(lines[index]);
  let text = py.strip(first.slice(py.split(first)[0].length));
  if (/^(?:if|elsif)\b/i.test(first)) {
    // v0.24 printed a long caption on one line, a line break as \n and a quote doubled.
    for (let k = index + 1; !/\bthen$/i.test(text) && k < lines.length; k++) text += '\\n    ' + py.strip(lines[k]);
    text = py.strip(text.replace(/\s*\bthen$/i, ''));
  }
  return text.split("'").join("''");
}

// v0.25 writes an `if` that is all of an `else` branch as `elsif`; v0.24 wrote the nested `if`,
// with its caption. Under `mdl 1` an `elsif` is that decision.
const ELSIF_RE = rx(String.raw`^\s*elsif\b`, 'i');

// Caption rules for an if/case/while; the bool is false when it has no @caption.
function decisionFindings(lines, index, mdl1 = false) {
  const line = lines[index];
  const annotations = precedingAnnotations(lines, index);
  let text;
  if (!annotationKinds(annotations).includes('caption')) {
    // mxcli v0.25 (`mdl 1`) leaves out a caption that is the split's own expression, as it leaves
    // out every default; v0.24 printed it. A split always has a caption in the model, so a missing
    // one there is that default, judged as v0.24's printed caption was.
    if (!mdl1) {
      return [[finding('CAPTION03',
        `decision without @caption -- put @caption '<the question it answers?>' on the line above: ${head(py.strip(line), 70)}`,
        index + 1)], [], false];
    }
    text = splitExpression(lines, index);
  } else {
    text = captionText(annotations);
  }
  if (!text) return [[], [], true];
  const stripped = py.strip(line);
  const expression = py.strip(stripped.slice(py.split(stripped)[0].length));
  const isEnumSplit = stripped.toLowerCase().startsWith('case');
  if (isEnumSplit && py.strip(text) === expression) {
    // mxcli overwrites an enum case's @caption with its expression.
    return [[], [finding('CAPTION08',
      "mxcli wrote this split's own expression as its caption " +
      `('${text}'); measured on 11.13.0 it discards both @caption ` +
      "and @annotation on a split, so this is not the author's doing",
      index + 1)], true];
  }
  if (text.includes('$') || COMPARISON_RE.search(text)) {
    return [[finding('CAPTION05',
      `caption restates the expression: '${text}' -- write the business question instead, with no $, <, >, != or =, ending in '?'`,
      index + 1)], [], true];
  }
  if (!py.rstrip(text).endsWith('?')) {
    return [[finding('CAPTION04',
      `decision caption is not phrased as a question: '${text}' -- end it with '?', e.g. 'Is the invoice overdue?'`,
      index + 1)], [], true];
  }
  return [[], [], true];
}

// A loop or while loop needs @annotation and must not carry @caption.
function loopFindings(lines, index) {
  const line = lines[index];
  const kinds = annotationKinds(precedingAnnotations(lines, index));
  const failures = [];
  if (kinds.includes('caption')) {
    failures.push(finding('CAPTION07',
      'loop carries @caption, which is dropped (MDL042 on a loop, silently on a while) -- write @annotation \'<why it repeats>\' above it instead',
      index + 1));
  }
  if (!kinds.includes('annotation')) {
    failures.push(finding('CAPTION06',
      `loop without @annotation -- put @annotation '<why it repeats>' on the line above: ${head(py.strip(line), 70)}`,
      index + 1));
  }
  return failures;
}

// An action needs a @caption that is not the Mendix default.
function actionFindings(lines, index) {
  const line = lines[index];
  const annotations = precedingAnnotations(lines, index);
  if (!annotationKinds(annotations).includes('caption')) {
    return [finding('CAPTION01',
      `action without business-operation @caption -- put @caption '<what it does for the business>' on the line above: ${head(py.strip(line), 70)}`,
      index + 1)];
  }
  const text = captionText(annotations);
  if (text && DEFAULT_ACTION_CAPTION_RE.match(py.strip(text))) {
    return [finding('CAPTION02',
      `action caption restates the Mendix default: '${text}' -- say what it does for the business, e.g. 'Load the open invoices'`,
      index + 1)];
  }
  return [];
}

function variableFindings(line, lineNumber) {
  const failures = [];
  for (const [regex, check, label] of VARIABLE_RULES) {
    for (const hit of regex.findall(line)) {
      const at = label.indexOf(' -- ');
      const what = at < 0 ? label : label.slice(0, at), fix = at < 0 ? '' : label.slice(at + 4);
      failures.push(finding(check, `${what}: ${hit}` + (fix ? ` -- ${fix}` : ''), lineNumber));
    }
  }
  return failures;
}

// [failures, warnings] for all naming rules.
function checkNaming(lines) {
  const failures = [], warnings = [];
  const mdl1 = isMdl1(lines);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const stripped = py.strip(line).toLowerCase();
    if (stripped.startsWith('end ') || stripped === 'end') return;
    if (DECISION_RE.match(line) || (mdl1 && ELSIF_RE.match(line))) {
      const [found, warned, hasCaption] = decisionFindings(lines, index, mdl1);
      failures.push(...found);
      warnings.push(...warned);
      if (!hasCaption) return;  // skips the variable-name rules for this line
    } else if (LOOP_RE.match(line)) {
      failures.push(...loopFindings(lines, index));
    } else if (ACTION_RE.match(line)) {
      failures.push(...actionFindings(lines, index));
    }
    failures.push(...variableFindings(line, lineNumber));
  });
  return [failures, warnings];
}

// A microflow behind a popup's Save: it commits, then `close page`. Without `refresh` the
// client is never told the object changed, so the grid under the popup still shows the old
// rows until a reload -- in every app the harness built (new invoice, new customer). The tests
// missed it: a session reloaded the page in its test (`reopen_app()`) to see the new row.
const MICROFLOW_START_RE = rx(String.raw`^create\s+(?:or\s+(?:modify|replace)\s+)?microflow\s+([\w.]+)`, 'i');
const COMMIT_STATEMENT_RE = rx(String.raw`^\s*(?:commit\s+\$\w+|change\s+\$\w+\b.*\bcommit\b)`, 'is');

// REFRESH01: in a microflow that ends in `close page`, every commit carries `refresh`.
function refreshFindings(lines) {
  const failures = [];
  let name = null, statements = [], closes = false;
  const flush = () => {
    if (!name || !closes) return;
    for (const [lineNumber, statement] of statements) {
      if (COMMIT_STATEMENT_RE.match(statement) && !py.re.search(String.raw`\brefresh\b`, statement, 'i')) {
        const target = py.re.search(String.raw`\$\w+`, statement).group(0);
        failures.push(finding('REFRESH01',
          `${name} closes its page but commits ${target} without refresh -- the grid under the ` +
          `popup keeps showing the old rows until a reload: write \`commit ${target} refresh;\` ` +
          `(or \`change ${target} (...) commit refresh;\`)`,
          lineNumber));
      }
    }
  };
  let current = '', start = null, inBody = false;
  lines.forEach((line, index) => {
    const match = MICROFLOW_START_RE.match(line);
    if (match) {
      flush();
      name = match.group(1); statements = []; closes = false; current = ''; start = null; inBody = false;
      return;
    }
    if (name === null || ANNOTATION_RE.match(line)) return;
    if (!inBody) {
      // the signature and its parameters end at `begin`
      inBody = Boolean(py.re.match(String.raw`^\s*begin\s*$`, line, 'i'));
      return;
    }
    if (py.re.match(String.raw`^end;\s*$`, line)) {
      flush();
      name = null;
      return;
    }
    if (!py.strip(current)) start = index + 1;
    current += ' ' + py.strip(line);
    if (py.rstrip(line).endsWith(';')) {
      const statement = py.strip(current);
      if (py.re.match(String.raw`close\s+page\b`, statement, 'i')) closes = true;
      statements.push([start, statement]);
      current = '';
    }
  });
  flush();
  return failures;
}

function checkNamingAndRefresh(lines) {
  const [failures, warnings] = checkNaming(lines);
  // Performance (PERF02/03/05/06, perf_rules.cjs): warnings, listed before the caption warnings.
  const perf = perfFindings(lines).map(([code, message, line]) => finding(code, message, line));
  return [[...failures, ...refreshFindings(lines)], [...perf, ...warnings]];
}

module.exports = {
  ANNOTATION_RE, CAPTION_RE, DECISION_RE, LOOP_RE, ACTION_RE, DEFAULT_ACTION_CAPTION_RE, PLACEHOLDER_VAR_RE,
  THROWAWAY_VAR_RE, TYPE_ECHO_VAR_RE, COMPARISON_RE, VARIABLE_RULES, MICROFLOW_START_RE, COMMIT_STATEMENT_RE,
  finding, stripComments, precedingAnnotations, captionText, annotationKinds, decisionFindings, loopFindings,
  actionFindings, variableFindings, checkNaming, refreshFindings, checkNamingAndRefresh,
};
