import { create } from 'zustand';

/**
 * Optimistic sent-DM echoes created OUTSIDE the chat screen. The Send flow's
 * contact ecash delivery (`deliverContactEcashDm`) publishes its NIP-17 pair
 * BEFORE the thread mounts, so `UserMessagesScreen`'s own echo lane never saw
 * the message — the sender landed in a thread that stayed empty (or on the
 * loading skeleton) until nagg round-tripped the self-copy. The screen seeds
 * its local echo lane from here on mount; entries carry the SELF-WRAP id, so
 * they dedup against the server copy exactly like in-screen echoes and stale
 * entries are harmless.
 *
 * Runtime-only by design, but profile changes can happen without an app
 * restart. Every thread key therefore includes the active sender pubkey as
 * well as protocol + peer. The content is a DM body (and may be a bearer ecash
 * token) — never log it and never add this store to the e2e store mirror.
 */
export interface DmEchoMessage {
  /** Self-copy gift-wrap event id — the thread's dedup key. */
  id: string;
  content: string;
  isOwn: true;
  created_at: number;
  /** Sender (own) pubkey, hex. */
  pubkey: string;
}

type DmEchoProtocol = 'nip04' | 'nip17';

/** One DM thread: the active profile's pubkey, the protocol and the peer, all hex. */
export interface DmThreadRef {
  viewer: string;
  protocol: DmEchoProtocol;
  counterparty: string;
}

interface DmEchoStore {
  byThread: Record<string, DmEchoMessage[]>;
  /** Record a sent echo for one profile- and protocol-specific peer thread. */
  append: (thread: DmThreadRef, message: DmEchoMessage) => void;
  /** Read echoes for exactly one profile- and protocol-specific peer thread. */
  getForThread: (thread: DmThreadRef) => DmEchoMessage[];
}

const MAX_ECHOES_PER_THREAD = 20;
const threadKey = ({ protocol, viewer, counterparty }: DmThreadRef) =>
  `${protocol}:${viewer}:${counterparty}`;

export const useDmEchoStore = create<DmEchoStore>((set, get) => ({
  byThread: {},
  append: (thread, message) =>
    set((state) => {
      const key = threadKey(thread);
      const existing = state.byThread[key] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        byThread: {
          ...state.byThread,
          [key]: [...existing.slice(-(MAX_ECHOES_PER_THREAD - 1)), message],
        },
      };
    }),
  getForThread: (thread) => get().byThread[threadKey(thread)] ?? [],
}));
