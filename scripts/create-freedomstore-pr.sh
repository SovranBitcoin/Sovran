#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FREEDOMSTORE_DIR="${ROOT_DIR}/../freedomstore"
ALTSTORE_JSON="${FREEDOMSTORE_DIR}/altstore-source.json"
BUNDLE_ID="com.sovranbitcoin"
TARGET_REPO="${FREEDOMSTORE_TARGET:-kelbie/freedomstore}"
BASE_BRANCH="main"

# --- Usage ---
usage() {
  echo "Usage: $0 <ADP_ID> [--no-screenshots]"
  echo
  echo "  ADP_ID             Alternative Distribution Package ID (UUID from App Store Connect)"
  echo "                     e.g. 955b20d5-8417-4a3d-88f6-05d72eec18aa"
  echo "  --no-screenshots   Skip syncing screenshots from App Store Connect"
  echo
  echo "  Find ADP ID at:"
  echo "    https://appstoreconnect.apple.com/apps/6499554529/distribution/activity/ios/versions"
  echo "    Click a version -> Alternative Distribution Package ID"
  exit 1
}

if [ $# -lt 1 ] || [ -z "$1" ]; then
  usage
fi

ADP_ID="$1"
SYNC_FLAGS=""
shift
for arg in "$@"; do
  case "${arg}" in
    --no-screenshots) SYNC_FLAGS="${SYNC_FLAGS} --no-screenshots" ;;
  esac
done

# Validate UUID format
if ! echo "${ADP_ID}" | grep -qE '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
  echo "Error: Invalid ADP ID format. Expected a UUID like:"
  echo "  955b20d5-8417-4a3d-88f6-05d72eec18aa"
  exit 1
fi

# --- Prerequisites ---
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required. Install: brew install gh"
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Error: gh is not authenticated for github.com."
  echo "Run: gh auth login -h github.com"
  exit 1
fi

# --- Fork and clone freedomstore if not present ---
if [ ! -d "${FREEDOMSTORE_DIR}/.git" ]; then
  echo "Forking freedomstore/freedomstore and cloning into ${FREEDOMSTORE_DIR}..."
  gh repo fork freedomstore/freedomstore --clone=false 2>/dev/null || true
  gh repo clone kelbie/freedomstore "${FREEDOMSTORE_DIR}"
fi

# --- Download ADP (+ screenshots to sovran.money, without updating freedomstore JSON) ---
node "${ROOT_DIR}/scripts/sync-altstore.mjs" "${ADP_ID}" --download-only${SYNC_FLAGS}

# --- Read version from the downloaded manifest ---
RELEASES_DIR="${ROOT_DIR}/../sovran.money/public/ios/releases"
RELEASE_DIR="${RELEASES_DIR}/${ADP_ID}"
MANIFEST="${RELEASE_DIR}/manifest.json"

if [ ! -f "${MANIFEST}" ]; then
  echo "Error: manifest.json not found at ${MANIFEST}."
  exit 1
fi

read -r VERSION BUILD < <(
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(m.shortVersionString + " " + m.bundleVersion);
  ' "${MANIFEST}"
)

if [ -z "${VERSION}" ] || [ -z "${BUILD}" ]; then
  echo "Error: Could not parse version/build from manifest.json."
  exit 1
fi

echo "Version: ${VERSION} (build ${BUILD})"

# --- Git operations on freedomstore ---
TITLE="Sovran release ${VERSION}"
BRANCH="sovran-release-${VERSION}"

cd "${FREEDOMSTORE_DIR}"

# Make sure we have the latest main
git fetch origin "${BASE_BRANCH}" --quiet

# Create or switch to release branch from clean main
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git checkout "${BRANCH}"
else
  git checkout -b "${BRANCH}" "origin/${BASE_BRANCH}"
fi

# --- Now update altstore-source.json on the branch ---
node "${ROOT_DIR}/scripts/sync-altstore.mjs" "${ADP_ID}"${SYNC_FLAGS}

# Commit if altstore-source.json changed
if ! git diff --quiet -- altstore-source.json; then
  git add altstore-source.json
  git commit -m "${TITLE}"
fi

git push -u origin "${BRANCH}"

# --- Generate composite screenshot image ---
SCREENSHOTS_DIR="${ROOT_DIR}/../sovran.money/public/ios"
COMPOSITE_NAME="screenshots-preview-${VERSION}.png"
COMPOSITE_PATH="${SCREENSHOTS_DIR}/${COMPOSITE_NAME}"
COMPOSITE_URL=""

# Find the primary device directory (first one with PNGs)
PRIMARY_DEVICE=""
for d in APP_IPHONE_65 APP_IPHONE_67 APP_IPHONE_55 APP_IPHONE_61 APP_IPHONE_58; do
  if ls "${SCREENSHOTS_DIR}/${d}/"*.png >/dev/null 2>&1; then
    PRIMARY_DEVICE="${d}"
    break
  fi
done

