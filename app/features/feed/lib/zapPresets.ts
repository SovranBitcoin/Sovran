/**
 * Zap preset table — Primal-style: each preset binds an emoji, a sat amount,
 * and a canned message. The message becomes the NIP-57 zap comment (the 9734
 * `content`), so recipients see it alongside the amount in their client.
 * Hardcoded in v1; a user-editable list is a deliberate non-goal for now.
 */

export interface ZapPreset {
  emoji: string;
  sats: number;
  message: string;
}

export const ZAP_PRESETS: ZapPreset[] = [
  { emoji: '👍', sats: 21, message: 'Great post 👍' },
  { emoji: '☕', sats: 1_000, message: 'Coffee on me ☕' },
  { emoji: '🍻', sats: 5_000, message: 'Cheers 🍻' },
  { emoji: '🚀', sats: 10_000, message: "Let's go 🚀" },
  { emoji: '👑', sats: 100_000, message: 'Generational wealth 👑' },
];

/** Collapse newlines + truncate for the persisted annotation snapshot. */
export function zapContentPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 120);
}
