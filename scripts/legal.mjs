import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = JSON.parse(
  await readFile(resolve(root, "app/shared/lib/legal/documents.json"), "utf8"),
);
const revisions = Object.fromEntries(
  ["terms", "privacy"].map((id) => [
    id,
    createHash("sha256")
      .update(
        JSON.stringify({
          operator: source.operator,
          document: source[id],
          publicationReady: source.publicationReady,
        }),
      )
      .digest("hex"),
  ]),
);
const generated = JSON.stringify({ ...source, revisions }, null, 2) + "\n";
const siteFile = resolve(root, "../sovran.money/public/legal/documents.json");
const mode = process.argv[2];
if (mode === "--sync-site") {
  await mkdir(resolve(root, "../sovran.money/public/legal"), {
    recursive: true,
  });
  await writeFile(siteFile, generated);
  console.log(
    "Updated sovran.money/public/legal/documents.json from the app legal documents. Review and commit both repos.",
  );
} else if (mode === "--check-site") {
  if ((await readFile(siteFile, "utf8")) !== generated)
    throw new Error("Website legal documents differ. Run bun run legal:sync.");
  console.log("App and website legal documents match.");
} else if (mode === "--publication-check") {
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
