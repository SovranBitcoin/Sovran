import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  deserializeApplicationRumor,
  getGroupMembers,
  getNostrGroupIdHex,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { useWhitenoise } from '../WhitenoiseContext';
import { resolveInboxRelays } from '../client/network';
import { WhitenoiseDmIndex } from '../storage/dmIndex';
import { WhitenoiseGroupHistory } from '../storage/groupHistory';
import { mintLocalId } from '@/shared/lib/id';
import { wnLog } from '@/shared/lib/logger';
import { relays as appRelays } from '@/shared/ndk';

const KEY_PACKAGE_KIND = 443;
const GROUP_EVENT_KIND = 445;

type WnGroup = MarmotGroup<WhitenoiseGroupHistory>;

export type WhitenoiseDmMessage = {
  id: string;
  authorPubkey: string;
  content: string;
  createdAtSec: number;
  isSelf: boolean;
  isPending?: boolean;
};

/** A change to the messages of the conversation opened for `target`. */
type UpdateMessages = (target: OpenedFor, update: SetStateAction<WhitenoiseDmMessage[]>) => void;

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
    createdAtSec: rumor.created_at,
    isSelf: rumor.pubkey === selfPubkey,
  };
}

/** The client, account and peer a conversation was read for. */
interface OpenedFor {
  client: NonNullable<WhitenoiseClient>;
  counterpartyPubkey: string;
  selfPubkey: string;
  accountIndex: WhitenoiseAccountIndex;
}

/**
 * Where the conversation stands. Every state after `closed` names what it was
 * opened for, so a send can tell the read it relies on was for this client and
 * this peer: before that read finishes, "no group" could mean "not read yet",
 * and a send would create a second group.
 */
type Conversation =
  /** No client or no peer. `refusedSend`: a send was tried without a client. */
  | { phase: 'closed'; refusedSend: boolean }
  /** Reading the groups and the saved conversation. */
  | { phase: 'loading'; for: OpenedFor }
  /** The saved group is open and listening; its saved history is still being read. */
  | { phase: 'reading-history'; for: OpenedFor; group: WnGroup }
  /** Read: the conversation's group, or none yet (the first send creates it). */
  | { phase: 'ready'; for: OpenedFor; group: WnGroup | null }
  /** The first send is creating the group and inviting the peer. */
  | { phase: 'creating-group'; for: OpenedFor }
  /**
   * The read, the group's creation or a send failed. A send is still allowed;
   * with no group it first reads the conversation again, since a failed read
   * cannot tell whether one exists.
   */
  | { phase: 'failed'; for: OpenedFor; group: WnGroup | null; error: string };

type ConversationEvent =
  | { type: 'closed' }
  | { type: 'send-without-client' }
  | { type: 'load-started'; for: OpenedFor }
  | { type: 'reload-started'; for: OpenedFor }
  | { type: 'group-found'; for: OpenedFor; group: WnGroup }
  | { type: 'loaded'; for: OpenedFor; group: WnGroup | null }
  | { type: 'send-started'; for: OpenedFor }
  | { type: 'create-started'; for: OpenedFor }
  | { type: 'group-created'; for: OpenedFor; group: WnGroup }
  | { type: 'failed'; for: OpenedFor; error: string };

const CLOSED: Conversation = { phase: 'closed', refusedSend: false };

