/**
 * @fileoverview NIP-46 Requests Store (runtime-only)
 *
 * Never persisted: the pending approval queue, opt-in session grants, and
 * per-app throttle flags all die with the JS context. Promise resolvers for
 * deferred verdicts live in the engine's module scope, not here — store state
 * must stay serializable-shaped even though it never serializes.
 *
 * `paramsPreview` carries only SAFE display payloads: the parsed unsigned
 * event for sign_event, the client-supplied plaintext for encrypt, and for
 * decrypt nothing but the peer pubkey and ciphertext length — ciphertext
 * never reaches UI state.
 */

import { err, ok, type Result } from 'neverthrow';
import { create } from 'zustand';

import {
  MAX_PENDING_GLOBAL,
  MAX_PENDING_PER_APP,
  SESSION_GRANT_TTL_MS,
  type GrantKey,
  type Nip46Method,
  type UnsignedEvent,
} from '@/features/nostrSigner/lib/nip46Types';
import type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import { storeLog } from '@/shared/lib/logger';

export type Nip46ParamsPreview =
  | { type: 'sign_event'; event: UnsignedEvent }
  | { type: 'encrypt'; peerPubkey: string; plaintext: string }
  | { type: 'decrypt'; peerPubkey: string; ciphertextLength: number }
  | { type: 'none' };

export interface Nip46PendingRequest {
  /** RPC request id (client-generated). */
  id: string;
  /** Kind-24133 envelope event id — globally unique dedupe key. */
  eventId: string;
  clientPubkey: string;
  /** False for pairing prompts from not-yet-connected clients. */
  connectionKnown: boolean;
  method: Nip46Method;
  kind?: number;
  paramsPreview: Nip46ParamsPreview;
  receivedAt: number;
  expiresAt: number;
}

export type EnqueueRejection = 'duplicate' | 'per_app_cap' | 'global_cap';

/** Session grants exist only for decrypt methods — never for signing. */
export type SessionGrantKey = 'nip04_decrypt' | 'nip44_decrypt';

export type SessionGrantError = 'self_decrypt_forbidden' | 'not_session_grantable';

export interface Nip46SessionGrant {
  clientPubkey: string;
  grantKey: SessionGrantKey;
  expiresAt: number;
}

const SESSION_GRANTABLE_KEYS: readonly string[] = ['nip04_decrypt', 'nip44_decrypt'];

/** Toast handoff for the UI layer (Layer 3 consumes + clears). */
export type Nip46PairingNotice = 'expired';

interface Nip46RequestsState {
  pending: Nip46PendingRequest[];
  sessionGrants: Nip46SessionGrant[];
  /** Apps in rate-limit cooldown — UI flag only; the engine owns the timing. */
  throttledApps: Record<string, true>;
  /**
   * UI-requested hot flag: signer surfaces (share screen, connect sheet) set
   * this so the service hook starts the engine even with zero connections.
   * The hook clears nothing here — the surface that set it owns resetting it.
   */
  serviceHotRequested: boolean;
  /**
   * Boot handoff from useResumePendingPairing: a pairing intent that survived
   * a profile-switch restart, parsed and already registered with the engine
   * via startNostrconnectPairing. Layer 3 watches this to open the connect
   * sheet, then clears it. Carries the pairing secret — runtime-only by
   * construction (this store never persists) and never logged.
   */
  resumedPairing: ParsedNostrConnectUri | null;
  /** Set when a pairing intent died (expired/mismatched) — UI shows a toast. */
  pairingNotice: Nip46PairingNotice | null;
}

interface Nip46RequestsActions {
  /**
   * FIFO append. Rejects the incoming request at the caps (the engine
   * auto-denies the newest — never evict a prompt the user may be reading).
   */
  enqueue: (request: Nip46PendingRequest) => Result<void, EnqueueRejection>;
  remove: (id: string) => void;
  /**
   * Move a pending request to the queue head. The approval sheet always
   * renders the head, so this is how the requests page seeds the prompt at a
   * specific row ("review this one") without a second queue representation.
   * Engine resolution/expiry are id/TTL-based — order is presentation-only.
   */
  promote: (id: string) => void;
  /** Remove and return every request past its TTL so the engine can respond + log. */
  expireDue: (nowMs: number) => Nip46PendingRequest[];
  clear: () => void;
  /**
   * 1h opt-in auto-approve for critical peer≠self decrypts. The guard forces
   * the caller to assert the peer is not the user — decrypt-to-self (NIP-60
   * wallet payloads) must always prompt.
   */
  grantSession: (
    clientPubkey: string,
    grantKey: SessionGrantKey,
    guard: { peerIsSelf: false },
    nowMs?: number
  ) => Result<void, SessionGrantError>;
  hasSessionGrant: (clientPubkey: string, grantKey: GrantKey, nowMs?: number) => boolean;
  /** Revoke one grant, or all of an app's grants when `grantKey` is omitted. */
  revokeSessionGrant: (clientPubkey: string, grantKey?: SessionGrantKey) => void;
  pruneSessionGrants: (nowMs?: number) => void;
  setAppThrottled: (clientPubkey: string, throttled: boolean) => void;
  setServiceHotRequested: (hot: boolean) => void;
  setResumedPairing: (parsed: ParsedNostrConnectUri | null) => void;
  setPairingNotice: (notice: Nip46PairingNotice | null) => void;
}

