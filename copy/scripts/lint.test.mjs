import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lintCopy } from "./lint.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(
  readFileSync(resolve(directory, "../claims.json"), "utf8"),
);

function fixture(t, files, rules = policy) {
  const root = mkdtempSync(resolve(tmpdir(), "sovran-copy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({
    "copy/claims.json": JSON.stringify(rules),
    ...files,
  })) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  }
  return root;
}

function cli(root, ...args) {
  return spawnSync(
    process.execPath,
    [resolve(directory, "lint.mjs"), "--root", root, ...args],
    { encoding: "utf8" },
  );
}

test("seeded banned authored phrase fails the real CLI, not just a matcher", (t) => {
  const root = fixture(t, {
    "copy/src/example.ts": 'export const headline = "Fully open source";',
  });
  const result = cli(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /ERROR copy\/src\/example.ts:1 \[source.absolute\]/,
  );
});

test("watch words warn without failing and repeated matches do not flood output", (t) => {
  const root = fixture(t, {
    "site/src/hero.astro": "Private payments.\n".repeat(150),
  });
  const result = cli(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARN \[privacy.review\] 150 matches in 1 files/);
  assert.equal(
    result.stdout
      .split("\n")
      .filter((line) => line.startsWith("WARN [privacy.review]")).length,
    1,
  );
  assert.ok(result.stdout.split("\n").length < 15);
});

test("known artwork overclaims fail even in unselected alternatives", (t) => {
  const cases = [
    [
      "ecash.bitcoin-conflation",
      "Private messages, with bitcoin you drop straight into the chat.",
    ],
    ["ecash.bitcoin-conflation", "Bitcoin that works like cash."],
    ["capability.universal", "One code, any wallet."],
    [
      "capability.universal",
      "One QR that works with whatever wallet they use.",
    ],
    ["capability.universal", "Pay anyone, any way."],
    ["capability.universal", "Any model, pay per use."],
    ["capability.universal", "Every reply, in order."],
    [
      "capability.universal",
      "Open a post and the whole conversation loads with it.",
    ],
    ["mint.unverified-trust", "Real reviews from people who use this mint."],
    ["mint.unverified-trust", "Trust, with receipts."],
    [
      "mint.unverified-trust",
      "Independent checks and reviews before you put money in.",
    ],
    ["mint.unverified-trust", "Verified mint reserves."],
    ["feed.unqualified", "Follow people, not algorithms."],
    ["feed.unqualified", "Posts ranked by real engagement."],
    ["recovery.absolute", "Your words are all you need."],
  ];
  for (const [id, phrase] of cases) {
    const root = fixture(t, {
      "press/artwork/source/copy.json": JSON.stringify({
        concepts: {
          example: {
            headlines: ["Send digital cash.", phrase],
            chosen: { headline: 0 },
          },
        },
      }),
    });
    const result = cli(root);
    assert.equal(result.status, 1, phrase);
    assert.ok(result.stdout.includes(`[${id}]`), result.stdout);
  }
});

test("qualified ecash, backup and trust copy is not blocked by the narrow artwork rules", (t) => {
  const root = fixture(t, {
    "press/artwork/source/copy.json": JSON.stringify({
      subtitles: [
        "Send digital cash in chat. You still rely on its issuer to redeem it.",
        "Chat in encrypted messages. Redeeming cash still depends on its mint.",
        "Save your recovery words and mint URLs. Recovery has limits.",
        "Read community reviews before choosing a mint. Reviews are not guarantees.",
        "Choose a supported model. Prices and availability vary.",
      ],
    }),
  });
  const result = lintCopy({ directory: root });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((finding) => finding.id === "privacy.review"));
});

