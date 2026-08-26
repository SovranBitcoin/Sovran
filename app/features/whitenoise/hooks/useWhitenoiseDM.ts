import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  deserializeApplicationRumor,
  getNostrGroupIdHex,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useWhitenoise } from '../WhitenoiseContext';
import { resolveInboxRelays } from '../client/network';
import { WhitenoiseDmIndex } from '../storage/dmIndex';
import { WhitenoiseGroupHistory } from '../storage/groupHistory';
import { mintLocalId } from '@/shared/lib/id';
import { wnLog } from '@/shared/lib/logger';

const KEY_PACKAGE_KIND = 443;
const GROUP_EVENT_KIND = 445;

type WnGroup = MarmotGroup<WhitenoiseGroupHistory>;

export type WhitenoiseDmMessage = {
  id: string;
  authorPubkey: string;
  content: string;
  createdAt: number;
  isSelf: boolean;
  isPending?: boolean;
};

type UseWhitenoiseDMState = {
  isClientReady: boolean;
  isLoading: boolean;
  isCreatingGroup: boolean;
  error: string | null;
  hasGroup: boolean;
  messages: WhitenoiseDmMessage[];
  send: (text: string) => Promise<void>;
};

function rumorToMessage(
  rumor: { id?: string; pubkey: string; content: string; created_at: number },
  selfPubkey: string
): WhitenoiseDmMessage {
  return {
    id: rumor.id ?? `wn-${rumor.created_at}-${rumor.pubkey.slice(0, 8)}`,
    authorPubkey: rumor.pubkey,
    content: rumor.content,
    createdAt: rumor.created_at,
    isSelf: rumor.pubkey === selfPubkey,
  };
}

