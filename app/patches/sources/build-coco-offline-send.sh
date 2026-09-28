#!/usr/bin/env bash
# Rebuild app/patches/@cashu+coco-core+2.0.0.patch from its source commit.
#
#   app/patches/sources/build-coco-offline-send.sh [path-to-coco-checkout]
#
# Applies coco-core-2.0.0-offline-send.patch to coco v2.0.0 in a temporary
# worktree, runs coco's unit tests, builds, and turns the build into the bun
# patch. A v2.0.0 build reproduces the published dist byte for byte, so the
# bun patch holds only what the source commit changes. Run from the repo root.
set -euo pipefail

COCO_REPO="${1:-../../coco}"
ROOT="$(pwd)"
SOURCE_PATCH="$ROOT/app/patches/sources/coco-core-2.0.0-offline-send.patch"
BUN_PATCH="app/patches/@cashu+coco-core+2.0.0.patch"
# Published names of the content-hashed type chunks in @cashu/coco-core@2.0.0.
PUBLISHED_INDEX_CHUNK="index-CvKNFBXJ"
PUBLISHED_PLUGIN_CHUNK="plugin-CwKz4VMw"
UNCHANGED_INDEX_CHUNK="index-ClFJiJ8o"

WORKTREE="$(mktemp -d)/coco-offline-send"
cleanup() { git -C "$COCO_REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git -C "$COCO_REPO" worktree add --detach --quiet "$WORKTREE" v2.0.0
git -C "$WORKTREE" -c user.name=build -c user.email=build@localhost am --quiet "$SOURCE_PATCH"
(cd "$WORKTREE" && bun install --silent)
(cd "$WORKTREE/packages/core" && bun test test/unit >/dev/null && bun run build >/dev/null)

DIST="$WORKTREE/packages/core/dist"
index_chunk="$(cd "$DIST" && ls index-*.d.ts | grep -v "$UNCHANGED_INDEX_CHUNK" | sed 's/\.d\.ts$//')"
plugin_chunk="$(cd "$DIST" && ls plugin-*.d.ts | sed 's/\.d\.ts$//')"
mv "$DIST/$index_chunk.d.ts" "$DIST/$PUBLISHED_INDEX_CHUNK.d.ts"
mv "$DIST/$plugin_chunk.d.ts" "$DIST/$PUBLISHED_PLUGIN_CHUNK.d.ts"
sed -i.bak "s/$index_chunk/$PUBLISHED_INDEX_CHUNK/g; s/$plugin_chunk/$PUBLISHED_PLUGIN_CHUNK/g" "$DIST"/*.d.ts
rm "$DIST"/*.bak

# Start from the published package, not the currently patched one.
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  delete pkg.patchedDependencies["@cashu/coco-core@2.0.0"];
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'
rm -f "$BUN_PATCH"
rm -rf node_modules/@cashu/coco-core
bun install --silent
bun patch @cashu/coco-core >/dev/null
cp "$DIST"/*.js "$DIST"/*.d.ts node_modules/@cashu/coco-core/dist/
bun patch --commit node_modules/@cashu/coco-core --patches-dir app/patches >/dev/null

mv "app/patches/@cashu%2Fcoco-core@2.0.0.patch" "$BUN_PATCH"
sed -i.bak 's#app/patches/@cashu%2Fcoco-core@2.0.0.patch#app/patches/@cashu+coco-core+2.0.0.patch#' package.json bun.lock
rm package.json.bak bun.lock.bak
rm -rf node_modules/@cashu/coco-core
bun install --silent
echo "Rebuilt $BUN_PATCH"
