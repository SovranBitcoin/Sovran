import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';
import { isNostrPubkeyHex, NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';

const MAX_PEERS = 500;

const LastMessageSchema = z.object({
  // Unknown protocols drop only this disposable metadata entry, never invent
  // evidence that the peer used a supported transport.
  // ast-grep-ignore: persisted-enum-needs-catch
  protocol: z.enum(['nip04', 'nip17', 'whitenoise', 'bitchat']),
  atSeconds: z.number().int().nonnegative(),
  isOwn: z.boolean(),
});

type LastMessageEntry = z.infer<typeof LastMessageSchema>;

function boundPeers(byPeer: Record<string, LastMessageEntry>): Record<string, LastMessageEntry> {
  if (Object.keys(byPeer).length <= MAX_PEERS) return byPeer;
  return Object.fromEntries(
    Object.entries(byPeer)
      .sort(([, a], [, b]) => b.atSeconds - a.atSeconds)
      .slice(0, MAX_PEERS)
  );
}

const PersistedDmLastMessageStore = z.object({
  byPeer: tolerantRecord(NostrPubkeyHexSchema, LastMessageSchema)
    .catch(() => ({}))
    .transform(boundPeers),
});

interface DmLastMessageStore {
  byPeer: Record<string, LastMessageEntry>;
  recordLastMessage: (peerHex: string, entry: LastMessageEntry) => void;
}

/** Bounded, profile-owned transport metadata; no message text is retained. */
export const useDmLastMessageStore = create<DmLastMessageStore>()(
  persist(
    (set, get) => ({
      byPeer: {},
      recordLastMessage: (peerHex, entry) => {
        if (!isNostrPubkeyHex(peerHex)) return;
        const existing = get().byPeer[peerHex];
        // Avoid calling set at all: persist writes even when set returns the
        // same state. Revisited inbox pages must not rewrite the cache.
        if (existing && existing.atSeconds >= entry.atSeconds) return;
        const byPeer = boundPeers({ ...get().byPeer, [peerHex]: entry });
        if (!byPeer[peerHex]) return;
        set({ byPeer });
      },
    }),
    persistConfig({
      name: 'dm-last-message-store',
      storage: createProfileScopedStorage(),
      schema: PersistedDmLastMessageStore,
      partialize: (state) => ({ byPeer: state.byPeer }),
    })
  )
);

export function useDmLastMessage(pubkey: string): LastMessageEntry | undefined {
  return useDmLastMessageStore((state) => state.byPeer[pubkey]);
}
