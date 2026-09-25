// tests/scenario-helpers.js -- the functions a scenario body can call. lib.sh pastes
// everything below the marker line into each scenario, after the settings constants.
//
// 'widget' = the Mendix widget name, i.e. the element with class .mx-name-<widget>.
//   open_app()                         open the app, sign in as TEST_USER if asked
//   reopen_app()                       start over (page.goto is refused once the app is open)
//   menu('Label'[, 'widget'])          click a menu item; the widget proves arrival
//   landed('widget', 'what')           throw unless the widget appears
//   fill('widget', value)              type into a text box/area, then tab out
//   pick_combo('widget', 'option')     choose a combo box option
//   row_action('grid', 'text', 'btn')  click a button in the first grid row containing text
//   await_message(/regex/[, ms])       wait for an app message; returns the page text
//   dismiss_dialog()                   click OK on an open dialog
//   page_text()                        all visible page text
//   look('label')                      measure the page as it renders now (VIS01-03); lib.sh
//                                      calls look('end') after every scenario body by itself
// Also in scope: page (Playwright), and BASE, USER, PASSWORD, ACTION_TIMEOUT from the settings.
// Indented two spaces: the code runs inside the scenario's async function.
// ---- helpers (lib.sh copies from the next line on) ----
  // Playwright waits 30s by default for a missing element. During development the
  // failing case is the normal case, so fail in 8s instead -- red runs are what
  // cost time, not green ones. Override per call where a step is genuinely slow.
  page.setDefaultTimeout(ACTION_TIMEOUT);

  const LOGIN_FIELD = '#usernameInput, input[name=username]';
  // '/' redirects to login.html, and the redirect finishes after goto returns --
  // so wait for whichever of the two arrives rather than deciding immediately,
  // or the form is never seen and .mx-page never comes.
  const sign_in_if_asked = async () => {
    await page.waitForSelector(LOGIN_FIELD + ', .mx-page', {timeout: 20000});
    if (!(await page.locator(LOGIN_FIELD).count())) return;
    if (!PASSWORD) throw new Error('app shows a login page but there is no password for TEST_USER='
      + USER + ' -- set TEST_USER to a user with a TEST_PASSWORD_<user>= line in tests/credentials.env,'
      + ' or add one for this user');
    // Login-page selectors only. `.alert` and `.mx-validation-message` also occur on
    // ordinary pages, and a race that matched those would report a refused sign-in
    // for an app that had loaded perfectly well.
    const LOGIN_ERROR = '#loginMessage, .login-message, .alert-danger, .mx-login .alert';
    let landed = 'gone';
    // Two attempts. A sign-in sent the instant the login page appears after a
    // sign-out is refused now and then with a bare "Sign in failed" (seen once in
    // ~10 suite runs, always right after switching users), and the same form
    // submitted again a moment later is accepted. Wrong credentials fail both
    // times and are reported as before.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.fill(LOGIN_FIELD, USER);
      await page.fill('#passwordInput, input[name=password]', PASSWORD);
      await page.click('#loginButton, button[type=submit], form button');
      // Race the app against the login page's own error: a refused sign-in is on
      // screen in about a second, and waiting out the 20s timeout for .mx-page turns
      // "wrong password" into an unexplained hang.
      landed = await Promise.race([
        page.waitForSelector('.mx-page', {timeout: 20000}).then(() => 'page').catch(() => 'gone'),
        page.waitForSelector(LOGIN_ERROR, {timeout: 20000}).then(() => 'error').catch(() => 'gone'),
      ]);
      if (!(landed === 'error' && /login/.test(page.url()) && attempt === 1)) break;
      await page.waitForTimeout(700);
    }
    // Still on the login page is part of the claim: an error element that appears as
    // the app renders must not be read as a refusal.
    if (landed === 'error' && /login/.test(page.url())) {
      const said = await page.locator(LOGIN_ERROR).first().innerText()
        .then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '');
      throw new Error('sign-in as ' + USER + ' was refused: ' + (said || 'the login page reported an error')
        + ' (credentials come from tests/credentials.env)');
    }
    await page.waitForSelector('.mx-page', {timeout: 20000});
  };
  // Ending a session, not just forgetting it. Clearing cookies leaves the old
  // session alive on the server, and the runtime's session limit then refuses the
  // next sign-in with "Maximum number of sessions exceeded" -- which reaches the
  // browser as a plain "Sign in failed".
  const current_user = async () => page.evaluate(() => {
    try { const a = mx.session.sessionData.user.attributes.Name; return (a && a.value) || ''; }
    catch (e) { return ''; }
  }).catch(() => '');
  const sign_out = async () => {
    if (await page.locator('.mx-page').count()) {
      await page.evaluate(() => { if (window.mx && window.mx.logout) window.mx.logout(); });
    }
    await page.waitForSelector(LOGIN_FIELD, {timeout: 20000});
  };
  // Always start from a fresh sign-in. The runtime's licence caps concurrent
  // sessions, and a session left behind by an earlier run counts against it --
  // the next sign-in then fails with a bare "Sign in failed" on the login page.
  // A mid-scenario page.goto wipes client state, hides carry-over between steps, and
  // above Security Level: Off it is a silent sign-out -- the suite then continues as
  // though navigation worked. Navigate with menu()/row_action(); to deliberately start
  // over, call reopen_app().
  let __journey_started = false;
  // The page object lives in the playwright-cli daemon and outlives one scenario, so a
  // guard installed last time is still on it. Restore the real goto first, or each
  // scenario wraps the previous scenario's already-tripped guard.
  if (page.__mdl_raw_goto) page.goto = page.__mdl_raw_goto;
  const __goto = page.goto.bind(page);
  page.__mdl_raw_goto = page.goto;
  page.goto = async (url, options) => {
    if (__journey_started) {
      throw new Error('page.goto(' + url + ') after the app was opened is a mid-journey reload:'
        + ' it wipes client state and, with security on, signs the session out. Navigate with'
        + ' menu() or row_action(), or call reopen_app() to deliberately start a fresh journey.');
    }
    return __goto(url, options);
  };
  const reopen_app = async () => { __journey_started = false; await open_app(); };

  const open_app = async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector(LOGIN_FIELD + ', .mx-page', {timeout: 20000});
    // Signing out only makes sense where there is something to sign in to. With
    // Security Level: Off there is no login page, so mx.logout() would leave the
    // scenario waiting 20s for a form that never appears -- and the failure then
    // reads as a broken feature. Say so instead, before spending the 20s.
    if (PASSWORD && await page.locator('.mx-page').count()) {
      const who = await current_user();
      if (/^Anonymous/.test(who)) {
        throw new Error('the app is signed in as ' + who + ' and shows no login page, so TEST_USER='
          + USER + ' cannot be applied: this app runs with Security Level: Off. Unset TEST_USER and'
          + ' TEST_PASSWORD (and remove tests/credentials.env) for this app, or turn security on');
      }
      // A session the previous script left signed in as this same user is this
      // script's session too (MDL_SESSION_REUSE / KEEP_SESSION). Anyone else's is
      // ended first: the tests for another role must not run as this one.
      if (!(REUSE && who === USER)) await sign_out();
    }
    await sign_in_if_asked();
    await page.waitForSelector('.mx-page', {timeout: 20000});
    __journey_started = true;
  };
  // await_message(/reminder sent/i) -- wait for the text the app shows in reply to
  // an action, wherever it puts it: a dialog, an alert bar, or a rendered message
  // on the page. Returns the visible text so the test can assert on it. This
  // replaces `waitForTimeout(1500)` followed by page_text(): it returns as soon as
  // the message is there (~200ms) instead of after a fixed pause, and it fails
  // saying what WAS on screen when the message never came, rather than handing the
  // test an unrelated page to assert against.
  // The pattern must match the MESSAGE and nothing the page showed before the
  // action: a button captioned "Unpaid" satisfies /unpaid/ instantly, and the
  // test then reads a page on which the message has not appeared yet. Include a
  // word or a number that only the message carries: /has \d+ unpaid invoice/i.
  const await_message = async (pattern, timeout) => {
    const deadline = Date.now() + (timeout || ACTION_TIMEOUT);
    let text = '';
    for (;;) {
      text = await page.locator('body').innerText().catch(() => '');
      if (pattern.test(text)) return text.replace(/\s+/g, ' ').trim();
      if (Date.now() > deadline) {
        throw new Error('no message matching ' + pattern + ' appeared within '
          + (timeout || ACTION_TIMEOUT) + 'ms; the page says: '
          + text.replace(/\s+/g, ' ').trim().slice(0, 300));
      }
      await page.waitForTimeout(100);
    }
  };
  // Mendix commits an input on blur, so a fill followed straight away by a click
  // on Save can be saved before the last value is committed. Tab out to blur.
  const fill = async (widget, value) => {
    const input = page.locator('.mx-name-' + widget + ' input, .mx-name-' + widget + ' textarea').first();
    await input.fill(String(value));
    await input.press('Tab');
  };
  const pick_combo = async (widget, option) => {
    await page.click('.mx-name-' + widget + ' .widget-combobox-input-container');
    const item = page.locator('.widget-combobox-item', {hasText: option}).first();
    await item.waitFor({timeout: 10000});
    await item.click();
  };
  const row_action = async (grid, row_text, widget) => {
    const row = page.locator('.mx-name-' + grid + ' [role=row]', {hasText: row_text}).first();
    await row.waitFor({timeout: 15000});
    await row.locator('.mx-name-' + widget).click();
  };
  // Prove the page arrived before anything asserts against it. Without this, a nav
  // click that silently did nothing leaves the next assertions measuring the PREVIOUS
  // page, and the failures that follow describe a defect that does not exist.
  const landed = async (widget, what) => {
    const ok = await page.locator('.mx-name-' + widget).first()
      .waitFor({timeout: 10000}).then(() => true).catch(() => false);
    if (!ok) {
      throw new Error('did NOT land after ' + what + ': .mx-name-' + widget
        + ' never appeared (on ' + page.url() + '). Everything after this would have been'
        + ' asserted against the previous page.');
    }
  };
  // menu('Invoices', 'invoiceGrid') -- the second argument is the widget that proves
  // arrival, and is the right way to click a menu item. With one argument the guard
  // falls back to "something must have happened": a menu item that is a microflow
  // action opens a dialog rather than a page, and both count.
  const menu = async (label, ready) => {
    const candidates = page.locator('.mx-navigationtree a, nav a, a').filter({hasText: label});
    await candidates.first().waitFor({timeout: 10000});
    // An Atlas layout renders its menu twice -- the top bar and the off-canvas
    // sidebar. Both report themselves visible, but the collapsed one sits under a
    // .mx-placeholder overlay, so clicking it times out as "element is not stable"
    // and the failure reads as a missing menu item. Click the copy a real pointer
    // would reach. (Found by a session that lost several minutes to it.)
    let link = candidates.first();
    const total = await candidates.count();
    for (let i = 0; i < total; i++) {
      const reachable = await candidates.nth(i).evaluate(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }).catch(() => false);
      if (reachable) { link = candidates.nth(i); break; }
    }
    const before = (await page.locator('.mx-page').first().innerText().catch(() => '')).slice(0, 300);
    const url_before = page.url();
    await link.click();
    if (ready) { await landed(ready, "menu '" + label + "'"); return; }
    const deadline = Date.now() + 3000;
    for (;;) {
      const after = (await page.locator('.mx-page').first().innerText().catch(() => '')).slice(0, 300);
      const dialog = await page.locator('.modal-footer button, .mx-dialog').count();
      if (after !== before || dialog > 0 || page.url() !== url_before) return;
      if (Date.now() > deadline) {
        throw new Error("clicked menu '" + label + "' but nothing happened within 3s: no page"
          + ' change, no dialog (on ' + page.url() + '). If this item leads to a page you are'
          + " already on, pass the widget that proves it: menu('" + label + "', 'someGrid').");
      }
      await page.waitForTimeout(150);
    }
  };
  const dismiss_dialog = async () => {
    const ok = page.locator('.modal-footer button, .mx-dialog button').filter({hasText: 'OK'});
    if (await ok.count()) await ok.first().click();
  };
  const page_text = async () => (await page.locator('body').innerText());

  // ---- visual_findings (pure; the audit tests run it on made-up boxes) ----
  // boxes: [{id, name, layer, leaf, text, x, y, w, h, clipped, rects?}]; only leaves (widgets with
  // no named widget inside) are compared, so a container never 'overlaps' what it holds. rects:
  // one box per rendered line of an inline widget -- a span that wraps onto a second line has a
  // bounding box over both, which 'overlapped' its neighbours on the first line.
  // viewport: {width, scrollWidth}. Returns [{code, widgets, px, message}].
  const visual_findings = (boxes, viewport) => {
    const found = [];
    const MIN = 4;   // px both ways: touching borders and 1-2 px rounding are not an overlap
    const leaves = boxes.filter(b => b.leaf && b.w > 0 && b.h > 0);
    const overlaps = {};
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i], b = leaves[j];
        if (a.layer !== b.layer) continue;   // a pop-up sits over the page by design
        let w = 0, h = 0;
        for (const ra of (a.rects || [a])) {
          for (const rb of (b.rects || [b])) {
            const cw = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
            const ch = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
            if (Math.min(cw, ch) > Math.min(w, h)) { w = cw; h = ch; }
          }
        }
        if (w < MIN || h < MIN) continue;
        const key = a.name;
        overlaps[key] = overlaps[key] || {others: [], px: 0};
        overlaps[key].others.push(b.name);
        overlaps[key].px = Math.max(overlaps[key].px, Math.round(Math.min(w, h)));
      }
    }
    for (const [name, o] of Object.entries(overlaps)) {
      found.push({code: 'VIS01', widgets: [name, ...o.others], px: o.px,
        message: name + ' overlaps ' + o.others.join(', ') + ' by ' + o.px + ' px'});
    }
    if (viewport.scrollWidth > viewport.width + 1) {
      found.push({code: 'VIS02', widgets: [], px: Math.round(viewport.scrollWidth - viewport.width),
        message: 'the page scrolls sideways by ' + Math.round(viewport.scrollWidth - viewport.width) + ' px'});
    }
    for (const b of leaves) {
      if (b.clipped) found.push({code: 'VIS03', widgets: [b.name], px: b.clipped,
        message: b.name + ' cuts its text off (' + b.clipped + ' px hidden)'});
    }
    return found;
  };
  // ---- end visual_findings ----
  const __mdl_visual = [];
  const look = async (label) => {
    if (!VISUAL) return;
    try {
      const snap = await page.evaluate(() => {
        const root = document.querySelector('.mx-page') || document.body;
        // The layout's menu and bars are not this page's: collapsed sidebar items clip their text
        // on purpose. (A content-region selector found an empty placeholder and measured nothing.)
        const LAYOUT_PARTS = '.mx-navigationtree, .mx-navbar, .mx-menubar, .region-sidebar, .region-topbar, nav';
        const els = Array.from(root.querySelectorAll('[class*="mx-name-"]'));
        const shown = el => {
          for (let e = el; e && e !== document.body; e = e.parentElement) {
            const st = getComputedStyle(e);
            if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
            if (st.position === 'fixed' || st.position === 'sticky') return false;
          }
          return true;
        };
        const boxes = [];
        els.forEach((el, i) => {
          const m = /(?:^|\s)mx-name-(\S+)/.exec(typeof el.className === 'string' ? el.className : '');   // an SVG's is an object
          if (!m || el.closest(LAYOUT_PARTS) || !shown(el)) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const dialog = el.closest('.modal-dialog, .mx-dialog, .popupcontent');
          const leaf = !el.querySelector('[class*="mx-name-"]');
          const st = getComputedStyle(el);
          const text = (el.innerText || '').trim().length > 0;
          const hidden = el.scrollWidth - el.clientWidth;
          const clipped = leaf && text && st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis' && hidden > 1 ? hidden : 0;
          const lines = st.display === 'inline' ? Array.from(el.getClientRects())
            .filter(q => q.width && q.height).map(q => ({x: q.x, y: q.y, w: q.width, h: q.height})) : null;
          boxes.push({id: i, name: m[1], layer: dialog ? 'dialog' : 'page', leaf, text,
            x: r.x, y: r.y, w: r.width, h: r.height, clipped, rects: lines && lines.length ? lines : undefined});
        });
        // Atlas scrolls the content inside its own container, not the document: measure both.
        const scrollers = [document.documentElement, root].concat(Array.from(root.querySelectorAll('*'))
          .filter(e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)));
        const doc = document.documentElement;
        const sideways = Math.max(doc.scrollWidth - doc.clientWidth, root.scrollWidth - root.clientWidth, 0);
        return {boxes, viewport: {width: doc.clientWidth, scrollWidth: doc.clientWidth + sideways},
          fullHeight: Math.max(...scrollers.map(e => e.scrollHeight - e.clientHeight)) + window.innerHeight,
          title: document.title};
      });
      const findings = visual_findings(snap.boxes, snap.viewport);
      let shot = '';
      if (VISUAL_DIR) {
        shot = VISUAL_DIR + '/' + TEST_NAME + '-' + (__mdl_visual.length + 1) + '.png';
        // The whole page: a viewport as tall as the content, since the layout scrolls inside itself.
        const size = page.viewportSize();
        try {
          if (size) await page.setViewportSize({width: size.width, height: Math.min(Math.ceil(snap.fullHeight), 8000)});
          await page.waitForTimeout(300);
          await page.screenshot({path: shot});
        } catch (e) { shot = ''; }
        if (size) await page.setViewportSize(size).catch(() => {});
      }
      __mdl_visual.push({label: String(label || ''), title: snap.title, findings, shot,
        widgets: snap.boxes.map(b => b.name)});
    } catch (e) {}   // measuring must never fail a test
  };
  // The scenario's value with what look() saw, for lib.sh to file and strip again.
  const __mdl_attach_visual = (value) => {
    if (!__mdl_visual.length || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.assign({}, value, {__visual: __mdl_visual});
  };
