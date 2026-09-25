"""Record what the installer put in this project, and what each file looked like.

Called by install.sh; tests/portable.sh compares against the result at gate preflight.
Usage: record_install.py <app-dir> <bundle-dir> <version>; prints the number of files recorded.
Writes <app>/tools/mdl-checks/INSTALL.json with keys version, installed, files ({path: sha256}).
Exit 0; 1 on wrong argument count, printing this docstring's first line as usage (keep it).
"""

import hashlib
import json
import os
import sys
import time

# Files are listed from the bundle, not globbed in the app, so mxcli's own skills and rules are not tracked.
SKILL_DIRS = (".claude/skills", ".agents/skills", ".ai-context/skills")
HARNESS_SCRIPTS = ("gate.sh", "orient.sh", "diagnose.sh", "precheck.sh", "peek.sh", "lib.sh", "portable.sh", "scenario-helpers.js")


def listdir(path, suffix):
    """Sorted names ending in `suffix`; [] if the directory is missing."""
    try:
        return sorted(n for n in os.listdir(path) if n.endswith(suffix))
    except OSError:
        return []


def destinations(src):
    """Yield (bundle file, app-relative destination) for everything tracked."""
    for name in HARNESS_SCRIPTS:
        yield os.path.join(src, "tests", name), "tests/" + name

    for name in listdir(os.path.join(src, "tests", "gate"), ".sh"):
        yield os.path.join(src, "tests", "gate", name), "tests/gate/" + name

    for name in listdir(os.path.join(src, "tests", "lib"), ".sh"):
        yield os.path.join(src, "tests", "lib", name), "tests/lib/" + name

    for name in listdir(os.path.join(src, "checks"), ".py"):
        yield os.path.join(src, "checks", name), "tools/mdl-checks/" + name

    # check_layout.py's rules, one module per area of a page.
    for name in listdir(os.path.join(src, "checks", "layout_rules"), ".py"):
        yield os.path.join(src, "checks", "layout_rules", name), "tools/mdl-checks/layout_rules/" + name

    for name in listdir(os.path.join(src, "hooks"), ".sh"):
        yield os.path.join(src, "hooks", name), "tools/mdl-checks/hooks/" + name

    for name in listdir(os.path.join(src, "lint-rules"), ".star"):
        yield os.path.join(src, "lint-rules", name), ".claude/lint-rules/" + name

    # plugins/ holds one file per host that takes a plugin: the OpenCode plugin, and the Pi
    # extension, which is installed under its host's own name.
    for name in listdir(os.path.join(src, "plugins"), ".js"):
        if name.endswith(".pi.js"):
            yield os.path.join(src, "plugins", name), ".pi/extensions/mendix-mdl-harness.js"
        else:
            yield os.path.join(src, "plugins", name), ".opencode/plugin/" + name

    yield os.path.join(src, "rules", "mdl-skills.md"), ".claude/rules/mdl-skills.md"
    yield os.path.join(src, "rules", "mdl-skills.mdc"), ".cursor/rules/mdl-skills.mdc"

    skills_root = os.path.join(src, "skills")
    try:
        skills = sorted(os.listdir(skills_root))
    except OSError:
        skills = []
    for skill in skills:
        source = os.path.join(skills_root, skill, "SKILL.md")
        if not os.path.isfile(source):
            continue
        for skill_dir in SKILL_DIRS:
            yield source, "%s/%s/SKILL.md" % (skill_dir, skill)
        for name in listdir(os.path.join(skills_root, skill, "reference"), ".md"):
            for skill_dir in SKILL_DIRS:
                yield os.path.join(skills_root, skill, "reference", name), "%s/%s/reference/%s" % (skill_dir, skill, name)


def main(argv):
    if len(argv) != 4:
        raise SystemExit(__doc__.strip().splitlines()[0])
    app, src, version = argv[1], argv[2], argv[3]

    files = {}
    for source, relative in destinations(src):
        if not os.path.isfile(source):
            continue
        # Keys stay forward-slashed so manifests are portable across Windows and macOS.
        path = os.path.join(app, *relative.split("/"))
        try:
            with open(path, "rb") as handle:
                files[relative] = hashlib.sha256(handle.read()).hexdigest()
        except OSError:
            # Not installed in this project.
            continue

    manifest = os.path.join(app, "tools", "mdl-checks", "INSTALL.json")
    os.makedirs(os.path.dirname(manifest), exist_ok=True)
    with open(manifest, "w", encoding="utf-8") as out:
        json.dump({"version": version,
                   "installed": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "files": files},
                  out, indent=1, sort_keys=True)
        out.write("\n")
    print(len(files))


if __name__ == "__main__":
    main(sys.argv)
