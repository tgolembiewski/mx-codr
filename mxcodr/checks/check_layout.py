#!/usr/bin/env python3
"""Check that page widgets are spaced with Atlas Spacing design properties.

Input: `describe page` dumps (.mdl files or directories), normally from tests/gate.sh;
optionally `DESCRIBE NAVIGATION` output (--navigation), snippet dumps (--sign-out-sources),
`describe layout` dumps of the project's own layouts (--layouts) and microflow/nanoflow dumps
whose `show page` also opens pages (--opened-from).
Usage: check_layout.py <file.mdl|dir> ... [--navigation nav.mdl] [--sign-out-sources dir]
                       [--layouts dir] [--opened-from dir] [--users-sign-in] [--json]
--json keys: verdict, pages, sources, failures, warnings.
Exit: 0 no errors (warnings allowed), 1 errors or no MDL found, 2 bad arguments.
"""

# Rule codes:
#   SPACE01  FAIL  inline sibling (not last) without margin-right, or H1-H3 heading with a sibling below and no margin-bottom
#   SPACE02  FAIL  margin/padding value other than None, S, M, L (mxcli check accepts it; mx check fails with CE6083)
#   SPACE03  FAIL  inline widgets on one line with different top/bottom margins, or none with margin-bottom
#   HEAD01   WARN  page with no H1-H3 text, no header widget and no header/title/masthead snippet
#   NAV01    FAIL  users sign in (--users-sign-in), but a navigation menu has no sign_out item
#                  and no page or snippet has a sign-out button
#   NAV02    WARN  the sign_out item is not the last item of its menu
#   NAV03    FAIL  users sign in, and a role's home page (`home page X for Role`) is not in that
#                  profile's menu
#   GRID01   FAIL  a grid filter in a column with no Attribute (and none of its own): it renders
#                  "Unable to get filter store" and filters nothing
#   LAYOUT01 FAIL  the app's pages (pop-ups, login and phone/tablet pages aside) use more than one
#                  layout: the menu and its open/closed state change from page to page
#   ICON01   FAIL  a button (actionbutton, linkbutton) without an icon; the message suggests one
#                  from its action and caption
#   USER01   FAIL  users sign in, and a page (pop-ups and the login page aside) does not open with
#                  the "who is signed in" snippet, <Module>.SNIPPET_CurrentUser, on the right of its top
#                  row -- first, or right after the Back button in the same container
#   BACK01   FAIL  a page another page or a flow opens (show_page) does not start with a Back
#                  button: close_page, icon chevron-left, top left. Pop-ups are exempt (they have X)
#   ACCOUNT01 FAIL users sign in, the Administration module is there, and the menu has no item for
#                  Administration.Account_Overview (user management; only administrators see it)
#   ACCOUNT02 FAIL ... and no item for microflow Administration.ManageMyAccount (every user's own
#                  account and password; it opens Administration.MyAccount, which needs an account)
#   ACCOUNT03 FAIL a user role that signs in lacks Administration.User, or no role has
#                  Administration.Administrator
#   MODULE01 FAIL  the app has its own module with pages, and the template's MyFirstModule is still
#                  there; lists everything that still uses it and how to remove it
#   HOME01   FAIL  the administrators' role does not open on a page of the app's own modules
#   NAV05    FAIL  a menu item or sub-menu with no icon (the message suggests one for its caption)
#   NAV04    FAIL  one of the project's own layouts opens two or more pages from buttons: a menu
#                  built by hand, with no hamburger, no active item and no phone view
#   ALERT01  WARN  a block class (alert, alert-*, card, well) on a dynamictext or text: it renders
#                  as an inline <span>, so its padding and border overlap the widgets around it
#
# Where each rule lives, in layout_rules/ next to this file (this file only reads the arguments
# and runs them): pages.py parses the dumps; spacing.py SPACE01-03, HEAD01, ALERT01; controls.py
# GRID01, ICON01; page_top.py BACK01, USER01; layouts.py LAYOUT01, NAV04; navigation.py NAV01-03,
# NAV05; accounts.py ACCOUNT01-03, MODULE01, HOME01.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The rules live next to this file, in layout_rules/; the gate runs this file by path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from layout_rules.accounts import account_findings, admin_home_findings, template_module_findings  # noqa: E402
from layout_rules.controls import button_icon_findings  # noqa: E402
from layout_rules.layouts import layout_menu_findings, one_layout_findings  # noqa: E402
from layout_rules.navigation import menu_icon_findings, role_home_findings, sign_out_findings  # noqa: E402
from layout_rules.page_top import back_button_findings, current_user_findings  # noqa: E402
from layout_rules.pages import page_blocks  # noqa: E402
from layout_rules.spacing import check  # noqa: E402