if [ -n "${PRIMARY_DEVICE}" ]; then
  echo "Generating composite screenshot from ${PRIMARY_DEVICE}..."
  NODE_PATH="${ROOT_DIR}/node_modules" node -e '
    const sharp = require("sharp");
    const fs = require("fs");
    const path = require("path");

    const dir = process.argv[1];
    const out = process.argv[2];
    const orderPath = path.join(dir, "order.json");
    const files = fs.existsSync(orderPath)
      ? JSON.parse(fs.readFileSync(orderPath, "utf8"))
      : fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
    if (files.length === 0) { console.log("No screenshots found"); process.exit(0); }

    const THUMB_HEIGHT = 480;
    const COLS = 4;
    const MARGIN = 16;
    const PADDING = 24;
    const BG = { r: 30, g: 30, b: 30, alpha: 255 };
    const RADIUS = 16;

    (async () => {
      const thumbs = [];
      for (const file of files) {
        const buf = await sharp(path.join(dir, file))
          .resize({ height: THUMB_HEIGHT })
          .png()
          .toBuffer();
        const meta = await sharp(buf).metadata();
        thumbs.push({ buf, w: meta.width, h: meta.height });
      }

      // Split into rows of COLS
      const rows = [];
      for (let i = 0; i < thumbs.length; i += COLS) {
        rows.push(thumbs.slice(i, i + COLS));
      }

      const rowW = (row) => row.reduce((s, t) => s + t.w, 0) + MARGIN * (row.length - 1);
      const totalW = Math.max(...rows.map(rowW)) + PADDING * 2;
      const totalH = rows.length * THUMB_HEIGHT + (rows.length - 1) * MARGIN + PADDING * 2;

      const bgSvg = Buffer.from(
        `<svg width="${totalW}" height="${totalH}"><rect x="0" y="0" width="${totalW}" height="${totalH}" rx="${RADIUS}" ry="${RADIUS}" fill="rgb(${BG.r},${BG.g},${BG.b})"/></svg>`
      );

      // Round each thumbnail with a continuous corner mask
      const IMG_RADIUS = 32;
      async function roundCorners(buf, w, h) {
        const mask = Buffer.from(
          `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${IMG_RADIUS}" ry="${IMG_RADIUS}" fill="white"/></svg>`
        );
        return sharp(buf)
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer();
      }

      const composites = [{ input: bgSvg, top: 0, left: 0 }];
      let y = PADDING;
      for (const row of rows) {
        let x = PADDING;
        for (const thumb of row) {
          const rounded = await roundCorners(thumb.buf, thumb.w, thumb.h);
          composites.push({ input: rounded, top: y, left: x });
          x += thumb.w + MARGIN;
        }
        y += THUMB_HEIGHT + MARGIN;
      }

      await sharp({ create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(composites)
        .png()
        .toFile(out);

      console.log("OK " + totalW + "x" + totalH);
    })();
  ' "${SCREENSHOTS_DIR}/${PRIMARY_DEVICE}" "${COMPOSITE_PATH}" 2>&1

  if [ -f "${COMPOSITE_PATH}" ]; then
    COMPOSITE_URL="https://sovran.money/ios/${COMPOSITE_NAME}"
    echo "Composite saved — will be at ${COMPOSITE_URL} after deploy"
  fi
fi

# --- Determine PR head ref (cross-fork needs owner prefix) ---
GH_LOGIN="$(gh api user --jq .login)"
if [ "${TARGET_REPO}" = "${GH_LOGIN}/freedomstore" ]; then
  HEAD_REF="${BRANCH}"
else
  HEAD_REF="${GH_LOGIN}:${BRANCH}"
fi

# --- Create PR ---
EXISTING_PR_URL="$(
  gh pr list \
    -R "${TARGET_REPO}" \
    --head "${HEAD_REF}" \
    --base "${BASE_BRANCH}" \
    --state open \
    --json url \
    --jq '.[0].url'
)"

if [ -n "${EXISTING_PR_URL}" ] && [ "${EXISTING_PR_URL}" != "null" ]; then
  echo
  echo "PR already open: ${EXISTING_PR_URL}"
  exit 0
fi

FOOTER="---
*This PR was automatically generated via a script.*"

if [ -n "${COMPOSITE_URL}" ]; then
  BODY="- Version: ${VERSION} (build ${BUILD})
- ADP ID: \`${ADP_ID}\`

## Screenshots

![Sovran ${VERSION} screenshots](${COMPOSITE_URL})

${FOOTER}"
else
  BODY="- Version: ${VERSION} (build ${BUILD})
- ADP ID: \`${ADP_ID}\`

${FOOTER}"
fi

PR_URL="$(
  gh pr create \
    -R "${TARGET_REPO}" \
    --base "${BASE_BRANCH}" \
    --head "${HEAD_REF}" \
    --title "${TITLE}" \
    --body "${BODY}"
)"

echo
echo "Created PR: ${PR_URL}"
