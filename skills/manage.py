#!/usr/bin/env python3
"""Verify pinned skill content and create portable agent discovery links."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "link"), default="check", nargs="?")
    args = parser.parse_args()
    manifest = json.loads((SKILLS / "sources.json").read_text())
    names = set()
    errors = []
    for entry in manifest["skills"]:
        name = entry["name"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or name in names:
            errors.append(f"Invalid or duplicate skill name: {name}")
            continue
        names.add(name)
        folder = SKILLS / name
        main_file = folder / "SKILL.md"
        if not main_file.is_file():
            errors.append(f"Missing {name}/SKILL.md")
            continue
        text = main_file.read_text()
        frontmatter = re.match(r"\A---\n(.*?)\n---(?:\n|$)", text, re.S)
        if not frontmatter:
            errors.append(f"Missing frontmatter: {name}")
        else:
            fields = frontmatter.group(1)
            if not re.search(rf"^name:\s*{re.escape(name)}\s*$", fields, re.M):
                errors.append(f"Name mismatch: {name}")
            if not re.search(r"^description:\s*\S", fields, re.M):
                errors.append(f"Missing description: {name}")
        for path in folder.rglob("*"):
            if path.is_symlink():
                errors.append(f"Unexpected symlink inside skill source: {path.relative_to(ROOT)}")
        if entry["kind"] == "upstream":
            actual = {
                p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in folder.rglob("*") if p.is_file() and not p.is_symlink()
            }
            if actual != entry["files_sha256"]:
                changed = sorted(k for k in actual.keys() | entry["files_sha256"].keys()
                                 if actual.get(k) != entry["files_sha256"].get(k))
                errors.append(f"Upstream snapshot changed: {name}: {', '.join(changed)}")
        if entry.get("license_file") and not (folder / entry["license_file"]).is_file():
            errors.append(f"Missing license: {name}")

    # Validate sources before making any links. Never overwrite a contributor's files.
    pending = []
    for agent in (".agents", ".claude"):
        parent = ROOT / agent / "skills"
        if (ROOT / agent).is_symlink() or parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            errors.append(f"Expected real discovery directory: {parent.relative_to(ROOT)}")
            continue
        for name in sorted(names):
            link = parent / name
            target = f"../../skills/{name}"
            if link.is_symlink():
                if os.readlink(link) != target or not link.is_dir():
                    errors.append(f"Unexpected/broken link: {link.relative_to(ROOT)}")
            elif link.exists():
                errors.append(f"Refusing to overwrite: {link.relative_to(ROOT)}")
            elif args.command == "link":
                pending.append((link, target))
            else:
                errors.append(f"Missing link: {link.relative_to(ROOT)}; run link")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    for link, target in pending:
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(target, target_is_directory=True)
    print(f"Verified {len(names)} skills, pinned upstream contents, and both agent link trees."
          + (f" Created {len(pending)} links." if pending else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
