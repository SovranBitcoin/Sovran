import { useState, useEffect } from 'react';
import { KYMHandler } from 'cashu-kym';
import { fetchMintInfo } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';

// Infer types from KYMHandler's discover method
type KYMDiscoverResult = Awaited<ReturnType<KYMHandler['discover']>>;
type AuditInfo = KYMDiscoverResult['results'][number];

interface UseAuditedMintResult {
  auditInfo?: AuditInfo;
  mintInfo?: GetInfoResponse;
  loading: boolean;
  error?: string;
}

export const useAuditedMint = (mintUrl?: string): UseAuditedMintResult => {
  const [auditInfo, setAuditInfo] = useState<AuditInfo>();
  const [mintInfo, setMintInfo] = useState<GetInfoResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!mintUrl) {
      setAuditInfo(undefined);
      setMintInfo(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const loadMint = async () => {
      try {
        setLoading(true);
        setError(undefined);

        console.log(`🔍 Fetching audit data for mint: ${mintUrl}`);

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

        // Discover mints and find the specific one
        const result = await handler.discover();
        const mintAudit = result.results.find((mint) => mint.url === mintUrl);

        if (mintAudit) {
          setAuditInfo(mintAudit);
          console.log(`✅ Got audit info for ${mintUrl}`);
        } else {
          console.warn(`⚠️ Mint not found in KYM discovery: ${mintUrl}`);
          setAuditInfo(undefined);
        }

        // Fetch mint info
        const mintInfoResult = await fetchMintInfo(mintUrl);
        if (mintInfoResult.isOk()) {
          setMintInfo(mintInfoResult.value);
          console.log(`✅ Got mint info for ${mintUrl}`);
        } else {
          console.warn(`⚠️ Failed to get mint info for ${mintUrl}:`, mintInfoResult.error.message);
          setMintInfo(undefined);
        }
      } catch (err) {
        console.error('❌ Failed to load mint data:', err);
        setError('Failed to load mint information');
        setAuditInfo(undefined);
        setMintInfo(undefined);
      } finally {
        setLoading(false);
      }
    };

    loadMint();
  }, [mintUrl]);

  return { auditInfo, mintInfo, loading, error };
};
