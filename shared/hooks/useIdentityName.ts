import { useMemo } from 'react';
import {
  useNostrProfileMetadata,
  useNostrProfileMetadataMany,
} from './useNostrProfileMetadata';
import {
  resolveIdentityName,
  type IdentityNameInputs,
} from '@/shared/lib/identity';

/**
 * Resolves a single pubkey to a human-readable name using the canonical
 * hierarchy (see {@link resolveIdentityName}). Reads from the shared
 * `nostrMetadataCache` synchronously and triggers a single SWR
 * subscription if the entry is missing or stale — same semantics as
 * `useNostrProfileMetadata`. Always returns a non-empty `displayName`,
 * including while the kind-0 fetch is in flight (falls through to the
 * deterministic word pair).
 *
 * `extra` lets callers feed in mint / BLE / override data at the same
 * time so the helper picks the highest-priority source automatically.
 *
 * @example
 * const { displayName } = useIdentityName(counterpartyPubkey);
 * <Text>{displayName}</Text>
 *
 * @example
 * // Mint contact: mint name wins over the operator's Nostr displayName.
 * const { displayName } = useIdentityName(mintNostrPubkey, {
 *   mintName: mint.mintInfo?.name,
 * });
 */
export function useIdentityName(
  pubkey: string | undefined | null,
  extra?: Omit<IdentityNameInputs, 'pubkey' | 'nostrProfile'>
): { displayName: string; isLoading: boolean } {
  const { metadata, isLoading } = useNostrProfileMetadata(pubkey ?? undefined);

  const displayName = useMemo(
    () =>
      resolveIdentityName({
        pubkey: pubkey ?? undefined,
        nostrProfile: metadata,
        ...extra,
      }),
    [pubkey, metadata, extra]
  );

  return { displayName, isLoading };
}

/**
 * Batched variant for list rendering. Subscribes to one kind-0 query for
 * every pubkey at once (via `useNostrProfileMetadataMany`) and returns a
 * `Map<pubkey, displayName>`. Each entry is always a non-empty string —
 * unresolved pubkeys fall through to the deterministic word pair.
 */
export function useIdentityNames(
  pubkeys: readonly string[]
): ReadonlyMap<string, string> {
  const { metadata } = useNostrProfileMetadataMany(pubkeys);

  return useMemo(() => {
    const out = new Map<string, string>();
    for (const pk of pubkeys) {
      out.set(
        pk,
        resolveIdentityName({ pubkey: pk, nostrProfile: metadata.get(pk) })
      );
    }
    return out;
  }, [pubkeys, metadata]);
}