/** The next state. An answer for another read than the current one is ignored. */
function conversationStep(state: Conversation, event: ConversationEvent): Conversation {
  switch (event.type) {
    case 'closed':
      return state.phase === 'closed' ? state : CLOSED;
    case 'send-without-client':
      return { phase: 'closed', refusedSend: true };
    case 'load-started':
      return { phase: 'loading', for: event.for };
  }
  if (state.phase === 'closed' || state.for !== event.for) return state;
  switch (event.type) {
    case 'reload-started':
      return state.phase === 'failed' ? { phase: 'loading', for: state.for } : state;
    case 'group-found':
      return state.phase === 'loading'
        ? { phase: 'reading-history', for: state.for, group: event.group }
        : state;
    case 'loaded':
      return state.phase === 'loading' || state.phase === 'reading-history'
        ? { phase: 'ready', for: state.for, group: event.group }
        : state;
    case 'send-started':
      return state.phase === 'failed'
        ? { phase: 'ready', for: state.for, group: state.group }
        : state;
    case 'create-started':
      return state.phase === 'ready' && !state.group
        ? { phase: 'creating-group', for: state.for }
        : state;
    case 'group-created':
      return state.phase === 'creating-group'
        ? { phase: 'ready', for: state.for, group: event.group }
        : state;
    case 'failed':
      return { phase: 'failed', for: state.for, group: groupOf(state), error: event.error };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

type OpenedConversation = Exclude<Conversation, { phase: 'closed' }>;

/** `state` when it was opened for exactly these, else null. */
function openedForNow(
  state: Conversation,
  now: { client: WhitenoiseClient } & Omit<OpenedFor, 'client'>
): OpenedConversation | null {
  if (state.phase === 'closed') return null;
  const target = state.for;
  return target.client === now.client &&
    target.counterpartyPubkey === now.counterpartyPubkey &&
    target.selfPubkey === now.selfPubkey &&
    target.accountIndex === now.accountIndex
    ? state
    : null;
}

function groupOf(state: Conversation | null): WnGroup | null {
  if (!state) return null;
  switch (state.phase) {
    case 'reading-history':
    case 'ready':
    case 'failed':
      return state.group;
    case 'closed':
    case 'loading':
    case 'creating-group':
      return null;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** Whether the read for the current client and peer has not finished. */
function isReading(opened: OpenedConversation | null): boolean {
  if (!opened) return true;
  switch (opened.phase) {
    case 'loading':
    case 'reading-history':
      return true;
    case 'ready':
    case 'creating-group':
    case 'failed':
      return false;
    default: {
      const unreachable: never = opened;
      return unreachable;
    }
  }
}

function errorOf(state: Conversation): string | null {
  switch (state.phase) {
    case 'closed':
      return state.refusedSend ? 'White Noise client not ready' : null;
    case 'failed':
      return state.error;
    case 'loading':
    case 'reading-history':
    case 'ready':
    case 'creating-group':
      return null;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function useWhitenoiseDM(counterpartyPubkey: string): UseWhitenoiseDMState {
  const { client, accountIndex } = useWhitenoise();
  const { keys } = useNostrKeysContext();
  const selfPubkey = keys?.pubkey ?? '';

  // The conversation as of now, moved by every event at once, so a send reads
  // it at call time (a group the previous send just created included); the
  // state copy is what renders.
  const machine = useRef<Conversation>(CLOSED);
  const [conversation, setConversation] = useState<Conversation>(CLOSED);
  const dispatch = useCallback((event: ConversationEvent) => {
    const next = conversationStep(machine.current, event);
    if (next === machine.current) return;
    machine.current = next;
    setConversation(next);
  }, []);
  const [messages, setMessages] = useState<WhitenoiseDmMessage[]>([]);
  // Like the state events, a change for a conversation that is no longer the
  // open one (a group created for the previous peer) is dropped.
  const updateMessages = useCallback<UpdateMessages>((target, update) => {
    const now = machine.current;
    if (now.phase === 'closed' || now.for !== target) return;
    setMessages(update);
  }, []);
  // The state only counts once it is for this client, account and peer: in the
  // commit that first carries a new client the read for it has not started.
  const opened = openedForNow(conversation, {
    client,
    counterpartyPubkey,
    selfPubkey,
    accountIndex,
  });
  const group = groupOf(opened);
  const openedFor = opened?.for ?? null;

  // Resolve existing group by counterparty pubkey, hydrate persisted history.
  // The impls construct their own WhitenoiseDmIndex from accountIndex at call
  // time, so a provider re-mount with a different account always reads a
  // fresh index instead of reusing the previous account's (audit 33.json
  // F-008; same shape as useWhitenoiseRequests' acceptRequestImpl).
  useEffect(() => {
    if (!client || !counterpartyPubkey) {
      dispatch({ type: 'closed' });
      return;
    }
    const target: OpenedFor = { client, counterpartyPubkey, selfPubkey, accountIndex };
    dispatch({ type: 'load-started', for: target });
    let cancelled = false;
    void loadDmGroupImpl(target, () => cancelled, { dispatch, updateMessages });
    return () => {
      cancelled = true;
    };
  }, [client, counterpartyPubkey, selfPubkey, accountIndex, dispatch, updateMessages]);

  // Subscribe to kind-445 events for the group and feed them into ingest.
  // The h-tag uses the *Nostr* group id (from the MarmotGroupData extension),
  // NOT the MLS `group.id`. They differ — getNostrGroupIdHex returns the
  // Nostr-tag value marmot writes when publishing kind-445 group events.
  useEffect(() => {
    if (!client || !group || !openedFor) return;
    const groupRelays = group.relays && group.relays.length > 0 ? group.relays : [...appRelays];
    const nostrGroupIdHex = getNostrGroupIdHex(group.state);

    const onAppMessage = (bytes: Uint8Array) => {
      try {
        const rumor = deserializeApplicationRumor(bytes);
        if (!selfPubkey) return;
        upsertDmMessage(
          (update) => updateMessages(openedFor, update),
          rumorToMessage(rumor, selfPubkey)
        );
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
  }, [client, group, openedFor, selfPubkey, updateMessages]);

  // The lazy group-creation path is the high-cost double-tap target: a
  // second concurrent call would see no group yet, call `client.createGroup`
  // again, and burn a second key package while orphaning the first group.
  // The `creating-group` state commits one render too late to stop it, so
  // the guard lives on useSingleFlight's ref, which holds regardless of
  // callback identity. A send decides from the client, peer and conversation
  // as they are when it is called, never as a kept callback saw them.
  const inputs = useLatestRef({ client, counterpartyPubkey, selfPubkey, accountIndex });
  const send = useSingleFlight((text: string) => {
    const now = inputs.current;
    return sendDmImpl(
      {
        client: now.client,
        opened: openedForNow(machine.current, now),
        current: () => machine.current,
        dispatch,
        updateMessages,
      },
      text
    );
  });

  return {
    isClientReady: !!client,
    isLoading: !!client && !!counterpartyPubkey && isReading(opened),
    isCreatingGroup: opened?.phase === 'creating-group',
    error: errorOf(conversation),
    hasGroup: !!group,
    messages,
    send,
  };
}

async function ingestGroupEvent(
  group: WnGroup,
  event: Parameters<WnGroup['ingest']>[0][number]
): Promise<void> {
  for await (const _result of group.ingest([event])) {
    // applicationMessage events are emitted via the group emitter and handled there.
  }
}

// Bodies live at module scope: they need nothing from render scope beyond the
// setters, and keeping them out of the hook keeps its compiled output lean.
// DM plaintext flows exactly as before.
type WhitenoiseClient = ReturnType<typeof useWhitenoise>['client'];
type WhitenoiseAccountIndex = ReturnType<typeof useWhitenoise>['accountIndex'];

// Sorted insertion — ingest is monotonic by createdAtSec in the steady state,
// but local sends carry now() and historical hydration may interleave, so
// we still find the right slot. O(n) per upsert vs the previous full sort.
// Audit 33.json F-012.
function upsertDmMessage(
  setMessages: (update: SetStateAction<WhitenoiseDmMessage[]>) => void,
  msg: WhitenoiseDmMessage
): void {
  setMessages((prev) => {
    if (prev.some((m) => m.id === msg.id)) return prev;
    const next = [...prev];
    const idx = next.findIndex((m) => m.createdAtSec > msg.createdAtSec);
    if (idx === -1) next.push(msg);
    else next.splice(idx, 0, msg);
    return next;
  });
}

async function loadDmGroupImpl(
  target: OpenedFor,
  isCancelled: () => boolean,
  io: {
    dispatch: (event: ConversationEvent) => void;
    updateMessages: UpdateMessages;
  }
): Promise<void> {
  const { client, counterpartyPubkey, selfPubkey, accountIndex } = target;
  try {
    await client.loadAllGroups();
    const groupIdHex = await new WhitenoiseDmIndex(accountIndex).get(counterpartyPubkey);
    if (!groupIdHex) {
      if (!isCancelled()) {
        io.updateMessages(target, []);
        io.dispatch({ type: 'loaded', for: target, group: null });
      }
      return;
    }
    const found = (await client.getGroup(groupIdHex)) as WnGroup;
    if (isCancelled()) return;
    io.dispatch({ type: 'group-found', for: target, group: found });
    // Hydrate persisted history (own + peer messages saved by marmot).
    try {
      const stored = await found.history.loadMessages();
      if (isCancelled()) return;
      if (selfPubkey) {
        const hydrated = stored.map((s) => rumorToMessage(s.rumor, selfPubkey));
        io.updateMessages(
          target,
          hydrated.sort((a, b) => a.createdAtSec - b.createdAtSec)
        );
      }
    } catch (err) {
      wnLog.warn('whitenoise.dm.history_load_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    io.dispatch({ type: 'loaded', for: target, group: found });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    wnLog.warn('whitenoise.dm.load_failed', { error: message });
    if (!isCancelled()) io.dispatch({ type: 'failed', for: target, error: message });
  }
}

interface SendDmCtx {
  client: WhitenoiseClient;
  /** The conversation, when it was opened for the current client, account and peer. */
  opened: OpenedConversation | null;
  /** The conversation as it is now, after a wait. */
  current: () => Conversation;
  dispatch: (event: ConversationEvent) => void;
  updateMessages: UpdateMessages;
}

async function sendDmImpl(ctx: SendDmCtx, text: string): Promise<void> {
  const { client, opened, dispatch, updateMessages } = ctx;
  if (!text.trim()) return;
  if (!client) {
    dispatch({ type: 'send-without-client' });
    return;
  }
  if (opened?.phase !== 'ready' && opened?.phase !== 'failed') {
    wnLog.warn('whitenoise.dm.send_refused_while_loading');
    return;
  }
  const target = opened.for;
  const { selfPubkey } = target;
  if (!selfPubkey) {
    dispatch({ type: 'failed', for: target, error: 'No active Nostr key' });
    return;
  }
  let read: { group: WnGroup | null } = opened;
  if (opened.phase === 'failed' && !opened.group) {
    // Creating a group here could split an existing conversation in two (the
    // peer gets a second invitation): read it again first, and send only on
    // what that read says. A second failure refuses the send with its error.
    dispatch({ type: 'reload-started', for: target });
    const stillFor = () => {
      const now = ctx.current();
      return now.phase !== 'closed' && now.for === target;
    };
    await loadDmGroupImpl(target, () => !stillFor(), { dispatch, updateMessages });
    const after = ctx.current();
    if (after.phase !== 'ready' || after.for !== target) return;
    read = after;
  }
  dispatch({ type: 'send-started', for: target });

  // Lazy-create the group on first send.
  const activeGroup = read.group ?? (await createDmGroup(ctx, target));
  if (!activeGroup) return;

  const optimisticId = mintLocalId('pending');
  const nowSec = Math.floor(Date.now() / 1000);
  const setMessages = (update: SetStateAction<WhitenoiseDmMessage[]>) =>
    updateMessages(target, update);
  upsertDmMessage(setMessages, {
    id: optimisticId,
    authorPubkey: selfPubkey,
    content: text,
    createdAtSec: nowSec,
    isSelf: true,
    isPending: true,
  });

  try {
    await activeGroup.sendChatMessage(text);
    setMessages((prev) =>
      prev.map((m) => (m.id === optimisticId ? { ...m, isPending: false } : m))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dispatch({ type: 'failed', for: target, error: message });
    wnLog.error('whitenoise.dm.send_failed', { error: message });
    setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
  }
}

/**
 * Groups created this app session whose invitation did not go out, by client
 * and then peer: the next send for that peer invites into the same group
 * instead of making a second one. Kept in memory only, since the DM index must
 * name only a group the peer was invited to (a later open sends into whatever
 * it names, and would never invite); after a restart the group stays unused
 * and the next send creates another.
 */
const uninvitedGroups = new WeakMap<NonNullable<WhitenoiseClient>, Map<string, WnGroup>>();

/**
 * The peer's uninvited group, unless the peer was already added to it: then
 * the add went out and only the welcome did not, which Marmot cannot send
 * again, so the group is let go.
 */
function takeUninvitedGroup(target: OpenedFor): WnGroup | null {
  const kept = uninvitedGroups.get(target.client);
  const group = kept?.get(target.counterpartyPubkey);
  if (!group) return null;
  if (!getGroupMembers(group.state).includes(target.counterpartyPubkey)) return group;
  keepUninvitedGroup(target, null);
  return null;
}

/** Remember `group` as the peer's uninvited group, or forget it once the invitation went out. */
function keepUninvitedGroup(target: OpenedFor, group: WnGroup | null): void {
  const kept = uninvitedGroups.get(target.client);
  if (!group) kept?.delete(target.counterpartyPubkey);
  else if (kept) kept.set(target.counterpartyPubkey, group);
  else uninvitedGroups.set(target.client, new Map([[target.counterpartyPubkey, group]]));
}

/**
 * Create the conversation's group (or take the one whose invitation failed
 * earlier), invite the peer and save the index; null when that failed.
 */
async function createDmGroup(ctx: SendDmCtx, target: OpenedFor): Promise<WnGroup | null> {
  const { dispatch } = ctx;
  const { client, counterpartyPubkey, accountIndex } = target;
  dispatch({ type: 'create-started', for: target });
  try {
    const fallbackRelays = [...appRelays];
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

    const uninvited = takeUninvitedGroup(target);
    const created =
      uninvited ??
      ((await client.createGroup(`dm:${counterpartyPubkey.slice(0, 16)}`, {
        description: 'White Noise 1:1 DM',
        relays: fallbackRelays,
      })) as WnGroup);
    keepUninvitedGroup(target, created);
    await created.inviteByKeyPackageEvent(keyPackageEvent);
    keepUninvitedGroup(target, null);

    await new WhitenoiseDmIndex(accountIndex).set(counterpartyPubkey, bytesToHex(created.id));
    dispatch({ type: 'group-created', for: target, group: created });
    wnLog.info('whitenoise.dm.group_created', {
      groupId: bytesToHex(created.id),
      counterparty: counterpartyPubkey.slice(0, 16),
      reinvited: uninvited !== null,
    });
    return created;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dispatch({ type: 'failed', for: target, error: message });
    wnLog.error('whitenoise.dm.group_create_failed', { error: message });
    return null;
  }
}
