import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { aiLog, storeLog } from '@/shared/lib/logger';
import { RoutstrModel, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';
import {
  AI_PROVIDER_IDS,
  AI_TIER_IDS,
  PersistedLineupSchema,
  deriveLineup,
  lineupHasEntries,
  mergeLineupWithLastKnown,
  type AiLineup,
  type AiProviderId,
  type AiTierId,
  type PersistedLineup,
} from '@/shared/lib/routstr/lineup';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { restoreActiveSessionView } from '@/shared/stores/profile/restoreActiveSessionView';

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
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 300000ms

interface ModelsCache {
  data: RoutstrModel[];
  timestamp: number;
}

interface RoutstrState {
  /** Cashu token or persistent wallet key */
  apiKey: string | null;
  /** Balance in msats */
  balance: number | null;
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
   * Session-only. While set, `setCachedModels` keeps refreshing the raw
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
   *  derivation for the rest of the session and persists the snapshot +
   *  node override. */
  setServerLineup: (params: { lineup: AiLineup; nodeBaseUrl: string | null }) => void;
  isCacheStale: () => boolean;

  createSession: () => string;
  switchSession: (sessionId: string) => void;
  updateCurrentSessionTitle: () => void;
}

type RoutstrStore = RoutstrState & RoutstrActions;

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
  role: z.enum(['user', 'assistant']),
  content: z.string().max(65_536),
  timestamp: z.number().int().nonnegative(),
  attachments: z.array(PersistedChatAttachment).max(4).optional().catch([]),
  parentId: z.string().max(128).nullable().optional(),
  thinkingDurationSec: z.number().nonnegative().optional(),
  reasoningContent: z.string().max(65_536).optional(),
  costSats: z.number().int().nonnegative().optional(),
  pending: z.boolean().optional(),
});

const PersistedRoutstrSession = z.looseObject({
  id: z.string().max(128),
  title: z.string().max(512),
  createdAt: z.number().int().nonnegative(),
  messages: z.array(PersistedRoutstrMessage).max(10_000),
  activeChildren: z.record(z.string().max(128), z.string().max(128)).optional(),
});

const PersistedRoutstrStore = z.object({
  apiKey: z.string().max(8192).nullable().default(null),
  balance: z.number().nullable().default(null),
  selectedModel: z.string().max(256).nullable().default(null),
  sessions: z.array(PersistedRoutstrSession).max(1024).default([]),
  currentSessionId: z.string().max(128).nullable().default(null),
  // Additive + tolerant (no version bump needed): a malformed snapshot
  // parses to null and the menu just re-derives on next fetch.
  lastKnownLineup: PersistedLineupSchema.nullable().default(null).catch(null),
  // Additive + tolerant: a malformed value parses to null and the app
  // falls back to the built-in default node.
  nodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
});

