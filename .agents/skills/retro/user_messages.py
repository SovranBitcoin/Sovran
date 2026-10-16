#!/usr/bin/env python3
"""Print every message the owner typed to Claude Code or Codex in this project, oldest first.

Reads the transcripts both tools keep under the home directory and writes plain text to
standard output. Nothing is sent anywhere.
"""

import argparse
import datetime
import glob
import hashlib
import json
import os
import re
import subprocess

HOME = os.path.expanduser("~")
# Text the tools insert into a user turn that the owner did not type.
INSERTED = re.compile(
    r"<(system-reminder|local-command-\w+|command-message|task-notification|bash-std\w+)>.*?</\1>",
    re.S,
)
NOT_TYPED = (
    "This session is being continued",
    "Caveat:",
    "[Request interrupted",
    "Base directory for this skill",
    "<bash-input>",
    "Stop hook feedback",
)


def claude_messages(project):
    # Claude Code names a project's folder after its path, with every separator as a dash.
    folder = re.sub(r"[^A-Za-z0-9]", "-", project)
    for path in glob.glob(f"{HOME}/.claude/projects/{folder}*/*.jsonl"):
        session = os.path.basename(path)[:8]
        with open(path, errors="replace") as lines:
            for line in lines:
                if '"type":"user"' not in line:
                    continue
                try:
                    turn = json.loads(line)
                except ValueError:
                    continue
                if turn.get("type") != "user" or turn.get("isSidechain") or turn.get("isMeta"):
                    continue
                content = turn.get("message", {}).get("content")
                if isinstance(content, list):
                    content = "\n".join(
                        part.get("text", "")
                        for part in content
                        if isinstance(part, dict) and part.get("type") == "text"
                    )
                if not isinstance(content, str):
                    continue
                command = re.search(r"<command-name>(.*?)</command-name>", content, re.S)
                text = INSERTED.sub("", content)
                if command:
                    args = re.search(r"<command-args>(.*?)</command-args>", content, re.S)
                    text = f"{command.group(1).strip()} {args.group(1).strip() if args else ''}"
                text = text.strip()
                if text and not text.startswith(NOT_TYPED):
                    yield turn.get("timestamp", "")[:16], "claude", session, text


def codex_messages(project):
    history = f"{HOME}/.codex/history.jsonl"
    if not os.path.exists(history):
        return
    prompts = []
    with open(history, errors="replace") as lines:
        for line in lines:
            try:
                prompts.append(json.loads(line))
            except ValueError:
                continue
    wanted = {prompt["session_id"] for prompt in prompts}
    # history.jsonl has no working directory; the first record of each session file does.
    here = set()
    for path in glob.glob(f"{HOME}/.codex/sessions/**/*.jsonl", recursive=True):
        session = re.search(r"([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$", path)
        if not session or session.group(1) not in wanted:
            continue
        with open(path, errors="replace") as file:
            cwd = re.search(r'"cwd":"([^"]+)"', file.read(20000))
        if cwd and cwd.group(1).startswith(project):
            here.add(session.group(1))
    for prompt in prompts:
        if prompt["session_id"] in here:
            when = datetime.datetime.fromtimestamp(prompt["ts"], datetime.timezone.utc)
            yield when.strftime("%Y-%m-%dT%H:%M"), "codex", prompt["session_id"][-8:], prompt.get("text", "").strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default="", help="earliest date to include, as YYYY-MM-DD")
    parser.add_argument("--limit", type=int, default=1500, help="characters kept of each message")
    args = parser.parse_args()
    # A linked worktree's sessions belong with the main checkout's.
    common = subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], text=True
    ).strip()
    project = os.path.dirname(common)

    seen = set()
    for when, tool, session, text in sorted([*claude_messages(project), *codex_messages(project)]):
        if when < args.since:
            continue
        key = hashlib.md5(re.sub(r"\s+", " ", text[:400]).encode()).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        text = re.sub(r"\n{2,}", "\n", text)
        if len(text) > args.limit:
            text = f"{text[: args.limit]} …[+{len(text) - args.limit} characters]"
        print(f"## {when} {tool} {session}\n{text}")


if __name__ == "__main__":
    main()
