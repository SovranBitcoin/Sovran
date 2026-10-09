import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mint } from '@cashu/coco-core';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { paymentLog, mintUrlLogFields } from '@/shared/lib/logger';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { prefetchImages } from '@/shared/lib/imageCache';
import type { DmConversation } from './useDmConversations';

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
  dmEvent: { content: string; isOwn?: boolean } | undefined;
  timestamp: number;
}

/** Mint info requests in flight at once; a miss is an HTTP round trip to the mint. */
const MINT_INFO_CONCURRENCY = 4;

export function useMintContacts(
  _nostrKeys: NostrKeys | null,
  mints: Mint[],
  getMintInfo: (url: string) => Promise<GetInfoResponse>,
  // NIP-17 conversations (already decrypted + bucketed by counterparty) supply the
  // mint's last-DM preview. Replaces the legacy kind-4 relay events.
  conversations?: DmConversation[]
) {
  const [mintsWithInfo, setMintsWithInfo] = useState<MintWithInfo[]>([]);
  const [mintInfoLoading, setMintInfoLoading] = useState(false);
  // Info this hook instance already loaded, per `getMintInfo` (a new wallet
  // manager brings a new one). Adding or removing a mint then asks only for the
  // mints it has not seen; a failed mint is not recorded, so it is asked again.
  const loadedRef = useRef<{
    getMintInfo: (url: string) => Promise<GetInfoResponse>;
    byUrl: Map<string, GetInfoResponse>;
  } | null>(null);

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
    if (loadedRef.current?.getMintInfo !== getMintInfo) {
      loadedRef.current = { getMintInfo, byUrl: new Map() };
    }
    // Captured, so a run superseded by a new `getMintInfo` fills its own map.
    const loaded = loadedRef.current.byUrl;

    const loadMintInfo = async () => {
      try {
        setMintInfoLoading(true);
        const results: { mint: Mint; mintInfo: GetInfoResponse | null }[] = mints.map((mint) => ({
          mint,
          mintInfo: loaded.get(mint.mintUrl) ?? null,
        }));
        const missing = results.filter((result) => result.mintInfo === null);
        let next = 0;
        const worker = async () => {
          while (next < missing.length) {
            const result = missing[next++];
            try {
              result.mintInfo = await getMintInfo(result.mint.mintUrl);
              loaded.set(result.mint.mintUrl, result.mintInfo);
            } catch (err) {
              paymentLog.warn('payment.mint.contacts.info_failed', {
                ...mintUrlLogFields(result.mint.mintUrl),
                error: err instanceof Error ? err : new Error(String(err)),
              });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(MINT_INFO_CONCURRENCY, missing.length) }, worker)
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

  // Resolve each mint's nostr contact pubkey and attach its latest NIP-17 DM
  // preview (if any). Conversations are already decrypted, so there's no
  // per-mint decryption pass anymore.
  const displayMints = useMemo<MintContact[]>(() => {
    const dmByPubkey = new Map<string, DmConversation>();
    for (const c of conversations ?? []) dmByPubkey.set(c.counterparty, c);

    return mintsWithInfo.map(({ mint, mintInfo }) => {
      let mintPubkey: string | null = null;
      const nostrContact = mintInfo.contact?.find((c) => c.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch (err) {
          paymentLog.warn('payment.mint.contacts.npub_decode_failed', {
            ...mintUrlLogFields(mint.mintUrl),
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      const convo = mintPubkey ? dmByPubkey.get(mintPubkey) : undefined;
      return {
        type: 'mint',
        pubkey: mintPubkey,
        mint,
        mintInfo,
        dmEvent: convo
          ? { content: convo.lastMessagePreview, isOwn: convo.lastMessageIsOwn }
          : undefined,
        timestamp: convo?.lastMessageAtSec ?? 0,
      };
    });
  }, [mintsWithInfo, conversations]);

  const mintPubkeys = useMemo(
    () => displayMints.map((m) => m.pubkey).filter((p): p is string => !!p),
    [displayMints]
  );

  return { displayMints, mintPubkeys, mintInfoLoading };
}
