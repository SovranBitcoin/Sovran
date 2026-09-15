/**
 * App-source freshness for captured screenshots.
 *
 * A screenshot shows the app as it was when captured. It is current only while
 * the source that decides those pixels is unchanged. The e2e run fingerprint
 * hashes the whole repository, including the screenshot registry itself, so
 * every promotion would invalidate every capture. This fingerprint covers only
 * rendered app inputs; press/, site/, e2e and tests cannot make it drift.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/** Paths whose files decide what a captured app screen looks like. */
export const APP_SOURCE_PATHS = Object.freeze(["app", "wallet", "nostr", "copy", "package.json", "bun.lock"]);
/** Files inside those paths that cannot change rendered pixels. */
export const APP_SOURCE_EXCLUDE = /^app\/(?:e2e|__tests__|docs)\/|(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$|\.md$/;

const git = (root, args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

export function appSourceFiles(root) {
  const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...APP_SOURCE_PATHS]);
  return [...new Set(listed.toString("utf8").split("\0").filter(Boolean))]
    .filter((file) => !APP_SOURCE_EXCLUDE.test(file))
    .sort();
}

/** SHA-256 over every app source path and its bytes, or undefined outside a git checkout. */
export function appSourceFingerprint(root) {
  try {
    const hash = createHash("sha256");
    for (const file of appSourceFiles(root)) {
      let bytes;
      try {
        const stat = lstatSync(join(root, file));
        bytes = stat.isSymbolicLink()
          ? Buffer.from(readlinkSync(join(root, file)))
          : stat.isFile()
            ? readFileSync(join(root, file))
            : Buffer.alloc(0);
      } catch {
        bytes = Buffer.from("\0deleted\0"); // tracked but removed from the working tree
      }
      hash.update(`${file}\0${bytes.length}\0`);
      hash.update(bytes);
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

/** The stamp recorded on a promoted capture. */
export function appSourceStamp(root) {
  const fingerprint = appSourceFingerprint(root);
  if (!fingerprint) return undefined;
  try {
    return {
      fingerprint,
      gitSha: git(root, ["rev-parse", "HEAD"]).toString().trim(),
      gitDirty: git(root, ["status", "--porcelain", "--", ...APP_SOURCE_PATHS]).toString().trim().length > 0,
    };
  } catch {
    return undefined;
  }
}

/** Tracked app source files that differ from a capture's commit. Informational only. */
export function appFilesChangedSince(root, gitSha) {
  try {
    return git(root, ["diff", "--name-only", gitSha, "--", ...APP_SOURCE_PATHS])
      .toString()
      .split("\n")
      .filter((file) => file && !APP_SOURCE_EXCLUDE.test(file))
      .sort();
  } catch {
    return undefined;
  }
}

/**
 * current: captured from exactly the current app source.
 * outdated: app source changed since capture.
 * unverified: captured before app-source stamping existed.
 * withdrawn / missing: not usable. unknown: current source unavailable (e.g. a Docker build).
 */
export function classifyCapture(entry, currentFingerprint) {
  if (!entry || entry.availability === "unavailable" || entry.freshness === "stale") return "withdrawn";
  if (!entry.run || !entry.sha256) return "missing";
  if (!entry.appSource?.fingerprint) return "unverified";
  if (!currentFingerprint) return "unknown";
  return entry.appSource.fingerprint === currentFingerprint ? "current" : "outdated";
}
