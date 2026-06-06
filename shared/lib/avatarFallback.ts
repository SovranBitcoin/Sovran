export const AVATAR_FALLBACK_VARIANTS = ['beam', 'pixel', 'glass'] as const;

export type AvatarFallbackVariant = (typeof AVATAR_FALLBACK_VARIANTS)[number];

export const DEFAULT_AVATAR_FALLBACK_VARIANT: AvatarFallbackVariant = 'beam';

export const WHITE_FACE_AVATAR_FALLBACK_VARIANT = 'beam' satisfies AvatarFallbackVariant;
export const GLASS_AVATAR_FALLBACK_VARIANT = 'glass' satisfies AvatarFallbackVariant;

export const AVATAR_FALLBACK_VARIANT_LABELS: Record<AvatarFallbackVariant, string> = {
  beam: 'Beam',
  pixel: 'Pixels',
  glass: 'Glass',
};

// Stronger static design-system colors used by every fallback variation. Beam
// is rendered locally with a white face and black details. Pixel receives a
// deterministic slice so it stays legible instead of using every color at once.
export const AVATAR_FALLBACK_COLOR_TOKENS = [
  'blue-300',
  'green-300',
  'purple-300',
  'yellow-300',
  'orange-300',
  'red-300',
  'blue-400',
  'green-400',
  'purple-400',
  'yellow-400',
  'orange-400',
  'red-400',
] as const;

export function getAvatarFallbackColorsForVariant({
  variant,
  colors,
  seed,
}: {
  variant: AvatarFallbackVariant;
  colors: readonly string[];
  seed: string;
}): string[] {
  if (variant !== 'pixel' || colors.length <= 3) return colors.slice();

  const familyCount = Math.floor(colors.length / 2);
  if (familyCount < 2) return colors.slice(0, 3);

  const seedNumber = hashSeedNumber(seed);
  const primaryIndex = seedNumber % familyCount;
  const accentOffset = 1 + (Math.floor(seedNumber / familyCount) % (familyCount - 1));
  const accentIndex = (primaryIndex + accentOffset) % familyCount;

  return [
    colors[primaryIndex] ?? colors[0]!,
    colors[primaryIndex + familyCount] ?? colors[primaryIndex] ?? colors[0]!,
    colors[accentIndex] ?? colors[0]!,
  ];
}

export function isAvatarFallbackVariant(value: string): value is AvatarFallbackVariant {
  return (AVATAR_FALLBACK_VARIANTS as readonly string[]).includes(value);
}

const MAX_SANITIZED_SEED_LENGTH = 96;

function hashSeedNumber(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashSeedInput(input: string): string {
  return hashSeedNumber(input).toString(36);
}

function encodeSeedChar(char: string): string {
  if (/^[A-Za-z0-9_-]$/.test(char)) return char;
  const codePoint = char.codePointAt(0);
  return codePoint == null ? '_' : `_${codePoint.toString(16)}`;
}

export function sanitizeAvatarFallbackSeed(input?: string | null): string {
  const raw = input?.trim() || 'avatar';
  const encoded = Array.from(raw, encodeSeedChar).join('');

  if (!encoded) return 'avatar';
  if (encoded.length <= MAX_SANITIZED_SEED_LENGTH) return encoded;

  const hash = hashSeedInput(raw);
  const prefixLength = MAX_SANITIZED_SEED_LENGTH - hash.length - 1;
  return `${encoded.slice(0, prefixLength)}_${hash}`;
}
