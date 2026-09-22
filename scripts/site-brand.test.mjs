import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { siteBrandFiles, generateSiteBrand } from "./site-brand.mjs";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("app/package.json", root));
const sharp = require("sharp");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = await siteBrandFiles();

test("web and QR logos use the exact native/artwork master path", async () => {
  const master = await readFile(
    new URL("app/assets/brand/source/symbol.svg", root),
    "utf8",
  );
  const d = master.match(/<path\b[^>]*\bd="([^"]+)"/)[1];
  for (const svg of Object.values(files)) {
    assert.equal(svg.split(`d="${d}"`).length, 2);
  }
  assert.match(files["site/public/sovran-mark.svg"], /viewBox="0 0 621 621"/);
});

test("web mark holds its 24px and 32px silhouettes", async () => {
  // Rebaselined 2026-09-22 when the master's three unintended curvature breaks
  // were faired. Against the pre-consolidation capture the silhouette shifts by
  // at most 9/255 alpha on 4% of pixels at these sizes; anything larger is drift.
  const originals = {
    24: "bce71754209d98eae3c579f86ddb6524c9eaf73554dce2680b4fd1f3282825f9",
    32: "63081c8199e89007eb5170f68a4fb042528bad55ed6930fc93c19c9f942a12d7",
  };
  for (const [size, expected] of Object.entries(originals)) {
    const alpha = await sharp(Buffer.from(files["site/public/sovran-mark.svg"]))
      .resize(Number(size), Number(size))
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    assert.equal(hash(alpha), expected);
  }
});

test("QR encoding, colors, masks and placement are unchanged outside the logo slot", () => {
  const qr = files["site/public/downloads/download-qr.svg"];
  const withoutMark = qr.replace(
    /<g transform="translate\(23 20\) scale\(0\.135\)">[\s\S]*?<\/g>/g,
    "",
  );
  assert.equal(
    hash(withoutMark),
    "4d8179a21f7f647b2f1d772c1d3c5726e01bc76b84f886fac6a3983b3c8e8069",
  );
});

test("committed web logos are current", async () => {
  await generateSiteBrand({ check: true });
});

test("project license is MPL-2.0 and the fast-squircle MIT notice remains intact", async () => {
  assert.match(
    await readFile(new URL("LICENSE", root), "utf8"),
    /^Mozilla Public License Version 2\.0/,
  );
  const notice = await readFile(
    new URL("site/public/licenses/fast-squircle.txt", root),
  );
  assert.equal(
    hash(notice),
    "376052147050114699c1e9a90f19c1ddb5c63f823558894bfd3d501eb5aa631f",
  );
  const clarification = await readFile(
    new URL("site/public/licenses/README.txt", root),
    "utf8",
  );
  assert.match(
    clarification,
    /component notice, not the license for all of Sovran/,
  );
  assert.match(clarification, /does not relicense it under MPL-2\.0/);
});
