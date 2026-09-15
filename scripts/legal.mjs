import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertMatchingLegalDocuments } from "../release/legal.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const bytes = await readFile(resolve(root, "copy/legal/documents.json"));
const source = JSON.parse(bytes.toString("utf8"));
const site = resolve(root, "site");
const mode = process.argv[2];
if (mode === "--sync-site") {
  execFileSync("bun", ["run", "build"], { cwd: site, stdio: "inherit" });
  console.log("Built site/dist from local sources. Nothing was published.");
} else if (mode === "--check-site") {
  if (!bytes.equals(await readFile(resolve(site, "dist/legal/documents.json"))))
    throw new Error(
      "Local website legal documents differ. Run bun run legal:sync.",
    );
  execFileSync(
    "bun",
    ["test", "tests/build.test.ts", "--test-name-pattern", "legal"],
    {
      cwd: site,
      stdio: "inherit",
    },
  );
  console.log("Canonical legal bytes and local website legal HTML match.");
} else if (mode === "--publication-check") {
  assertMatchingLegalDocuments(source, source);
  if (
    !source.publicationReady ||
    JSON.stringify(source).includes("Awaiting confirmation") ||
    !source.operator.email.includes("@")
  ) {
    throw new Error(
      "Legal documents are drafts. Confirm operator identity, contact details, retention, provider practices and legal review before publication.",
    );
  }
  console.log(
    "Legal publication flag is set. This is not a legal or operational audit.",
  );
} else {
  throw new Error("Use --sync-site, --check-site, or --publication-check.");
}