export const useRoutstrStore = create<RoutstrStore>()(
  persist(
    (set, get) => ({
      apiKey: null,
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
      sessions: [],
      currentSessionId: null,
      isAnonymousMode: false,

      setApiKey: (apiKey: string) => {
        storeLog.info('store.routstr.set_api_key');
        set({ apiKey });
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
        set((state) => {
          const newHistory = [...state.conversationHistory, message];
          // Skip saving to sessions if in anonymous mode
          if (state.isAnonymousMode) {
            return { conversationHistory: newHistory };
          }
          // Update current session's messages if it exists
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId ? { ...session, messages: newHistory } : session
            );
            return {
              conversationHistory: newHistory,
              sessions: updatedSessions,
            };
          }
          return { conversationHistory: newHistory };
        });
      },

      removeMessages: (ids: Set<string>) => {
        storeLog.debug('store.routstr.remove_messages', { count: ids.size });
        set((state) => {
          const filtered = state.conversationHistory.filter((msg) => !ids.has(msg.id));
          if (state.isAnonymousMode) return { conversationHistory: filtered };
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId ? { ...session, messages: filtered } : session
            );
            return { conversationHistory: filtered, sessions: updatedSessions };
          }
          return { conversationHistory: filtered };
        });
      },

      setMessagePending: (id: string, pending: boolean) => {
        set((state) => {
          const apply = (msg: RoutstrMessage): RoutstrMessage =>
            msg.id === id ? { ...msg, pending } : msg;
          const updatedHistory = state.conversationHistory.map(apply);
          if (state.isAnonymousMode) {
            return { conversationHistory: updatedHistory };
          }
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId
                ? { ...session, messages: session.messages.map(apply) }
                : session
            );
            return { conversationHistory: updatedHistory, sessions: updatedSessions };
          }
          return { conversationHistory: updatedHistory };
        });
      },

      updateMessage: (id: string, content: string) => {
        storeLog.debug('store.routstr.update_message', { id, contentLength: content.length });
        set((state) => {
          const updatedHistory = state.conversationHistory.map((msg) =>
            msg.id === id
              ? {
                  ...msg,
                  content,
                }
              : msg
          );
          // Skip saving to sessions if in anonymous mode
          if (state.isAnonymousMode) {
            return { conversationHistory: updatedHistory };
          }
          // Update current session's messages if it exists
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId
                ? { ...session, messages: updatedHistory }
                : session
            );
            return {
              conversationHistory: updatedHistory,
              sessions: updatedSessions,
            };
          }
          return { conversationHistory: updatedHistory };
        });
      },

      finalizeAssistantMessage: (id, fields) => {
        storeLog.debug('store.routstr.finalize_assistant', {
          id,
          contentLength: fields.content.length,
          hasReasoning: !!fields.reasoningContent,
          costSats: fields.costSats,
        });
        set((state) => {
          const apply = (msg: RoutstrMessage): RoutstrMessage =>
            msg.id === id
              ? {
                  ...msg,
                  content: fields.content,
                  thinkingDurationSec: fields.thinkingDurationSec ?? msg.thinkingDurationSec,
                  reasoningContent: fields.reasoningContent ?? msg.reasoningContent,
                  costSats: fields.costSats ?? msg.costSats,
                }
              : msg;
          const updatedHistory = state.conversationHistory.map(apply);
          if (state.isAnonymousMode) return { conversationHistory: updatedHistory };
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId
                ? { ...session, messages: session.messages.map(apply) }
                : session
            );
            return { conversationHistory: updatedHistory, sessions: updatedSessions };
          }
          return { conversationHistory: updatedHistory };
        });
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
        const safeProvider = PROVIDER_IDS.includes(slot.provider)
          ? slot.provider
          : DEFAULT_PROVIDER;
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
        // A nagg-served lineup outranks the client derivation for the rest
        // of the session: keep the raw catalog fresh (pricing lookups,
        // vision flags, display names) but leave `lineup` untouched.
        if (get().serverLineupAt != null) {
          aiLog.debug('ai.lineup.derive_skipped_server_lineup');
          set({ modelsCache: { data: models, timestamp: Date.now() } });
          return;
        }
        const { lineup: derived, stats } = deriveLineup(models);
        const previous = get().lastKnownLineup;
        const merged = mergeLineupWithLastKnown(derived, previous?.lineup ?? null);
        aiLog.info('ai.lineup.derived', {
          catalogSize: models.length,
          totalQualifying: stats.totalQualifying,
          perProvider: stats.perProvider,
          substitutedProviders: PROVIDER_IDS.filter(
            (p) => merged[p] !== derived[p] // mergeLineupWithLastKnown replaces the block reference
          ),
          allProvidersEmpty: !lineupHasEntries(derived),
        });
        set({
          modelsCache: { data: models, timestamp: Date.now() },
          lineup: merged,
          lastKnownLineup: lineupHasEntries(merged)
            ? { derivedAt: Date.now(), lineup: merged }
            : previous,
        });
      },

      setServerLineup: ({ lineup, nodeBaseUrl }) => {
        if (!lineupHasEntries(lineup)) {
          aiLog.warn('ai.lineup.server_empty');
          return;
        }
        aiLog.info('ai.lineup.server_applied', {
          nodeBaseUrl,
          providers: PROVIDER_IDS.filter((p) => TIER_IDS.some((t) => lineup[p][t] != null)),
        });
        setRoutstrNodeBaseUrl(nodeBaseUrl);
        set({
          lineup,
          serverLineupAt: Date.now(),
          nodeBaseUrl,
          lastKnownLineup: { derivedAt: Date.now(), lineup },
        });
      },

      isCacheStale: () => {
        const cache = get().modelsCache;
        if (!cache) return true;
        return Date.now() - cache.timestamp > MODELS_CACHE_TTL;
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
      storage: createProfileScopedStorage(),
      schema: PersistedRoutstrStore,
      partialize: (state) => ({
        apiKey: state.apiKey,
        balance: state.balance,
        selectedModel: state.selectedModel,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        lastKnownLineup: state.lastKnownLineup,
        nodeBaseUrl: state.nodeBaseUrl,
      }),
      afterHydrate: (state) => {
        if (!state) return;
        // Re-apply the nagg-served node override before any Routstr call
        // this session — a repointed node must survive offline relaunches.
        setRoutstrNodeBaseUrl(state.nodeBaseUrl ?? null);
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
