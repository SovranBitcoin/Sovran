import { DEFAULT_SHADOW, FRAME_IDS, SCENE_PRESETS, SHADOW_GROUNDS, SHADOW_LIMITS } from '../../scripts/lib/phone-frame.mjs';

export const BACKGROUNDS = Object.freeze({ charcoal: '#171916', forest: '#12372d', paper: '#f5f7f2', black: '#080908' });
// The brand watermark is part of the published image, so its placement is a
// recipe field: six anchors that reserve their own band, plus an opt-out.
export const BRAND_PLACEMENTS = Object.freeze(['none', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']);
export const BRAND_LOCKUPS = Object.freeze(['wordmark', 'symbol']);
export const BRAND_SCALE = Object.freeze([0.6, 1.6]);
export const DEFAULT_BRAND = Object.freeze({ placement: 'bottom-left', lockup: 'wordmark', scale: 1 });
// The ground is part of the published image, so it is a recipe field too: a
// plane, a height above it, and the key light that casts onto it. Absent means
// no ground and no shadow. `samples` is render cost, not composition, so it
// stays at the library default rather than becoming a knob.
export const SHADOW_FIELDS = Object.freeze(['ground', 'height', 'softness', 'opacity', 'angle', 'tilt']);
export const POSE_LIMITS = Object.freeze({ x: [-2000, 2000], y: [-2000, 2000], z: [-10, 10], scale: [0.3, 2], rotateX: [-60, 60], rotateY: [-60, 60], rotateZ: [-180, 180] });
export const resolveCapture = (catalog, id) => catalog.captures.find(capture => capture.id === id || capture.aliases?.includes(id));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);

// This dependency-free boundary is shared by JSON/hash import and the server.
// Asset membership is checked separately against the live source catalog.
export function validateRecipe(value) {
  if (!keys(value, ['version', 'id', 'title', 'headline', 'subtitle', 'footnote', 'background', 'width', 'height', 'preset', 'phones', 'brand', 'shadow', 'draft']) || value.version !== 1)
    throw new Error('Expected a version 1 composition recipe.');
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id) || !text(value.title, 120) || !text(value.headline, 180) || !text(value.subtitle, 320))
    throw new Error('Use a short ID, title (120), headline (180) and subtitle (320 characters).');
  // The caveat line. It is a separate field because a disclosure set at the
  // size of a benefit reads as one, and the subtitle stops being a subtitle.
  if (value.footnote !== undefined && !text(value.footnote, 160)) throw new Error('A footnote is at most 160 characters.');
  if (typeof value.background !== 'string' || !Object.hasOwn(BACKGROUNDS, value.background)) throw new Error('Choose an approved background.');
  if (![value.width, value.height].every(number => Number.isInteger(number) && number >= 320 && number <= 2560) || value.width * value.height > 5_000_000 || value.width / value.height < 0.4 || value.width / value.height > 2.2)
    throw new Error('Canvas must be 320-2560 pixels, at most 5 megapixels, with an aspect ratio from 0.4 to 2.2.');
  if (typeof value.preset !== 'string' || !Object.hasOwn(SCENE_PRESETS, value.preset)) throw new Error('Choose an approved phone preset.');
  if (!Array.isArray(value.phones) || value.phones.length < 1 || value.phones.length > 4 || value.phones.length !== SCENE_PRESETS[value.preset].poses.length)
    throw new Error('The preset must have exactly one to four matching phone slots.');
  if (value.draft !== undefined && typeof value.draft !== 'boolean') throw new Error('Draft must be a boolean.');
  let brand;
  if (value.brand !== undefined) {
    if (!keys(value.brand, ['placement', 'lockup', 'scale'])) throw new Error('Brand takes a placement, lockup and scale.');
    brand = { ...DEFAULT_BRAND, ...value.brand };
    if (!BRAND_PLACEMENTS.includes(brand.placement) || !BRAND_LOCKUPS.includes(brand.lockup)) throw new Error('Choose an approved brand placement and lockup.');
    if (!Number.isFinite(brand.scale) || brand.scale < BRAND_SCALE[0] || brand.scale > BRAND_SCALE[1]) throw new Error(`Brand scale must be ${BRAND_SCALE[0]}-${BRAND_SCALE[1]}.`);
    brand = { placement: brand.placement, lockup: brand.lockup, scale: brand.scale };
  }
  let shadow;
  if (value.shadow !== undefined) {
    if (!keys(value.shadow, SHADOW_FIELDS)) throw new Error('Shadow takes a ground, height, softness, opacity, angle and tilt.');
    shadow = { ...DEFAULT_SHADOW, ...value.shadow };
    if (typeof shadow.ground !== 'string' || !Object.hasOwn(SHADOW_GROUNDS, shadow.ground)) throw new Error('Choose an approved ground.');
    for (const key of SHADOW_FIELDS.filter(field => field !== 'ground')) {
      const [min, max] = SHADOW_LIMITS[key];
      if (!Number.isFinite(shadow[key]) || shadow[key] < min || shadow[key] > max) throw new Error(`Shadow ${key} must be ${min}-${max}.`);
    }
    shadow = Object.fromEntries(SHADOW_FIELDS.map(key => [key, shadow[key]]));
  }
  const phones = value.phones.map(phone => {
    if (!keys(phone, ['captureId', 'frameId', 'pose']) || typeof phone.captureId !== 'string' || !/^(ios|android)\/[a-z0-9-]{1,100}$/.test(phone.captureId)) throw new Error('Choose a registered capture ID.');
    if (phone.frameId !== undefined && !FRAME_IDS[phone.captureId.split('/')[0]].includes(phone.frameId)) throw new Error('Frame and platform must match.');
    if (phone.pose !== undefined && (!keys(phone.pose, Object.keys(POSE_LIMITS)) || Object.entries(phone.pose).some(([key, number]) => !Number.isFinite(number) || number < POSE_LIMITS[key][0] || number > POSE_LIMITS[key][1]))) throw new Error('Phone pose exceeds its limits.');
    return { captureId: phone.captureId, ...(phone.frameId ? { frameId: phone.frameId } : {}), ...(phone.pose ? { pose: { ...phone.pose } } : {}) };
  });
  return { version: 1, id: value.id, title: value.title, headline: value.headline, subtitle: value.subtitle,
    ...(value.footnote?.trim() ? { footnote: value.footnote } : {}), background: value.background, width: value.width, height: value.height, preset: value.preset, phones,
    ...(brand ? { brand } : {}), ...(shadow ? { shadow } : {}), ...(value.draft ? { draft: true } : {}) };
}

export function recipeHash(recipe) { return `#recipe=${encodeURIComponent(JSON.stringify(validateRecipe(recipe)))}`; }
export function recipeFromHash(hash) {
  if (!hash.startsWith('#recipe=') || hash.length > 24000) throw new Error('Invalid recipe URL.');
  return validateRecipe(JSON.parse(decodeURIComponent(hash.slice(8))));
}
