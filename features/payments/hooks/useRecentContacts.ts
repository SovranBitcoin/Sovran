import { useEffect, useMemo, useState } from 'react';
import { NDKEvent, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { paymentLog } from '@/shared/lib/logger';
import { PUBLIC_KEYS } from '@/shared/lib/constants';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
import { getCachedUnwrap, hydrateGiftWrapCache, putUnwrap } from '@/shared/lib/nostr/giftWrapCache';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { decryptNip04Events } from '../lib/decryptNip04Events';

const DEFAULT_CONTACTS = [{ pubkey: PUBLIC_KEYS.SUPPORT, label: 'Sovran' }] as const;

interface NostrKeys {
  pubkey?: string;
  privateKey?: Uint8Array;
}

export interface RecentContact {
  type: 'contact';
  pubkey: string;
  dmEvent: NDKEvent | { content: string } | null | undefined;
  nip17Content: string | undefined;
  timestamp: number;
  isDefault?: boolean;
}

export function useRecentContacts(nostrKeys: NostrKeys | null) {
  // NIP-04 DM subscription
  const dmFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [
      { kinds: [EncryptedDirectMessage], authors: [nostrKeys.pubkey] },
      { kinds: [EncryptedDirectMessage], '#p': [nostrKeys.pubkey] },
    ];
  }, [nostrKeys?.pubkey]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // NIP-17 gift-wrap subscription
  const giftWrapFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [{ kinds: [1059 as number], '#p': [nostrKeys.pubkey] }];
  }, [nostrKeys?.pubkey]);

  const { events: giftWrapEvents } = useSubscribe({ filters: giftWrapFilters });

  // Warm the persistent unwrap cache as soon as we know which profile is
  // active. The cache hydrates from AsyncStorage in the background — by
  // the time `unwrappedDMs` runs (after the first relay tick), most or
  // all entries are in memory, so the loop below short-circuits to
  // `getCachedUnwrap` for previously-seen wraps and only pays the
  // secp256k1 ECDH cost on genuinely new wraps.
  useEffect(() => {
    if (nostrKeys?.pubkey) {
      void hydrateGiftWrapCache(nostrKeys.pubkey);
    }
  }, [nostrKeys?.pubkey]);

  const unwrappedDMs = useMemo(() => {
    const privateKey = nostrKeys?.privateKey;
    const recipientPubkey = nostrKeys?.pubkey;
    if (!giftWrapEvents?.length || !privateKey || !recipientPubkey) return [];
    const t0 = performance.now();
    let cacheHits = 0;
    let unwrapped = 0;
    let failed = 0;
    let nonDm = 0;
    const out = giftWrapEvents
      .map((event) => {
        // L1 hit: skip the two NIP-44 decrypts entirely.
        const cached = getCachedUnwrap(recipientPubkey, event.id);
        if (cached) {
          cacheHits++;
          return { ...cached, wrapId: event.id };
        }
        const fresh = unwrapGiftWrap({ content: event.content, pubkey: event.pubkey }, privateKey);
        if (!fresh) {
          failed++;
          return null;
        }
        // Persist for the next session — the same wraps will keep
        // arriving from relays on every `useSubscribe`, and we don't
        // want to pay the unwrap cost again next launch.
        putUnwrap(recipientPubkey, event.id, fresh);
        unwrapped++;
        return { ...fresh, wrapId: event.id };
      })
      // Drop non-NIP-17 inner rumors. kind-1059 is overloaded across the
      // Nostr ecosystem — Marmot Welcomes (kind 444), MLS proposals, and
      // other application rumors all share the same gift-wrap envelope.
      // Recent contacts should only surface actual chat DMs (kind 14),
      // otherwise an MLS invite from a stranger leaks into the Recent
      // pill as a skeleton row.
      .filter((dm): dm is NonNullable<typeof dm> => {
        if (dm === null) return false;
        if (dm.kind !== 14) {
          nonDm++;
          return false;
        }
        return true;
      });
    paymentLog.debug('payment.contacts.unwrap_pass', {
      total: giftWrapEvents.length,
      cacheHits,
      unwrapped,
      failed,
      nonDm,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
    return out;
  }, [giftWrapEvents, nostrKeys?.privateKey, nostrKeys?.pubkey]);

  const [decryptedContacts, setDecryptedContacts] = useState<RecentContact[]>([]);

  // Build recent activity contacts from NIP-04 and NIP-17 events
  const recentActivityContacts = useMemo(() => {
    if (!nostrKeys?.pubkey) return [];

    const contactMap = new Map<
      string,
      { type: string; event?: NDKEvent; dm?: (typeof unwrappedDMs)[number]; timestamp: number }
    >();

    dmEvents?.forEach((event) => {
      const otherPubkey =
        event.pubkey === nostrKeys.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;
      if (!otherPubkey) return;

      const existing = contactMap.get(otherPubkey);
      const ts = event.created_at || 0;
      if (!existing || ts > existing.timestamp) {
        contactMap.set(otherPubkey, { type: 'nip04', event, timestamp: ts });
      }
    });

    unwrappedDMs.forEach((dm) => {
      const otherPubkey =
        dm.senderPubkey === nostrKeys.pubkey ? dm.recipientPubkeys[0] : dm.senderPubkey;
      if (!otherPubkey) return;

      const existing = contactMap.get(otherPubkey);
      if (!existing || dm.created_at > existing.timestamp) {
        contactMap.set(otherPubkey, { type: 'nip17', dm, timestamp: dm.created_at });
      }
    });

    const contacts: RecentContact[] = Array.from(contactMap.entries())
      .map(([pubkey, entry]) => ({
        type: 'contact' as const,
        pubkey,
        dmEvent: entry.type === 'nip04' ? (entry.event ?? null) : null,
        nip17Content: entry.type === 'nip17' ? entry.dm?.content : undefined,
        timestamp: entry.timestamp,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    paymentLog.debug('payment.contacts.recent', {
      contactCount: contacts.length,
      nip04Events: dmEvents?.length ?? 0,
      nip17Events: unwrappedDMs.length,
    });
    return contacts;
  }, [dmEvents, unwrappedDMs, nostrKeys?.pubkey]);

  // Merge default contacts with recent activity contacts
  const contactsWithDefaults = useMemo<RecentContact[]>(() => {
    const existingPubkeys = new Set(recentActivityContacts.map((c) => c.pubkey));

    const defaultsToAdd: RecentContact[] = DEFAULT_CONTACTS.filter(
      (dc) => !existingPubkeys.has(dc.pubkey)
    ).map((dc) => ({
      type: 'contact',
      pubkey: dc.pubkey,
      dmEvent: null,
      nip17Content: undefined,
      timestamp: 0,
      isDefault: true,
    }));

    return [...recentActivityContacts, ...defaultsToAdd];
  }, [recentActivityContacts]);

  // Decrypt contact DM events
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!contactsWithDefaults.length) {
        setDecryptedContacts([]);
        return;
      }

      if (!nostrKeys?.pubkey || !nostrKeys?.privateKey) {
        setDecryptedContacts(
          contactsWithDefaults.map((c) =>
            c.nip17Content !== undefined ? { ...c, dmEvent: { content: c.nip17Content } } : c
          )
        );
        return;
      }

      try {
        // Split into items that actually need decryption vs passthrough
        const needsDecrypt = contactsWithDefaults.filter(
          (c) => c.dmEvent || c.nip17Content !== undefined
        );
        const passthrough = contactsWithDefaults.filter(
          (c) => !c.dmEvent && c.nip17Content === undefined
        );
        const decrypted =
          needsDecrypt.length > 0
            ? await decryptNip04Events(needsDecrypt, {
                privateKey: nostrKeys.privateKey,
                recipientPubkey: nostrKeys.pubkey,
              })
            : [];
        const results = [...decrypted, ...passthrough];
        paymentLog.debug('payment.contacts.decrypt', { decryptedCount: results.length });
        if (!cancelled) setDecryptedContacts(results);
      } catch (err) {
        paymentLog.error('payment.contacts.decrypt.error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        if (!cancelled) setDecryptedContacts(contactsWithDefaults);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contactsWithDefaults, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  // Overlay decrypted message content per-pubkey when available
  const displayContacts = useMemo<RecentContact[]>(() => {
    const decryptedByPubkey = new Map<string, RecentContact>();
    decryptedContacts.forEach((c) => {
      if (c.pubkey) decryptedByPubkey.set(c.pubkey, c);
    });

    return contactsWithDefaults.map((c) => {
      const decrypted = decryptedByPubkey.get(c.pubkey);
      if (decrypted) return decrypted;
      return {
        ...c,
        dmEvent: c.nip17Content !== undefined ? { content: c.nip17Content } : undefined,
      };
    });
  }, [decryptedContacts, contactsWithDefaults]);

  const contactPubkeys = useMemo(
    () => contactsWithDefaults.map((c) => c.pubkey).filter(Boolean),
    [contactsWithDefaults]
  );

  return { displayContacts, contactPubkeys, dmEvents };
}