type Nip46RequestsStore = Nip46RequestsState & Nip46RequestsActions;

export const useNip46RequestsStore = create<Nip46RequestsStore>()((set, get) => ({
  pending: [],
  sessionGrants: [],
  throttledApps: {},
  serviceHotRequested: false,
  resumedPairing: null,
  pairingNotice: null,

  enqueue: (request) => {
    const { pending } = get();
    if (pending.some((p) => p.eventId === request.eventId || p.id === request.id)) {
      return err('duplicate');
    }
    const appCount = pending.filter((p) => p.clientPubkey === request.clientPubkey).length;
    if (appCount >= MAX_PENDING_PER_APP) {
      storeLog.warn('store.nip46_requests.per_app_cap', { method: request.method });
      return err('per_app_cap');
    }
    if (pending.length >= MAX_PENDING_GLOBAL) {
      storeLog.warn('store.nip46_requests.global_cap', { method: request.method });
      return err('global_cap');
    }
    set({ pending: [...pending, request] });
    return ok(undefined);
  },

  remove: (id) => {
    set((state) => {
      const pending = state.pending.filter((p) => p.id !== id);
      return pending.length === state.pending.length ? state : { pending };
    });
  },

  promote: (id) => {
    set((state) => {
      const index = state.pending.findIndex((p) => p.id === id);
      if (index <= 0) return state;
      const target = state.pending[index];
      if (target === undefined) return state;
      return {
        pending: [target, ...state.pending.slice(0, index), ...state.pending.slice(index + 1)],
      };
    });
  },

  expireDue: (nowMs) => {
    const { pending } = get();
    const expired = pending.filter((p) => p.expiresAt <= nowMs);
    if (expired.length > 0) {
      set({ pending: pending.filter((p) => p.expiresAt > nowMs) });
    }
    return expired;
  },

  clear: () => {
    set({ pending: [] });
  },

  grantSession: (clientPubkey, grantKey, guard, nowMs = Date.now()) => {
    // Runtime re-checks of the compile-time contracts — a JS caller (or a
    // cast) must not be able to mint a self-decrypt or signing session grant.
    if (guard.peerIsSelf !== false) return err('self_decrypt_forbidden');
    if (!SESSION_GRANTABLE_KEYS.includes(grantKey)) return err('not_session_grantable');
    storeLog.info('store.nip46_requests.session_grant', { grantKey });
    set((state) => ({
      sessionGrants: [
        ...state.sessionGrants.filter(
          (g) => !(g.clientPubkey === clientPubkey && g.grantKey === grantKey)
        ),
        { clientPubkey, grantKey, expiresAt: nowMs + SESSION_GRANT_TTL_MS },
      ],
    }));
    return ok(undefined);
  },

  hasSessionGrant: (clientPubkey, grantKey, nowMs = Date.now()) => {
    return get().sessionGrants.some(
      (g) => g.clientPubkey === clientPubkey && g.grantKey === grantKey && g.expiresAt > nowMs
    );
  },

  revokeSessionGrant: (clientPubkey, grantKey) => {
    set((state) => ({
      sessionGrants: state.sessionGrants.filter(
        (g) =>
          g.clientPubkey !== clientPubkey || (grantKey !== undefined && g.grantKey !== grantKey)
      ),
    }));
  },

  pruneSessionGrants: (nowMs = Date.now()) => {
    set((state) => {
      const sessionGrants = state.sessionGrants.filter((g) => g.expiresAt > nowMs);
      return sessionGrants.length === state.sessionGrants.length ? state : { sessionGrants };
    });
  },

  setAppThrottled: (clientPubkey, throttled) => {
    set((state) => {
      if (throttled === (state.throttledApps[clientPubkey] === true)) return state;
      const throttledApps = { ...state.throttledApps };
      if (throttled) {
        throttledApps[clientPubkey] = true;
      } else {
        delete throttledApps[clientPubkey];
      }
      return { throttledApps };
    });
  },

  setServiceHotRequested: (hot) => {
    set((state) => (state.serviceHotRequested === hot ? state : { serviceHotRequested: hot }));
  },

  setResumedPairing: (parsed) => {
    // The parsed URI embeds the pairing secret — never log it.
    set({ resumedPairing: parsed });
  },

  setPairingNotice: (notice) => {
    set({ pairingNotice: notice });
  },
}));
