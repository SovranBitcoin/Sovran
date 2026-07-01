/**
 * @fileoverview `mergeRailCapabilities` — reduce N rails to one ComposeConfig.
 *
 * Limits take the minimum across selected rails (the strictest wins); optional
 * capabilities are AND-ed (offered only if every selected rail supports it).
 * When a capability is disabled, the first rail-supplied reason is carried so
 * the toolbar can explain why. Pure + unit-tested — mirrors the structure of
 * colada's availability reducer without any payment coupling.
 */
import type {
  ComposeConfig,
  OptionalCapability,
  RailCapability,
} from '@/features/composer/config/types';

const OPTIONAL_CAPS: { key: OptionalCapability; flag: keyof RailCapability }[] = [
  { key: 'altText', flag: 'allowAltText' },
  { key: 'sensitive', flag: 'allowSensitive' },
  { key: 'poll', flag: 'allowPoll' },
];

/** Merges rail capabilities into the single config the composer reads. */
export function mergeRailCapabilities(rails: readonly RailCapability[]): ComposeConfig {
  if (rails.length === 0) {
    return {
      rails: [],
      charBudget: 0,
      maxMedia: 0,
      allowAltText: false,
      allowSensitive: false,
      allowPoll: false,
      reasons: {},
    };
  }

  const charBudget = Math.min(...rails.map((r) => r.charBudget));
  const maxMedia = Math.min(...rails.map((r) => r.maxMedia));
  const reasons: Partial<Record<OptionalCapability, string>> = {};

  const allowAltText = rails.every((r) => r.allowAltText);
  const allowSensitive = rails.every((r) => r.allowSensitive);
  const allowPoll = rails.every((r) => r.allowPoll);

  // Media is gated on maxMedia > 0; the others on the AND above.
  if (maxMedia === 0) reasons.media = firstReason(rails, 'media');
  for (const { key, flag } of OPTIONAL_CAPS) {
    if (!rails.every((r) => r[flag])) reasons[key] = firstReason(rails, key);
  }

  return {
    rails: rails.map((r) => r.id),
    charBudget,
    maxMedia,
    allowAltText,
    allowSensitive,
    allowPoll,
    reasons,
  };
}

function firstReason(
  rails: readonly RailCapability[],
  cap: OptionalCapability
): string | undefined {
  for (const rail of rails) {
    const reason = rail.reasons?.[cap];
    if (reason) return reason;
  }
  return undefined;
}
