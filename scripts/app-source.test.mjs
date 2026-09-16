import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  appFilesChangedSince,
  appSourceFingerprint,
  appSourceStamp,
  classifyCapture,
} from "./lib/app-source.mjs";

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), "app-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  put("app/features/receive/ReceiveScreen.tsx", "pills");
  put("app/e2e/scenarios/receive.json", "{}");
  put("app/__tests__/receive.test.ts", "test");
  put("copy/src/receive.ts", "Receive");
  put("press/artwork/source/screenshots.json", "{}");
  put("site/src/pages/screenshots.astro", "page");
  put("README.md", "readme");
  put("package.json", "{}");
  git("add", "-A");
  git("commit", "-qm", "initial");
  return { root, put, git };
}

test("editing rendered app code changes the fingerprint", (t) => {
  const { root, put } = repo(t);
  const captured = appSourceFingerprint(root);
  assert.match(captured, /^[a-f0-9]{64}$/);
  put("app/features/receive/ReceiveScreen.tsx", "no pills");
  assert.notEqual(appSourceFingerprint(root), captured);
});

test("promotion, site, e2e, tests and docs cannot make captures look outdated", (t) => {
  const { root, put } = repo(t);
  const captured = appSourceFingerprint(root);
  put("press/artwork/source/screenshots.json", '{"ios/receive-qr":{}}');
  put("site/src/pages/screenshots.astro", "new page");
  put("app/e2e/scenarios/receive.json", '{"steps":[]}');
  put("app/eslint-suppressions.json", '{"features/receive/ReceiveScreen.tsx":{}}');
  put("app/__tests__/receive.test.ts", "changed test");
  put("README.md", "changed readme");
  put("app/features/receive/NOTES.md", "notes");
  put("copy/src/site.ts", "Website copy");
  put("copy/store.json", "{}");
  put("package.json", '{"scripts":{"site:assets":"node generator.mjs"}}');
  assert.equal(appSourceFingerprint(root), captured);
});

test("copy strings, dependencies, new files and deletions count as app changes", (t) => {
  for (const change of [
    ({ put }) => put("copy/src/receive.ts", "Get paid"),
    ({ put }) => put("package.json", '{"dependencies":{"x":"1"}}'),
    ({ put }) => put("app/features/receive/NewTab.tsx", "tab"),
    ({ root }) =>
      unlinkSync(join(root, "app/features/receive/ReceiveScreen.tsx")),
  ]) {
    const fixture = repo(t);
    const captured = appSourceFingerprint(fixture.root);
    change(fixture);
    assert.notEqual(appSourceFingerprint(fixture.root), captured);
  }
});

test("stamps record the commit and changed files are reported against it", (t) => {
  const { root, put, git } = repo(t);
  const stamp = appSourceStamp(root);
  assert.match(stamp.gitSha, /^[a-f0-9]{40}$/);
  assert.equal(stamp.gitDirty, false);
  put("app/features/receive/ReceiveScreen.tsx", "no pills");
  put("site/src/pages/screenshots.astro", "unrelated");
  git("commit", "-qam", "redesign receive");
  assert.deepEqual(appFilesChangedSince(root, stamp.gitSha), [
    "app/features/receive/ReceiveScreen.tsx",
  ]);
  assert.equal(
    appSourceFingerprint(
      join(tmpdir(), "definitely-not-a-repo-" + process.pid),
    ),
    undefined,
  );
});

test("classification distinguishes current, outdated, unverified, withdrawn, missing and unknown", () => {
  const capture = { run: "run-1", sha256: "a".repeat(64) };
  assert.equal(
    classifyCapture({ ...capture, appSource: { fingerprint: "f1" } }, "f1"),
    "current",
  );
  assert.equal(
    classifyCapture({ ...capture, appSource: { fingerprint: "f1" } }, "f2"),
    "outdated",
  );
  assert.equal(classifyCapture(capture, "f1"), "unverified");
  assert.equal(
    classifyCapture({ ...capture, freshness: "stale" }, "f1"),
    "withdrawn",
  );
  assert.equal(
    classifyCapture({ ...capture, availability: "unavailable" }, "f1"),
    "withdrawn",
  );
  assert.equal(classifyCapture({ run: null, sha256: null }, "f1"), "missing");
  assert.equal(classifyCapture(undefined, "f1"), "missing");
  assert.equal(
    classifyCapture(
      { ...capture, appSource: { fingerprint: "f1" } },
      undefined,
    ),
    "unknown",
  );
});
