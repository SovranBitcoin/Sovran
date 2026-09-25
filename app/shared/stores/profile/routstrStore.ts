import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createRoutstrPersistence } from '@/shared/lib/routstr/securePersistence';
import { mintLocalId } from '@/shared/lib/id';
import { aiLog, storeLog } from '@/shared/lib/logger';
import { RoutstrModel, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';
import {
  AI_PROVIDER_IDS,
  AI_TIER_IDS,
  PersistedLineupSchema,
  deriveLineup,
  lineupHasEntries,
  lineupProviderIds,
  mergeLineupWithLastKnown,
  type AiLineup,
  type AiProviderId,
  type AiTierId,
  type PersistedLineup,
} from '@/shared/lib/routstr/lineup';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord, tolerantArray } from '@/shared/lib/persist/tolerant';
import { restoreActiveSessionView } from '@/shared/stores/profile/restoreActiveSessionView';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';

// AI tab tier + provider ids — imported from the shared lineup module,
// which is the single source of truth for both this store's selection
// guards and the display metadata in `features/ai/lib/format.ts`. (These
// used to be duplicated literal unions to avoid a feature → store cycle;
// the shared module removed the need.)
type RoutstrTierId = AiTierId;
const TIER_IDS = AI_TIER_IDS;
const DEFAULT_TIER: RoutstrTierId = 'auto';

type RoutstrProviderId = AiProviderId;
const PROVIDER_IDS = AI_PROVIDER_IDS;
const DEFAULT_PROVIDER: RoutstrProviderId = 'openai';

/**
 * Image attached to a chat message. Bounded local-URI metadata ONLY —
 * never base64 payloads (a 4-image message would be ~2MB of base64; the
 * encode happens at send time in `features/ai/lib/attachments.ts` and the
 * result never touches persistence or logs).
 */
export interface ChatAttachment {
  localUri: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface RoutstrMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /**
   * Images attached to a user message (≤4). Bubbles render thumbnails from
   * the local URIs; the send path re-encodes them into OpenAI-compatible
   * `image_url` content parts. A URI can go stale (iOS container-path
   * rotation across reinstalls) — renderers show a placeholder and the
   * send path degrades that turn to text-only.
   */
  attachments?: ChatAttachment[];
  /**
   * Tree-link to the message that prompted this one (user → assistant) or
   * preceded it (assistant → next user). `null` is the conversation root.
   * Optional on the wire so old persisted messages (which predate the field)
   * survive shallow-merge rehydration; the active-path derivation in
   * `features/ai/lib/branching.ts` synthesises one for legacy nodes by
   * treating each message's predecessor in the flat array as its parent.
   */
  parentId?: string | null;
  /** Seconds from stream open to first content token (locally measured). */
  thinkingDurationSec?: number;
  /** Reasoning/thinking text from the model (e.g. DeepSeek R1, o-series). */
  reasoningContent?: string;
  /**
   * Whole sats this assistant message cost the user, derived from a
   * pre/post `checkBalance` diff in `useAiSend`. Set after stream completion
   * so it can land on a subsequent persisted write; rendered next to the
   * "Thought for…" header. Absent on user messages and on assistant
   * messages from before the cost-tracking change shipped.
   */
  costSats?: number;
  /**
   * Optimistic dispatch flag for user messages — `true` between submit and
   * the moment the streaming round-trip resolves (success or error).
   * `UserBubble` renders a spinner/check accordingly so the AI surface
   * matches the chat-app sending → sent vocabulary used by the DM screens.
   * Transient: cleared on rehydrate so a crashed mid-send doesn't leave a
   * stuck spinner on next launch (see `routstrStore.afterHydrate`).
   */
  pending?: boolean;
}

interface RoutstrSession {
  id: string;
  title: string;
  createdAt: number;
  messages: RoutstrMessage[];
  /**
   * Sparse map of `parentId → activeChildId` capturing which sibling is
   * currently visible at each branch point. Defaults to "newest child by
   * timestamp" when no entry exists, so old sessions (which never had
   * branches) render exactly as before. The `assistantRetry` flow writes
   * here when the user picks a sibling via the chevron nav.
   */
  activeChildren?: Record<string, string>;
}

// Cache TTL: 5 minutes
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 300000ms

interface ModelsCache {
  data: RoutstrModel[];
  timestamp: number;
}

/**
 * A Routstr credential this profile has held, kept so the sats behind it stay
 * reachable.
 *
 * A Routstr key is `sk-<sha256(token)>` — a row in ONE node's database — and it
 * is the only bearer instrument for whatever was deposited. Until now a 401
 * deleted it outright, which made that balance permanently unreachable; and
 * because a node repoint leaves the key addressed at a node that never issued
 * it, a 401 was exactly what a repoint produced.
 */
interface RoutstrAccount {
  apiKey: string;
  /** Issuing provider; old records use their map key when this is absent. */
  nodeBaseUrl?: string | null;
  /** Last balance this key was observed to hold, in msats. A hint for the UI,
   *  never a substitute for asking the node. */
  lastKnownBalanceMsats: number | null;
  archivedAt: number;
  /** Set once the balance has been swept back into the wallet. */
  reclaimedAt: number | null;
}

function withArchivedAccount(
  accounts: Record<string, RoutstrAccount>,
  nodeBaseUrl: string | null,
  apiKey: string,
  balanceMsats: number | null
): Record<string, RoutstrAccount> {
  const node = nodeBaseUrl ?? 'unknown';
  const match = Object.entries(accounts).find(
    ([key, account]) => (account.nodeBaseUrl ?? key) === node && account.apiKey === apiKey
  );
  const key = match?.[0] ?? (accounts[node] ? mintLocalId('routstr-account') : node);
  const existing = accounts[key];
  return {
    ...accounts,
    [key]: {
      apiKey,
      nodeBaseUrl,
      lastKnownBalanceMsats: existing?.lastKnownBalanceMsats ?? balanceMsats ?? null,
      archivedAt: existing?.archivedAt ?? Date.now(),
      reclaimedAt: existing?.reclaimedAt ?? null,
    },
  };
}

