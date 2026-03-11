import { useEffect, useMemo, useState } from 'react';
import { NDKEvent, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { decryptNip04Events } from '../lib/decryptNip04Events';

const DEFAULT_CONTACTS = [
  {
    npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
    label: 'Sovran',
  },
  {
    npub: 'npub1ceel7z6ly287kz4mzqqcsgtc6nzc30zw2ru9w9e4gj64gw69f7qscyf0p8',
    label: 'kelbie',
  },
];

interface NostrKeys {
  pubkey?: string;
  privateKey?: Uint8Array;
}

export function useRecentContacts(nostrKeys: NostrKeys | null) {
  const defaultContactPubkeys = useMemo(
    () =>
      DEFAULT_CONTACTS.map((contact) => ({
        pubkey: npubToPubkey(contact.npub),
        label: contact.label,
      })),
    []
  );

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

  const unwrappedDMs = useMemo(() => {
    if (!giftWrapEvents?.length || !nostrKeys?.privateKey) return [];
    return giftWrapEvents
      .map((event) => {
        const unwrapped = unwrapGiftWrap(
          { content: event.content, pubkey: event.pubkey },
          nostrKeys.privateKey
        );
        if (!unwrapped) return null;
        return { ...unwrapped, wrapId: event.id };
      })
      .filter((dm): dm is NonNullable<typeof dm> => dm !== null);
  }, [giftWrapEvents, nostrKeys?.privateKey]);

  const [decryptedContacts, setDecryptedContacts] = useState<any[]>([]);

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

    return Array.from(contactMap.entries())
      .map(([pubkey, entry]) => ({
        type: 'contact',
        pubkey,
        dmEvent: entry.type === 'nip04' ? entry.event : null,
        nip17Content: entry.type === 'nip17' ? entry.dm?.content : undefined,
        timestamp: entry.timestamp,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [dmEvents, unwrappedDMs, nostrKeys?.pubkey]);

  // Merge default contacts with recent activity contacts
  const contactsWithDefaults = useMemo(() => {
    const existingPubkeys = new Set(recentActivityContacts.map((c) => c.pubkey));

    const defaultsToAdd = defaultContactPubkeys
      .filter((dc) => !existingPubkeys.has(dc.pubkey))
      .map((dc) => ({
        type: 'contact' as const,
        pubkey: dc.pubkey,
        dmEvent: null,
        nip17Content: undefined as string | undefined,
        timestamp: 0,
        isDefault: true,
      }));

    return [...recentActivityContacts, ...defaultsToAdd];
  }, [recentActivityContacts, defaultContactPubkeys]);

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
        const results = await decryptNip04Events(contactsWithDefaults, nostrKeys.privateKey);
        if (!cancelled) setDecryptedContacts(results);
      } catch {
        if (!cancelled) setDecryptedContacts(contactsWithDefaults);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contactsWithDefaults, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  // Overlay decrypted message content per-pubkey when available
  const displayContacts = useMemo(() => {
    const decryptedByPubkey = new Map<string, any>();
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
