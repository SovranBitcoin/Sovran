/**
 * @fileoverview Remote Login (NIP-46) connections, kept inert.
 *
 * The signer was removed (ADR 0035). This store stays declared under its
 * released name, storage and schema so an install that paired apps still
 * loads, keeps and wipes that saved data like any other per-profile store
 * (`releasedPersistedSurface.test.ts`). Nothing reads or writes it.
 *
 * The schema below is the released one, byte for byte, with what it needed
 * from the signer folded in. Its whole-blob refines are kept: a tampered blob
 * that gives a critical grant an 'always' verdict is still rejected.
 */

import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

const profileStorage = createProfileScopedStorage();

const MAX_RELAYS = 8;
const MAX_RELAY_URL_LENGTH = 512;
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 512;
const MAX_IMAGE_URL_LENGTH = 1024;
const MAX_CONNECTED_APPS = 64;
const MAX_PEER_DECRYPT_GRANTS_PER_APP = 50;
const MAX_PREVIOUS_CLIENT_PUBKEYS = 8;
const MAX_EVENT_KIND = 65535;

const RELAY_URL_RE = /^wss:\/\/\S+$/;

// ast-grep-ignore: persisted-enum-needs-catch
const GrantVerdictSchema = z.enum(['always', 'deny']);
// ast-grep-ignore: persisted-enum-needs-catch
const ConnectionModeSchema = z.enum(['standard', 'strict']);
// ast-grep-ignore: persisted-enum-needs-catch
const ConnectionStatusSchema = z.enum(['active', 'blocked']);

const ENCRYPTION_GRANT_METHODS = [
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt',
] as const;
type GrantKey = `sign_event:${number}` | (typeof ENCRYPTION_GRANT_METHODS)[number];

// No leading zeros, max 5 digits; range-checked against MAX_EVENT_KIND below.
const SIGN_EVENT_GRANT_KEY_RE = /^sign_event:(0|[1-9]\d{0,4})$/;

function isGrantKey(value: string): value is GrantKey {
  if ((ENCRYPTION_GRANT_METHODS as readonly string[]).includes(value)) return true;
  const match = SIGN_EVENT_GRANT_KEY_RE.exec(value);
  if (!match) return false;
  return Number(match[1]) <= MAX_EVENT_KIND;
}

const GrantKeySchema = z.custom<GrantKey>(
  (value) => typeof value === 'string' && isGrantKey(value),
  'invalid grant key'
);

// NIP-60/61 wallet kinds: signing these can move or expose ecash.
const CRITICAL_SIGN_KINDS = new Set([17375, 7375, 7374, 7376, 9321, 10019]);
const DELETION_KIND = 5;

/**
 * Whether a grant key is critical, so it can never hold 'always': every
 * decrypt (ciphertext is opaque), a NIP-60/61 wallet kind, or a deletion
 * (classified without its tags, so it fails closed). The signer's
 * `classifyRequest(parseGrantKey(key))` without params, reduced; the two were
 * compared over every grant key before the signer was removed.
 */
export function isCriticalGrantKey(grantKey: GrantKey): boolean {
  if (grantKey === 'nip04_decrypt' || grantKey === 'nip44_decrypt') return true;
  if (!grantKey.startsWith('sign_event:')) return false;
  const kind = Number(grantKey.slice('sign_event:'.length));
  return kind === DELETION_KIND || CRITICAL_SIGN_KINDS.has(kind);
}

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

// Tolerant at the app level, deliberately bare inside it. The enums below are
// security semantics and must never be guessed, so an unrecognized connection
// still hard-rejects and that app has to be re-paired — but bare, `z.record`
// rejected the whole map for it, and `createMergeWithSchema` then wiped EVERY
// pairing. The comment on `peerDecryptGrants` already names that outcome as the
// thing to avoid. Containing the rejection to the one app the blob could not be
// trusted about is the same fail-closed answer at the right granularity.
//
// The refines below stay whole-blob on purpose: they are not "this value is
// unrecognized", they are "this data violates an invariant the store is
// supposed to enforce". That is a different failure and rejecting outright
// remains the correct answer to it. Note they now run on the FILTERED map, so
// a blob that was over the app cap only because of malformed entries, or whose
// critical-grant violation sat in an app that was dropped, can pass where it
// used to reject. Nothing unsafe is admitted by that: the offending app is
// absent entirely, and every app that survives still satisfies all four.
const PersistedConnectionsStore = z
  .object({
    apps: tolerantRecord(NostrPubkeyHexSchema, PersistedConnection),
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

type LegacyNip46Connection = z.output<typeof PersistedConnection>;

interface Nip46ConnectionsState {
  apps: Record<string, LegacyNip46Connection>;
}

export const useNip46ConnectionsStore = create<Nip46ConnectionsState>({
  name: 'nip46-connections-store',
  scope: 'profile',
})(
  persist(
    (): Nip46ConnectionsState => ({ apps: {} }),
    persistConfig({
      name: 'nip46-connections-store',
      storage: profileStorage,
      schema: PersistedConnectionsStore,
      partialize: (state) => ({ apps: state.apps }),
    })
  )
);
