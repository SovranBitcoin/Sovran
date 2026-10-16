#!/usr/bin/env bash
#
# Refresh the vendored copy of marmot-ts at app/vendor/marmot-ts/ from a
# checkout of it. Vendored because an EAS build only sees this repository, so a
# `file:` path to a sibling checkout would break it.
#
#   cd app && bun run vendor:marmot-ts && bun install
#
# The checkout is looked for beside this repository (../marmot-ts from the
# repository root); set MARMOT_TS_DIR to use another. It must be a clean git
# checkout: the commit it is at is written to vendor/marmot-ts/UPSTREAM, and a
# copy that cannot name its commit is refused. Commit vendor/marmot-ts/ with the
# change that needs the new behaviour.
#
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${MARMOT_TS_DIR:-$APP_ROOT/../../marmot-ts}"
TARGET="$APP_ROOT/vendor/marmot-ts"

fail() {
  echo "error: $*" >&2
  exit 1
}

[ -d "$SOURCE/.git" ] || [ -f "$SOURCE/.git" ] ||
  fail "no git checkout of marmot-ts at $SOURCE (set MARMOT_TS_DIR)"
[ -f "$SOURCE/LICENSE" ] || fail "$SOURCE has no LICENSE; a copy cannot be vendored without one"
[ -z "$(git -C "$SOURCE" status --porcelain)" ] ||
  fail "$SOURCE has uncommitted changes; the vendored copy must match a commit"

REVISION="$(git -C "$SOURCE" rev-parse HEAD)"
ORIGIN="$(git -C "$SOURCE" remote get-url origin 2>/dev/null || echo unknown)"

echo "→ building marmot-ts $REVISION at $SOURCE"
(cd "$SOURCE" && pnpm install --ignore-workspace --frozen-lockfile --silent && pnpm build)
[ -d "$SOURCE/dist" ] || fail "the marmot-ts build did not produce dist/"

echo "→ copying dist, package.json and LICENSE into $TARGET"
rm -rf "$TARGET/dist"
mkdir -p "$TARGET/dist"
cp -R "$SOURCE/dist/." "$TARGET/dist/"
cp "$SOURCE/package.json" "$TARGET/package.json"
cp "$SOURCE/LICENSE" "$TARGET/LICENSE"
[ ! -f "$SOURCE/README.md" ] || cp "$SOURCE/README.md" "$TARGET/README.md"
printf 'source: %s\nrevision: %s\nrefresh: cd app && bun run vendor:marmot-ts\n' \
  "$ORIGIN" "$REVISION" >"$TARGET/UPSTREAM"

echo "✓ marmot-ts $REVISION vendored. Run 'bun install' to refresh node_modules."
