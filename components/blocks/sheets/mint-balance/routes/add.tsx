import React, { useState, useEffect, useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Avatar } from 'components/ui/Avatar';
import { Checkbox } from 'components/ui/Checkbox';
import { showMessage } from 'helper/popup/popups';
import { useMintManagement } from 'hooks/coco';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { KYMHandler } from 'cashu-kym';
import { MintCurrencySelector } from '../MintCurrencySelector';

interface DiscoveredMint {
  url: string;
  score: number;
  recommendations: {
    score: number;
    comment: string;
  }[];
  auditorData?: {
    url: string;
    name: string;
    updated_at: Date;
    state: string;
    errors: number;
    mints: number;
    melts: number;
  };
  // Extended to work with MintCurrencySelector
  mintUrl?: string;
  name?: string;
  amount?: number;
  unit?: string;
  iconUrl?: string | null;
  mintInfo?: any;
}

interface AddMintItemProps {
  mint: DiscoveredMint;
  onToggle: (url: string) => void;
  selected: boolean;
  theme: any;
}

const AddMintItem: React.FC<AddMintItemProps> = ({ mint, onToggle, selected, theme }) => {
  const g = greys(theme);
  const isDisabled = !mint.auditorData;
  const mintUrl = mint.url || mint.mintUrl || '';
  const mintName =
    mint.auditorData?.name || mint.name || mintUrl.replace('https://', '').split('/')[0];

  return (
    <View
      className="overflow-hidden rounded-lg"
      blur
      style={[{ backgroundColor: g[800], marginBottom: 12 }]}>
      <TouchableOpacity disabled={isDisabled} onPress={() => !isDisabled && onToggle(mintUrl)}>
        <HStack
          align="center"
          justify="space-between"
          className={`p-3 ${isDisabled ? 'opacity-50' : ''}`}>
          <HStack align="center">
            <Avatar
              picture={undefined}
              size={42}
              variant="mint"
              name={mintName}
              alt={`${mintName} icon`}
              status={mint.auditorData?.state}
            />

            <VStack className="flex-1" style={{ marginLeft: 12, marginRight: 12 }}>
              <Text style={[{ color: g[0], fontSize: 16 }]}>{mintName}</Text>

              <HStack align="center" gap={8}>
                <Text style={[{ color: g[200], fontSize: 12 }]}>
                  Score: {mint.score.toFixed(1)}/5
                </Text>
                <Text style={[{ color: g[200], fontSize: 12 }]}>
                  ({mint.recommendations.length} reviews)
                </Text>
              </HStack>

              {mint.auditorData && (
                <HStack align="center" gap={8}>
                  <Text style={[{ color: g[300], fontSize: 11 }]}>
                    {mint.auditorData.mints} mints • {mint.auditorData.melts} melts
                  </Text>
                </HStack>
              )}
            </VStack>
          </HStack>

          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(mintUrl)}
            disabled={isDisabled}
            size={24}
            variant="success"
          />
        </HStack>
      </TouchableOpacity>
    </View>
  );
};

const AddRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getBalances } = useMintManagement();

  const [mints, setMints] = useState<DiscoveredMint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Get allowed currencies from payload
  const allowedCurrencies = useMemo(
    () =>
      (payload?.allowedUnits ?? ['SAT', 'USD', 'EUR', 'GBP']).map((c: string) => c.toUpperCase()),
    [payload?.allowedUnits]
  );

  // Load discovered mints using cashu-kym
  useEffect(() => {
    const loadMints = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get existing balances to filter out already owned mints
        const balances = await getBalances();
        const ownedMintUrls = new Set(Object.keys(balances));

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

        // Discover mints
        const result = await handler.discover();

        // Filter out already owned mints and sort by score
        const filteredMints = result.results
          .filter((mint: any) => !ownedMintUrls.has(mint.url))
          .sort((a: any, b: any) => b.score - a.score)
          // Transform to match MintCurrencySelector expectations
          .map((mint: any) => ({
            ...mint,
            mintUrl: mint.url,
            name: mint.auditorData?.name || mint.url.replace('https://', '').split('/')[0],
            amount: 0,
            unit: 'SAT', // Default unit since KYM doesn't provide this
            iconUrl: null,
          }));

        setMints(filteredMints);
      } catch (err) {
        console.error('Failed to load mints:', err);
        setError('Failed to load mint recommendations. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadMints();
  }, [getBalances]);

  const handleToggleMint = (url: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedMints.size === 0) {
      showMessage('Please select at least one mint to add');
      return;
    }

    try {
      showMessage(`Added ${selectedMints.size} mint(s) successfully`);

      sheetRef.current?.hide({
        id: 'add-mints',
        name: 'Add Mints',
        iconUrl: null,
        unit: 'sat',
      });
    } catch (err) {
      console.error('Failed to add mints:', err);
      showMessage('Failed to add mints. Please try again.');
    }
  };

  const g = greys(theme);

  if (loading) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack className="items-center p-5">
          <ActivityIndicator size="large" color={g[0]} />
          <Spacer size={10} />
          <Text className="text-sm" style={{ color: g[200] }}>
            Discovering mints...
          </Text>
        </VStack>
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Retry',
                variant: 'primary',
                onPress: async () => {
                  setError(null);
                  setLoading(true);
                },
              },
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack className="items-center p-5">
          <Text className="text-center text-base" style={{ color: g[200] }}>
            {error}
          </Text>
        </VStack>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: `Add (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0,
            },
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      <MintCurrencySelector
        mints={mints}
        theme={theme}
        allowedCurrencies={allowedCurrencies}
        currencyLabel="Currency options"
        mintsLabel={`Discovered mints (${mints.length})`}
        renderItem={(mint) => (
          <AddMintItem
            key={mint.url || mint.mintUrl}
            mint={mint}
            onToggle={handleToggleMint}
            selected={selectedMints.has(mint.url || mint.mintUrl || '')}
            theme={theme}
          />
        )}
      />
    </Wrapper>
  );
};

export default AddRoute;
