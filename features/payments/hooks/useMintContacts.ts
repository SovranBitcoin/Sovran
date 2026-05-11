import { useEffect, useMemo, useState } from 'react';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import type { Mint } from '@cashu/coco-core';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { paymentLog } from '@/shared/lib/logger';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { prefetchImages } from '@/shared/lib/imageCache';
import { decryptNip04Events } from '../lib/decryptNip04Events';

interface NostrKeys {
  pubkey?: string;
  privateKey?: Uint8Array;
}

interface MintWithInfo {
  mint: Mint;
  mintInfo: GetInfoResponse;
}

export interface MintContact {
  type: 'mint';
  pubkey: string | null;
  mint: Mint;
  mintInfo: GetInfoResponse;
  dmEvent: NDKEvent | { content: string } | undefined;
  timestamp: number;
}

export function useMintContacts(
  nostrKeys: NostrKeys | null,
  mints: Mint[],
  getMintInfo: (url: string) => Promise<GetInfoResponse>,
  dmEvents: NDKEvent[] | null | undefined
) {
  const [mintsWithInfo, setMintsWithInfo] = useState<MintWithInfo[]>([]);
  const [mintInfoLoading, setMintInfoLoading] = useState(false);
  const [decryptedMints, setDecryptedMints] = useState<MintContact[]>([]);

  // Coco's mint:* event cascade replaces the `mints` array reference on every
  // event (mint:added / mint:updated / mint:trusted / mint:untrusted), even
  // when the trusted-set is unchanged. Key the load on the sorted url-set so a
  // no-op refresh does not retrigger the Promise.all(getMintInfo) waterfall.
  const mintUrlsKey = useMemo(
    () =>
      mints
        .map((m) => m.mintUrl)
        .sort()
        .join('|'),
    [mints]
  );

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
              const mintInfo = await getMintInfo(mint.mintUrl);
              return { mint, mintInfo };
            } catch (err) {
              paymentLog.warn('payment.mint.contacts.info_failed', {
                mintUrl: mint.mintUrl,
                error: err instanceof Error ? err : new Error(String(err)),
              });
              return { mint, mintInfo: null };
            }
          })
        );
        if (cancelled) return;

        const withNostr: MintWithInfo[] = results.filter(
          (r): r is MintWithInfo =>
            r.mintInfo !== null &&
            Array.isArray(r.mintInfo.contact) &&
            r.mintInfo.contact.some(
              (c) =>
                c.method === 'nostr' && typeof c.info === 'string' && c.info.startsWith('npub1')
            )
        );
        paymentLog.info('payment.mint.contacts.loaded', {
          totalMints: mints.length,
          withNostr: withNostr.length,
        });
        setMintsWithInfo(withNostr);
      } catch (err) {
        paymentLog.error('payment.mint.contacts.error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
      } finally {
        if (!cancelled) setMintInfoLoading(false);
      }
    };

    void loadMintInfo();
    return () => {
      cancelled = true;
    };
    // mintUrlsKey + getMintInfo are the real inputs; the closed-over `mints`
    // is value-stable when the key is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintUrlsKey, getMintInfo]);

  // Prefetch mint icons
  useEffect(() => {
    void prefetchImages(mintsWithInfo.map(({ mintInfo }) => mintInfo?.icon_url));
  }, [mintsWithInfo]);

  // NDK's useSubscribe returns a fresh `dmEvents` array reference on every
  // relay flush even when the event-id set is unchanged. Key the metadata
  // memo on the sorted id-set so unchanged relay output does not cascade
  // into a fresh decryption pass downstream.
  const dmEventsKey = useMemo(
    () =>
      dmEvents
        ?.map((e) => e.id)
        .sort()
        .join(',') ?? '',
    [dmEvents]
  );

  // Build mints with most recent DM metadata
  const mintsWithMetadata = useMemo<MintContact[]>(() => {
    const dmMap = new Map<string, NDKEvent>();
    dmEvents?.forEach((event) => {
      const otherPubkey =
        event.pubkey === nostrKeys?.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;
      if (!otherPubkey) return;

      const existing = dmMap.get(otherPubkey);
      if (!existing || (event.created_at && event.created_at > (existing.created_at ?? 0))) {
        dmMap.set(otherPubkey, event);
      }
    });

    return mintsWithInfo.map(({ mint, mintInfo }) => {
      let mintPubkey: string | null = null;
      const nostrContact = mintInfo.contact?.find((c) => c.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch (err) {
          paymentLog.warn('payment.mint.contacts.npub_decode_failed', {
            mintUrl: mint.mintUrl,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      const dmEvent = mintPubkey ? dmMap.get(mintPubkey) : undefined;
      return {
        type: 'mint',
        pubkey: mintPubkey,
        mint,
        mintInfo,
        dmEvent,
        timestamp: dmEvent?.created_at ?? 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintsWithInfo, dmEventsKey, nostrKeys?.pubkey]);

  // Decrypt mint DM events
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!mintsWithMetadata.length || !nostrKeys?.pubkey || !nostrKeys?.privateKey) {
        setDecryptedMints([]);
        return;
      }
      try {
        const results = await decryptNip04Events(mintsWithMetadata, {
          privateKey: nostrKeys.privateKey,
          recipientPubkey: nostrKeys.pubkey,
        });
        paymentLog.debug('payment.mint.contacts.decrypt', { decryptedCount: results.length });
        if (!cancelled) setDecryptedMints(results);
      } catch (err) {
        paymentLog.error('payment.mint.contacts.decrypt.error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        if (!cancelled) setDecryptedMints(mintsWithMetadata);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mintsWithMetadata, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  // Merge display mints
  const displayMints = useMemo<MintContact[]>(() => {
    const decryptedByKey = new Map<string, MintContact>();
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