def collect(sources: list[Path]) -> tuple[str, list[Path]]:
    """Joined text of every .mdl under sources, and the files read."""
    chunks, used = [], []
    for source in sources:
        files = sorted(source.rglob("*.mdl")) if source.is_dir() else ([source] if source.exists() else [])
        for file in files:
            chunks.append(file.read_text(encoding="utf-8", errors="replace"))
            used.append(file)
    return "\n".join(chunks), used


def read_optional(path: Path | None) -> str:
    """Text of an optional input file; empty when it was not given or does not exist."""
    return path.read_text(encoding="utf-8", errors="replace") if path and path.exists() else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path, help="describe-page dumps, or a directory of them")
    parser.add_argument("--navigation", type=Path, help="DESCRIBE NAVIGATION output")
    parser.add_argument("--sign-out-sources", type=Path, action="append", default=[],
                        help="more dumps (snippets) where a sign-out button counts")
    parser.add_argument("--layouts", type=Path, action="append", default=[],
                        help="describe-layout dumps of the project's own layouts")
    parser.add_argument("--admin-module", action="store_true",
                        help="the Administration module (Account_Overview, ManageMyAccount) is in the project")
    parser.add_argument("--user-roles", type=Path, help="DESCRIBE USER ROLE output for every user role")
    parser.add_argument("--guest-role", default="", help="the anonymous user role, which does not sign in")
    parser.add_argument("--own-modules", default="",
                        help="the app's own modules, space-separated (not System, Marketplace or MyFirstModule)")
    parser.add_argument("--template-module", action="store_true", help="MyFirstModule is in the project")
    parser.add_argument("--opened-from", type=Path, action="append", default=[],
                        help="microflow/nanoflow dumps whose `show page` opens pages (BACK01)")
    parser.add_argument("--users-sign-in", action="store_true",
                        help="project security is on, so the menu needs a Log out item")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    text, used = collect(args.sources)
    if not text.strip():
        print(f"FAIL  no MDL found in {[str(s) for s in args.sources]}", file=sys.stderr)
        return 1

    # Every input is read once; a missing optional one is empty text.
    lines = text.splitlines()
    has_navigation = bool(args.navigation and args.navigation.exists())
    navigation = read_optional(args.navigation)
    roles = read_optional(args.user_roles)
    snippets, _ = collect(args.sign_out_sources)
    layouts, _ = collect(args.layouts)
    flows, _ = collect(args.opened_from)
    own_modules = args.own_modules.split()

    failures, warnings, pages = check(lines)
    if args.users_sign_in and has_navigation:
        nav_failures, nav_warnings = sign_out_findings(navigation, text + "\n" + snippets)
        failures += nav_failures
        warnings += nav_warnings
        failures += role_home_findings(navigation)
    if args.template_module:
        failures += template_module_findings(own_modules, bool(page_blocks(lines)), navigation,
                                             roles, text + "\n" + flows)
    if args.users_sign_in and own_modules and navigation:
        failures += admin_home_findings(navigation, roles, own_modules)
    if args.users_sign_in:
        failures += current_user_findings(lines, snippets, navigation, layouts)
    if args.users_sign_in and args.admin_module and has_navigation:
        failures += account_findings(navigation, roles, args.guest_role)
    if has_navigation:
        failures += menu_icon_findings(navigation)
    failures += one_layout_findings(lines, navigation, layouts)
    failures += button_icon_findings(lines + snippets.splitlines())
    failures += back_button_findings(lines, flows, navigation)
    if args.layouts:
        failures += layout_menu_findings(layouts)
    report = {
        "verdict": "PASS" if not failures else "FAIL",
        "pages": pages,
        "sources": [str(p) for p in used],
        "failures": failures,
        "warnings": warnings,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['verdict']}  {len(failures)} failure(s) over {pages} page(s)")
        for failure in failures:
            print(f"  - [{failure['check']}] line {failure['line']}: {failure['message']}")
        for warning in warnings:
            print(f"  ! [{warning['check']}] {warning['message']}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
