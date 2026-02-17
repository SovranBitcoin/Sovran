#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FREEDOMSTORE_DIR="${ROOT_DIR}/freedomstore"
ALTSTORE_JSON="${FREEDOMSTORE_DIR}/altstore-source.json"
BUNDLE_ID="com.sovranbitcoin"
UPSTREAM_REPO="freedomstore/freedomstore"
BASE_BRANCH="main"
FORK_REMOTE="fork"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required."
  exit 1
fi

if [ ! -d "${FREEDOMSTORE_DIR}/.git" ]; then
  echo "Error: freedomstore repo not found at ${FREEDOMSTORE_DIR}."
  exit 1
fi

if [ ! -f "${ALTSTORE_JSON}" ]; then
  echo "Error: altstore-source.json not found at ${ALTSTORE_JSON}."
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Error: gh is not authenticated for github.com."
  echo "Run: gh auth login -h github.com"
  exit 1
fi

GH_LOGIN="$(gh api user --jq .login)"
if [ -z "${GH_LOGIN}" ]; then
  echo "Error: could not determine GitHub login from gh auth."
  exit 1
fi

read -r VERSION BUILD DOWNLOAD_URL FIRST_SCREENSHOT < <(
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const bundleId = process.argv[2];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const app = data.apps.find((x) => x.bundleIdentifier === bundleId);
    if (!app) {
      console.error("Sovran app entry not found");
      process.exit(1);
    }
    const latest = app.versions?.[0];
    if (!latest) {
      console.error("No version entry found for Sovran");
      process.exit(1);
    }
    const out = [
      String(latest.version || "").replace(/\s+/g, ""),
      String(latest.buildVersion || "").replace(/\s+/g, ""),
      String(latest.downloadURL || "").replace(/\s+/g, ""),
      String(app.screenshots?.[0] || "").replace(/\s+/g, ""),
    ];
    console.log(out.join(" "));
  ' "${ALTSTORE_JSON}" "${BUNDLE_ID}"
)

if [ -z "${VERSION}" ] || [ -z "${BUILD}" ]; then
  echo "Error: could not parse Sovran version/build from altstore-source.json."
  exit 1
fi

ADP_ID="$(echo "${DOWNLOAD_URL}" | sed -nE 's#.*releases/([0-9a-fA-F-]+)/.*#\1#p')"
TITLE="Sovran release ${VERSION}"
BRANCH="sovran-release-${VERSION}"
FORK_REPO="${GH_LOGIN}/freedomstore"
FORK_REMOTE_URL="https://github.com/${FORK_REPO}.git"

# Ensure your fork exists.
if ! gh repo view "${FORK_REPO}" >/dev/null 2>&1; then
  echo "Creating fork ${FORK_REPO} from ${UPSTREAM_REPO}..."
  gh repo fork "${UPSTREAM_REPO}" --clone=false
fi

# Ensure local remote points to your fork.
if git -C "${FREEDOMSTORE_DIR}" remote get-url "${FORK_REMOTE}" >/dev/null 2>&1; then
  git -C "${FREEDOMSTORE_DIR}" remote set-url "${FORK_REMOTE}" "${FORK_REMOTE_URL}"
else
  git -C "${FREEDOMSTORE_DIR}" remote add "${FORK_REMOTE}" "${FORK_REMOTE_URL}"
fi

# Reuse existing local branch if present.
if git -C "${FREEDOMSTORE_DIR}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git -C "${FREEDOMSTORE_DIR}" checkout "${BRANCH}"
else
  git -C "${FREEDOMSTORE_DIR}" checkout -b "${BRANCH}"
fi

# Commit if altstore-source.json changed.
if ! git -C "${FREEDOMSTORE_DIR}" diff --quiet -- altstore-source.json; then
  git -C "${FREEDOMSTORE_DIR}" add altstore-source.json
  git -C "${FREEDOMSTORE_DIR}" commit -m "${TITLE}"
fi

git -C "${FREEDOMSTORE_DIR}" push -u "${FORK_REMOTE}" "${BRANCH}"

EXISTING_PR_URL="$(
  gh pr list \
    -R "${UPSTREAM_REPO}" \
    --head "${GH_LOGIN}:${BRANCH}" \
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

if [ -n "${ADP_ID}" ]; then
  BODY="Automated Sovran release update from sync scripts.

- Version: ${VERSION} (build ${BUILD})
- ADP ID: ${ADP_ID}
- First screenshot: ${FIRST_SCREENSHOT}

Please review the \`altstore-source.json\` update."
else
  BODY="Automated Sovran release update from sync scripts.

- Version: ${VERSION} (build ${BUILD})
- First screenshot: ${FIRST_SCREENSHOT}

Please review the \`altstore-source.json\` update."
fi

PR_URL="$(
  gh pr create \
    -R "${UPSTREAM_REPO}" \
    --base "${BASE_BRANCH}" \
    --head "${GH_LOGIN}:${BRANCH}" \
    --title "${TITLE}" \
    --body "${BODY}"
)"

echo
echo "Created PR: ${PR_URL}"