/** A payment in the window between spending and being paid back. */
interface PendingPayment {
  /** The token as sent. It is the lookup key the node refunds against. */
  encoded: string;
  nodeBaseUrl: string;
  /** Coco send operation, so a token the node never redeemed can be undone. */
  operationId: string;
  startedAt: number;
}

/** What a Routstr provider published about itself, as last seen. */
interface KnownProvider {
  name: string;
  description: string | null;
  version: string | null;
  /** Mints this provider redeems payment tokens from. Empty = publishes none,
   *  which the payment path reads as "any mint". */
  mints: string[];
  /** Whether its catalog carries end-to-end encrypted (Tinfoil) models.
   *  `null` until a catalog has been read for it. */
  e2ee: boolean | null;
  /** The operator's Nostr pubkey, hex. A provider is a counterparty, and this
   *  is what turns it from a hostname into somebody with a reputation — the
   *  same thing a mint's operator npub does on the mint page. */
  pubkey: string | null;
  seenAt: number;
}

interface RoutstrState {
  /** Cashu token or persistent wallet key */
  apiKey: string | null;
  authMode: 'bearer' | 'x-cashu';
  /** Balance in msats */
  balance: number | null;
  /**
   * Superseded credentials, keyed by the node they are BELIEVED to belong to.
   *
   * The key is a hint, not a fact: a repoint can move `nodeBaseUrl` out from
   * under a credential before anything archives it, so the pairing recorded
   * here may be wrong. Reclaim must therefore try each archived key against
   * every node we know of rather than trusting this key — asking a node that
   * never issued it is free and answers `401 key_not_found`.
   */
  legacyAccounts: Record<string, RoutstrAccount>;
  /**
   * Every Routstr provider this profile has seen, with what it published.
   *
   * Discovery is a live fetch from one node's `/v1/providers/`, and that node
   * is sometimes unreachable — which is how a picker that listed 28 providers
   * came back showing two. Remembering them makes the list a floor rather
   * than a snapshot: a failed refresh loses freshness, never the menu.
   *
   * `mints` is the field that matters most. A node redeems tokens only from
   * the mints it publishes, so this is what says whether the user can pay a
   * provider at all — before they pick it and watch a send fail.
   */
  knownProviders: Record<string, KnownProvider>;
  /**
   * A provider the USER chose, which outranks nagg's pick.
   *
   * nagg moves `nodeBaseUrl` on its own — its ladder switches on catalog
   * health, and the app follows. That is right as a default and wrong as a
   * rule: a user who deliberately picked a provider must not be moved off it
   * by a background refresh. `null` means "whatever nagg says", which is the
   * default everyone starts on.
   */
  userNodeBaseUrl: string | null;
  /**
   * Payments handed to a node whose change has not come home yet.
   *
   * Paying per request means spending a token and taking change back in the
   * same round trip. Between those two moments the money is in the node's
   * hands and the only record of it is a response header we have not read. If
   * the app dies there — force quit, crash, OS reclaim — that header never
   * arrives and the change is lost.
   *
   * Recording the token BEFORE sending closes that window, because routstr's
   * refund endpoint accepts the original token and returns that specific
   * request's change (`routstr/balance.py`, the `X-Cashu` branch). So a
   * payment written here can always be asked about again.
   */
  pendingPayments: Record<string, PendingPayment>;
  /**
   * Ask before each message what it could cost.
   *
   * Paying per request LOCKS the node's admission gate for the duration of the
   * call, and on a frontier model that is thousands of sats even when the
   * message itself costs a fraction of one. The user should see that number
   * before it leaves, not discover it in the history.
   *
   * Nothing in the app sets this to `false` any more: the "Always allow"
   * button that did was removed because it was a one-way door (no settings
   * toggle was ever built to undo it). It stays a persisted boolean rather
   * than a constant so re-introducing the setting is a UI change, not a
   * schema change — and `migrate` at version 2 repairs the blobs that already
   * hold `false`.
   */
  confirmSpend: boolean;
  /**
   * Working copy of the active session's messages. The canonical home is
   * `sessions[currentSessionId].messages`; this field is rehydrated from
   * the active session in `afterHydrate` and is *not* persisted on its
   * own. In anonymous mode this is the only copy (no session row exists)
   * and resets to empty across cold starts.
   */
  conversationHistory: RoutstrMessage[];
  /**
   * Working copy of the active session's `activeChildren` map. Same
   * persistence story as `conversationHistory` — rehydrated from the
   * active session, never persisted standalone.
   */
  activeChildren: Record<string, string>;
  /**
   * Legacy single-model selection used by `features/user/screens/UserMessagesScreen`.
   * The AI tab no longer reads this — it uses `selectedTier` instead.
   */
  selectedModel: string | null;
  /**
   * AI tab tier selection. Session-only: deliberately excluded from
   * `partialize` so the app always boots into Auto. The underlying model
   * id is resolved from the (provider, tier) pair in
   * `features/ai/lib/format.ts` at send time.
   */
  selectedTier: RoutstrTierId;
  /**
   * AI tab provider selection (OpenAI / Claude / Grok). Session-only,
   * same rationale as `selectedTier` — boots into the curated default
   * (`openai`) every cold start so the user is never surprised by a
   * carry-over choice they made on a different account or session.
   */
  selectedProvider: RoutstrProviderId;
  modelsCache: ModelsCache | null;
  /**
   * Session-only lineup derived from the last successful catalog fetch
   * (already merged with per-provider last-known fallback). `null` until
   * the first fetch of this app run; readers fall back to
   * `lastKnownLineup?.lineup` and finally to a "models loading" state.
   */
  lineup: AiLineup | null;
  /**
   * Persisted compact snapshot of the most recent derived lineup — the
   * offline fallback that keeps the model menu functional (with prices
   * and vision flags) when the catalog fetch fails. Bounded (≤12 entries),
   * tolerant on parse so it can never take down the rest of this blob.
   */
  lastKnownLineup: PersistedLineup | null;
  /**
   * Timestamp of the last applied nagg-served lineup (`/app/ai-lineup`).
   * Persisted, including invalidation. While set, setCachedModels refreshes the raw
   * catalog cache (pricing lookups, vision flags) but no longer overwrites
   * `lineup` — the server-curated lineup outranks the client derivation.
   */
  serverLineupAt: number | null;
  /**
   * Routstr node origin served by nagg's lineup (e.g.
   * "https://api.routstr.com"), applied to `shared/lib/routstr/api` as the
   * base-URL override on receipt and re-applied on hydrate. Persisted
   * (tolerant, additive) so a node repoint survives offline relaunches.
   * `null` = the built-in default node.
   */
  nodeBaseUrl: string | null;
  sessions: RoutstrSession[];
  currentSessionId: string | null;
  isAnonymousMode: boolean;
}

