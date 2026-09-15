import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = JSON.parse(
  readFileSync(new URL("../store.json", import.meta.url), "utf8"),
);

test("English store copy remains an editorial candidate, not a live snapshot or publisher input", () => {
  assert.equal(store.language, "en");
  assert.equal(store.status, "editorially-reviewed-candidate");
  assert.equal(store.publicationReady, false);
  assert.match(store.note, /Not a store snapshot or publisher input/);
  assert.equal(store.capturedAt, undefined);
});

function validateStoreFields(candidate) {
  // Store metadata limits, not proof of rendered fit or store acceptance:
  // https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
  // https://support.google.com/googleplay/android-developer/answer/9859152
  const limits = {
    apple: {
      name: 30,
      subtitle: 30,
      promotionalText: 170,
      keywords: 100,
      description: 4000,
    },
    google: { title: 30, shortDescription: 80, fullDescription: 4000 },
  };
  for (const [platform, fields] of Object.entries(limits)) {
    assert.deepEqual(
      Object.keys(candidate[platform]).sort(),
      Object.keys(fields).sort(),
    );
    for (const [field, limit] of Object.entries(fields)) {
      const text = candidate[platform][field];
      assert.equal(typeof text, "string");
      const normalized = text
        .normalize("NFKC")
        .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      assert.ok(
        /[\p{L}\p{N}]/u.test(normalized),
        `${platform}.${field} must contain meaningful text`,
      );
      assert.doesNotMatch(
        normalized,
        /\b(?:todo|tbd|fixme|placeholder|lorem\s+ipsum|replace[_ -]+me|your[_ -]+app(?:[_ -]+name)?)\b|[{}]|<[^>]+>|\[[^\]]+\]|__[a-z0-9_]+__|%(?:\d+\$|\([^)]+\))?[sd@]|\bexample\.(?:com|org|net)\b|^(?:null|undefined|n\/?a)$/i,
        `${platform}.${field} contains placeholder copy`,
      );
      assert.ok(
        text.length <= limit,
        `${platform}.${field}: ${text.length} exceeds ${limit}`,
      );
    }
  }
}

test("candidate copy fits field budgets and contains no unresolved placeholders", () => {
  validateStoreFields(store);
});

test("every store field rejects placeholders, including mixed case and hidden whitespace", () => {
  const placeholders = [
    "TODO",
    "tBd",
    "fixme",
    "Placeholder",
    "Lorem\n\u00a0ipsum",
    "To\u200bDo",
    "ＴＢＤ",
    "replace_me",
    "YOUR_APP_NAME",
    "{appName}",
    "{{ appName }}",
    "${appName}",
    "[App name]",
    "<App name>",
    "__APP_NAME__",
    "%s",
    "%1$s",
    "%(name)s",
    "%@",
    "https://example.com",
  ];
  for (const [platform, fields] of Object.entries({
    apple: store.apple,
    google: store.google,
  })) {
    for (const field of Object.keys(fields)) {
      for (const placeholder of placeholders) {
        const candidate = structuredClone(store);
        candidate[platform][field] = `Read ${placeholder}`;
        assert.throws(
          () => validateStoreFields(candidate),
          /contains placeholder copy/,
          `${platform}.${field} accepted ${placeholder}`,
        );
      }
    }
  }
});

test("empty, non-string and sentinel store values fail even within length budgets", () => {
  for (const value of [
    null,
    undefined,
    0,
    false,
    [],
    {},
    "",
    "\n\t\u00a0",
    "\u200b\ufeff",
    "...",
    "null",
    "undefined",
    "N/A",
  ]) {
    const candidate = structuredClone(store);
    candidate.google.shortDescription = value;
    assert.throws(
      () => validateStoreFields(candidate),
      undefined,
      `accepted ${JSON.stringify(value)}`,
    );
  }
});

test("literal prose remains valid while a field exceeding its budget fails", () => {
  const candidate = structuredClone(store);
  candidate.apple.name = "A".repeat(30);
  candidate.google.fullDescription =
    "Your wallet supports payments. These limits apply to individuals.";
  validateStoreFields(candidate);
  candidate.apple.name += "A";
  assert.throws(
    () => validateStoreFields(candidate),
    /apple.name: 31 exceeds 30/,
  );
});

test("copy package is private and dependency-free with explicit source exports", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.name, "copy");
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(pkg.exports, {
    "./onboarding": "./src/onboarding.ts",
    "./legal": "./legal/documents.json",
    "./site": "./src/site.ts",
    "./claims": "./claims.json",
  });
});
