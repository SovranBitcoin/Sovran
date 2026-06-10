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
  type ConnectionMode,
  type ConnectionStatus,
  type GrantKey,
  type GrantVerdict,
} from '@/features/nostrSigner/lib/nip46Types';
import { classifyRequest, parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
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

export type ConnectionOrigin = 'bunker' | 'nostrconnect';
export type ConnectionEncryption = 'nip44' | 'nip04';
type GrantOrigin = 'pairing' | 'prompt';

export interface Nip46Grant {
  verdict: GrantVerdict;
  origin: GrantOrigin;
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
}

// 64-char hex pubkey — the trust-boundary predicate used across the app.
const HexPubkeySchema = z.custom<string>(isNostrPubkeyHex, 'invalid pubkey');

const RelayUrlSchema = z.string().max(MAX_RELAY_URL_LENGTH).regex(RELAY_URL_RE);

const PersistedGrant = z.looseObject({
  verdict: GrantVerdictSchema,
  origin: z.enum(['pairing', 'prompt']),
  createdAt: z.int().min(0),
  lastUsedAt: z.int().min(0).optional(),
  useCount: z.int().min(0),
});

const PersistedConnection = z.looseObject({
  clientPubkey: HexPubkeySchema,
  name: z.string().max(MAX_NAME_LENGTH).optional(),
  url: z.string().max(MAX_URL_LENGTH).optional(),
  image: z.string().max(MAX_IMAGE_URL_LENGTH).optional(),
  relays: z.array(RelayUrlSchema).min(1).max(MAX_RELAYS),
  origin: z.enum(['bunker', 'nostrconnect']),
  status: ConnectionStatusSchema,
  mode: ConnectionModeSchema,
  encryption: z.enum(['nip44', 'nip04']),
  pairedAt: z.int().min(0),
  lastUsedAt: z.int().min(0).optional(),
  requestCount: z.int().min(0),
  deniedCount: z.int().min(0),
  grants: z.record(GrantKeySchema, PersistedGrant),
});

const PersistedConnectionsStore = z
  .object({
    apps: z.record(HexPubkeySchema, PersistedConnection).default({}),
  })
  .refine((data) => Object.keys(data.apps).length <= MAX_CONNECTED_APPS, 'too many apps')
  .refine(
    (data) => Object.entries(data.apps).every(([key, app]) => app.clientPubkey === key),
    'app key does not match clientPubkey'
  )
  .refine(
    (data) =>
      Object.values(data.apps).every((app) =>
        Object.entries(app.grants).every(
          ([grantKey, grant]) =>
            grant.verdict !== 'always' || !isCriticalGrantKey(grantKey as GrantKey)
        )
      ),
    'critical grant key holds an always verdict'
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

interface Nip46ConnectionsState {
  apps: Record<string, Nip46Connection>;
}

interface Nip46ConnectionsActions {
  /** Create or update a connection. New apps are rejected once the cap is hit. */
  upsertApp: (input: UpsertAppInput) => Result<void, UpsertAppError>;
  /** Set a standing verdict, or clear back to ask with `null`. Enforces the critical ceiling. */
  setGrant: (
    clientPubkey: string,
    grantKey: GrantKey,
    verdict: GrantVerdict | null
  ) => Result<void, SetGrantError>;
  setMode: (clientPubkey: string, mode: ConnectionMode) => void;
  setEncryption: (clientPubkey: string, encryption: ConnectionEncryption) => void;
  /** Bump usage counters; pass `grantKey` when an auto-approval consumed a grant. */
  touchUsage: (clientPubkey: string, opts?: { denied?: boolean; grantKey?: GrantKey }) => void;
  blockApp: (clientPubkey: string) => void;
  unblockApp: (clientPubkey: string) => void;
  /** Deletes the record entirely (Block keeps it with status 'blocked'). */
  disconnectApp: (clientPubkey: string) => void;
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
          const name = sanitizeName(input.name);
          const url = sanitizeUrl(input.url, MAX_URL_LENGTH);
          const image = sanitizeUrl(input.image, MAX_IMAGE_URL_LENGTH);
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
          };
          const next: Nip46Connection = {
            ...base,
            relays,
            origin: input.origin,
            ...(name !== undefined && { name }),
            ...(url !== undefined && { url }),
            ...(image !== undefined && { image }),
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
            return {
              ...app,
              grants,
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
            const name = sanitizeName(meta.name);
            const url = sanitizeUrl(meta.url, MAX_URL_LENGTH);
            const image = sanitizeUrl(meta.image, MAX_IMAGE_URL_LENGTH);
            const relays = meta.relays ? sanitizeRelays(meta.relays) : null;
            return {
              ...app,
              ...(name !== undefined && { name }),
              ...(url !== undefined && { url }),
              ...(image !== undefined && { image }),
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
      version: 1,
      partialize: (state) => ({ apps: state.apps }),
    })
  )
);
