import type { NostrTier } from '@sovranbitcoin/schemas';
import * as React from 'react';

import { Badge } from '@/shared/ui/primitives/Badge';
import { useDebugTier } from '@/features/feed/stores/debugTierStore';

// Single-letter debug chip showing which facade tier served this note's data.
// Legend: n = nagg (app-view), c = primal (public cache server), r = relay (raw NIP-01).
// Colour tracks source quality: nagg=success, primal=warning, relay=error.
const TIER_DISPLAY: Record<
  NostrTier,
  { letter: string; variant: 'success' | 'warning' | 'error' | 'secondary' }
> = {
  nagg: { letter: 'n', variant: 'success' },
  primal: { letter: 'c', variant: 'warning' },
  relay: { letter: 'r', variant: 'error' },
  cache: { letter: 'c', variant: 'secondary' },
};

/**
 * Dev-only per-post tier badge. Renders nothing in production builds or before the
 * serving tier for `eventId` has been recorded (see {@link useDebugTier}).
 */
export function TierBadge({ eventId }: { eventId: string }): React.ReactElement | null {
  const tier = useDebugTier(eventId);
  if (!__DEV__ || !tier) return null;
  const display = TIER_DISPLAY[tier] ?? { letter: tier.charAt(0), variant: 'secondary' as const };
  return (
    <Badge variant={display.variant} size={10}>
      {display.letter}
    </Badge>
  );
}
