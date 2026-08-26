/**
 * @fileoverview NIP-46 Connections Store
 *
 * Persisted, profile-scoped record of connected NIP-46 client apps and their
 * standing grants. An absent grant key means "ask".
 *
 * Security invariant: a grant key that classifies critical can never hold an
 * 'always' verdict. Enforced twice — `setGrant`/`upsertApp` reject or drop the
 * write, and the persisted-blob schema refine rejects the whole blob at merge,
 * so a tampered AsyncStorage blob falls back to in-memory defaults instead of
 * silently auto-signing wallet events.
 */

import { err, ok, type Result } from 'neverthrow';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import {
  ConnectionModeSchema,
  ConnectionStatusSchema,
  GrantKeySchema,
  GrantVerdictSchema,
  isGrantKey,
  MAX_CONNECTED_APPS,
  MAX_PEER_DECRYPT_GRANTS_PER_APP,
  MAX_PREVIOUS_CLIENT_PUBKEYS,
  type ConnectionMode,
  type ConnectionStatus,
  type DecryptMethod,
  type GrantKey,
  type GrantVerdict,
} from '@/features/nostrSigner/lib/nip46Types';
import { classifyRequest, parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex, NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

const MAX_RELAYS = 8;
const MAX_RELAY_URL_LENGTH = 512;
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 512;
const MAX_IMAGE_URL_LENGTH = 1024;

const RELAY_URL_RE = /^wss:\/\/\S+$/;

/**
 * Whether a grant key classifies critical and therefore can never hold
 * 'always'. Classification runs without request params, so kind 5 (deletion)
 * fails closed to critical — an always-grant on deletions is unrepresentable
 * even though a single harmless-scope deletion prompt can still be approved.
 */
export function isCriticalGrantKey(grantKey: GrantKey): boolean {
  return classifyRequest(parseGrantKey(grantKey)).class === 'critical';
}

type ConnectionOrigin = 'bunker' | 'nostrconnect';
export type ConnectionEncryption = 'nip44' | 'nip04';
type GrantOrigin = 'pairing' | 'prompt';

interface Nip46Grant {
  verdict: GrantVerdict;
  origin: GrantOrigin;
  createdAt: number;
  lastUsedAt?: number;
  useCount: number;
}

/**
 * A standing decrypt grant scoped to ONE conversation partner. Lives outside
 * `grants` deliberately: grant keys are a closed codec the permission editor
 * enumerates, and the critical-always ceiling on `grants` must keep rejecting
 * blanket decrypt grants byte-for-byte (see the schema refine below).
 */
interface PeerDecryptGrant {
  methods: DecryptMethod[];
  createdAt: number;
  lastUsedAt?: number;
  useCount: number;
}

export interface Nip46Connection {
  clientPubkey: string;
  name?: string;
  url?: string;
  image?: string;
  relays: string[];
  origin: ConnectionOrigin;
  status: ConnectionStatus;
  mode: ConnectionMode;
  /** Per-peer envelope pin — nip04-only legacy clients stay on nip04. */
  encryption: ConnectionEncryption;
  pairedAt: number;
  lastUsedAt?: number;
  requestCount: number;
  deniedCount: number;
  grants: Partial<Record<GrantKey, Nip46Grant>>;
  /** Keyed by lowercase peer pubkey hex. Never holds the user's own pubkey. */
  peerDecryptGrants: Record<string, PeerDecryptGrant>;
  /**
   * Client keys this record REPLACED via adoption (ephemeral-key clients
   * re-pairing). Attribution metadata only — activity history resolves
   * through it (`connectionForClient`); it never grants anything. Capped at
   * MAX_PREVIOUS_CLIENT_PUBKEYS, most recent kept.
   */
  previousClientPubkeys: string[];
}

// 64-char hex pubkey — the trust-boundary predicate used across the app.
// Canonical pubkey schema lives in protocolIds (branded output).

const RelayUrlSchema = z.string().max(MAX_RELAY_URL_LENGTH).regex(RELAY_URL_RE);

// Signer trust store: enums here are security semantics (grant origin,
// decrypt methods, transport, encryption mode). Catching an unknown value to
// a default would fail OPEN — deliberately bare so an unrecognized blob
// hard-rejects and the user re-pairs instead of the app guessing crypto state.
const PersistedGrant = z.looseObject({
  verdict: GrantVerdictSchema,
  // ast-grep-ignore: persisted-enum-needs-catch
  origin: z.enum(['pairing', 'prompt']),
  createdAt: z.int().min(0),
  lastUsedAt: z.int().min(0).optional(),
  useCount: z.int().min(0),
});

const PersistedPeerDecryptGrant = z.looseObject({
  // ast-grep-ignore: persisted-enum-needs-catch
  methods: z.array(z.enum(['nip04_decrypt', 'nip44_decrypt'])).min(1),
  createdAt: z.int().min(0),
  lastUsedAt: z.int().min(0).optional(),
  useCount: z.int().min(0),
});

const PersistedConnection = z.looseObject({
  clientPubkey: NostrPubkeyHexSchema,
  name: z.string().max(MAX_NAME_LENGTH).optional(),
  url: z.string().max(MAX_URL_LENGTH).optional(),
  image: z.string().max(MAX_IMAGE_URL_LENGTH).optional(),
  relays: z.array(RelayUrlSchema).min(1).max(MAX_RELAYS),
  // ast-grep-ignore: persisted-enum-needs-catch
  origin: z.enum(['bunker', 'nostrconnect']),
  status: ConnectionStatusSchema,
  mode: ConnectionModeSchema,
  // ast-grep-ignore: persisted-enum-needs-catch
  encryption: z.enum(['nip44', 'nip04']),
  pairedAt: z.int().min(0),
  lastUsedAt: z.int().min(0).optional(),
  requestCount: z.int().min(0),
  deniedCount: z.int().min(0),
  grants: z.record(GrantKeySchema, PersistedGrant),
  // `.default({})`/`.default([])` keep a blob missing these fields parseable —
  // a rejected blob falls back to in-memory defaults (createMergeWithSchema)
  // and would wipe every pairing, so default-fill rather than reject.
  peerDecryptGrants: z.record(NostrPubkeyHexSchema, PersistedPeerDecryptGrant).default({}),
  previousClientPubkeys: z.array(NostrPubkeyHexSchema).max(MAX_PREVIOUS_CLIENT_PUBKEYS).default([]),
});

const PersistedConnectionsStore = z
  .object({
    apps: z.record(NostrPubkeyHexSchema, PersistedConnection).default({}),
  })
  .refine((data) => Object.keys(data.apps).length <= MAX_CONNECTED_APPS, 'too many apps')
  .refine(
    (data) => Object.entries(data.apps).every(([key, app]) => app.clientPubkey === key),
    'app key does not match clientPubkey'
  )
  .refine(
    // The critical ceiling forbids a BLANKET decrypt-always because ciphertext
    // is opaque — a blanket grant covers every conversation, present and
    // future. `peerDecryptGrants` is the deliberate, scoped exception: it only
    // exposes the one conversation the user already chose to expose by
    // approving a decrypt with that exact peer, and self-peer (NIP-60 wallet
    // payloads) is excluded twice — evaluate() asks on isSelfDecrypt BEFORE
    // consulting peer grants, and every write path requires the
    // `{ peerIsSelf: false }` guard. This refine therefore stays byte-for-byte
    // for `grants` and never inspects `peerDecryptGrants`.
    (data) =>
      Object.values(data.apps).every((app) =>
        Object.entries(app.grants).every(
          ([grantKey, grant]) =>
            grant.verdict !== 'always' || !isCriticalGrantKey(grantKey as GrantKey)
        )
      ),
    'critical grant key holds an always verdict'
  )
  .refine(
    (data) =>
      Object.values(data.apps).every(
        (app) => Object.keys(app.peerDecryptGrants).length <= MAX_PEER_DECRYPT_GRANTS_PER_APP
      ),
    'too many peer decrypt grants'
  );

export interface UpsertAppInput {
  clientPubkey: string;
  relays: string[];
  origin: ConnectionOrigin;
  name?: string;
  url?: string;
  image?: string;
  mode?: ConnectionMode;
  encryption?: ConnectionEncryption;
  /** Pairing-time grants. Critical-always entries are dropped, never stored. */
  grants?: Partial<Record<GrantKey, Nip46Grant>>;
}

interface UpdateMetadataInput {
  name?: string;
  url?: string;
  image?: string;
  relays?: string[];
}

export type UpsertAppError = 'invalid_pubkey' | 'invalid_relays' | 'app_limit_reached';
type SetGrantError = 'unknown_app' | 'invalid_grant_key' | 'critical_always_forbidden';
type SetPeerDecryptGrantError =
  'unknown_app' | 'self_decrypt_forbidden' | 'invalid_peer' | 'peer_grant_limit';

export type AdoptConnectionError =
  UpsertAppError | 'unknown_previous' | 'same_pubkey' | 'target_exists';

interface Nip46ConnectionsState {
  apps: Record<string, Nip46Connection>;
}

interface Nip46ConnectionsActions {
  /** Create or update a connection. New apps are rejected once the cap is hit. */
  upsertApp: (input: UpsertAppInput) => Result<void, UpsertAppError>;
  /**
   * Replace a previous connection with a re-pairing client's new record in
   * ONE atomic set. `inheritGrants: true` (active previous) carries grants,
   * peer decrypt grants, mode, pairedAt, counters, and lastUsedAt;
   * `false` (blocked previous — deliberate fresh start) carries only the
   * `previousClientPubkeys` attribution chain. The old record is deleted.
   * Callers must have user confirmation; the ENGINE re-validates the match
   * before calling this (claimed identity is attacker-controllable).
   */
  adoptConnection: (
    previousClientPubkey: string,
    input: UpsertAppInput,
    opts: { inheritGrants: boolean }
  ) => Result<void, AdoptConnectionError>;
  /** Set a standing verdict, or clear back to ask with `null`. Enforces the critical ceiling. */
  setGrant: (
    clientPubkey: string,
    grantKey: GrantKey,
    verdict: GrantVerdict | null
  ) => Result<void, SetGrantError>;
  setMode: (clientPubkey: string, mode: ConnectionMode) => void;
  setEncryption: (clientPubkey: string, encryption: ConnectionEncryption) => void;
  /**
   * Persistent "Always" decrypt grant for one (app, peer, method). Same
   * compile-time `{ peerIsSelf: false }` guard pattern as the session grant —
   * a self-decrypt grant is unrepresentable through this API.
   */
  setPeerDecryptGrant: (
    clientPubkey: string,
    peerPubkey: string,
    method: DecryptMethod,
    guard: { peerIsSelf: false }
  ) => Result<void, SetPeerDecryptGrantError>;
  /** Drop one method, or the whole peer entry when `method` is omitted. */
  revokePeerDecryptGrant: (
    clientPubkey: string,
    peerPubkey: string,
    method?: DecryptMethod
  ) => void;
  /**
   * Bump usage counters; pass `grantKey` when an auto-approval consumed a
   * standing grant, or `peerGrant` when it consumed a per-peer decrypt grant.
   */
  touchUsage: (
    clientPubkey: string,
    opts?: { denied?: boolean; grantKey?: GrantKey; peerGrantPubkey?: string }
  ) => void;
  blockApp: (clientPubkey: string) => void;
  unblockApp: (clientPubkey: string) => void;
  /** Deletes the record entirely (Block keeps it with status 'blocked'). */
  disconnectApp: (clientPubkey: string) => void;
  /** Deletes EVERY record — the hub's Reset Remote Login. */
  clearAll: () => void;
  renameApp: (clientPubkey: string, name: string) => void;
  /** Re-pair metadata refresh — only call after user approval (blocks rename-phishing). */
  updateMetadataAfterApproval: (clientPubkey: string, meta: UpdateMetadataInput) => void;
}

type Nip46ConnectionsStore = Nip46ConnectionsState & Nip46ConnectionsActions;

/** Trim, dedupe, and cap relays; non-wss entries are dropped. Null when none survive. */
function sanitizeRelays(relays: string[]): string[] | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const relay of relays) {
    const trimmed = relay.trim();
    if (trimmed.length > MAX_RELAY_URL_LENGTH || !RELAY_URL_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length === MAX_RELAYS) break;
  }
  return out.length > 0 ? out : null;
}