export function useWhitenoiseDM(counterpartyPubkey: string): UseWhitenoiseDMState {
  const { client, relays, accountIndex } = useWhitenoise();
  const { keys } = useNostrKeysContext();
  const selfPubkey = keys?.pubkey ?? '';

  const [group, setGroup] = useState<WnGroup | null>(null);
  const [messages, setMessages] = useState<WhitenoiseDmMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks the dm-pubkey → groupId map for the active account. Keying the
  // memo on accountIndex means a future provider re-mount with a different
  // account creates a fresh index instead of reusing the previous account's
  // (audit 33.json F-008).
  const dmIndex = useMemo(() => new WhitenoiseDmIndex(accountIndex), [accountIndex]);

  // Post-commit mirror of `group` (write-during-render blocks the compiler).
  // Only read inside the send callback, where post-commit timing is correct;
  // sendDmImpl also writes it directly to bridge the gap between createGroup
  // and the commit of setGroup(created).
  const groupRef = useLatestRef<WnGroup | null>(group);

  // Sorted insertion — ingest is monotonic by createdAt in the steady state,
  // but local sends carry now() and historical hydration may interleave, so
  // we still find the right slot. O(n) per upsert vs the previous full sort.
  // Audit 33.json F-012.
  const upsertMessage = useCallback((msg: WhitenoiseDmMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev];
      const idx = next.findIndex((m) => m.createdAt > msg.createdAt);
      if (idx === -1) next.push(msg);
      else next.splice(idx, 0, msg);
      return next;
    });
  }, []);

  // Resolve existing group by counterparty pubkey, hydrate persisted history.
  useEffect(() => {
    if (!client || !counterpartyPubkey) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    void loadDmGroupImpl(client, counterpartyPubkey, selfPubkey, dmIndex, () => cancelled, {
      setGroup,
      setMessages,
      setIsLoading,
      setError,
    });
    return () => {
      cancelled = true;
    };
  }, [client, counterpartyPubkey, selfPubkey, dmIndex]);

  // Subscribe to kind-445 events for the group and feed them into ingest.
  // The h-tag uses the *Nostr* group id (from the MarmotGroupData extension),
  // NOT the MLS `group.id`. They differ — getNostrGroupIdHex returns the
  // Nostr-tag value marmot writes when publishing kind-445 group events.
  useEffect(() => {
    if (!client || !group) return;
    const groupRelays = group.relays && group.relays.length > 0 ? group.relays : [...relays];
    const nostrGroupIdHex = getNostrGroupIdHex(group.state);

    const onAppMessage = (bytes: Uint8Array) => {
      try {
        const rumor = deserializeApplicationRumor(bytes);
        if (!selfPubkey) return;
        upsertMessage(rumorToMessage(rumor, selfPubkey));
      } catch (err) {
        wnLog.warn('whitenoise.dm.deserialize_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    group.on('applicationMessage', onAppMessage);

    const sub = client.network.subscription(groupRelays, [
      { kinds: [GROUP_EVENT_KIND], '#h': [nostrGroupIdHex] },
    ]);
    const handle = sub.subscribe({
      next: (event) => {
        ingestGroupEvent(group, event).catch((err: unknown) => {
          wnLog.warn('whitenoise.dm.ingest_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      error: (err) => {
        wnLog.warn('whitenoise.dm.subscription_error', {
          error: err instanceof Error ? err.message : String(err),
        });
      },
    });

    return () => {
      group.off('applicationMessage', onAppMessage);
      handle.unsubscribe();
    };
  }, [client, group, relays, selfPubkey, upsertMessage]);

  const sendInner = useCallback(
    (text: string) =>
      sendDmImpl(
        {
          client,
          selfPubkey,
          relays,
          counterpartyPubkey,
          dmIndex,
          groupRef,
          upsertMessage,
          setError,
          setIsCreatingGroup,
          setGroup,
          setMessages,
        },
        text
      ),
    [client, counterpartyPubkey, relays, selfPubkey, upsertMessage, dmIndex, groupRef]
  );

  // The lazy group-creation path is the high-cost double-tap target: a
  // second concurrent call before `groupRef.current` is set re-enters the
  // `!activeGroup` branch, calls `client.createGroup` again, and burns a
  // second key package while orphaning the first group. The `isCreatingGroup`
  // React flag wasn't enough — it commits one render too late.
  const send = useSingleFlight(sendInner);

  return {
    isClientReady: !!client,
    isLoading,
    isCreatingGroup,
    error,
    hasGroup: !!group,
    messages,
    send,
  };
}

async function ingestGroupEvent(group: WnGroup, event: unknown): Promise<void> {
  for await (const _result of group.ingest([event as never])) {
    // applicationMessage events are emitted via the group emitter and handled there.
  }
}

// Bodies live at module scope: try/finally (and throw-inside-try) cannot be
// lowered by the React Compiler and made every consumer of this hook carry an
// uncompiled hook slot. Verbatim moves — DM plaintext flows exactly as before.
type WhitenoiseClient = ReturnType<typeof useWhitenoise>['client'];

async function loadDmGroupImpl(
  client: NonNullable<WhitenoiseClient>,
  counterpartyPubkey: string,
  selfPubkey: string,
  dmIndex: WhitenoiseDmIndex,
  isCancelled: () => boolean,
  io: {
    setGroup: (value: WnGroup | null) => void;
    setMessages: React.Dispatch<React.SetStateAction<WhitenoiseDmMessage[]>>;
    setIsLoading: (value: boolean) => void;
    setError: (value: string | null) => void;
  }
): Promise<void> {
  io.setIsLoading(true);
  try {
    await client.loadAllGroups();
    const groupIdHex = await dmIndex.get(counterpartyPubkey);
    if (!groupIdHex) {
      if (!isCancelled()) {
        io.setGroup(null);
        io.setMessages([]);
        io.setIsLoading(false);
      }
      return;
    }
    const found = (await client.getGroup(groupIdHex)) as WnGroup;
    if (isCancelled()) return;
    io.setGroup(found);
    // Hydrate persisted history (own + peer messages saved by marmot).
    try {
      const stored = await found.history.loadMessages();
      if (isCancelled()) return;
      if (selfPubkey) {
        const hydrated = stored.map((s) => rumorToMessage(s.rumor, selfPubkey));
        io.setMessages(hydrated.sort((a, b) => a.createdAt - b.createdAt));
      }
    } catch (err) {
      wnLog.warn('whitenoise.dm.history_load_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    wnLog.warn('whitenoise.dm.load_failed', { error: message });
    if (!isCancelled()) io.setError(message);
  } finally {
    if (!isCancelled()) io.setIsLoading(false);
  }
}

interface SendDmCtx {
  client: WhitenoiseClient;
  selfPubkey: string;
  relays: ReturnType<typeof useWhitenoise>['relays'];
  counterpartyPubkey: string;
  dmIndex: WhitenoiseDmIndex;
  groupRef: { current: WnGroup | null };
  upsertMessage: (msg: WhitenoiseDmMessage) => void;
  setError: (value: string | null) => void;
  setIsCreatingGroup: (value: boolean) => void;
  setGroup: (value: WnGroup | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<WhitenoiseDmMessage[]>>;
}

async function sendDmImpl(ctx: SendDmCtx, text: string): Promise<void> {
  const {
    client,
    selfPubkey,
    relays,
    counterpartyPubkey,
    dmIndex,
    groupRef,
    upsertMessage,
    setError,
    setIsCreatingGroup,
    setGroup,
    setMessages,
  } = ctx;
  if (!text.trim()) return;
  if (!client) {
    setError('White Noise client not ready');
    return;
  }
  if (!selfPubkey) {
    setError('No active Nostr key');
    return;
  }
  setError(null);

  let activeGroup = groupRef.current;

  // Lazy-create the group on first send.
  if (!activeGroup) {
    setIsCreatingGroup(true);
    try {
      const fallbackRelays = relays.length > 0 ? [...relays] : [];
      const lookupRelays = await resolveInboxRelays(
        client.network,
        counterpartyPubkey,
        fallbackRelays
      );
      const events = await client.network.request(lookupRelays, [
        { kinds: [KEY_PACKAGE_KIND], authors: [counterpartyPubkey], limit: 1 },
      ]);
      if (events.length === 0) {
        throw new Error("Recipient hasn't published a White Noise key package yet.");
      }
      const keyPackageEvent = events[0];

      const created = (await client.createGroup(`dm:${counterpartyPubkey.slice(0, 16)}`, {
        description: 'White Noise 1:1 DM',
        relays: fallbackRelays,
      })) as WnGroup;
      await created.inviteByKeyPackageEvent(keyPackageEvent);

      await dmIndex.set(counterpartyPubkey, bytesToHex(created.id));
      activeGroup = created;
      groupRef.current = created;
      setGroup(created);
      wnLog.info('whitenoise.dm.group_created', {
        groupId: bytesToHex(created.id),
        counterparty: counterpartyPubkey.slice(0, 16),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      wnLog.error('whitenoise.dm.group_create_failed', { error: message });
      setIsCreatingGroup(false);
      return;
    }
    setIsCreatingGroup(false);
  }

  const optimisticId = mintLocalId('pending');
  const nowSec = Math.floor(Date.now() / 1000);
  upsertMessage({
    id: optimisticId,
    authorPubkey: selfPubkey,
    content: text,
    createdAt: nowSec,
    isSelf: true,
    isPending: true,
  });

  try {
    await activeGroup!.sendChatMessage(text);
    setMessages((prev) =>
      prev.map((m) => (m.id === optimisticId ? { ...m, isPending: false } : m))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    wnLog.error('whitenoise.dm.send_failed', { error: message });
    setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
  }
}