interface RoutstrActions {
  setApiKey: (apiKey: string) => void;
  clearApiKey: () => void;
  /** Move a credential into `legacyAccounts` so its balance stays reachable.
   *  Idempotent, and never overwrites a richer record with a poorer one. */
  archiveAccount: (nodeBaseUrl: string | null, apiKey: string, balanceMsats: number | null) => void;
  /** Mark an archived credential as swept. Keeps the row (the node may still
   *  hold dust, and a refund is idempotent) but stops it being retried. */
  markAccountReclaimed: (nodeBaseUrl: string) => void;
  applyChangeToken: (token: string) => void;
  invalidateServerLineup: () => void;

  setBalance: (balance: number) => void;
  clearBalance: () => void;

  addMessage: (message: RoutstrMessage) => void;
  updateMessage: (id: string, content: string) => void;
  /** Toggle a message's transient `pending` flag. Used by `useAiSend` to
   *  flip the user-bubble spinner → check once the streaming round-trip
   *  resolves. Transient — never persisted as `true` (see `afterHydrate`). */
  setMessagePending: (id: string, pending: boolean) => void;
  /** Persist the final assistant payload (content + reasoning + thinking
   *  duration + cost) in one atomic write, replacing the placeholder body
   *  added at stream open. Preserves `id`, `parentId`, `role`, and
   *  `timestamp` so message identity / branch links don't shift. */
  finalizeAssistantMessage: (
    id: string,
    fields: {
      content: string;
      thinkingDurationSec?: number;
      reasoningContent?: string;
      costSats?: number;
    }
  ) => void;
  removeMessages: (ids: Set<string>) => void;
  /** Pick which sibling is shown at a branch point. Writes through to
   *  the current session's `activeChildren` so the choice survives across
   *  app restarts. */
  setActiveBranch: (parentId: string, childId: string) => void;
  /** Atomic write of the (provider, tier) pair — used by the tabbed
   *  picker so flipping a row doesn't briefly leave the store in a
   *  half-updated state between two `set()` calls. */
  setSelectedSlot: (slot: { provider: RoutstrProviderId; tier: RoutstrTierId }) => void;

  setCachedModels: (models: RoutstrModel[]) => void;
  /** Apply the nagg-served lineup (already mapped via
   *  `lineupFromNaggPayload`). Takes precedence over `setCachedModels`'
   *  derivation until invalidation and persists the snapshot +
   *  node override. */
  setServerLineup: (params: {
    lineup: AiLineup;
    nodeBaseUrl: string | null;
    authMode?: 'bearer' | 'x-cashu';
  }) => boolean;
  /** Pin the app to a provider, or pass `null` to follow nagg again. Drops the
   *  server lineup and model cache so the menu re-derives from the new node's
   *  own catalog rather than showing another node's models. */
  /** Merge what a discovery pass (or a direct `/v1/info` read) learned about a
   *  provider. Additive per field: a pass that does not know `e2ee` must not
   *  erase an earlier answer. */
  rememberProviders: (providers: Record<string, Partial<KnownProvider>>) => void;
  setUserNode: (nodeBaseUrl: string | null) => void;
  /** Record a payment before it leaves, so its change stays recoverable. */
  beginPayment: (id: string, payment: PendingPayment) => void;
  /** Forget a payment whose change is home, or which was never taken. */
  settlePayment: (id: string) => void;
  isCacheStale: (nowMs?: number) => boolean;

  createSession: () => string;
  switchSession: (sessionId: string) => void;
  updateCurrentSessionTitle: () => void;
}

type RoutstrStore = RoutstrState & RoutstrActions;

type SessionMirrorState = Pick<
  RoutstrState,
  'conversationHistory' | 'isAnonymousMode' | 'currentSessionId' | 'sessions'
>;

/**
 * Set `conversationHistory` to `messages` and mirror the same list into the
 * current session, unless anonymous mode is on (sessions stay untouched).
 */
function withSessionMirror(
  state: SessionMirrorState,
  messages: RoutstrMessage[]
): Partial<SessionMirrorState> {
  if (state.isAnonymousMode || !state.currentSessionId) {
    return { conversationHistory: messages };
  }
  return {
    conversationHistory: messages,
    sessions: state.sessions.map((session) =>
      session.id === state.currentSessionId ? { ...session, messages } : session
    ),
  };
}

/**
 * Apply a per-message transform to the conversation AND to the current
 * session's own message list (mapped independently, not replaced wholesale),
 * unless anonymous mode is on.
 */
function mapSessionMessages(
  state: SessionMirrorState,
  apply: (msg: RoutstrMessage) => RoutstrMessage
): Partial<SessionMirrorState> {
  const conversationHistory = state.conversationHistory.map(apply);
  if (state.isAnonymousMode || !state.currentSessionId) {
    return { conversationHistory };
  }
  return {
    conversationHistory,
    sessions: state.sessions.map((session) =>
      session.id === state.currentSessionId
        ? { ...session, messages: session.messages.map(apply) }
        : session
    ),
  };
}

