// The parts of Python's standard library the checks were written against, for their Node ports.
//
// The checks moved from Python to Node (2026-10-05) with the rule that a port prints exactly what
// the Python did, on every platform. Where the two runtimes differ -- regular expressions (Unicode
// \w, \b, \s; `$` before a final newline), shlex, glob, json.dumps, str.split()/strip()/splitlines(),
// text-mode reads that turn \r\n into \n -- the port calls this module instead of the JS built-in.
//
// The module is in parts: py_strings.cjs (str, repr, json.dumps, sorted), py_re.cjs (re), py_shlex.cjs
// (shlex) and py_os.cjs (os.path, glob, reads, print). Callers require this file; it exports them all.
'use strict';
const strings = require('./py_strings.cjs');
const regex = require('./py_re.cjs');
const shlex = require('./py_shlex.cjs');
const os = require('./py_os.cjs');

module.exports = {
  WIN: os.WIN,
  strip: strings.strip, lstrip: strings.lstrip, rstrip: strings.rstrip, split: strings.split,
  splitlines: strings.splitlines, isSpace: strings.isSpace,
  readText: os.readText, readStdin: os.readStdin, readStdinBytes: os.readStdinBytes,
  pyStr: strings.pyStr, pyRepr: strings.pyRepr, jsonDumps: strings.jsonDumps,
  compare: strings.compare, compareTuples: strings.compareTuples, sorted: strings.sorted,
  re: regex.re, rx: regex.rx, translate: regex.translate,
  Shlex: shlex.Shlex, shlexSplit: shlex.shlexSplit,
  basename: os.basename, dirname: os.dirname, join: os.join, exists: os.exists, lexists: os.lexists,
  isdir: os.isdir, isfile: os.isfile, glob: os.glob, iglob: os.iglob, fnmatchRegex: os.fnmatchRegex,
  normpath: os.normpath, print: os.print, write: os.write, setOutputFilter: os.setOutputFilter,
};
