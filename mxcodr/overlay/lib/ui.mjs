// The installer's terminal output: the banner, the progress bar and every line the install prints. A port of
// v1's install/ui.sh (tag v1-last), character for character: the same wordmark, colours, icons, bar and summary
// rows. Colours and the bar only on a terminal (not with NO_COLOR, TERM=dumb or a pipe: plain lines then, so the
// eval runner's logs and the tests stay clean); Unicode icons only with a UTF-8 locale (cmd.exe has none: ASCII).
// makeUi({ out, err, env, isTTY, columns }) -> the ui; the defaults are this process's own.

const BANNER = [
  ['39', '  ███╗   ███╗██╗  ██╗       ██████╗ ██████╗ ██████╗ ██████╗ '],
  ['39', '  ████╗ ████║╚██╗██╔╝      ██╔════╝██╔═══██╗██╔══██╗██╔══██╗'],
  ['44', '  ██╔████╔██║ ╚███╔╝ █████╗██║     ██║   ██║██║  ██║██████╔╝'],
  ['44', '  ██║╚██╔╝██║ ██╔██╗ ╚════╝██║     ██║   ██║██║  ██║██╔══██╗'],
  ['44', '  ██║ ╚═╝ ██║██╔╝ ██╗      ╚██████╗╚██████╔╝██████╔╝██║  ██║'],
  ['44', '  ╚═╝     ╚═╝╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝'],
];
const BAR_WIDTH = 24;      // the bar's width in characters
const SUB_EXPECTED = 6;    // sub-steps expected inside one step, for the bar
const REDRAW_MS = 2000;    // a silent tool still moves the elapsed time (v1: read -t 2)

const len = s => [...s].length;
const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - len(s)));
const padStart = (s, w) => ' '.repeat(Math.max(0, w - len(s))) + s;