// Tightly bounded + tolerant: one malformed attachment must never fail the
// whole-blob parse (which would wipe sessions AND the apiKey — the exact
// failure class documented on `createMergeWithSchema`). Invalid arrays
// collapse to [] and drop only the attachments, never the message.
const PersistedChatAttachment = z.object({
  localUri: z.string().max(2048),
  mimeType: z.string().max(64),
  width: z.number().int().nonnegative().catch(0),
  height: z.number().int().nonnegative().catch(0),
});

const PersistedRoutstrMessage = z.looseObject({
  id: z.string().max(128),
  // Deliberately bare: `role` is attribution — catching a bad value to
  // 'assistant' would re-attribute the user's text as model output and
  // replay it to the model as its own words. The per-message safeParse in
  // PersistedRoutstrMessages drops just the bad message instead of the blob.
  // ast-grep-ignore: persisted-enum-needs-catch
  role: z.enum(['user', 'assistant']),
  content: z.string().max(65_536),
  timestamp: z.number().int().nonnegative(),
  attachments: z
    .array(PersistedChatAttachment)
    .max(4)
    .optional()
    .catch(() => []),
  parentId: z.string().max(128).nullable().optional(),
  thinkingDurationSec: z.number().nonnegative().optional(),
  reasoningContent: z.string().max(65_536).optional(),
  costSats: z.number().int().nonnegative().optional(),
  pending: z.boolean().optional(),
});

// A message whose role can't be trusted is dropped alone (a hole in the
// transcript beats mis-attributed model context); the rest of the session
// survives. Dropping a branch parent degrades branch nav for its children,
// which is the acceptable cost.
/**
 * Capacity ceilings, shared by the schema below and by `partialize`.
 *
 * They have to be one constant each, used at both ends. The schema said 1024
 * sessions and `createSession` prepended without a cap, so session 1025 made
 * the blob fail parse — and `createMergeWithSchema` is all-or-nothing, so the
 * next launch discarded the WHOLE store: the API key, every session and its
 * transcript, the last-known lineup and the node override. Tolerance cannot
 * help here (a `.max()` breach rejects the array itself, not an entry), so the
 * projection is what has to respect the ceiling.
 *
 * Sessions are newest-first, so the newest survive; messages are chronological,
 * so the tail does. Dropping the head of a transcript degrades branch nav for
 * whatever pointed at it, which is the cost `PersistedRoutstrMessages` already
 * accepts for a dropped parent.
 */
const MAX_PERSISTED_SESSIONS = 1024;
const MAX_PERSISTED_SESSION_MESSAGES = 10_000;

const PersistedRoutstrMessages = tolerantArray(
  PersistedRoutstrMessage,
  MAX_PERSISTED_SESSION_MESSAGES
);

/**
 * Archived credentials, bounded to what the schema accepts.
 *
 * The ceiling is applied here, like `boundedSessions`, so the blob is trimmed
 * at the one point where store state becomes persisted state rather than at
 * each writer. Eviction is deliberately NOT least-recently-used: a row is a
 * candidate only once it has been reclaimed, because the alternative is
 * deleting the one string that can reach a user's money. If every row is still
 * unreclaimed the record is left over its ceiling — an oversized blob is
 * recoverable; a deleted key is not.
 */
/**
 * Keep the directory bounded, dropping the least recently seen first.
 *
 * Plain recency is right here in a way it is not for `legacyAccounts`: a
 * provider row holds no money, so losing the stalest one costs a menu entry
 * that the next discovery pass restores.
 */
function boundedProviders(providers: Record<string, KnownProvider>): Record<string, KnownProvider> {
  const entries = Object.entries(providers);
  if (entries.length <= MAX_KNOWN_PROVIDERS) return providers;
  return Object.fromEntries(
    entries.sort(([, a], [, b]) => b.seenAt - a.seenAt).slice(0, MAX_KNOWN_PROVIDERS)
  );
}

function boundedAccounts(accounts: Record<string, RoutstrAccount>): Record<string, RoutstrAccount> {
  const entries = Object.entries(accounts);
  if (entries.length <= MAX_ARCHIVED_ACCOUNTS) return accounts;
  const reclaimed = entries
    .filter(([, a]) => a.reclaimedAt != null)
    .sort((a, b) => (a[1].reclaimedAt ?? 0) - (b[1].reclaimedAt ?? 0));
  const dropCount = Math.min(entries.length - MAX_ARCHIVED_ACCOUNTS, reclaimed.length);
  if (dropCount === 0) return accounts;
  const dropped = new Set(reclaimed.slice(0, dropCount).map(([key]) => key));
  storeLog.debug('store.routstr.accounts_evicted', { dropped: dropped.size });
  return Object.fromEntries(entries.filter(([key]) => !dropped.has(key)));
}

/**
 * The session list, bounded to what the schema accepts.
 *
 * Returns the SAME array when nothing exceeds a ceiling — which is every write
 * until a user has 1024 sessions or a 10,000-turn transcript. `persist` calls
 * `partialize` on every state change, so the common path stays a pair of length
 * checks and no allocation. (The serialisation that follows is already linear
 * in the whole persisted state, so even the scan costs nothing against it.)
 *
 * The active session is kept whichever end of the list it is at: trimming the
 * one the user is looking at would drop the turns they are adding right now.
 * Truncating a transcript also prunes `activeChildren` entries whose parent
 * went with the head, so branch navigation is left with no key pointing at a
 * message that is not there.
 */
function boundedSessions(
  sessions: RoutstrSession[],
  currentSessionId: string | null
): RoutstrSession[] {
  const tooMany = sessions.length > MAX_PERSISTED_SESSIONS;
  if (!tooMany && !sessions.some((s) => s.messages.length > MAX_PERSISTED_SESSION_MESSAGES)) {
    return sessions;
  }
  let kept = sessions;
  if (tooMany) {
    kept = sessions.slice(0, MAX_PERSISTED_SESSIONS);
    const active = sessions.find((session) => session.id === currentSessionId);
    if (active && !kept.includes(active)) kept = [...kept.slice(0, -1), active];
  }
  return kept.map((session) =>
    session.messages.length > MAX_PERSISTED_SESSION_MESSAGES ? truncateTranscript(session) : session
  );
}

