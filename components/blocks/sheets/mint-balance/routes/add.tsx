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
import { Badge } from 'components/ui/Badge';
import { MintSearchInput } from 'components/ui/MintSearchInput';
import { useDebouncedMintValidation } from 'hooks/useDebouncedMintValidation';
import { filterMints, createPseudoMint, looksLikeMintUrl } from 'helper/fuzzySearch';
import { CocoManager } from 'helper/coco/manager';

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
  // Add properties to match MintData interface
  mintUrl: string;
  name: string;
  amount: number;
  unit: string;
  iconUrl: string | null;
  mintInfo?: {
    nuts?: {
      '4'?: {
        methods?: { unit?: string }[];
      };
    };
  };
}

// Union type for both discovered mints and pseudo mints
type SearchableMint =
  | DiscoveredMint
  | {
      url: string;
      name: string;
      mintUrl?: string;
      auditorData?: {
        name?: string;
      };
      score?: number;
      recommendations?: any[];
      amount?: number;
      unit?: string;
      iconUrl?: string | null;
      mintInfo?: any;
    };

interface AddMintItemProps {
  mint: SearchableMint;
  onToggle: (url: string) => void;
  selected: boolean;
  theme: any;
}

const AddMintItem: React.FC<AddMintItemProps> = ({ mint, onToggle, selected, theme }) => {
  const g = greys(theme);
  const isPseudoMint = !mint.auditorData && !mint.score;
  // Pseudo mints (custom URLs) should be selectable if they look like valid URLs
  const isDisabled = !mint.auditorData && !isPseudoMint && !looksLikeMintUrl(mint.url);

  // Type guards for safe property access
  const hasAuditorData = mint.auditorData && 'state' in mint.auditorData;
  const hasScore = typeof mint.score === 'number';
  const hasRecommendations = Array.isArray(mint.recommendations);

  // Safe property access
  const auditorState = hasAuditorData ? (mint.auditorData as any).state : undefined;
  const score = hasScore ? mint.score! : 0;
  const recommendations = hasRecommendations ? mint.recommendations! : [];

  return (
    <View
      className="overflow-hidden rounded-lg"
      blur
      style={[{ backgroundColor: g[800], marginBottom: 12 }]}>
      <TouchableOpacity disabled={isDisabled} onPress={() => !isDisabled && onToggle(mint.url)}>
        <HStack
          align="center"
          justify="space-between"
          className={`p-3 ${isDisabled ? 'opacity-50' : ''}`}>
          <HStack align="center" gap={8}>
            <Avatar
              picture={mint.auditorData?.name ? undefined : undefined}
              size={42}
              variant="mint"
              name={mint.auditorData?.name || mint.url.replace('https://', '').split('/')[0]}
              alt={`${mint.auditorData?.name || 'Mint'} icon`}
              status={auditorState}
            />

            <VStack spacing={2}>
              <Text style={[{ color: g[0], fontSize: 16 }]}>
                {mint.auditorData?.name || mint.url.replace('https://', '').split('/')[0]}
              </Text>

              <HStack align="center" gap={8}>
                {isPseudoMint ? (
                  <Badge variant="warning" icon="ic:round-warning" size={12}>
                    Custom URL
                  </Badge>
                ) : (
                  <>
                    {hasScore && (
                      <Badge variant="warning" icon="ic:round-star" size={12}>
                        {score % 1 === 0 ? score.toString() : score.toFixed(1)} (
                        {recommendations.length})
                      </Badge>
                    )}
                    {hasRecommendations && recommendations.length > 0 && (
                      <Badge variant="success" icon="fluent:checkmark-16-filled" size={12}>
                        {(
                          (recommendations.reduce((acc: number, rec: any) => acc + rec.score, 0) /
                            recommendations.length /
                            5) *
                          100
                        ).toFixed(1)}
                        %
                      </Badge>
                    )}
                  </>
                )}
              </HStack>
            </VStack>
          </HStack>

          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(mint.url)}
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

  // Search functionality
  const { url, setUrl, validationState, reset } = useDebouncedMintValidation(800);

  // Get allowed currencies from payload or use defaults
  const allowedCurrencies = payload?.allowedUnits ?? ['SAT', 'USD', 'EUR', 'GBP'];

  // Filter mints based on search query
  const filteredMints = useMemo((): SearchableMint[] => {
    if (!url.trim()) return mints;

    const filtered = filterMints(mints, url);

    // If the search query looks like a URL and doesn't match any existing mints,
    // add a pseudo mint for the custom URL
    if (looksLikeMintUrl(url) && !filtered.some((mint) => mint.url === url)) {
      const pseudoMint = createPseudoMint(url);
      return [pseudoMint, ...filtered];
    }

    return filtered;
  }, [mints, url]);

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
        // Transform to match MintData interface
        const filteredMints = result.results
          .filter((mint) => !ownedMintUrls.has(mint.url))
          .sort((a, b) => b.score - a.score)
          .map((mint) => ({
            ...mint,
            mintUrl: mint.url,
            name: mint.auditorData?.name || mint.url.replace('https://', '').split('/')[0],
            amount: 0,
            unit: 'SAT', // Default unit
            iconUrl: null,
            mintInfo: {
              nuts: {
                '4': {
                  methods: [{ unit: 'SAT' }], // Default to SAT, could be fetched from mint info
                },
              },
            },
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

  const handleAddCustomMint = async () => {
    console.log('🚀 Add button clicked!');
    console.log('🚀 URL:', url);
    console.log('🚀 Validation state:', validationState);

    if (!url.trim()) {
      console.log('❌ No URL provided');
      showMessage('Please enter a mint URL');
      return;
    }

    // Temporarily bypass validation to test mint addition
    if (validationState.isValid !== true) {
      console.log('⚠️ Validation failed, but proceeding anyway for testing...');
      console.log('⚠️ Validation state:', validationState);
    }

    try {
      console.log('🔍 Starting mint addition process...');
      console.log('🔍 URL:', url);
      console.log('🔍 Validation state:', validationState);

      // Check if CocoManager is initialized
      if (!CocoManager.isInitialized()) {
        console.error('❌ CocoManager not initialized');
        showMessage('Manager not initialized. Please try again.');
        return;
      }

      console.log('✅ CocoManager is initialized');

      // Use CocoManager directly, same as migration
      const manager = CocoManager.getInstance();
      console.log('✅ Got manager instance:', !!manager);

      console.log('🔍 Calling manager.mint.addMint...');
      const result = await manager.mint.addMint(url);
      console.log('✅ Add mint result:', result);

      // Try to get mint info to ensure it's loaded (same as migration)
      try {
        console.log('🔍 Getting mint info...');
        const mintInfo = await manager.mint.getMintInfo(url);
        console.log(`✅ Mint info loaded for ${url}:`, mintInfo);
      } catch (infoError) {
        console.warn(`⚠️ Failed to load mint info for ${url}:`, infoError);
      }

      // Check if mint was actually added by listing all mints
      try {
        console.log('🔍 Checking all mints...');
        const allMints = await manager.mint.getAllMints();
        console.log(
          '📋 All mints:',
          allMints.map((m) => (m as any).url || m)
        );
        const isAdded = allMints.some((m) => (m as any).url === url);
        console.log(`✅ Mint ${url} is in list:`, isAdded);
      } catch (listError) {
        console.warn('⚠️ Failed to list mints:', listError);
      }

      // Also add it to the selected mints for immediate selection
      setSelectedMints((prev) => new Set([...prev, url]));

      showMessage('Mint added successfully');
      reset();
    } catch (err) {
      console.error('❌ Failed to add custom mint:', err);
      console.error('❌ Error details:', {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
        name: err instanceof Error ? err.name : undefined,
        cause: err instanceof Error ? err.cause : undefined,
      });
      showMessage(`Failed to add mint: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleSave = async () => {
    if (selectedMints.size === 0) {
      showMessage('Please select at least one mint to add');
      return;
    }

    try {
      console.log('🚀 Starting to add selected mints:', Array.from(selectedMints));

      // Check if CocoManager is initialized
      if (!CocoManager.isInitialized()) {
        console.error('❌ CocoManager not initialized');
        showMessage('Manager not initialized. Please try again.');
        return;
      }

      const manager = CocoManager.getInstance();
      const results = [];
      const errors = [];

      // Add each selected mint to the manager
      for (const mintUrl of selectedMints) {
        try {
          console.log(`🔍 Adding mint: ${mintUrl}`);
          const result = await manager.mint.addMint(mintUrl);
          console.log(`✅ Added mint ${mintUrl}:`, result);
          results.push(mintUrl);

          // Try to get mint info to ensure it's loaded
          try {
            const mintInfo = await manager.mint.getMintInfo(mintUrl);
            console.log(`✅ Mint info loaded for ${mintUrl}:`, mintInfo);
          } catch (infoError) {
            console.warn(`⚠️ Failed to load mint info for ${mintUrl}:`, infoError);
          }
        } catch (err) {
          console.error(`❌ Failed to add mint ${mintUrl}:`, err);
          errors.push({ mintUrl, error: err });
        }
      }

      // Show results
      if (errors.length === 0) {
        showMessage(`Successfully added ${results.length} mint(s)`);
      } else if (results.length > 0) {
        showMessage(`Added ${results.length} mint(s), ${errors.length} failed`);
      } else {
        showMessage('Failed to add any mints. Please try again.');
        return;
      }

      // Close the sheet
      sheetRef.current?.hide({
        id: 'add-mints',
        name: 'Add Mints',
        iconUrl: null,
        unit: 'sat',
      });
    } catch (err) {
      console.error('❌ Failed to add mints:', err);
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
      <VStack spacing={16}>
        <MintSearchInput
          value={url}
          onChangeText={setUrl}
          validationState={validationState}
          onAddMint={handleAddCustomMint}
          canAddMint={url.trim().length > 0}
        />

        <MintCurrencySelector
          mints={filteredMints as any}
          theme={theme}
          allowedCurrencies={allowedCurrencies}
          currencyLabel="Currency options"
          mintsLabel={url.trim() ? 'Search results' : 'Discovered mints'}
          renderItem={(mint: any) => (
            <AddMintItem
              mint={mint}
              onToggle={handleToggleMint}
              selected={selectedMints.has(mint.url)}
              theme={theme}
            />
          )}
        />
      </VStack>
    </Wrapper>
  );
};

export default AddRoute;
