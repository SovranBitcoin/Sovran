import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scopes = [
  "copy/src",
  "copy/store.json",
  "copy/legal",
  "copy/README.md",
  "CLAIMS.md",
  "app/shared/lib/legal", // Revision/acceptance adapter, not the document owner.
  "app/shared/blocks/LegalDocumentScreen.tsx",
  "app/features/settings/screens/SettingsLegalScreen.tsx",
  "app/features/legal",
  "app/features/onboarding",
  "app/features/backup",
  "app/features/settings/screens/SettingsRecoveryScreen.tsx",
  "app/features/settings/screens/SettingsProfileRecoveryScreen.tsx",
  "marketing",
  "press",
  "site/src",
  "docs",
  "README.md",
  "app/README.md",
  "wallet/README.md",
  "nostr/README.md",
];
const extensions = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".svg",
  ".xml",
  ".yaml",
  ".yml",
]);
const skippedDirectories = new Set(["node_modules", ".git"]);
const skippedPaths = new Set([
  "docs/.vitepress/dist",
  "docs/.vitepress/cache",
  "marketing/artwork/generated",
  "press/artwork/generated",
]);
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

function normalize(text) {
  return text
    .replace(/\\u([\da-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, value) => {
      const code =
        value[0].toLowerCase() === "x"
          ? parseInt(value.slice(1), 16)
          : Number(value);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/&(?:apos|rsquo|lsquo);/gi, "'")
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(['"])/g, "$1")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ");
}

function matcher(phrase) {
  const escaped = normalize(phrase)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
}

function validatePolicy(policy) {
  if (
    policy.version !== 1 ||
    !Array.isArray(policy.rules) ||
    !policy.rules.length ||
    !Array.isArray(policy.exceptions)
  ) {
    throw new Error(
      "Invalid claims policy: expected version 1, rules and exceptions",
    );
  }
  const ids = new Set();
  for (const rule of policy.rules) {
    if (
      !idPattern.test(rule.id) ||
      ids.has(rule.id) ||
      !["error", "warning"].includes(rule.severity) ||
      !Array.isArray(rule.phrases) ||
      !rule.phrases.length ||
      rule.phrases.some(
        (phrase) => typeof phrase !== "string" || !normalize(phrase).trim(),
      ) ||
      typeof rule.reason !== "string" ||
      !rule.reason.trim()
    ) {
      throw new Error(`Invalid rule ID or definition: ${rule.id}`);
    }
    ids.add(rule.id);
  }
  const exceptionIds = new Set();
  for (const exception of policy.exceptions) {
    const rule = policy.rules.find((entry) => entry.id === exception.ruleId);
    if (
      !idPattern.test(exception.id) ||
      exceptionIds.has(exception.id) ||
      !rule ||
      !Array.isArray(exception.paths) ||
      !exception.paths.length ||
      exception.paths.some(
        (path) =>
          typeof path !== "string" ||
          !path ||
          path.startsWith("/") ||
          path.split("/").includes("..") ||
          /[\\*?]/.test(path),
      ) ||
      typeof exception.context !== "string" ||
      !/[.!?]$/.test(exception.context) ||
      !rule.phrases.some((phrase) =>
        matcher(phrase).test(normalize(exception.context)),
      ) ||
      typeof exception.reason !== "string" ||
      !exception.reason.trim()
    ) {
      throw new Error(
        `Invalid exception or rule ID: ${exception.id} -> ${exception.ruleId}`,
      );
    }
    exceptionIds.add(exception.id);
  }
}

function scan(text, path, policy, external = false) {
  let offset = 0;
  let paragraphStart = 0;
  const lines = text.split(/\r?\n/).flatMap((line, index) => {
    const value = normalize(line).trim();
    if (!value) {
      paragraphStart = offset;
      return [];
    }
    const entry = { offset, paragraphStart, number: index + 1, value };
    offset += value.length + 1;
    return entry;
  });
  const content = lines.map((line) => line.value).join(" ");
  const findings = [];
  let policyMentions = 0;
  let exceptions = 0;
  for (const rule of policy.rules) {
    for (const phrase of rule.phrases) {
      for (const match of content.matchAll(matcher(phrase))) {
        const start = match.index;
        const end = start + match[0].length;
        const line = lines.findLast((entry) => entry.offset <= start);
        // Only an explicit editorial prohibition in Markdown is policy prose.
        // Quotes, code fences, and a stray "not" are not blanket exemptions.
        const prefix = content.slice(
          Math.max(line.paragraphStart, start - 160),
          start,
        );
        if (
          !external &&
          /\.mdx?$/.test(path) &&
          /\b(?:do not|don't|never|must not|should not)\s+(?:claim|say|promise|advertise|describe|market|call|use)\b[^.!?;:,]{0,100}$/.test(
            prefix,
          )
        ) {
          policyMentions++;
          continue;
        }
        const exempt =
          !external &&
          policy.exceptions.some((exception) => {
            if (exception.ruleId !== rule.id || !exception.paths.includes(path))
              return false;
            const context = normalize(exception.context);
            let at = content.indexOf(context);
            while (at !== -1) {
              if (
                at <= start &&
                at + context.length >= end &&
                /(?:^|["'.!?]\s*)$/.test(content.slice(0, at))
              )
                return true;
              at = content.indexOf(context, at + 1);
            }
            return false;
          });
        if (exempt) {
          exceptions++;
          continue;
        }
        findings.push({
          path,
          line: line.number,
          id: rule.id,
          phrase,
          reason: rule.reason,
          severity: external ? "warning" : rule.severity,
        });
      }
    }
  }
  return { findings, policyMentions, exceptions };
}

export function lintCopy({
  directory = root,
  policyPath = resolve(directory, "copy/claims.json"),
  externalSnapshots = [],
} = {}) {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  validatePolicy(policy);
  const files = new Set();
  const skipped = [];
  function visit(path) {
    if (
      !existsSync(path) ||
      skippedPaths.has(relative(directory, path).split("\\").join("/"))
    )
      return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      skipped.push(relative(directory, path));
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (!skippedDirectories.has(entry.name))
          visit(resolve(path, entry.name));
      }
    } else if (extensions.has(extname(path).toLowerCase())) files.add(path);
  }
  for (const scope of scopes) visit(resolve(directory, scope));
  const findings = [];
  let policyMentions = 0;
  let exceptions = 0;
  for (const file of [...files].sort()) {
    const path = relative(directory, file).split("\\").join("/");
    const result = scan(readFileSync(file, "utf8"), path, policy);
    findings.push(...result.findings);
    policyMentions += result.policyMentions;
    exceptions += result.exceptions;
  }
  for (const snapshot of externalSnapshots) {
    const file = resolve(directory, snapshot);
    findings.push(
      ...scan(readFileSync(file, "utf8"), `external:${snapshot}`, policy, true)
        .findings,
    );
  }
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const output = [
    `Copy lint: ${files.size} authored text files; ${errors.length} errors; ${warnings.length} watch/external matches.`,
  ];
  for (const error of errors)
    output.push(
      `ERROR ${error.path}:${error.line} [${error.id}] "${error.phrase}". ${error.reason}`,
    );
  for (const rule of policy.rules) {
    const matches = warnings.filter((finding) => finding.id === rule.id);
    if (!matches.length) continue;
    const locations = [
      ...new Set(matches.map((finding) => `${finding.path}:${finding.line}`)),
    ];
    output.push(
      `WARN [${rule.id}] ${matches.length} matches in ${new Set(matches.map((finding) => finding.path)).size} files; examples: ${locations.slice(0, 3).join(", ")}.`,
    );
  }
  output.push(
    `Context: ${policyMentions} explicit Markdown policy mentions; ${exceptions} exact contextual exceptions.`,
  );
  output.push(
    `Scope: copy/src, optional store.json, legal, onboarding, backup/recovery screens, marketing/press, site/src, docs and READMEs. Binary artwork, generated/build output, dependencies and symlinks excluded (${skipped.length} symlinks skipped).`,
  );
  const missing = [
    "copy/src",
    "copy/legal/documents.json",
    "site/src",
    "docs",
    "README.md",
  ].filter((scope) => !existsSync(resolve(directory, scope)));
  if (missing.length)
    output.push(`WARN missing surfaces: ${missing.join(", ")}.`);
  output.push(
    "Limit: lexical source scan, not rendered-copy, translation, runtime, legal, protocol, or live-availability verification; composed strings and unsupported file formats need manual review. Rule definitions and test fixtures are policy/tooling, not published copy.",
  );
  output.push(
    externalSnapshots.length
      ? `WARN external snapshots: ${externalSnapshots.length} supplied files scanned as warnings only; authenticity, capture date, locale and live listing parity are NOT verified.`
      : "WARN external snapshots: none supplied; live store listings, deployed sites and external copy were NOT checked. No snapshots were invented.",
  );
  return { errors, warnings, files: [...files], output: output.join("\n") };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = { externalSnapshots: [] };
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      const [flag, value] = args.slice(index, index + 2);
      if (
        !value ||
        !["--root", "--rules", "--external-snapshot"].includes(flag)
      ) {
        throw new Error(
          "Usage: node copy/scripts/lint.mjs [--root directory] [--rules file] [--external-snapshot file]",
        );
      }
      if (flag === "--root") options.directory = resolve(value);
      if (flag === "--rules") options.policyPath = resolve(value);
      if (flag === "--external-snapshot") options.externalSnapshots.push(value);
    }
    const result = lintCopy(options);
    console.log(result.output);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`Copy lint configuration/read error: ${error.message}`);
    process.exitCode = 2;
  }
}
