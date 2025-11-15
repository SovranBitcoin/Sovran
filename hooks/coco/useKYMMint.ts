import { useState, useEffect } from 'react';
import { KYMHandler } from 'cashu-kym';

// Infer types from KYMHandler's discover method
type KYMDiscoverResult = Awaited<ReturnType<KYMHandler['discover']>>;
type AuditInfo = KYMDiscoverResult['results'][number];

interface UseKYMMintResult {
  score?: number;
  recommendations?: AuditInfo['recommendations'];
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch KYM rating data for a specific mint URL
 *
 * @param mintUrl - The mint URL to fetch rating data for
 * @returns Rating data including score, recommendations, loading state, and error
 */
export const useKYMMint = (mintUrl?: string): UseKYMMintResult => {
  const [score, setScore] = useState<number | undefined>();
  const [recommendations, setRecommendations] = useState<
    AuditInfo['recommendations'] | undefined
  >();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mintUrl) {
      setScore(undefined);
      setRecommendations(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    const loadKYMData = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log(`🔍 Fetching KYM rating data for mint: ${mintUrl}`);

        // Initialize KYM handler with same config as useDiscoveredMints
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

        // Discover all mints and find the one matching our URL
        const result = await handler.discover();

        // Normalize URLs for comparison (remove trailing slashes)
        const normalizedMintUrl = mintUrl.replace(/\/$/, '');

        // Find the mint matching our URL
        const matchingMint = result.results.find(
          (mint) => mint.url.replace(/\/$/, '') === normalizedMintUrl
        );

        if (matchingMint) {
          setScore(matchingMint.score);
          setRecommendations(matchingMint.recommendations);
          console.log(
            `✅ Found KYM rating data for ${mintUrl}: score=${matchingMint.score}, recommendations=${matchingMint.recommendations?.length || 0}`
          );
        } else {
          console.log(`⚠️ Mint ${mintUrl} not found in KYM database`);
          setScore(undefined);
          setRecommendations(undefined);
        }
      } catch (err) {
        console.error('❌ Failed to load KYM rating data:', err);
        setError('Failed to load rating data');
        setScore(undefined);
        setRecommendations(undefined);
      } finally {
        setLoading(false);
      }
    };

    loadKYMData();
  }, [mintUrl]);

  return { score, recommendations, loading, error };
};
