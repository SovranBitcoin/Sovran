/** Read-only public snapshot. Never pass these events to signing, publishing,
 * wallet operations, live entity caches, or persisted stores. */
import type { ProfileInfo } from '@/shared/lib/nostr/nostrEventTypes';
import { PUBLIC_DEMO_METADATA } from './mockPublicProfile';

export const DEMO_PROFILES = new Map<string, ProfileInfo>(
  [...PUBLIC_DEMO_METADATA].map(([pubkey, metadata]) => [
    pubkey,
    {
      name: metadata.displayName || metadata.name || pubkey.slice(0, 8),
      picture: metadata.picture,
    },
  ])
);
