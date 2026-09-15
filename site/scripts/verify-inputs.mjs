import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { legalRevisions } from "../src/legal.mjs";
import { captureDevice, createScene } from "../../scripts/lib/phone-frame.mjs";

const root = new URL("../../", import.meta.url);
const documents = JSON.parse(
  readFileSync(new URL("copy/legal/documents.json", root), "utf8"),
);
assert.equal(typeof documents.publicationReady, "boolean");
for (const key of ["name", "country", "address", "email"])
  assert.ok(
    typeof documents.operator?.[key] === "string" &&
      documents.operator[key].trim(),
  );
for (const id of ["terms", "privacy"]) {
  assert.ok(
    documents[id]?.title && documents[id]?.updated && documents[id]?.summary,
  );
  assert.ok(
    Array.isArray(documents[id].sections) && documents[id].sections.length > 0,
  );
  for (const section of documents[id].sections) {
    assert.ok(typeof section.title === "string" && section.title.trim());
    assert.ok(
      Array.isArray(section.paragraphs) && section.paragraphs.length > 0,
    );
    for (const paragraph of section.paragraphs)
      assert.ok(typeof paragraph === "string" && paragraph.trim());
  }
}
assert.equal(Object.keys(legalRevisions(documents)).length, 2);
const captures = JSON.parse(
  readFileSync(new URL("press/artwork/source/screenshots.json", root), "utf8"),
);
const keys = readdirSync(new URL("press/artwork/source/screenshots/ios/", root))
  .filter((file) => file.endsWith(".png"))
  .map((file) => `ios/${file.slice(0, -4)}`);
assert.ok(keys.length >= 2, "Phone scenes must import reviewed captures");
for (const key of keys) {
  const capture = captures[key];
  assert.ok(key.startsWith("ios/"), "Website phone scenes are iOS-only");
  assert.ok(capture, `Unreviewed capture: ${key}`);
  assert.equal(capture.file, `source/screenshots/${key}.png`);
  assert.match(capture.run, /^run-/);
  const bytes = readFileSync(new URL(`press/artwork/${capture.file}`, root));
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  captureDevice("ios", width, height);
  createScene([{ key, width, height }]);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    capture.sha256,
    `Capture ${key} differs from its reviewed manifest`,
  );
}
console.log(
  `Validated canonical policies and all ${keys.length} source capture hashes.`,
);
