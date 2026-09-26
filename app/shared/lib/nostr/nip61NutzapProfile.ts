/**
 * @fileoverview NIP-61 (`kind:10019`) nutzap-info parse.
 *
 * Answers "if I lock ecash to this person, which key should I lock it to, and
 * which mints will they take it from?".
 *
 * NIP-61 puts that in a replaceable `kind:10019` event: `["pubkey", <key>]` is
 * the key to P2PK-lock to — deliberately NOT necessarily their nostr identity
 * key, since NIP-60 keeps a separate wallet key for exactly this — plus
 * `["mint", <url>, <unit>…]` and `["relay", <url>]`.
 *
 * Absence is the common case, not an error: almost nobody publishes one yet.
 * So this module never refuses. It falls back to `02` + the identity key (the
 * convention Nut Drop and every Cashu-aware nostr client already use) and says
 * which of the two it gave you, because "we could not confirm they can unlock
 * this" is a thing the sender has to be told.
 *
 * Pure functions over plain tags — no NDK, no network — so they unit-test
 * without either. The lookup lives in `nutzapProfileDiscovery.ts`.
 */
import { normalizeURL } from 'nostr-tools/utils';

import {
  CASHU_P2PK_PUBKEY_RE,
  cashuP2pkPubkeyFromNostrHex,
  type CashuP2pkPubkey,
} from '@/shared/lib/protocolIds';

/** NIP-61 nutzap informational event kind. */
export const NUTZAP_INFO_KIND = 10019;

/**
 * A recipient's declared nutzap preferences, or our assumption in place of
 * them.
 */
export interface NutzapProfile {
  /** The 33-byte compressed key to lock ecash to. */
  lockKey: CashuP2pkPubkey;
  /**
   * Where `lockKey` came from. `identityFallback` is the honest signal that we
   * are assuming, not quoting: the holder may keep a separate wallet key and
   * be unable to unlock anything sent to their identity key.
   */
  source: 'nutzapInfo' | 'identityFallback';
  /** Mints they said they accept. Empty means they named none. */
  mints: string[];
  /** Relays they said they read nutzaps from. Carried, unused for now. */
  relays: string[];
  /** When the event was published, for cache staleness decisions. */
  updatedAtSec: number | null;
}

/** Minimal event shape this module reads. */
interface NutzapInfoEventLike {
  tags?: unknown;
  created_at?: unknown;
}

function normalizeTags(input: unknown): string[][] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is string[] => Array.isArray(t) && typeof t[0] === 'string');
}

/**
 * Normalizes a relay url the same way the DM relay list does, and for the same
 * reason: these urls are attacker-supplied and go straight to a pool.
 */
function safeRelay(url: string): string | null {
  try {
    const normalized = normalizeURL(url);
    const { protocol } = new URL(normalized);
    return protocol === 'wss:' || protocol === 'ws:' ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * A mint url we would be willing to take ecash from. Same rule the payment
 * parser applies: https only, since a mint url reached over plain http is a
 * man-in-the-middle away from being someone else's mint.
 */
function safeMint(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' ? parsed.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * The lock key a `["pubkey", …]` tag names.
 *
 * NIP-61 says clients MUST prefix the key they lock with `02`, and wallets in
 * the wild write the tag both ways — 32-byte x-only, or already compressed.
 * Read both; emit the compressed form either way.
 */
function readLockKey(value: string): CashuP2pkPubkey | null {
  const trimmed = value.trim().toLowerCase();
  if (CASHU_P2PK_PUBKEY_RE.test(trimmed)) return trimmed as CashuP2pkPubkey;
  try {
    return cashuP2pkPubkeyFromNostrHex(trimmed);
  } catch {
    return null;
  }
}

/**
 * Read a `kind:10019` event, or assume the identity key when there is none.
 *
 * Never throws and never returns null: a caller deciding whether to offer a
 * lock needs an answer for every recipient, and `source` carries the
 * difference between a declared key and our assumption.
 */
export function readNutzapInfo(
  event: NutzapInfoEventLike | null | undefined,
  identityPubkeyHex: string
): NutzapProfile {
  const fallback: NutzapProfile = {
    lockKey: cashuP2pkPubkeyFromNostrHex(identityPubkeyHex),
    source: 'identityFallback',
    mints: [],
    relays: [],
    updatedAtSec: null,
  };
  if (!event) return fallback;

  const tags = normalizeTags(event.tags);
  const declaredKey = tags
    .filter((tag) => tag[0] === 'pubkey' && typeof tag[1] === 'string')
    .map((tag) => readLockKey(tag[1] as string))
    .find((key): key is CashuP2pkPubkey => key !== null);

  const mints = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== 'mint' || typeof tag[1] !== 'string') continue;
    const url = safeMint(tag[1]);
    if (url) mints.add(url);
  }

  const relays = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== 'relay' || typeof tag[1] !== 'string') continue;
    const url = safeRelay(tag[1]);
    if (url) relays.add(url);
  }

  const updatedAtSec =
    typeof event.created_at === 'number' && Number.isFinite(event.created_at)
      ? event.created_at
      : null;

  return {
    // A kind:10019 with no readable pubkey tag tells us where they take ecash
    // but not which key can unlock it, so the key stays an assumption even
    // though the mints and relays are theirs.
    lockKey: declaredKey ?? fallback.lockKey,
    source: declaredKey ? 'nutzapInfo' : 'identityFallback',
    mints: [...mints],
    relays: [...relays],
    updatedAtSec,
  };
}