export function makeUi({ out = process.stdout, err = process.stderr, env = process.env, isTTY = Boolean(out.isTTY), columns, clock = () => Date.now() } = {}) {
  const tty = Boolean(isTTY) && !env.NO_COLOR && (env.TERM || 'dumb') !== 'dumb'
    // Windows consoles have no TERM; Node's own isTTY is the test there (v1 ran in Git Bash, which sets one)
    || (Boolean(isTTY) && !env.NO_COLOR && !env.TERM && process.platform === 'win32');
  const esc = code => (tty ? `\x1b[${code}m` : '');
  const c = {
    reset: esc('0'), bold: esc('1'), dim: esc('2'),
    blue: esc('38;5;39'), cyan: esc('38;5;44'), green: esc('38;5;42'),
    yellow: esc('38;5;214'), red: esc('38;5;203'), grey: esc('38;5;245'),
  };
  const unicode = /UTF-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
  const i = unicode
    ? { ok: '✔', warn: '!', fail: '✘', dot: '·', arrow: '→', play: '▶', box: '▪', full: '█', empty: '░' }
    : { ok: '+', warn: '!', fail: 'x', dot: '-', arrow: '->', play: '>', box: '*', full: '#', empty: '.' };
  let cols = Number(columns || env.COLUMNS || out.columns || 80); // v1: $COLUMNS, else tput cols
  if (!(cols >= 40)) cols = 80;

  const w = s => out.write(s);
  let total = 1, step = 0, label = '', subSeen = 0, began = clock(), timer = null;

  const ui = {
    tty, unicode, c, i,

    banner(version) {
      // terminals narrower than 62 columns get plain words instead of the wordmark
      if (unicode && cols >= 62) {
        w('\n');
        for (const [colour, line] of BANNER) w(`${colour === '39' ? c.blue : c.cyan}${line}${c.reset}\n`);
        w(`\n  ${c.bold}version:${c.reset} ${version}\n\n`);
      } else {
        w(`\n  ${c.bold}mx-codr${c.reset}  ${version}\n`);
        w(`  mxcli ${i.dot} MDL skills, the always-on rule and a starter test kit\n\n`);
      }
    },

    // ▪ target <folder>  (what the install will do there)
    target(app, state) { w(`  ${c.grey}${i.box} target${c.reset} ${app}  ${c.grey}(${state})${c.reset}\n\n`); },

    plan(n) { total = Math.max(1, n); },

    // done steps plus sub-progress, capped at 90% of the current step
    pct() {
      const span = Math.floor(100 / total), base = Math.floor(step * 100 / total), cap = Math.floor(span * 9 / 10);
      const inside = subSeen > 0 ? Math.min(cap, Math.floor(span * subSeen / SUB_EXPECTED)) : 0;
      return base + inside;
    },

    // redraws the bar in place (terminal only)
    bar() {
      if (!tty) return;
      const pct = ui.pct(), filled = Math.floor(pct * BAR_WIDTH / 100);
      const bar = i.full.repeat(Math.min(filled, BAR_WIDTH)) + i.empty.repeat(Math.max(0, BAR_WIDTH - filled));
      let max = cols - BAR_WIDTH - 11, took = '', shown = label;
      // a step that runs long shows how long, so a silent tool does not look frozen
      const elapsed = Math.floor((clock() - began) / 1000);
      if (elapsed >= 5) { took = ` ${i.dot} ${Math.floor(elapsed / 60)}m${String(elapsed % 60).padStart(2, '0')}s`; max -= len(took); }
      if (max < 8) max = 8;
      if (len(shown) > max) shown = [...shown].slice(0, max - 1).join('') + '~';
      w(`\r\x1b[K  ${c.blue}${bar}${c.reset}  ${c.bold}${padStart(String(pct), 3)}%${c.reset}  ${c.grey}${shown}${took}${c.reset}`);
    },

    // wipes the bar's line
    clear() { if (tty) w('\r\x1b[K'); },

    begin(text) {
      label = text; began = clock(); subSeen = 0;
      if (!tty) w(`  ${i.dot} ${text}\n`);
      ui.bar();
    },

    // transient detail inside a step
    sub(phase) {
      subSeen++;
      if (tty) { label = `${label.split(` ${i.dot} `)[0]} ${i.dot} ${phase}`; ui.bar(); } else w(`     ${i.dot} ${phase}\n`);
    },

    // progress without a new label: the tool is still working
    tick() { subSeen++; ui.bar(); },

    done(text, detail) {
      step++; subSeen = 0;
      ui.clear();
      if (detail) w(`  ${c.green}${i.ok}${c.reset} ${padEnd(text, 26)} ${c.grey}${detail}${c.reset}\n`);
      else w(`  ${c.green}${i.ok}${c.reset} ${text}\n`);
      label = '';
      ui.bar();
    },

    // a fact worth keeping on screen, not a step
    note(text) {
      ui.clear();
      w(`  ${c.yellow}${i.warn}${c.reset} ${text}\n`);
      ui.bar();
    },

    // the first line in bold after a red cross, every other line indented below it; on stderr
    fail(first, ...rest) {
      ui.stop();
      ui.clear();
      err.write(`  ${c.red}${i.fail}${c.reset} ${c.bold}${first}${c.reset}\n`);
      for (const line of rest) err.write(`    ${line}\n`);
      err.write('\n');
    },

    // redraws the bar every 2 s while a slow tool runs; -> stop()
    live() {
      ui.stop();
      if (tty) { timer = setInterval(() => ui.bar(), REDRAW_MS); timer.unref?.(); }
      return ui.stop;
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },

    // a line of tool output -> the bar: "Executing step '<phase>'" names a phase, a line ending in ... ticks
    toolLine(line) {
      const m = /^Executing step '(.*)'$/.exec(line.trim());
      if (m) ui.sub(m[1]); else if (/\.\.\.\s*$/.test(line)) ui.tick();
    },

    // the summary's parts
    head(icon, title) { w(`\n  ${c.bold}${icon} ${title}${c.reset}\n`); },
    row(what, count, where) { w(`     ${c.cyan}${padEnd(what, 10)}${c.reset} ${c.bold}${padStart(String(count), 3)}${c.reset}  ${where}\n`); },
    line(text = '') { w(`${text}\n`); },
  };
  return ui;
}
