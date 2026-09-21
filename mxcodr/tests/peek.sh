#!/usr/bin/env bash
# tests/peek.sh -- look at a page in the running app without writing a test for it.
#
#   bash tests/peek.sh 'Invoices'                 # open the app, click that menu item, print the page
#   bash tests/peek.sh 'Invoices' invoiceGrid     # ... and wait for that widget first
#   TEST_USER=demo_customer1 bash tests/peek.sh 'My invoices'
#
# Prints the page's visible text and the console errors the browser logged, and nothing else. Two
# sessions in a row wrote a scratch `verify-zz-*.test.sh` to do this, ran it through the gate, then
# deleted it -- each one leaving a "went green without ever being red" record behind. This is the
# same look, with no test file, no coverage claim and no red-first record.
#
# It reads, never writes: no button is clicked but the one that navigates. To assert something,
# write a real tests/verify-<feature>.test.sh (skill: test-first-delivery).
# Inputs: TEST_USER (default demo_administrator, password from tests/credentials.env), APP_PORT.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

menu_item="${1:-}"
widget="${2:-}"
if [ -z "$menu_item" ] && [ "${1:-}" != "" ]; then
  echo "usage: bash tests/peek.sh '<menu item>' [widget-name]" >&2
  exit 1
fi

# lib.sh brings scenario(), the sign-in, the browser and the timeouts the gate uses.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

body='
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  await open_app();
'
if [ -n "$menu_item" ]; then
  if [ -n "$widget" ]; then
    body="$body
  await menu(\"$menu_item\", \"$widget\");"
  else
    body="$body
  await menu(\"$menu_item\");"
  fi
fi
body="$body
  const text = await page_text();
  return {text: text.slice(0, 4000), problems: problems.slice(0, 10)};
"

result="$(scenario "$body")" || {
  echo "peek: the browser could not reach that page. The line above says why." >&2
  exit 1
}

echo "== page text (first 4000 characters)"
field "$result" text
echo
echo "== console errors"
field "$result" problems