/**
 * Keep the newest turns, and leave no branch reference aimed at a dropped one.
 *
 * Both halves matter. A retained message whose `parentId` went with the head
 * is an orphan `buildBranchIndex` cannot root, so its siblings collapse into
 * one arbitrary choice and the others become unreachable; re-parenting it to
 * null makes it a root, which is what it now is. An `activeChildren` entry
 * naming either a dropped parent or a dropped child is a saved branch choice
 * pointing at nothing.
 */
function truncateTranscript(session: RoutstrSession): RoutstrSession {
  const kept = session.messages.slice(-MAX_PERSISTED_SESSION_MESSAGES);
  const present = new Set(kept.map((message) => message.id));
  const messages = kept.map((message) =>
    message.parentId != null && !present.has(message.parentId)
      ? { ...message, parentId: null }
      : message
  );
  if (!session.activeChildren) return { ...session, messages };
  const activeChildren = Object.fromEntries(
    Object.entries(session.activeChildren).filter(
      ([parentId, childId]) => present.has(parentId) && present.has(childId)
    )
  );
  return { ...session, messages, activeChildren };
}

const PersistedRoutstrSession = z.looseObject({
  id: z.string().max(128),
  title: z.string().max(512),
  createdAt: z.number().int().nonnegative(),
  messages: PersistedRoutstrMessages,
  activeChildren: z.record(z.string().max(128), z.string().max(128)).optional(),
});

/**
 * Archived credentials never expire on a clock. Eviction is balance-aware by
 * construction: only rows already reclaimed, or holding no key, are
 * candidates. A pure LRU here would delete the one string that can reach a
 * user's money, which is the failure this whole record exists to prevent.
 */
/** Capped at roughly four times what a healthy directory returns today (42),
 *  so a hostile or runaway directory cannot grow the blob without bound while
 *  a real network still fits comfortably. */
const MAX_KNOWN_PROVIDERS = 160;

const PersistedKnownProvider = z.looseObject({
  name: z.string().max(200).default('').catch(''),
  description: z.string().max(2000).nullable().default(null).catch(null),
  version: z.string().max(64).nullable().default(null).catch(null),
  /** Mints this provider redeems payment tokens from. Empty means it does not
   *  publish a list, which reads as "any mint". */
  mints: tolerantArray(z.string().max(512), 32).default([]).catch([]),
  /** True when its catalog carried at least one `tinfoil-` model, so the
   *  picker can say which providers can answer without reading the prompt.
   *  `null` until a catalog has been read for it — absence of evidence. */
  e2ee: z.boolean().nullable().default(null).catch(null),
  pubkey: z.string().max(128).nullable().default(null).catch(null),
  seenAt: z.number().int().nonnegative().default(0).catch(0),
});

const MAX_ARCHIVED_ACCOUNTS = 32;

const PersistedRoutstrAccount = z.looseObject({
  apiKey: z.string().max(8192),
  nodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
  lastKnownBalanceMsats: z.number().nullable().default(null).catch(null),
  archivedAt: z.number().int().nonnegative().default(0).catch(0),
  reclaimedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
});

const PersistedPendingPayment = z.looseObject({
  encoded: z.string().max(65_536),
  nodeBaseUrl: z.string().max(512),
  operationId: z.string().max(128),
  startedAt: z.number().int().nonnegative().default(0).catch(0),
});

const PersistedRoutstrStore = z.object({
  authMode: z.enum(['bearer', 'x-cashu']).default('bearer').catch('bearer'),
  serverLineupAt: z.number().int().nonnegative().nullable().default(null).catch(null),
  apiKey: z.string().max(8192).nullable().default(null),
  balance: z.number().nullable().default(null),
  selectedModel: z.string().max(256).nullable().default(null),
  sessions: z.array(PersistedRoutstrSession).max(MAX_PERSISTED_SESSIONS).default([]),
  currentSessionId: z.string().max(128).nullable().default(null),
  // Additive + tolerant (no version bump needed): a malformed snapshot
  // parses to null and the menu just re-derives on next fetch.
  lastKnownLineup: PersistedLineupSchema.nullable().default(null).catch(null),
  // Additive + tolerant: a malformed value parses to null and the app
  // falls back to the built-in default node.
  nodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
  // Additive, and `tolerantRecord` rather than a bare `z.record` on purpose:
  // under `z.record` one malformed row rejects the record, and through
  // `createMergeWithSchema` the whole blob — so a single bad entry would take
  // every OTHER provider's key with it. Here it loses one row.
  legacyAccounts: tolerantRecord(z.string().max(512), PersistedRoutstrAccount),
  // Additive + tolerant: a malformed value parses to null, which simply means
  // "follow nagg" — the default.
  userNodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
  // Additive + tolerant, same reasoning as `legacyAccounts`: one malformed
  // provider row must cost that row, not the directory.
  knownProviders: tolerantRecord(z.string().max(512), PersistedKnownProvider),
  pendingPayments: tolerantRecord(z.string().max(128), PersistedPendingPayment),
  // Additive, and defaulting to ON: spending is the kind of thing that should
  // have to be turned off deliberately, never left off by a parse failure.
  confirmSpend: z.boolean().default(true).catch(true),
});

