"""Accounts and the template module: ACCOUNT01-03 (Users and My account in the menu, the
roles that need them), MODULE01 (MyFirstModule removed) and HOME01 (admins start in the app).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .navigation import MENU_ITEM_RE, PROFILE_RE


# ACCOUNT01-03 ---------------------------------------------------------------------------------
ADMIN_PAGE = "Administration.Account_Overview"
MY_ACCOUNT_FLOW = "Administration.ManageMyAccount"
ADMIN_ITEM = f"menu item 'Users' page {ADMIN_PAGE} icon Atlas_Core.Atlas_Filled.\"user-neutral-group\";"
MY_ACCOUNT_ITEM = f"menu item 'My account' microflow {MY_ACCOUNT_FLOW} icon Atlas_Core.Atlas_Filled.user;"
USER_ROLE_RE = re.compile(r"^\s*create\s+user\s+role\s+(?P<name>[\w.]+)\s*\((?P<roles>[^)]*)\)", re.IGNORECASE)


def account_findings(navigation: str, user_roles: str, guest_role: str) -> list[dict]:
    """ACCOUNT01-03: user management for administrators, own account and password for everyone."""
    failures = []
    targets: dict[str, str] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            targets.setdefault(profile, "")
            continue
        if profile and MENU_ITEM_RE.match(line):
            targets[profile] += line + "\n"
    for profile, menu in sorted(targets.items()):
        if not menu:
            continue  # a profile without a menu is not where users navigate
        if not re.search(r"\bpage\s+" + re.escape(ADMIN_PAGE) + r"\b", menu, re.IGNORECASE):
            failures.append({"check": "ACCOUNT01", "line": 0, "message": (
                f"navigation profile {profile}: no menu item for user management -- add `{ADMIN_ITEM}` before"
                f" Log out. It is the Administration module's own page; only Administration.Administrator can"
                f" open it, so everyone else never sees the item")})
        if not re.search(r"\bmicroflow\s+" + re.escape(MY_ACCOUNT_FLOW) + r"\b", menu, re.IGNORECASE):
            failures.append({"check": "ACCOUNT02", "line": 0, "message": (
                f"navigation profile {profile}: no menu item for the user's own account and password -- add"
                f" `{MY_ACCOUNT_ITEM}` before Log out. It opens Administration.MyAccount (view the account,"
                f" change the password) for whoever is signed in; a menu item cannot open MyAccount itself,"
                f" because the page needs the account as its parameter")})
    roles = {m.group("name"): {r.strip() for r in m.group("roles").split(",")}
             for m in map(USER_ROLE_RE.match, user_roles.splitlines()) if m}
    for name, module_roles in sorted(roles.items()):
        if name == guest_role or "Administration.User" in module_roles:
            continue
        failures.append({"check": "ACCOUNT03", "line": 0, "message": (
            f"user role {name} signs in but lacks Administration.User, so 'My account' is hidden from it and"
            f" its users cannot change their password -- `alter user role {name} add module roles"
            f" (Administration.User);`")})
    if roles and not any("Administration.Administrator" in r for r in roles.values()):
        failures.append({"check": "ACCOUNT03", "line": 0, "message": (
            "no user role has Administration.Administrator, so nobody can manage users -- add it to the"
            " administrators' role: `alter user role Administrator add module roles (Administration.Administrator);`")})
    return failures


# MODULE01 / HOME01 ---------------------------------------------------------------------------
TEMPLATE_MODULE = "MyFirstModule"
TEMPLATE_USE_RE = re.compile(TEMPLATE_MODULE + r"[.][\w.]+")
HOME_RE = re.compile(r"^\s*home\s+page\s+(?P<page>[\w.]+)(?:\s+for\s+(?P<role>[\w.]+))?", re.IGNORECASE)


def admin_roles(user_roles: str) -> list[str]:
    """User roles that administer the app: Administration.Administrator, or `manage all roles`."""
    found = []
    for line in user_roles.splitlines():
        role = USER_ROLE_RE.match(line)
        if role and ("Administration.Administrator" in role.group("roles") or "manage all roles" in line.lower()):
            found.append(role.group("name"))
    return found


def template_module_findings(own_modules: list[str], has_pages: bool, navigation: str, user_roles: str,
                             own_mdl: str) -> list[dict]:
    """MODULE01: once the app has a module of its own, the template's MyFirstModule is dead weight."""
    if not own_modules or not has_pages:
        return []
    uses = []
    for line in navigation.splitlines():
        if TEMPLATE_MODULE + "." in line and ("home page" in line.lower() or "menu item" in line.lower()):
            uses.append("navigation: " + line.strip().rstrip(";"))
    for line in user_roles.splitlines():
        role = USER_ROLE_RE.match(line)
        if role and TEMPLATE_MODULE + "." in role.group("roles"):
            uses.append(f"user role {role.group('name')} has {TEMPLATE_MODULE}.User")
    document = ""
    for line in own_mdl.splitlines():
        head = re.match(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:page|snippet|microflow|nanoflow)\s+([\w.]+)",
                        line, re.IGNORECASE)
        if head:
            document = head.group(1)
        used = TEMPLATE_USE_RE.search(line)
        if used and document:
            uses.append(f"{document} uses {used.group(0)}")
    uses = list(dict.fromkeys(uses))
    main = own_modules[0]
    steps = []
    if any(use.startswith("navigation:") for use in uses):
        steps.append(f"point every `home page`/`menu item` at pages of {main} -- the administrators get their own"
                     f" home page there (e.g. {main}.Admin_Home), and the profile keeps a default `home page"
                     f" {main}.<Page>` without `for` (without one mx check fails CE0527)")
    if any(" uses " in use for use in uses):
        steps.append(f"move what your pages or flows use from {TEMPLATE_MODULE} (an image, a flow) into {main}")
    if any(use.startswith("user role") for use in uses):
        steps.append(f"`alter user role <Role> remove module roles ({TEMPLATE_MODULE}.User);` for each role listed")
    steps.append(f"`drop module {TEMPLATE_MODULE};`, and remove {TEMPLATE_MODULE} from the scripts in mdlsource/"
                 f" so a re-run does not bring it back")
    steps = "; ".join(f"{n}. {step}" for n, step in enumerate(steps, 1))
    found = "; ".join(uses[:8]) + (f"; ... {len(uses) - 8} more" if len(uses) > 8 else "") if uses else "nothing"
    return [{"check": "MODULE01", "line": 0, "message": (
        f"{TEMPLATE_MODULE} is the empty template's module and this app has its own ({', '.join(own_modules)})"
        f" -- remove it. Still using it: {found}. Steps: {steps}")}]


def admin_home_findings(navigation: str, user_roles: str, own_modules: list[str]) -> list[dict]:
    """HOME01: administrators open on a page of the app itself, not the template's Home_Web."""
    failures = []
    default, by_role, profile = {}, {}, ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        home = HOME_RE.match(line)
        if home and profile:
            if home.group("role"):
                by_role.setdefault(profile, {})[home.group("role")] = home.group("page")
            else:
                default.setdefault(profile, home.group("page"))
    main = own_modules[0] if own_modules else "<YourModule>"
    for role in admin_roles(user_roles):
        for profile in sorted(set(default) | set(by_role)):
            page = by_role.get(profile, {}).get(role, default.get(profile, ""))
            if page and page.split(".")[0] in own_modules:
                continue
            failures.append({"check": "HOME01", "line": 0, "message": (
                f"navigation profile {profile}: role {role} opens on {page or 'no page'}, which is not a page of"
                f" the app's own modules -- create an administrators' home page in {main} (e.g. {main}.Admin_Home:"
                f" what an administrator starts the day with, and links to Users) and add"
                f" `home page {main}.Admin_Home for {role}` to the profile")})
    return failures
