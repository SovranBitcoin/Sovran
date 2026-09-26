/**
 * @fileoverview The single answer to "does this transaction have a person to
 * show, and who is it".
 *
 * A transaction reaches a detail screen carrying its counterparty in one of
 * three shapes, and each screen used to test for them on its own:
 *
 *  1. The live send flow's transient preview metadata (`recipientPubkey` plus
 *     `recipientDisplayName` / `recipientAvatarUrl`), stamped by
 *     `navigateToMeltPreview`. It is gone as soon as the synthetic preview is
 *     replaced by the persisted row, which is why the collapsed header used to
 *     fall back to "Send Lightning" the moment a payment started processing.
 *  2. The persisted counterparty annotation (Nut Drop, chat → send money, a
 *     lightning-address payee that resolved to a nostr identity). It survives
 *     onto history, so a re-opened transaction still names the person.
 *  3. The persisted zap annotation — a post payment names the post's AUTHOR,
 *     who is exactly the person that was paid.
 *
 * Whatever the shape, an identity is only offered when the person can be
 * NAMED: `resolveIdentityName`'s deterministic word pair over a bare pubkey
 * tells the user less than the screen's own title, so an unresolved pubkey
 * keeps the plain title.
 */

import { getCounterparty, getZap, normalizeNostrPubkey } from 'wallet';

import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import type { HeaderIdentity } from '@/shared/ui/composed/IdentityHeader';

/** Any entry whose annotation record has been merged into `metadata`. */
type AnnotatedEntry = { metadata?: Record<string, string> | undefined };

/** What the transaction itself knows about the person, before any live lookup. */
interface TransactionIdentitySnapshot {
  pubkey: string;
  /** Name captured when the payment was made; beats the live profile. */
  name?: string;
  picture?: string;
}

function metadataString(entry: AnnotatedEntry, key: string): string | undefined {
  const value = entry.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The counterparty this transaction carries, highest confidence first. Pure and
 * synchronous, so a screen can decide its layout (scroll mode, probes) from it
 * at mount instead of waiting on a profile fetch.
 */
export function transactionIdentitySnapshot(
  entry: AnnotatedEntry | null | undefined
): TransactionIdentitySnapshot | undefined {
  if (!entry) return undefined;
  const recipientPubkey = normalizeNostrPubkey(metadataString(entry, 'recipientPubkey') ?? '');
  if (recipientPubkey) {
    return {
      pubkey: recipientPubkey,
      name: metadataString(entry, 'recipientDisplayName'),
      picture: metadataString(entry, 'recipientAvatarUrl'),
    };
  }
  const counterparty = getCounterparty(entry);
  const counterpartyPubkey = normalizeNostrPubkey(counterparty?.pubkey ?? '');
  if (counterpartyPubkey) {
    return {
      pubkey: counterpartyPubkey,
      name: counterparty?.displayName,
      picture: counterparty?.avatarUrl,
    };
  }
  const zap = getZap(entry);
  const authorPubkey = normalizeNostrPubkey(zap?.authorPubkey ?? '');
  if (authorPubkey) {
    return {
      pubkey: authorPubkey,
      name: zap?.authorName,
      picture: zap?.authorAvatarUrl,
    };
  }
  return undefined;
}

/**
 * The header identity for a transaction: the snapshot it carries, filled in
 * from the live kind-0 for anything it is missing. Undefined when no source
 * names the person — the caller keeps its plain title.
 */
export function useTransactionIdentity(
  entry: AnnotatedEntry | null | undefined
): HeaderIdentity | undefined {
  const snapshot = transactionIdentitySnapshot(entry);
  const { metadata, isResolving } = useNostrProfileMetadata(snapshot?.pubkey);
  if (!snapshot) return undefined;
  // Without a `pubkey` input `resolveIdentityName` never substitutes a word
  // pair, so 'Unknown' means precisely "nothing named this person".
  const name = resolveIdentityName({ overrideName: snapshot.name, nostrProfile: metadata });
  if (name === 'Unknown') return undefined;
  const picture = snapshot.picture ?? metadata?.picture ?? null;
  return {
    name,
    seed: snapshot.pubkey,
    picture,
    kind: 'person',
    // A named person whose picture is still in flight holds the placeholder
    // rather than flashing the seeded fallback the fetch is about to replace.
    isLoading: !picture && isResolving,
  };
}
