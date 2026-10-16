#!/usr/bin/env python3
"""Find where the durable surface changed across every build that could have reached a phone.

  epochs.py builds   Pull every EAS build and write the store builds, one per line, to
                     docs/architecture/persistence/store-builds.tsv (needs `eas login`).
  epochs.py diff     Run surface.sh on every commit in that file, on origin/main inside any
                     window whose builds recorded no commit, and on HEAD; write the changes in
                     durable names to docs/architecture/persistence/epoch-diff.txt.

Both outputs are evidence, not conclusions: a token appearing or disappearing says where to
read, not what happened to the data. Run from the repository root.
"""
import json
import os
import re
import subprocess
import sys

OUT = "docs/architecture/persistence"
BUILDS = f"{OUT}/store-builds.tsv"
DIFF = f"{OUT}/epoch-diff.txt"
SURFACE = ".agents/skills/persistence-release-safety/surface.sh"
COLUMNS = ("date", "platform", "profile", "version", "build", "commit", "in_repo", "on_main")


def run(*args, cwd=None):
    return subprocess.run(args, capture_output=True, text=True, cwd=cwd)


def in_repo(sha):
    return bool(sha) and run("git", "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0


def builds():
    rows, offset = {}, 0
    while True:
        page = run("bunx", "eas-cli", "build:list", "--limit", "50", "--offset", str(offset),
                   "--non-interactive", "--json", cwd="app")
        if page.returncode:
            sys.exit(f"eas build:list failed at offset {offset}: {page.stderr[-400:]}")
        batch = json.loads(page.stdout)
        for build in batch:
            rows[build["id"]] = build
        if len(batch) < 50:
            break
        offset += 50
    lines = ["\t".join(COLUMNS)]
    for build in sorted(rows.values(), key=lambda b: b["createdAt"]):
        # A store build is anything a tester or a customer could install from a store or as
        # a signed APK. Development and simulator builds never carry real wallets.
        shippable = build.get("distribution") == "STORE" or build.get("buildProfile") == "production-apk"
        if build["status"] != "FINISHED" or not shippable:
            continue
        sha = (build.get("gitCommitHash") or "")[:10]
        known = in_repo(sha)
        main = known and run("git", "merge-base", "--is-ancestor", sha, "origin/main").returncode == 0
        lines.append("\t".join([
            build["createdAt"][:10], build["platform"].lower(), build.get("buildProfile") or "",
            build.get("appVersion") or "", build.get("appBuildVersion") or "", sha or "-",
            "yes" if known else "no", "yes" if main else "no",
        ]))
    with open(BUILDS, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"{len(lines) - 1} store builds -> {BUILDS}")


TOKEN = re.compile(r"""['"`]([A-Za-z0-9_:.\-\$\{\}/]{3,80})['"`]""")
NAMED = ("Persisted store names", "AsyncStorage calls", "SecureStore calls", "SQLite databases", "MMKV")
TABLE = re.compile(r"(CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE|DROP TABLE(?: IF EXISTS)?) +([A-Za-z_]+)")


def tokens(rev):
    found, section = set(), None
    for line in run("sh", SURFACE, rev).stdout.split("\n"):
        if line.startswith("## "):
            section = line[3:]
            continue
        if not section:
            continue
        body = line.split(":", 2)[-1]
        if section.startswith("Persist versions"):
            match = re.match(r"([^:]+):\d+:.*version: *(\d+)", line)
            if match:
                found.add(f"version:{os.path.basename(match.group(1))}={match.group(2)}")
        elif section.startswith(NAMED):
            table = TABLE.search(body) if section.startswith("SQLite") else None
            if table:
                found.add(f"table:{table.group(2)}")
                continue
            kind = section.split()[0].lower()
            for match in TOKEN.finditer(body):
                found.add(f"{kind}:{match.group(1)}")
    return found


def diff():
    rows = [line.split("\t") for line in open(BUILDS).read().splitlines()[1:]]
    revisions, seen = [], set()

    def add(rev, label):
        full = run("git", "rev-parse", "--short=10", rev).stdout.strip()
        if full and full not in seen:
            seen.add(full)
            revisions.append((full, label))

    blind = []  # dates of builds that recorded no usable commit
    for date, platform, _profile, version, build, sha, known, _main in rows:
        if known == "yes":
            add(sha, f"{version} {platform} build {build}")
        else:
            blind.append(date)
    recorded = [row[0] for row in rows if row[6] == "yes"]
    # Builds before the first commit in this repository cannot be read at all; the rest of
    # the blind builds are covered by walking origin/main across the dates they span.
    first = run("git", "log", "--reverse", "--format=%ad", "--date=short", "origin/main").stdout.split("\n")[0]
    window = [date for date in blind if date >= first]
    if window:
        log = run("git", "log", "--first-parent", "--format=%h", f"--since={min(window)}T00:00:00",
                  f"--until={max(window)}T23:59:59", "origin/main").stdout.split()
        for sha in log:
            add(sha, "origin/main, inside a window whose builds recorded no commit")
    for tag in run("git", "tag").stdout.split():
        add(tag, f"tag {tag}")
    add("HEAD", "candidate")
    revisions.sort(key=lambda item: int(run("git", "log", "-1", "--format=%ct", item[0]).stdout))

    out = [f"# Changes in durable names across {len(revisions)} revisions",
           f"# {len(recorded)} store builds name a commit in this repository; "
           f"{len(blind)} do not ({len(blind) - len(window)} predate the repository).", ""]
    previous = None
    for sha, label in revisions:
        current = tokens(sha)
        date = run("git", "log", "-1", "--format=%ad", "--date=short", sha).stdout.strip()
        if previous is None:
            out.append(f"{date} {sha} [{label}] BASE\n  " + " ".join(sorted(current)))
        elif current != previous:
            out.append(f"{date} {sha} [{label}]\n  + " + " ".join(sorted(current - previous))
                       + "\n  - " + " ".join(sorted(previous - current)))
        previous = current
    with open(DIFF, "w") as handle:
        handle.write("\n".join(out) + "\n")
    print(f"{len(revisions)} revisions -> {DIFF}")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    {"builds": builds, "diff": diff}.get(command, lambda: sys.exit(__doc__))()
