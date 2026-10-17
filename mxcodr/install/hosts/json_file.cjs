// Shared by the host-config mergers: read and write JSON the way Python's json module did, so a
// file the installer rewrote before keeps its bytes (indent, \uXXXX for non-ASCII, key order).
'use strict';
const fs = require('fs');

// json.dumps escapes every non-ASCII character (ensure_ascii); JSON.stringify writes it raw.
const ascii = text => text.replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// json.dumps(..., sort_keys=True): the same value with every object's keys in sorted order.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
    return out;
  }
  return value;
}

function dumps(value, indent, sortKeys) {
  return ascii(JSON.stringify(sortKeys ? sorted(value) : value, null, indent));
}

// The parsed file, null when it does not exist; throws SyntaxError on a file that is not JSON.
function load(path) {
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(text);
}

// The parsed file, {} when it does not exist. A file that cannot be read or parsed is never
// replaced: message(error) goes to stderr and the process exits 1.
function loadOrExit(path, message) {
  try {
    return load(path) || {};
  } catch (error) {
    process.stderr.write(message(error));
    process.exit(1);
  }
}

module.exports = { dumps, load, loadOrExit, sorted };
