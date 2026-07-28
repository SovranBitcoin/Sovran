// Seed sanitization for the avatar fallback (the clay silhouette): every
// fallback render derives from a deterministic seed (pubkey → name → alt),
// normalized here to a stable, bounded, SVG-id-safe string.

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