test("case, multiline whitespace, escaped characters and Unicode punctuation normalize", (t) => {
  const root = fixture(t, {
    "copy/src/case.ts":
      'export const a = "FULLY\n\n \tOPEN\u00a0SOURCE";\nexport const b = "NOBODY\\u2019S WATCHING";',
    "site/src/content.html":
      "<p>Nobody&#8217;s watching</p><p>fully&nbsp;open source</p>",
    "site/src/line.ts": String.raw`const copy = "fully\nopen\tsource";`,
    "site/src/wide.md": "ＦＵＬＬＹ OPEN SOURCE",
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, 6);
  assert.equal(
    result.errors.find((error) => error.phrase === "nobody's watching").line,
    4,
  );
});

test("exact legal explanatory contexts are exempt at the migrated document owner", (t) => {
  const sentences = policy.exceptions.map((entry) => entry.context);
  const root = fixture(t, {
    "copy/legal/documents.json": JSON.stringify({ paragraphs: sentences }),
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, 0);
  assert.match(result.output, /2 exact contextual exceptions/);
});

test("the app legal adapter remains scanned without document exemptions", (t) => {
  const root = fixture(t, {
    "app/shared/lib/legal/legalDocuments.ts":
      'export const copy = "Sovran is not anonymous by default.";',
  });
  assert.equal(lintCopy({ directory: root }).errors.length, 1);
});

test("a legal sentence does not exempt positive claims before or after it", (t) => {
  const root = fixture(t, {
    "copy/legal/documents.json": JSON.stringify({
      paragraphs: [
        "Anonymous payments. Sovran is not anonymous by default. Untraceable payments.",
        "It is false that Sovran is not anonymous by default.",
      ],
    }),
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, 3);
  assert.match(result.output, /1 exact contextual exceptions/);
});

test("context exceptions cannot be moved to marketing or widened by altering the sentence", (t) => {
  const root = fixture(t, {
    "press/copy.json": JSON.stringify({
      copy: "Sovran is not anonymous by default.",
    }),
    "copy/legal/documents.json": JSON.stringify({
      copy: "Sovran is anonymous by default.",
    }),
  });
  assert.equal(lintCopy({ directory: root }).errors.length, 2);
});

test("Markdown editorial prohibitions are policy, but quotes and unrelated negations are not", (t) => {
  const root = fixture(t, {
    "docs/policy.md": [
      "Do NOT claim **fully open source**.",
      'Never advertise "anonymous" payments.',
      "We must not describe the app as non-custodial.",
      "Do not claim anonymous payments. Our payments are untraceable.",
      '> "Fully open source"',
      "Not every app is good. We are fully open source.",
      "Do not use stale text, we are anonymous.",
    ].join("\n"),
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, 4);
  assert.match(result.output, /5 explicit Markdown policy mentions/);
});

test("a policy clause cannot exempt the next paragraph without punctuation", (t) => {
  const root = fixture(t, {
    "docs/policy.md": "Do not claim\n\nFully open source",
  });
  assert.equal(lintCopy({ directory: root }).errors.length, 1);
});

test("editorial prohibition detection does not grant exemptions to UI source strings", (t) => {
  const root = fixture(t, {
    "site/src/hero.tsx": 'const text = "Do not claim fully open source";',
  });
  assert.equal(lintCopy({ directory: root }).errors.length, 1);
});

test("invalid rule ID is a configuration failure", (t) => {
  const invalid = structuredClone(policy);
  invalid.rules[0].id = "NOT A VALID ID";
  const result = cli(fixture(t, {}, invalid));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid rule ID/);
});

test("unknown exception rule ID is a configuration failure", (t) => {
  const invalid = structuredClone(policy);
  invalid.exceptions[0].ruleId = "privacy.missing";
  const result = cli(fixture(t, {}, invalid));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid exception or rule ID/);
});

test("duplicate rules and wildcard exceptions are rejected", (t) => {
  const duplicate = structuredClone(policy);
  duplicate.rules.push(duplicate.rules[0]);
  assert.equal(cli(fixture(t, {}, duplicate)).status, 2);
  const wildcard = structuredClone(policy);
  wildcard.exceptions[0].paths = ["copy/legal/*"];
  assert.equal(cli(fixture(t, {}, wildcard)).status, 2);
});

test("a supplied external snapshot warns, even for banned copy, and is not live evidence", (t) => {
  const root = fixture(t, {
    "capture.txt": "Fully open source and anonymous.",
  });
  const result = cli(root, "--external-snapshot", "capture.txt");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARN \[source.absolute\]/);
  assert.match(result.stdout, /external:capture.txt:1/);
  assert.match(result.stdout, /1 supplied files scanned as warnings only/);
  assert.match(result.stdout, /live listing parity are NOT verified/);
});

test("missing external snapshots and malformed arguments fail instead of claiming success", (t) => {
  const root = fixture(t, {});
  assert.equal(cli(root, "--external-snapshot", "missing.txt").status, 2);
  assert.equal(cli(root, "--unknown", "value").status, 2);
  assert.equal(cli(root, "--rules").status, 2);
});

test("scope includes component/content formats and optional store, not only a central site catalog", (t) => {
  const paths = [
    "copy/src/onboarding.ts",
    "copy/store.json",
    "copy/legal/documents.json",
    "app/features/onboarding/screens/Welcome.tsx",
    "app/features/backup/screens/BackupIntroScreen.tsx",
    "app/features/settings/screens/SettingsRecoveryScreen.tsx",
    "app/features/legal/Notice.tsx",
    "app/shared/blocks/LegalDocumentScreen.tsx",
    "app/features/settings/screens/SettingsLegalScreen.tsx",
    "marketing/artwork/source/copy.json",
    "press/artwork/source/copy.json",
    "site/src/hero.astro",
    "site/src/components/Banner.vue",
    "site/src/pages/nested/faq.mdx",
    "site/src/styles/copy.css",
    "site/src/art.svg",
    "docs/guide.md",
    "README.md",
    "app/README.md",
    "site/src/build/hero.ts",
    "site/src/generated/content.ts",
    "docs/build/readme.md",
  ];
  const root = fixture(
    t,
    Object.fromEntries(paths.map((path) => [path, "Fully open source"])),
  );
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, paths.length);
});

test("the CLI catches site component claims outside a clean site/src/content catalog", (t) => {
  const root = fixture(t, {
    "site/src/content/index.ts": 'export const title = "Sovran";',
    "site/src/components/Hero.tsx":
      "export const Hero = () => <h1>Fully open source</h1>;",
  });
  const result = cli(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /ERROR site\/src\/components\/Hero.tsx:1 \[source.absolute\]/,
  );
});

test("no snapshot is fabricated and missing surfaces and scope limits are visible", (t) => {
  const root = fixture(t, {
    "site/src/hero.ts": 'const label = "Sovran";',
    "site/node_modules/a/copy.ts": "Fully open source",
    "docs/.vitepress/dist/page.html": "Fully open source",
    "press/artwork/generated/image.svg": "Fully open source",
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.errors.length, 0);
  assert.equal(result.files.length, 1);
  assert.match(result.output, /WARN missing surfaces/);
  assert.match(
    result.output,
    /none supplied; live store listings, deployed sites and external copy were NOT checked/,
  );
  assert.match(
    result.output,
    /composed strings and unsupported file formats need manual review/,
  );
});

test("word boundaries avoid matching watch words inside identifiers or larger words", (t) => {
  const root = fixture(t, {
    "site/src/types.ts": "privateKey finally freedom securely",
  });
  const result = lintCopy({ directory: root });
  assert.equal(result.warnings.length, 0);
});
