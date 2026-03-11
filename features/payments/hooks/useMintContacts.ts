import { useEffect, useMemo, useState } from 'react';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import type { Mint } from 'coco-cashu-core';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { prefetchImages } from '@/shared/lib/imageCache';
import { decryptNip04Events } from '../lib/decryptNip04Events';

interface NostrKeys {
  pubkey?: string;
  privateKey?: Uint8Array;
}

export function useMintContacts(
  nostrKeys: NostrKeys | null,
  mints: Mint[],
  getMintInfo: (url: string) => Promise<any>,
  dmEvents: NDKEvent[] | null | undefined
) {
  const [mintsWithInfo, setMintsWithInfo] = useState<{ mint: Mint; mintInfo: any }[]>([]);
  const [mintInfoLoading, setMintInfoLoading] = useState(false);
  const [decryptedMints, setDecryptedMints] = useState<any[]>([]);

  // Load mint info and filter for those with nostr contacts
  useEffect(() => {
    if (mints.length === 0) return;
    let cancelled = false;

    const loadMintInfo = async () => {
      try {
        setMintInfoLoading(true);
        const results = await Promise.all(
          mints.map(async (mint) => {
            try {
              return { mint, mintInfo: await getMintInfo(mint.mintUrl) };
            } catch {
              return { mint, mintInfo: null };
            }
          })
        );
        if (cancelled) return;

        const withNostr = results.filter(({ mintInfo }) => {
          if (!mintInfo?.contact) return false;
          const nostrContact = mintInfo.contact.find((c: any) => c.method === 'nostr');
          return nostrContact?.info?.startsWith('npub1');
        });
        setMintsWithInfo(withNostr);
      } catch {
        // Mint info loading failed silently
      } finally {
        if (!cancelled) setMintInfoLoading(false);
      }
    };

    loadMintInfo();
    return () => {
      cancelled = true;
    };
  }, [mints, getMintInfo]);

  // Prefetch mint icons
  useEffect(() => {
    prefetchImages(mintsWithInfo.map(({ mintInfo }) => mintInfo?.icon_url));
  }, [mintsWithInfo]);

  // Build mints with most recent DM metadata
  const mintsWithMetadata = useMemo(() => {
    const dmMap = new Map();
    dmEvents?.forEach((event) => {
      const otherPubkey =
        event.pubkey === nostrKeys?.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;
      if (!otherPubkey) return;

      const existing = dmMap.get(otherPubkey);
      if (!existing || (event.created_at && event.created_at > existing.created_at)) {
        dmMap.set(otherPubkey, event);
      }
    });

    return mintsWithInfo.map(({ mint, mintInfo }) => {
      let mintPubkey = null;
      const nostrContact = mintInfo.contact?.find((c: any) => c.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch {
          // ignore decode failure
        }
      }

      return {
        type: 'mint',
        pubkey: mintPubkey,
        mint,
        mintInfo,
        dmEvent: mintPubkey ? dmMap.get(mintPubkey) : undefined,
        timestamp: mintPubkey ? dmMap.get(mintPubkey)?.created_at || 0 : 0,
      };
    });
  }, [mintsWithInfo, dmEvents, nostrKeys?.pubkey]);

  // Decrypt mint DM events
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!mintsWithMetadata.length || !nostrKeys?.pubkey || !nostrKeys?.privateKey) {
        setDecryptedMints([]);
        return;
      }
      try {
        const results = await decryptNip04Events(mintsWithMetadata, nostrKeys.privateKey);
        if (!cancelled) setDecryptedMints(results);
      } catch {
        if (!cancelled) setDecryptedMints(mintsWithMetadata);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [mintsWithMetadata, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  // Merge display mints
  const displayMints = useMemo(() => {
    const decryptedByKey = new Map<string, any>();
    decryptedMints.forEach((m) => {
      const key = m.pubkey || m.mint?.mintUrl;
      if (key) decryptedByKey.set(key, m);
    });

    return mintsWithMetadata.map((m) => {
      const key = m.pubkey || m.mint?.mintUrl;
      const decrypted = key ? decryptedByKey.get(key) : undefined;
      if (decrypted) return decrypted;
      return { ...m, dmEvent: undefined };
    });
  }, [decryptedMints, mintsWithMetadata]);

  const mintPubkeys = useMemo(
    () => mintsWithMetadata.map((m) => m.pubkey).filter((p): p is string => !!p),
    [mintsWithMetadata]
  );

  return { displayMints, mintPubkeys, mintInfoLoading };
}