function sanitizeName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, MAX_NAME_LENGTH) : undefined;
}

// Over-long URLs are dropped, not truncated — a truncated URL is garbage.
function sanitizeUrl(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/**
 * The three display fields a client app tells us about itself, sanitized and
 * emitted only when a usable value survived — a missing or over-long value
 * leaves whatever is already stored alone rather than erasing it.
 *
 * Every path that lets a client write its own metadata (pairing, adoption,
 * post-approval refresh) spreads this, so a field can't end up sanitized on one
 * path and raw on another.
 */
function sanitizedAppMetadata(meta: {
  name?: string;
  url?: string;
  image?: string;
}): Partial<Pick<Nip46Connection, 'name' | 'url' | 'image'>> {
  const name = sanitizeName(meta.name);
  const url = sanitizeUrl(meta.url, MAX_URL_LENGTH);
  const image = sanitizeUrl(meta.image, MAX_IMAGE_URL_LENGTH);
  return {
    ...(name !== undefined && { name }),
    ...(url !== undefined && { url }),
    ...(image !== undefined && { image }),
  };
}

function sanitizeGrants(
  grants: Partial<Record<GrantKey, Nip46Grant>>
): Partial<Record<GrantKey, Nip46Grant>> {
  const out: Partial<Record<GrantKey, Nip46Grant>> = {};
  for (const [key, grant] of Object.entries(grants)) {
    if (!grant || !isGrantKey(key)) continue;
    if (grant.verdict === 'always' && isCriticalGrantKey(key)) {
      storeLog.warn('store.nip46_connections.critical_always_dropped', { grantKey: key });
      continue;
    }
    out[key] = grant;
  }
  return out;
}

export const useNip46ConnectionsStore = create<Nip46ConnectionsStore>()(
  persist(
    (set, get) => {
      const patchApp = (
        clientPubkey: string,
        patch: (app: Nip46Connection) => Nip46Connection
      ): void => {
        set((state) => {
          const app = state.apps[clientPubkey];
          if (!app) return state;
          return { apps: { ...state.apps, [clientPubkey]: patch(app) } };
        });
      };

      return {
        apps: {},

        upsertApp: (input) => {
          if (!isNostrPubkeyHex(input.clientPubkey)) return err('invalid_pubkey');
          const relays = sanitizeRelays(input.relays);
          if (relays === null) return err('invalid_relays');

          const { apps } = get();
          const existing = apps[input.clientPubkey];
          if (!existing && Object.keys(apps).length >= MAX_CONNECTED_APPS) {
            storeLog.warn('store.nip46_connections.app_limit_reached');
            return err('app_limit_reached');
          }

          const now = Date.now();
          const base: Nip46Connection = existing ?? {
            clientPubkey: input.clientPubkey,
            relays,
            origin: input.origin,
            status: 'active',
            mode: 'standard',
            encryption: 'nip44',
            pairedAt: now,
            requestCount: 0,
            deniedCount: 0,
            grants: {},
            peerDecryptGrants: {},
            previousClientPubkeys: [],
          };
          const next: Nip46Connection = {
            ...base,
            relays,
            origin: input.origin,
            ...sanitizedAppMetadata(input),
            ...(input.mode !== undefined && { mode: input.mode }),
            ...(input.encryption !== undefined && { encryption: input.encryption }),
            grants: { ...base.grants, ...sanitizeGrants(input.grants ?? {}) },
          };

          storeLog.info('store.nip46_connections.upsert', {
            origin: input.origin,
            isNew: !existing,
          });
          set({ apps: { ...apps, [input.clientPubkey]: next } });
          return ok(undefined);
        },

        adoptConnection: (previousClientPubkey, input, opts) => {
          if (!isNostrPubkeyHex(input.clientPubkey)) return err('invalid_pubkey');
          const relays = sanitizeRelays(input.relays);
          if (relays === null) return err('invalid_relays');
          const newKey = input.clientPubkey.toLowerCase();
          const previousKey = previousClientPubkey.toLowerCase();
          if (newKey === previousKey) return err('same_pubkey');

          const { apps } = get();
          const previous = apps[previousKey];
          if (previous === undefined) return err('unknown_previous');
          if (apps[newKey] !== undefined) return err('target_exists');
          // Net count is unchanged (delete + insert) — count post-deletion so
          // adoption always succeeds at the app cap.
          if (Object.keys(apps).length - 1 >= MAX_CONNECTED_APPS) {
            storeLog.warn('store.nip46_connections.app_limit_reached');
            return err('app_limit_reached');
          }

          const now = Date.now();
          // Attribution chain: carry the old record's own chain, append the
          // old key, drop collisions with the new key, keep the most recent.
          const chain = [...previous.previousClientPubkeys, previous.clientPubkey]
            .map((key) => key.toLowerCase())
            .filter((key, index, all) => key !== newKey && all.indexOf(key) === index)
            .slice(-MAX_PREVIOUS_CLIENT_PUBKEYS);

          const carried = opts.inheritGrants
            ? {
                // sanitizeGrants as belt — carried grants already conform to
                // the critical-always ceiling by construction.
                grants: sanitizeGrants(previous.grants),
                peerDecryptGrants: previous.peerDecryptGrants,
                mode: previous.mode,
                pairedAt: previous.pairedAt,
                requestCount: previous.requestCount,
                deniedCount: previous.deniedCount,
                ...(previous.lastUsedAt !== undefined && { lastUsedAt: previous.lastUsedAt }),
              }
            : {
                grants: {},
                peerDecryptGrants: {},
                mode: input.mode ?? ('standard' as const),
                pairedAt: now,
                requestCount: 0,
                deniedCount: 0,
              };

          const next: Nip46Connection = {
            clientPubkey: newKey,
            relays,
            origin: input.origin,
            status: 'active',
            // The new client re-pins its own envelope scheme from its first
            // inbound request — never carry the old client's pin.
            encryption: input.encryption ?? 'nip44',
            ...carried,
            // Pairing-time grants (accepted checklist keys) merge on top of
            // anything carried — same additive semantics as upsertApp.
            grants: { ...carried.grants, ...sanitizeGrants(input.grants ?? {}) },
            ...sanitizedAppMetadata(input),
            ...(input.mode !== undefined && { mode: input.mode }),
            previousClientPubkeys: chain,
          };

          storeLog.info('store.nip46_connections.adopt', {
            inheritGrants: opts.inheritGrants,
            chainLength: chain.length,
          });
          set((state) => {
            const nextApps = { ...state.apps };
            delete nextApps[previousKey];
            nextApps[newKey] = next;
            return { apps: nextApps };
          });
          return ok(undefined);
        },

        setGrant: (clientPubkey, grantKey, verdict) => {
          if (!get().apps[clientPubkey]) return err('unknown_app');
          if (!isGrantKey(grantKey)) return err('invalid_grant_key');
          if (verdict === 'always' && isCriticalGrantKey(grantKey)) {
            storeLog.warn('store.nip46_connections.critical_always_rejected', { grantKey });
            return err('critical_always_forbidden');
          }
          storeLog.info('store.nip46_connections.set_grant', { grantKey, verdict });
          patchApp(clientPubkey, (app) => {
            const grants = { ...app.grants };
            if (verdict === null) {
              delete grants[grantKey];
            } else {
              grants[grantKey] = { verdict, origin: 'prompt', createdAt: Date.now(), useCount: 0 };
            }
            return { ...app, grants };
          });
          return ok(undefined);
        },

        setPeerDecryptGrant: (clientPubkey, peerPubkey, method, guard) => {
          // Runtime re-check of the compile-time contract — a cast must not be
          // able to mint a self-decrypt grant.
          if (guard.peerIsSelf !== false) return err('self_decrypt_forbidden');
          if (!isNostrPubkeyHex(peerPubkey)) return err('invalid_peer');
          const app = get().apps[clientPubkey];
          if (!app) return err('unknown_app');
          const peer = peerPubkey.toLowerCase();
          const existing = app.peerDecryptGrants[peer];
          if (
            existing === undefined &&
            Object.keys(app.peerDecryptGrants).length >= MAX_PEER_DECRYPT_GRANTS_PER_APP
          ) {
            storeLog.warn('store.nip46_connections.peer_grant_limit');
            return err('peer_grant_limit');
          }
          storeLog.info('store.nip46_connections.peer_decrypt_grant', { method });
          patchApp(clientPubkey, (current) => ({
            ...current,
            peerDecryptGrants: {
              ...current.peerDecryptGrants,
              [peer]: existing
                ? {
                    ...existing,
                    methods: existing.methods.includes(method)
                      ? existing.methods
                      : [...existing.methods, method],
                  }
                : { methods: [method], createdAt: Date.now(), useCount: 0 },
            },
          }));
          return ok(undefined);
        },

        revokePeerDecryptGrant: (clientPubkey, peerPubkey, method) => {
          const peer = peerPubkey.toLowerCase();
          storeLog.info('store.nip46_connections.peer_decrypt_revoke', {
            scope: method ?? 'all',
          });
          patchApp(clientPubkey, (app) => {
            const existing = app.peerDecryptGrants[peer];
            if (!existing) return app;
            const peerDecryptGrants = { ...app.peerDecryptGrants };
            const remaining =
              method === undefined ? [] : existing.methods.filter((m) => m !== method);
            if (remaining.length === 0) {
              delete peerDecryptGrants[peer];
            } else {
              peerDecryptGrants[peer] = { ...existing, methods: remaining };
            }
            return { ...app, peerDecryptGrants };
          });
        },

        setMode: (clientPubkey, mode) => {
          patchApp(clientPubkey, (app) => ({ ...app, mode }));
        },

        setEncryption: (clientPubkey, encryption) => {
          patchApp(clientPubkey, (app) => ({ ...app, encryption }));
        },

        touchUsage: (clientPubkey, opts) => {
          patchApp(clientPubkey, (app) => {
            const now = Date.now();
            let grants = app.grants;
            const grantKey = opts?.grantKey;
            const grant = grantKey ? grants[grantKey] : undefined;
            if (grantKey && grant) {
              grants = {
                ...grants,
                [grantKey]: { ...grant, lastUsedAt: now, useCount: grant.useCount + 1 },
              };
            }
            let peerDecryptGrants = app.peerDecryptGrants;
            const peer = opts?.peerGrantPubkey?.toLowerCase();
            const peerGrant = peer !== undefined ? peerDecryptGrants[peer] : undefined;
            if (peer !== undefined && peerGrant !== undefined) {
              peerDecryptGrants = {
                ...peerDecryptGrants,
                [peer]: { ...peerGrant, lastUsedAt: now, useCount: peerGrant.useCount + 1 },
              };
            }
            return {
              ...app,
              grants,
              peerDecryptGrants,
              lastUsedAt: now,
              requestCount: app.requestCount + 1,
              deniedCount: opts?.denied ? app.deniedCount + 1 : app.deniedCount,
            };
          });
        },

        blockApp: (clientPubkey) => {
          storeLog.info('store.nip46_connections.block');
          patchApp(clientPubkey, (app) => ({ ...app, status: 'blocked' }));
        },

        unblockApp: (clientPubkey) => {
          storeLog.info('store.nip46_connections.unblock');
          patchApp(clientPubkey, (app) => ({ ...app, status: 'active' }));
        },

        disconnectApp: (clientPubkey) => {
          storeLog.info('store.nip46_connections.disconnect');
          set((state) => {
            if (!state.apps[clientPubkey]) return state;
            const apps = { ...state.apps };
            delete apps[clientPubkey];
            return { apps };
          });
        },

        clearAll: () => {
          storeLog.info('store.nip46_connections.clear_all');
          set({ apps: {} });
        },

        renameApp: (clientPubkey, name) => {
          patchApp(clientPubkey, (app) => {
            const sanitized = sanitizeName(name);
            if (sanitized === undefined) {
              const { name: _omitted, ...rest } = app;
              return rest;
            }
            return { ...app, name: sanitized };
          });
        },

        updateMetadataAfterApproval: (clientPubkey, meta) => {
          patchApp(clientPubkey, (app) => {
            const relays = meta.relays ? sanitizeRelays(meta.relays) : null;
            return {
              ...app,
              ...sanitizedAppMetadata(meta),
              ...(relays !== null && { relays }),
            };
          });
        },
      };
    },
    persistConfig({
      name: 'nip46-connections-store',
      storage: profileStorage,
      schema: PersistedConnectionsStore,
      partialize: (state) => ({ apps: state.apps }),
    })
  )
);
