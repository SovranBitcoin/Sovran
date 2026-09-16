import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createScene, SCENE_PRESETS } from "../../../scripts/lib/phone-frame.mjs";
import website from "../../../press/website.json";
import { websiteScenes } from "../../scripts/website-config.mjs";
import inputs from 'virtual:sovran-website-captures';

export const captures = Object.fromEntries(Object.entries(inputs).map(([key, capture]) => {
  if (createHash('sha256').update(readFileSync(capture.image.fsPath)).digest('hex') !== capture.sha256)
    throw new Error(`Website capture changed during build: ${key}`);
  return [key, { key, image: capture.image, width: capture.image.width,
    height: capture.image.height, alt: capture.alt, freshness: capture.freshness }];
}));

export const pageScenes = websiteScenes(website);
export const defaultScreenshots = Object.keys(captures).slice(0, 4);

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
  const keys = screenshots ?? selection?.screenshots ?? defaultScreenshots.slice(0, 1);
  return createScene(
    keys.map((key, index) => {
      if (!Object.hasOwn(captures, key))
        throw new Error(`Unreviewed screenshot: ${key}`);
      return { ...captures[key], frameId: selection?.phones[index]?.frameId };
    }),
    { preset: preset ?? selection?.preset ?? "custom", poses: poses ?? (selection?.phones.some(phone => phone.pose) ? selection.phones.map((phone, index) => ({ ...SCENE_PRESETS[selection.preset].poses[index], ...phone.pose })) : undefined) },
  );
}
