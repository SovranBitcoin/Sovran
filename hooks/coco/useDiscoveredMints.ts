import { useState, useEffect } from 'react';
import { KYMHandler } from 'cashu-kym';
import { fetchMintInfo } from 'helper/apiClient';
import type { CashuMint } from '@cashu/cashu-ts';

type MintInfo = Awaited<ReturnType<CashuMint['getInfo']>>;

interface AuditorEntry {
  url: string;
  name: string;
  updated_at: Date;
  state: string;
  errors: number;
  mints: number;
  melts: number;
}

interface AggregatedMintRecommendation {
  score: number;
  recommendations: {
    score: number;
    comment: string;
  }[];
}

export interface DiscoveredMintData {
  url: string;
  auditInfo: AggregatedMintRecommendation & {
    auditorData: AuditorEntry;
    speedIndex?: number;
  };
  mintInfo: MintInfo | null;
}

interface UseDiscoveredMintsOptions {
  excludeUrls?: Set<string>;
}

interface UseDiscoveredMintsResult {
  mints: DiscoveredMintData[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export const useDiscoveredMints = (
  options: UseDiscoveredMintsOptions = {}
): UseDiscoveredMintsResult => {
  const { excludeUrls = new Set() } = options;
  const [mints, setMints] = useState<DiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const loadMints = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('🔍 Starting mint discovery...');

        // Initialize KYM handler
        const handler = new KYMHandler({
          auditorBaseUrl: 'https://api.audit.8333.space',
          relays: [
            'wss://purplepag.es',
            'wss://relay.primal.net',
            'wss://nostr.thank.eu',
            'wss://relay.vanderwarker.family',
            'wss://nostr-relay.bitcoin.ninja',
            'wss://lnbits.btc-payserver.eu/nostrrelay/1',
            'wss://relay.damus.io',
            'wss://nostr.girino.org',
            'wss://relay.8333.space/',
            'wss://relay.snort.social',
            'wss://nostr.mutinywallet.com',
            'wss://nos.lol',
            'wss://relay.nostr.band/all',
            'wss://relay.roli.social',
            'wss://deschooling.us',
            'wss://relay-verified.deschooling.us',
            'wss://feeds.nostr.band/nostrhispano',
            'wss://search.nos.today',
            'wss://nostr-relay.app',
            'wss://nb.relay.center',
            'wss://nostrja-kari-nip50.heguro.com',
            'wss://nfdn.betanet.dotalgo.io',
            'wss://saltivka.org',
            'wss://filter.stealth.wine?broadcast=true',
            'wss://nostr.novacisko.cz',
            'wss://relay.noswhere.com',
            'wss://relay1.nostrchat.io',
            'wss://relay2.nostrchat.io',
          ],
          timeout: 5000,
        });

        console.log('🔍 Discovering mints with KYM handler...');
        const result = await handler.discover();
        console.log('✅ KYM discovery result:', result.results.length, 'mints found');

        if (!result.results || result.results.length === 0) {
          console.warn('⚠️ No mints discovered');
          setMints([]);
          return;
        }

        console.log('🔍 Processing discovered mints sequentially...');

        const processedMints: DiscoveredMintData[] = [];

        for (let i = 0; i < result.results.length; i++) {
          const mint = result.results[i];

          // Skip excluded URLs
          if (excludeUrls.has(mint.url)) {
            console.log(`⏭️ Skipping excluded mint: ${mint.url}`);
            continue;
          }

          try {
            console.log(`🔍 Processing mint ${i + 1}/${result.results.length}: ${mint.url}`);

            // Add a small delay between requests to be respectful to mint endpoints
            if (i > 0) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            const mintInfoResult = await fetchMintInfo(mint.url);

            const discoveredMint: DiscoveredMintData = {
              url: mint.url,
              auditInfo: mint,
              mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
            };

            if (mintInfoResult.isOk()) {
              console.log(`✅ Got mint info for ${mint.url}`);
            } else {
              console.warn(
                `⚠️ Failed to get mint info for ${mint.url}:`,
                mintInfoResult.error.message
              );
            }

            processedMints.push(discoveredMint);
          } catch (err) {
            console.warn(`⚠️ Error processing mint ${mint.url}:`, err);
            // Still add the mint without mintInfo if it fails
            processedMints.push({
              url: mint.url,
              auditInfo: mint,
              mintInfo: null,
            });
          }
        }

        console.log('✅ Successfully processed', processedMints.length, 'mints');
        setMints(processedMints);
      } catch (err) {
        console.error('❌ Failed to load mints:', err);
        console.error('❌ Error details:', {
          message: err instanceof Error ? err.message : 'Unknown error',
          stack: err instanceof Error ? err.stack : undefined,
          name: err instanceof Error ? err.name : undefined,
        });
        setError('Failed to load mint recommendations. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadMints();
  }, [excludeUrls, retryCount]);

  const retry = () => {
    setRetryCount((prev) => prev + 1);
  };

  return { mints, loading, error, retry };
};