export const useRoutstrStore = create<RoutstrStore>()(
  persist(
    (set, get) => ({
      apiKey: null,
      authMode: 'bearer',
      balance: null,
      conversationHistory: [],
      activeChildren: {},
      selectedModel: null,
      selectedTier: DEFAULT_TIER,
      selectedProvider: DEFAULT_PROVIDER,
      modelsCache: null,
      lineup: null,
      lastKnownLineup: null,
      serverLineupAt: null,
      nodeBaseUrl: null,
      userNodeBaseUrl: null,
      knownProviders: {},
      pendingPayments: {},
      confirmSpend: true,
      legacyAccounts: {},
      sessions: [],
      currentSessionId: null,
      isAnonymousMode: false,

      setApiKey: (apiKey: string) => {
        storeLog.info('store.routstr.set_api_key');
        set({ apiKey });
      },

      archiveAccount: (nodeBaseUrl, apiKey, balanceMsats) => {
        if (!apiKey) return;
        set((state) => ({
          legacyAccounts: withArchivedAccount(
            state.legacyAccounts,
            nodeBaseUrl,
            apiKey,
            balanceMsats
          ),
        }));
      },

      markAccountReclaimed: (nodeBaseUrl) => {
        set((state) => {
          const existing = state.legacyAccounts[nodeBaseUrl];
          if (!existing) return state;
          storeLog.info('store.routstr.account_reclaimed', { node: nodeBaseUrl });
          return {
            legacyAccounts: {
              ...state.legacyAccounts,
              [nodeBaseUrl]: { ...existing, reclaimedAt: Date.now(), lastKnownBalanceMsats: 0 },
            },
          };
        });
      },

      applyChangeToken: (token) => {
        if (!get().apiKey?.startsWith('cashu') || !token.startsWith('cashu')) return;
        set({ apiKey: token });
        aiLog.info('routstr.change_token.applied');
      },

      invalidateServerLineup: () => {
        set({ serverLineupAt: null, lineup: null });
      },

      clearApiKey: () => {
        storeLog.info('store.routstr.clear_api_key');
        set({ apiKey: null });
      },

      setBalance: (balance: number) => {
        storeLog.debug('store.routstr.set_balance', { balance });
        set({ balance });
      },

      clearBalance: () => {
        storeLog.info('store.routstr.clear_balance');
        set({ balance: null });
      },

      addMessage: (message: RoutstrMessage) => {
        storeLog.debug('store.routstr.add_message', { role: message.role });
        set((state) => withSessionMirror(state, [...state.conversationHistory, message]));
      },

      removeMessages: (ids: Set<string>) => {
        storeLog.debug('store.routstr.remove_messages', { count: ids.size });
        set((state) =>
          withSessionMirror(
            state,
            state.conversationHistory.filter((msg) => !ids.has(msg.id))
          )
        );
      },

      setMessagePending: (id: string, pending: boolean) => {
        set((state) =>
          mapSessionMessages(state, (msg) => (msg.id === id ? { ...msg, pending } : msg))
        );
      },

      updateMessage: (id: string, content: string) => {
        storeLog.debug('store.routstr.update_message', { id, contentLength: content.length });
        set((state) =>
          withSessionMirror(
            state,
            state.conversationHistory.map((msg) => (msg.id === id ? { ...msg, content } : msg))
          )
        );
      },

      finalizeAssistantMessage: (id, fields) => {
        storeLog.debug('store.routstr.finalize_assistant', {
          id,
          contentLength: fields.content.length,
          hasReasoning: !!fields.reasoningContent,
          costSats: fields.costSats,
        });
        set((state) =>
          mapSessionMessages(state, (msg) =>
            msg.id === id
              ? {
                  ...msg,
                  content: fields.content,
                  thinkingDurationSec: fields.thinkingDurationSec ?? msg.thinkingDurationSec,
                  reasoningContent: fields.reasoningContent ?? msg.reasoningContent,
                  costSats: fields.costSats ?? msg.costSats,
                }
              : msg
          )
        );
      },

      setActiveBranch: (parentId, childId) => {
        storeLog.info('store.routstr.set_active_branch', { parentId, childId });
        set((state) => {
          const next = { ...state.activeChildren, [parentId]: childId };
          if (state.isAnonymousMode) return { activeChildren: next };
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId ? { ...session, activeChildren: next } : session
            );
            return { activeChildren: next, sessions: updatedSessions };
          }
          return { activeChildren: next };
        });
      },

      setSelectedSlot: (slot) => {
        // A vendor is valid when the live lineup offers it, not when it is one
        // of four names compiled into the app: the menu now comes from the
        // catalog, so its ids do too. The known-four remain acceptable so a
        // selection survives a lineup that has not landed yet.
        const lineup = get().lineup ?? get().lastKnownLineup?.lineup ?? null;
        const offered = new Set<string>([...PROVIDER_IDS, ...lineupProviderIds(lineup)]);
        const safeProvider = offered.has(slot.provider) ? slot.provider : DEFAULT_PROVIDER;
        const safeTier = TIER_IDS.includes(slot.tier) ? slot.tier : DEFAULT_TIER;
        storeLog.info('store.routstr.set_slot', {
          provider: safeProvider,
          tier: safeTier,
        });
        set({ selectedProvider: safeProvider, selectedTier: safeTier });
      },

      setCachedModels: (models: RoutstrModel[]) => {
        storeLog.debug('store.routstr.set_cached_models', { count: models.length });
        // Derive the (provider × tier) lineup alongside the raw cache and
        // persist a compact last-known snapshot, so the model menu keeps
        // prices + vision flags across offline relaunches. Per-provider
        // zero-row results (catalog drift on a 200 — the failure class
        // that produced "cost unavailable") substitute from the previous
        // snapshot, marked `lastKnown`.
        // A nagg-served lineup outranks derivation until invalidated by
        // model rejection or a failed refresh after seven days. Keep the raw catalog (pricing lookups,
        // vision flags, display names) but leave `lineup` untouched.
        //
        // The timestamp alone is NOT enough to claim that precedence.
        // `serverLineupAt` is persisted and `lineup` is session-only, so after
        // a cold start the app can hold a day-fresh timestamp and no lineup at
        // all — and `refreshRoutstrLineup('foreground')` skips a
        // `serverLineupAt` that young. Deferring to an absent lineup in that
        // state vetoes the only other source of a menu for a full day, which
        // is one of the ways the picker got stuck on "Models loading" with a
        // full catalog already in `modelsCache`. Defer to a server lineup that
        // is actually in memory; otherwise derive.
        const held = get().lineup;
        if (get().serverLineupAt != null && lineupHasEntries(held)) {
          aiLog.debug('ai.lineup.derive_skipped_server_lineup');
          set({ modelsCache: { data: models, timestamp: Date.now() } });
          return;
        }
        const { lineup: derived, stats } = deriveLineup(models);
        const snapshot = get().lastKnownLineup;
        const previous = snapshot?.nodeBaseUrl === get().nodeBaseUrl ? snapshot : null;
        const merged = mergeLineupWithLastKnown(derived, previous?.lineup ?? null);
        const filled = lineupHasEntries(merged);
        aiLog.info('ai.lineup.derived', {
          catalogSize: models.length,
          totalQualifying: stats.totalQualifying,
          perProvider: stats.perProvider,
          substitutedProviders: Object.keys(merged).filter(
            (p) => merged[p] !== derived[p] // mergeLineupWithLastKnown replaces the block reference
          ),
          allProvidersEmpty: !lineupHasEntries(derived),
          keptPreviousLineup: !filled && lineupHasEntries(held),
        });
        const now = Date.now();
        set({
          modelsCache: { data: models, timestamp: now },
          // A catalog that qualifies nothing is not an upgrade on a menu that
          // works. Node catalogs swing hard within one session (582 models one
          // read, 10 the next), and an empty derivation is truthy — it would
          // replace a working lineup AND shadow the `lastKnownLineup` fallback
          // that every reader falls through to, leaving a menu that cannot
          // recover until something else happens to refetch.
          lineup: filled || !lineupHasEntries(held) ? merged : held,
          lastKnownLineup: filled
            ? { derivedAt: now, lineup: merged, nodeBaseUrl: get().nodeBaseUrl }
            : previous,
        });
      },

      setServerLineup: ({ lineup, nodeBaseUrl, authMode }) => {
        const pinned = get().userNodeBaseUrl;
        if (
          pinned &&
          (!nodeBaseUrl || normalizeNodeUrl(pinned) !== normalizeNodeUrl(nodeBaseUrl))
        ) {
          return false;
        }
        if (!lineupHasEntries(lineup)) {
          aiLog.warn('ai.lineup.server_empty');
          return false;
        }
        aiLog.info('ai.lineup.server_applied', {
          nodeChanged: nodeBaseUrl !== get().nodeBaseUrl,
          providers: lineupProviderIds(lineup).filter((p) =>
            TIER_IDS.some((t) => lineup[p]?.[t] != null)
          ),
        });
        const now = Date.now();
        // A catalog is authoritative only for the node that served it.
        if (pinned) {
          setRoutstrNodeBaseUrl(pinned);
          set({
            lineup,
            serverLineupAt: now,
            lastKnownLineup: { derivedAt: now, lineup, nodeBaseUrl: pinned },
          });
          return true;
        }
        // nagg's own node is remembered as a discovery seed, never adopted as
        // the request target: the user picks who gets paid, and this app does
        // not get to recommend one on their behalf.
        const previous = get();
        const moving = nodeBaseUrl !== previous.nodeBaseUrl;
        set({
          lineup,
          serverLineupAt: now,
          nodeBaseUrl,
          authMode: authMode ?? (nodeBaseUrl === get().nodeBaseUrl ? get().authMode : 'bearer'),
          modelsCache: nodeBaseUrl === get().nodeBaseUrl ? get().modelsCache : null,
          lastKnownLineup: { derivedAt: now, lineup, nodeBaseUrl },
          ...(moving
            ? {
                apiKey: null,
                balance: null,
                legacyAccounts: previous.apiKey
                  ? withArchivedAccount(
                      previous.legacyAccounts,
                      previous.nodeBaseUrl,
                      previous.apiKey,
                      previous.balance
                    )
                  : previous.legacyAccounts,
              }
            : {}),
        });
        return true;
      },

      beginPayment: (id, payment) => {
        set((state) => ({ pendingPayments: { ...state.pendingPayments, [id]: payment } }));
      },

      settlePayment: (id) => {
        set((state) => {
          if (!Object.hasOwn(state.pendingPayments, id)) return state;
          const next = { ...state.pendingPayments };
          delete next[id];
          return { pendingPayments: next };
        });
      },

      rememberProviders: (providers) => {
        const entries = Object.entries(providers);
        if (entries.length === 0) return;
        set((state) => {
          const next = { ...state.knownProviders };
          for (const [baseUrl, patch] of entries) {
            const existing = next[baseUrl];
            next[baseUrl] = {
              name: patch.name || existing?.name || baseUrl.replace(/^https:\/\//, ''),
              description: patch.description ?? existing?.description ?? null,
              version: patch.version ?? existing?.version ?? null,
              mints: patch.mints ?? existing?.mints ?? [],
              // Only a catalog read can answer this, so a discovery pass that
              // does not know must leave the last answer alone.
              e2ee: patch.e2ee ?? existing?.e2ee ?? null,
              pubkey: patch.pubkey ?? existing?.pubkey ?? null,
              seenAt: Date.now(),
            };
          }
          storeLog.debug('store.routstr.providers_remembered', { count: entries.length });
          return { knownProviders: boundedProviders(next) };
        });
      },

      setUserNode: (nodeBaseUrl) => {
        const next = nodeBaseUrl ? normalizeNodeUrl(nodeBaseUrl) || null : null;
        storeLog.info('store.routstr.user_node_set', { pinned: next != null });
        setRoutstrNodeBaseUrl(next);
        const previous = get();
        const moving = next !== null && next !== previous.nodeBaseUrl;
        set({
          userNodeBaseUrl: next,
          // The model menu is per node. Clearing the server lineup and the
          // catalog forces a re-derive from whichever node is now in play,
          // rather than offering another node's models against it.
          lineup: null,
          serverLineupAt: null,
          modelsCache: null,
          lastKnownLineup:
            get().lastKnownLineup?.nodeBaseUrl === next ? get().lastKnownLineup : null,
          ...(next != null ? { nodeBaseUrl: next } : {}),
          ...(moving
            ? {
                apiKey: null,
                balance: null,
                legacyAccounts: previous.apiKey
                  ? withArchivedAccount(
                      previous.legacyAccounts,
                      previous.nodeBaseUrl,
                      previous.apiKey,
                      previous.balance
                    )
                  : previous.legacyAccounts,
              }
            : {}),
        });
      },

      isCacheStale: (nowMs: number = Date.now()) => {
        const cache = get().modelsCache;
        if (!cache) return true;
        return nowMs - cache.timestamp > MODELS_CACHE_TTL_MS;
      },

      createSession: () => {
        const sessionId = mintLocalId('session');
        storeLog.info('store.routstr.create_session', { sessionId });
        const newSession: RoutstrSession = {
          id: sessionId,
          title: 'New Session',
          createdAt: Date.now(),
          messages: [],
          activeChildren: {},
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: sessionId,
          conversationHistory: [],
          activeChildren: {},
        }));
        return sessionId;
      },

      switchSession: (sessionId: string) => {
        storeLog.info('store.routstr.switch_session', { sessionId });
        const state = get();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          set({
            currentSessionId: sessionId,
            conversationHistory: session.messages,
            activeChildren: session.activeChildren ?? {},
          });
        } else {
          storeLog.warn('store.routstr.session_not_found', { sessionId });
        }
      },

      updateCurrentSessionTitle: () => {
        const state = get();
        if (!state.currentSessionId) return;

        // Find first user message to use as title
        const firstUserMessage = state.conversationHistory.find((msg) => msg.role === 'user');
        if (firstUserMessage) {
          const title =
            firstUserMessage.content.length > 50
              ? firstUserMessage.content.substring(0, 50) + '...'
              : firstUserMessage.content;

          storeLog.debug('store.routstr.update_session_title', {
            sessionId: state.currentSessionId,
            title,
          });
          const updatedSessions = state.sessions.map((session) =>
            session.id === state.currentSessionId ? { ...session, title } : session
          );
          set({ sessions: updatedSessions });
        }
      },
    }),
    persistConfig({
      name: 'routstr-store',
      storage: createRoutstrPersistence(),
      schema: PersistedRoutstrStore,
      // v2: bring back the spend prompt for everyone who had turned it off.
      //
      // `confirmSpend: false` could only ever be written by the "Always allow"
      // button, and the settings toggle its own copy promised ("you can turn
      // this back on in settings") was never built. Removing the button
      // without this would leave exactly those users — the ones who opted out
      // — permanently unprompted before every spend, which is the opposite of
      // what removing it is for. The field is kept (not dropped) so the blob's
      // shape is unchanged and nothing else in it is at risk.
      version: 2,
      migrate: (state, version) => {
        const blob: Record<string, unknown> = { ...(state as Record<string, unknown> | null) };
        if (version < 2) blob.confirmSpend = true;
        return blob;
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        authMode: state.authMode,
        serverLineupAt: state.serverLineupAt,
        balance: state.balance,
        selectedModel: state.selectedModel,
        // The ceilings are applied HERE, not at each writer. Sessions grow in
        // one place but a session's messages are mirrored from
        // `conversationHistory` through several, and a cap repeated at every
        // writer is a cap that drifts. `partialize` is the one point where
        // store state becomes the persisted blob, so it is where the blob has
        // to be made to fit. Live state is untouched: the running session
        // keeps its full transcript for as long as the app is open.
        sessions: boundedSessions(state.sessions, state.currentSessionId),
        currentSessionId: state.currentSessionId,
        lastKnownLineup: state.lastKnownLineup,
        nodeBaseUrl: state.nodeBaseUrl,
        legacyAccounts: boundedAccounts(state.legacyAccounts),
        knownProviders: boundedProviders(state.knownProviders),
        userNodeBaseUrl: state.userNodeBaseUrl,
        // Age is not evidence of settlement. Keep the only recovery token
        // until the receive/refund path explicitly completes this payment.
        pendingPayments: state.pendingPayments,
        confirmSpend: state.confirmSpend,
      }),
      afterHydrate: (state) => {
        if (!state) return;
        // Re-apply the nagg-served node override before any Routstr call
        // this session — a repointed node must survive offline relaunches.
        state.nodeBaseUrl = state.nodeBaseUrl ?? state.lastKnownLineup?.nodeBaseUrl ?? null;
        // A pinned provider wins over whatever the last lineup left behind —
        // the point of pinning is that a background refresh cannot move the
        // user off it, and a relaunch is not an exception.
        setRoutstrNodeBaseUrl(state.userNodeBaseUrl);
        if (
          state.userNodeBaseUrl &&
          state.lastKnownLineup &&
          normalizeNodeUrl(state.lastKnownLineup.nodeBaseUrl ?? '') !==
            normalizeNodeUrl(state.userNodeBaseUrl)
        ) {
          state.lastKnownLineup = null;
          state.serverLineupAt = null;
        }
        // Record the live credential in the archive on the way in, so it is
        // already recoverable before anything this session can clear it. A
        // blob written before `legacyAccounts` existed has no other way to
        // learn about its own key, and that key may be the only route back to
        // a balance sitting on a node the app has since been repointed away
        // from. Idempotent: an existing row is left alone.
        state.legacyAccounts ??= {};
        const liveKey = state.apiKey;
        if (liveKey) {
          state.legacyAccounts = withArchivedAccount(
            state.legacyAccounts,
            state.nodeBaseUrl,
            liveKey,
            state.balance
          );
        }
        // Drop transient `pending: true` flags — any user message marked
        // pending at persist time (e.g. app killed mid-send) resolves to
        // "not in flight" on the next launch so the user sees a static
        // check rather than a stuck spinner.
        for (const session of state.sessions ?? []) {
          for (const m of session.messages) {
            if (m.pending) m.pending = false;
          }
        }
        restoreActiveSessionView(state);
      },
    })
  )
);
