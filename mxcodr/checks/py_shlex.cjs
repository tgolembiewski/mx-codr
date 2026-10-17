// Python's shlex in posix mode, for the checks' Node ports (behind py_compat.cjs).
'use strict';

class Shlex {
  constructor(text, punctuationChars) {
    this.text = text;
    this.at = 0;
    this.commenters = '#';
    this.wordchars = 'abcdfeghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' +
      'ßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ';
    this.whitespace = ' \t\r\n';
    this.whitespaceSplit = false;
    this.quotes = '\'"';
    this.escape = '\\';
    this.escapedquotes = '"';
    this.state = ' ';
    this.token = '';
    this.punctuation = punctuationChars === true ? '();<>|&' : (punctuationChars || '');
    this.pushbackChars = [];
    if (this.punctuation) {
      this.wordchars += '~-./*?=';
      this.wordchars = [...this.wordchars].filter(c => !this.punctuation.includes(c)).join('');
    }
  }
  read() {
    if (this.at >= this.text.length) return '';
    const c = String.fromCodePoint(this.text.codePointAt(this.at));
    this.at += c.length;
    return c;
  }
  readline() {
    const nl = this.text.indexOf('\n', this.at);
    this.at = nl < 0 ? this.text.length : nl + 1;
  }
  readToken() {
    const has = (set, c) => set.includes(c);
    let quoted = false;
    let escapedstate = ' ';
    for (;;) {
      const nextchar = this.punctuation && this.pushbackChars.length ? this.pushbackChars.pop() : this.read();
      if (this.state === null) {
        this.token = '';
        break;
      } else if (this.state === ' ') {
        if (!nextchar) { this.state = null; break; }
        else if (has(this.whitespace, nextchar)) {
          if (this.token || quoted) break;
          continue;
        } else if (has(this.commenters, nextchar)) {
          this.readline();
        } else if (has(this.escape, nextchar)) {
          escapedstate = 'a';
          this.state = nextchar;
        } else if (has(this.wordchars, nextchar)) {
          this.token = nextchar; this.state = 'a';
        } else if (has(this.punctuation, nextchar)) {
          this.token = nextchar; this.state = 'c';
        } else if (has(this.quotes, nextchar)) {
          this.state = nextchar;
        } else if (this.whitespaceSplit) {
          this.token = nextchar; this.state = 'a';
        } else {
          this.token = nextchar;
          if (this.token || quoted) break;
          continue;
        }
      } else if (has(this.quotes, this.state)) {
        quoted = true;
        if (!nextchar) throw new Error('No closing quotation');
        if (nextchar === this.state) {
          this.state = 'a';
        } else if (has(this.escape, nextchar) && has(this.escapedquotes, this.state)) {
          escapedstate = this.state;
          this.state = nextchar;
        } else {
          this.token += nextchar;
        }
      } else if (has(this.escape, this.state)) {
        if (!nextchar) throw new Error('No escaped character');
        if (has(this.quotes, escapedstate) && nextchar !== this.state && nextchar !== escapedstate) {
          this.token += this.state;
        }
        this.token += nextchar;
        this.state = escapedstate;
      } else if (this.state === 'a' || this.state === 'c') {
        if (!nextchar) { this.state = null; break; }
        else if (has(this.whitespace, nextchar)) {
          this.state = ' ';
          if (this.token || quoted) break;
          continue;
        } else if (has(this.commenters, nextchar)) {
          this.readline();
          this.state = ' ';
          if (this.token || quoted) break;
          continue;
        } else if (this.state === 'c') {
          if (has(this.punctuation, nextchar)) {
            this.token += nextchar;
          } else {
            if (!has(this.whitespace, nextchar)) this.pushbackChars.push(nextchar);
            this.state = ' ';
            break;
          }
        } else if (has(this.quotes, nextchar)) {
          this.state = nextchar;
        } else if (has(this.escape, nextchar)) {
          escapedstate = 'a';
          this.state = nextchar;
        } else if (has(this.wordchars, nextchar) || has(this.quotes, nextchar) ||
                   (this.whitespaceSplit && !has(this.punctuation, nextchar))) {
          this.token += nextchar;
        } else {
          this.pushbackChars.push(nextchar);
          this.state = ' ';
          if (this.token || quoted) break;
          continue;
        }
      }
    }
    let result = this.token;
    this.token = '';
    if (!quoted && result === '') result = null;
    return result;
  }
  all() {
    const out = [];
    for (let tok = this.readToken(); tok !== null; tok = this.readToken()) out.push(tok);
    return out;
  }
}
// shlex.split(text): throws on an unclosed quote or a trailing backslash, as Python's ValueError.
function shlexSplit(text) {
  const lex = new Shlex(text, '');
  lex.whitespaceSplit = true;
  lex.commenters = '';
  return lex.all();
}

module.exports = { Shlex, shlexSplit };
