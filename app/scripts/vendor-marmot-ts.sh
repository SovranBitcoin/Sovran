#!/usr/bin/env bash
#
# Sync the vendored copy of marmot-ts at vendor/marmot-ts/ from the sibling
# checkout at ../marmot-ts/. Vendored because EAS only sees the sovran-app
# tree, so a `file:../marmot-ts` install path would break CI builds.
#
# When you change anything in ../marmot-ts/, run this from sovran-app/:
#
#   bun run vendor:marmot-ts && bun install
#
# Then commit vendor/marmot-ts/ alongside sovran-app changes that depend
# on the new marmot-ts behaviour.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIBLING="$REPO_ROOT/../marmot-ts"
TARGET="$REPO_ROOT/vendor/marmot-ts"

if [ ! -d "$SIBLING" ]; then
  echo "error: sibling checkout not found at $SIBLING" >&2
  exit 1
fi

echo "→ building marmot-ts at $SIBLING"
(cd "$SIBLING" && pnpm install --ignore-workspace --silent && pnpm build)

if [ ! -d "$SIBLING/dist" ]; then
  echo "error: marmot-ts build did not produce dist/" >&2
  exit 1
fi

echo "→ syncing dist + package.json into $TARGET"
rm -rf "$TARGET/dist"
mkdir -p "$TARGET/dist"
cp -R "$SIBLING/dist/." "$TARGET/dist/"
cp "$SIBLING/package.json" "$TARGET/package.json"
cp "$SIBLING/LICENSE" "$TARGET/LICENSE" 2>/dev/null || true
cp "$SIBLING/README.md" "$TARGET/README.md" 2>/dev/null || true

echo "✓ marmot-ts vendored. Run 'bun install' to refresh node_modules."
