"""The navigation menu: NAV01/NAV02 (a Log out item, last), NAV03 (every role's home page is
in the menu) and NAV05 (an icon on every menu item).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re


# `create or replace navigation <Profile>` starts a profile's block in DESCRIBE NAVIGATION output.
PROFILE_RE = re.compile(r"^\s*create\s+(?:or\s+replace\s+)?navigation\s+(?P<name>\w+)", re.IGNORECASE)
# One `menu item '<caption>' ...;` line.
MENU_ITEM_RE = re.compile(r"^\s*menu\s+item\s+'(?P<caption>[^']*)'(?P<rest>.*)$", re.IGNORECASE)
SIGN_OUT_RE = re.compile(r"\bsign_out\b", re.IGNORECASE)


def menu_items(navigation: str) -> dict[str, list[tuple[str, bool]]]:
    """{profile: [(caption, is sign_out), ...]} in menu order; profiles without a menu are absent."""
    menus: dict[str, list[tuple[str, bool]]] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        item = MENU_ITEM_RE.match(line)
        if item and profile:
            menus.setdefault(profile, []).append(
                (item.group("caption"), bool(SIGN_OUT_RE.search(item.group("rest")))))
    return menus


def sign_out_findings(navigation: str, other_mdl: str) -> tuple[list[dict], list[dict]]:
    """NAV01 / NAV02: an app whose users sign in needs a way to log out."""
    failures, warnings = [], []
    button_elsewhere = bool(SIGN_OUT_RE.search(other_mdl))
    for profile, items in sorted(menu_items(navigation).items()):
        signs_out = [index for index, (_caption, is_sign_out) in enumerate(items) if is_sign_out]
        if not signs_out:
            if not button_elsewhere:
                failures.append({
                    "check": "NAV01",
                    "line": 0,
                    "message": (f"navigation profile {profile}: users sign in, but its menu has no way to log"
                                f" out -- add `menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;`"
                                f" as the last menu item (DESCRIBE NAVIGATION {profile} first and keep the other items)"),
                })
        elif signs_out[-1] != len(items) - 1:
            warnings.append({
                "check": "NAV02",
                "line": 0,
                "message": f"navigation profile {profile}: the Log out item is not the last item of the menu",
            })
    return failures, warnings


# `home page Module.Page for Role` in DESCRIBE NAVIGATION output; the default home page has no `for`.
ROLE_HOME_RE = re.compile(r"^\s*home\s+page\s+(?P<page>[\w.]+)\s+for\s+(?P<role>[\w.]+)", re.IGNORECASE)
MENU_PAGE_RE = re.compile(r"^\s*menu\s+item\s+'[^']*'\s+page\s+(?P<page>[\w.]+)", re.IGNORECASE)

# The one-menu-for-every-role fact the NAV03/NAV04 messages carry, so the fix needs no lookup.
ONE_MENU = ("one menu serves every role: Mendix hides a menu item from a user who cannot open its page, so"
            " give each role its pages with `grant view on page` and list them all in the menu")


def role_home_findings(navigation: str) -> list[dict]:
    """NAV03: a role opens on a page its menu does not offer, so it cannot get back there."""
    failures = []
    homes: dict[str, list[tuple[str, str]]] = {}
    menu_pages: dict[str, set[str]] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        home = ROLE_HOME_RE.match(line)
        if home and profile:
            homes.setdefault(profile, []).append((home.group("page"), home.group("role")))
        item = MENU_PAGE_RE.match(line)
        if item and profile:
            menu_pages.setdefault(profile, set()).add(item.group("page").lower())
    for profile, pairs in sorted(homes.items()):
        for page, role in pairs:
            if page.lower() in menu_pages.get(profile, set()):
                continue
            failures.append({
                "check": "NAV03",
                "line": 0,
                "message": (f"navigation profile {profile}: role {role} opens on {page}, which is not in the menu"
                            f" -- add `menu item '<caption>' page {page} icon <icon>;` before Log out"
                            f" (DESCRIBE NAVIGATION {profile} first and keep the other items); {ONE_MENU}"),
            })
    return failures


# A sub-menu line: `menu '<caption>' [icon ...] (`.
SUB_MENU_RE = re.compile(r"^\s*menu\s+'(?P<caption>[^']*)'(?P<rest>.*)$", re.IGNORECASE)
ICON_RE = re.compile(r"\bicon\b", re.IGNORECASE)
# Caption words -> an Atlas_Filled icon that shows the same thing; first match wins.
ICON_HINTS = (
    (("log out", "logout", "sign out"), "logout"),
    (("home", "start"), "home"),
    (("dashboard", "overview", "kpi"), "dashboard"),
    (("report", "analytic", "statistic", "chart"), "analytics-bars"),
    (("invoice", "bill"), "cash-payment-bill"),
    (("payment", "credit"), "credit-card"),
    (("order", "cart", "purchase"), "shopping-cart"),
    (("shipment", "delivery", "product", "stock"), "shipment-box"),
    (("customer", "client", "contact", "user", "people", "employee", "account"), "user-neutral-group"),
    (("task", "todo", "approval", "inbox"), "task-list-multiple"),
    (("document", "file", "contract"), "document"),
    (("calendar", "schedule", "planning"), "calendar"),
    (("mail", "message", "email"), "email"),
    (("setup", "setting", "config", "admin"), "cog"),
    (("search", "find"), "search"),
)


def suggested_icon(caption: str) -> str:
    low = caption.lower()
    for words, icon in ICON_HINTS:
        if any(word in low for word in words):
            return f'Atlas_Core.Atlas_Filled.{icon}' if "-" not in icon else f'Atlas_Core.Atlas_Filled."{icon}"'
    return ""


def menu_icon_findings(navigation: str) -> list[dict]:
    """NAV05: every menu entry carries an icon that shows what it opens."""
    failures = []
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        entry = MENU_ITEM_RE.match(line) or SUB_MENU_RE.match(line)
        if not entry or not profile or ICON_RE.search(entry.group("rest")):
            continue
        caption = entry.group("caption")
        icon = suggested_icon(caption)
        fix = (f"`icon {icon}`" if icon else
               "an icon that shows what it opens, from `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`")
        failures.append({
            "check": "NAV05",
            "line": 0,
            "message": (f"navigation profile {profile}: menu entry '{caption}' has no icon -- add {fix} at the end"
                        f" of its line; with the sidebar collapsed the icon is all a user sees"),
        })
    return failures
