#!/usr/bin/env bash
# Start the installed development client from this checkout, including on a phone.
#
# The session is captured to LOG.txt so it can be read back afterwards — by
# log-doctor, or by an agent debugging a report:
#
#   bun run log-doctor -- timeline --latest < LOG.txt
#   bun run log-doctor -- errors --latest   < LOG.txt
#
# Two things make that file readable:
#
#  1. EXPO_PUBLIC_LOG_PRETTY=0 — the app emits ONE JSON object per line. The dev
#     default indents, which is nicer live but spreads an entry over many lines
#     and leaves the capture unparseable. Set it to 1 to keep the indented form
#     (and accept an unreadable LOG.txt).
#  2. script(1) rather than a pipe — Metro keeps a pty, so Expo's interactive
#     shortcuts (r, m, j) still work while every line is also written to disk.
#     A plain `cmd | tee` would capture just as well but silently kill them.
set -euo pipefail

cd "$(dirname "$0")/.."
export EXPO_PUBLIC_ENV=development
export EXPO_PUBLIC_LOG_PRETTY="${EXPO_PUBLIC_LOG_PRETTY:-0}"

LOG_FILE="${SOVRAN_DEV_LOG:-LOG.txt}"

# Truncated per run, so the file is one session and cannot grow without bound
# across days of development. log-doctor's `--latest` then only has to deal with
# in-app reloads, not with weeks of history.
: > "$LOG_FILE"
echo "dev: capturing this session to app/$LOG_FILE" >&2

if [[ "$(uname -s)" == "Darwin" ]] && command -v script >/dev/null 2>&1; then
  # macOS: script [-q] <file> <command>… (BSD argument order).
  exec script -q "$LOG_FILE" bunx --no-install expo start --dev-client --clear "$@"
fi

# Elsewhere (and if script is unavailable): capture without a pty. Expo's
# interactive shortcuts are off in this mode.
bunx --no-install expo start --dev-client --clear "$@" 2>&1 | tee "$LOG_FILE"
