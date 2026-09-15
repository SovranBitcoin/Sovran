import type { ImageMetadata } from "astro";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createScene } from "../../../scripts/lib/phone-frame.mjs";
import { appSourceFingerprint, classifyCapture } from "../../../scripts/lib/app-source.mjs";
import registry from "../../../press/artwork/source/screenshots.json";
import contextCatalog from "../../../press/artwork/source/screenshot-context.json";

// Scene membership requires both retained pixels and authenticated provenance.
// Astro's ESM image proxy exposes the source fsPath during both dev and build.
type SourceImage = ImageMetadata & { fsPath: string };
const images = import.meta.glob<SourceImage>(
  "../../../press/artwork/source/screenshots/ios/*.png",
  { eager: true, import: "default" },
);
const androidImages = import.meta.glob<SourceImage>(
  "../../../press/artwork/source/screenshots/android/*.png",
  { eager: true, import: "default" },
);
export const collections = contextCatalog.collections;
type NativeBuild = { fingerprint: string; appVersion: string; buildNumber: string; gitSha: string; builtAt: string };
type RegistryEntry = {
  context: string; page: string; file: string; run: string | null; sha256: string | null;
  availability?: string; unavailableReason?: string; wallpaperId?: string;
  freshness?: string; staleReason?: string; capturedAt?: string; nativeBuild?: NativeBuild;
  lastRefreshFailure?: { at: string; reason: string };
  appSource?: { fingerprint: string; gitSha: string; gitDirty: boolean };
};
// Astro runs from site/; the app source lives one level up. Undefined without git (e.g. Docker).
const currentAppFingerprint = appSourceFingerprint(new URL("..", `file://${process.cwd()}/`).pathname);
const requestedEntries: [string, RegistryEntry][] = collections.flatMap(collection => collection.screenshots.map(key => {
  const context = key.split('/')[1];
  return [key, { context, page: context, file: `source/screenshots/${key}.png`, run: null, sha256: null }] as [string, RegistryEntry];
}));
export const screenshotCatalog = [...new Map<string, RegistryEntry>([...requestedEntries, ...Object.entries(registry)])].map(([key, entry]) => {
  const context = contextCatalog.contexts[entry.context as keyof typeof contextCatalog.contexts];
  const path = `../../../press/artwork/${entry.file}`;
  const image = images[path] ?? androidImages[path];
  const matches = Boolean(image && entry.sha256 &&
    createHash("sha256").update(readFileSync(image.fsPath)).digest("hex") === entry.sha256);
  let reason = "";
  if (entry.availability === "unavailable")
    reason = entry.unavailableReason ?? "This capture is marked unavailable.";
  else if (entry.freshness === "stale")
    reason = entry.staleReason ?? entry.unavailableReason ?? "This capture is marked stale.";
  else if (!entry.run || !entry.sha256) reason = "No native run and hash recorded yet.";
  else if (!image) reason = "The registered image is not retained on disk.";
  else if (!context) reason = "Screenshot context is missing.";
  else if (!matches) reason = "The retained file does not match its recorded SHA-256.";
  return { key, ...entry, context, alt: context?.alt ?? key, image: reason ? undefined : image, reason,
    freshness: classifyCapture(entry, currentAppFingerprint) };
});
export const captures = Object.fromEntries(screenshotCatalog.flatMap(capture =>
  capture.key.startsWith("ios/") && capture.image ? [[capture.key, {
    key: capture.key, image: capture.image, width: capture.image.width,
    height: capture.image.height, alt: capture.alt,
  }]] : [],
));

// Stable, collection-order combinations, not permutations or repeated fillers.
export function collectionPairings(keys: string[], count: number, available: string[]) {
  if (!Number.isInteger(count) || count < 1 || count > 4) return [];
  const retained = [...new Set(keys)].filter(key => available.includes(key));
  const groups: string[][] = [];
  const visit = (start: number, group: string[]) => {
    if (group.length === count) { groups.push(group); return; }
    for (let i = start; i <= retained.length - (count - group.length); i++)
      visit(i + 1, [...group, retained[i]]);
  };
  visit(0, []);
  return groups;
}
export const pageScenes = {
  hero: { preset: "duo-depth", screenshots: ["ios/feed", "ios/wallet"] },
  wallet: { preset: "duo-overlap", screenshots: ["ios/wallet", "ios/send"] },
  social: {
    preset: "duo-depth",
    screenshots: ["ios/notifications", "ios/feed"],
  },
  ai: { preset: "single-tilt", screenshots: ["ios/ai"] },
  offline: { preset: "duo-overlap", screenshots: ["ios/contacts", "ios/send"] },
};
export const defaultScreenshots = [
  "ios/wallet",
  "ios/feed",
  "ios/dm-chat",
  "ios/send",
];

export function resolveScene({
  scene,
  preset,
  screenshots,
  poses,
}: {
  scene?: keyof typeof pageScenes;
  preset?: string;
  screenshots?: string[];
  poses?: Record<string, number>[];
}) {
  const selection =
    scene && Object.hasOwn(pageScenes, scene) ? pageScenes[scene] : undefined;
  if (scene && !selection) throw new Error(`Unknown page scene: ${scene}`);
  const keys = screenshots ?? selection?.screenshots ?? ["ios/wallet"];
  return createScene(
    keys.map((key) => {
      if (!key.startsWith("ios/") || !Object.hasOwn(captures, key))
        throw new Error(`Unreviewed iOS screenshot: ${key}`);
      return captures[key];
    }),
    { preset: preset ?? selection?.preset ?? "custom", poses },
  );
}
