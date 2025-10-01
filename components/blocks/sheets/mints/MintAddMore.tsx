import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Image, ActivityIndicator, Dimensions, ScrollView as RNScrollView } from 'react-native';
import { greens, greys, reds } from 'helper/colors';
import { useSelector } from 'react-redux';
import Icon, { CurrencyIcon, FlagIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { Text } from 'components/ui/Text';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import Wrapper from '../wrapper';
import { ScrollView } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { memoizedGetTheme } from 'helper/redux/settings';
import { getMint } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import { Spacer, View, HStack, VStack } from 'components/ui/View';
import { showMessage } from 'helper/popup/popups';
import { useMintManagement } from 'hooks/coco';

interface CommentProps {
  pubkey: string;
  message: string;
  theme: string;
}

interface Review {
  pubkey: string;
  message: string;
}
interface MintInfo {
  name?: string;
  icon_url?: string;
  nuts?: Record<string, any>;
}
interface MintStats {
  mintUrl: string;
  averageRating: number;
  reviewCount: number;
  reviews: Review[];
  info?: MintInfo;
  error?: Error;
  loading: boolean;
}

export function Comment({ pubkey, message, theme }: CommentProps) {
  const filters = useMemo(() => [{ kinds: [0], authors: [pubkey], limit: 1 }], [pubkey]);
  const { events = [] } = useSubscribe({ filters });
  const profile = events[0] ? safeJson(events[0].content) : undefined;

  const displayName = profile?.name?.trim() || pubkey;
  const avatarSrc = profile?.picture;

  const g = greys(theme);

  return (
    <HStack
      blur
      align="flex-start"
      className="rounded-lg"
      style={[
        {
          backgroundColor: g[800],
          borderWidth: 0.5,
          borderColor: g[900],
          padding: 10,
          marginBottom: 8,
        },
      ]}>
      <Image
        source={{ uri: avatarSrc }}
        style={[
          { width: 32, height: 32, borderRadius: 22, backgroundColor: g[200], marginRight: 10 },
        ]}
      />

      <VStack className="flex-1">
        <Text weight="bold" style={[{ color: g[50], fontSize: 14 }]}>
          {displayName}
        </Text>

        <Text
          style={{
            color: g[0],
            fontSize: 13,
            lineHeight: 18,
            width: Dimensions.get('window').width - 120,
          }}>
          {message}
        </Text>
      </VStack>
    </HStack>
  );
}

function safeJson(str?: string) {
  try {
    return str ? JSON.parse(str) : undefined;
  } catch {
    return undefined;
  }
}
export interface ProcessedMint {
  id: string;
  name: string;
  logo?: string;
  supportedUnits: string[];
  averageRating: number;
  reviewCount: number;
  reviews: Review[];
  loading: boolean;
  error?: Error;
}

function extractSupportedUnits(info?: MintInfo): string[] {
  if (!info?.nuts) return [];
  const units = new Set<string>();
  Object.values(info.nuts).forEach((value: any) => {
    if (value && Array.isArray(value.methods)) {
      value.methods.forEach((m: any) => m?.unit && units.add(m.unit.toUpperCase()));
    }
    if (Array.isArray(value?.supported)) {
      value.supported.forEach((m: any) => m?.unit && units.add(m.unit.toUpperCase()));
    }
  });
  return Array.from(units);
}

function useRecommendedMints(): { mints: ProcessedMint[] } {
  /* 0️⃣ Existing balances */
  const { getBalances } = useMintManagement();
  const [balances, setBalances] = useState<any[]>([]);

  // Load balances from Coco
  useEffect(() => {
    const loadBalances = async () => {
      try {
        const balanceData = await getBalances();

        // Convert Coco balance format to the expected format
        const formattedBalances = Object.entries(balanceData).map(([mintUrl, amount]) => ({
          mintUrl,
          amount: amount || 0,
          unit: 'sat', // Default unit
        }));

        setBalances(formattedBalances);
      } catch (error) {
        console.error('Failed to load balances:', error);
        setBalances([]);
      }
    };

    loadBalances();
  }, [getBalances]);

  const balanceMintUrls = useMemo(() => new Set(balances.map((b) => b.mintUrl)), [balances]);
  /* 1️⃣ Subscribe for reviews */
  const filters = useMemo(() => [{ kinds: [38000], limit: 20000 }], []);
  const { events } = useSubscribe({ filters });

  /* 2️⃣ Stats per URL (skip already‑owned) */
  const mintStats = useMemo<MintStats[]>(() => {
    if (!events?.length) return [];

    const urlEventsMap = events.reduce<Map<string, typeof events>>((map, event) => {
      const tags = event.tags || [];
      const kTag = tags.find((t) => t[0] === 'k' && t[1] === '38172');
      const uTag = tags.find(
        (t) => t[0] === 'u' && typeof t[1] === 'string' && t[1].startsWith('https://')
      );
      if (kTag && uTag) {
        const url = uTag[1] as string;
        if (balanceMintUrls.has(url)) return map; // already owned
        if (!map.has(url)) map.set(url, []);
        map.get(url)!.push(event);
      }
      return map;
    }, new Map());

    const stats = Array.from(urlEventsMap.entries()).map(([url, evts]) => {
      const ratings = evts
        .map((e) => {
          const m = e.content.match(/^\[(\d+)\/\d+]/);
          return m ? parseInt(m[1], 10) : null;
        })
        .filter((r): r is number => r !== null);

      const reviewCount = evts.length;
      const averageRating = ratings.length
        ? ratings.reduce((s, r) => s + r, 0) / ratings.length
        : 0;
      const reviews: Review[] = evts.map((e) => ({
        pubkey: e.pubkey,
        message: e.content.replace(/^\[\d+\/\d+]\s*/, ''),
      }));

      return { mintUrl: url, averageRating, reviewCount, reviews, loading: true } as MintStats;
    });

    stats.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount);
    return stats;
  }, [events, balanceMintUrls]);

  /* 3️⃣ Fetch Mint info (only for unowned) */
  const [infos, setInfos] = useState<Record<string, { info?: MintInfo; error?: Error }>>({});
  const fetching = useRef(new Set<string>());

  useEffect(() => {
    const missing = mintStats
      .map((s) => s.mintUrl)
      .filter((url) => !infos[url] && !fetching.current.has(url));

    if (!missing.length) return;

    missing.forEach((url) => {
      fetching.current.add(url);
      (async () => {
        try {
          const mintRes = await getMint({ mintUrl: url, forceRefresh: true });
          if (mintRes.isErr()) throw mintRes.error;
          const mintInfoRes = await toResult(mintRes.value.getInfo());
          if (mintInfoRes.isErr()) throw mintInfoRes.error;
          setInfos((prev) => ({ ...prev, [url]: { info: mintInfoRes.value } }));
        } catch (err) {
          setInfos((prev) => ({ ...prev, [url]: { error: err as Error } }));
        } finally {
          fetching.current.delete(url);
        }
      })().catch(() => {});
    });
  }, [mintStats, infos]);

  /* 4️⃣ Combine stats + info */
  const mints = useMemo<ProcessedMint[]>(() => {
    return mintStats.map((s) => {
      const entry = infos[s.mintUrl] ?? {};
      const info = entry.info;

      return {
        id: s.mintUrl,
        name: info?.name ?? s.mintUrl.replace(/^https?:\/\//, ''),
        logo: info?.icon_url,
        supportedUnits: extractSupportedUnits(info),
        averageRating: s.averageRating,
        reviewCount: s.reviewCount,
        reviews: s.reviews,
        loading: !entry.info && !entry.error,
        error: entry.error,
      };
    });
  }, [mintStats, infos]);

  return {
    mints,
  };
}

function AddMintItem({
  index,
  mint,
  onToggle,
  selected,
}: {
  index: number;
  mint: ProcessedMint;
  onToggle: (id: string) => void;
  selected: boolean;
}) {
  const theme = useSelector(memoizedGetTheme);
  const g = greys(theme);

  if (mint.error) return null;

  const isDisabled = mint.loading;
  // const isHighlyRated = mint.averageRating >= 5 && mint.reviewCount >= 3;
  // const showReviews = isHighlyRated && mint.reviews.length > 0;

  return (
    <View
      className="overflow-hidden rounded-lg"
      blur
      style={[{ backgroundColor: g[800], marginBottom: 12 }]}>
      <TouchableOpacity
        testID={`add-mint-item-${index}`}
        disabled={isDisabled}
        onPress={() => !isDisabled && onToggle(mint.id)}>
        <HStack align="center" className={`p-3 ${isDisabled ? `opacity-50` : ''}`}>
          <Image
            source={{ uri: mint.logo || 'https://placehold.co/42x42' }}
            style={[{ width: 42, height: 42, borderRadius: 21, backgroundColor: g[200] }]}
          />

          <VStack className="flex-1" style={{ marginLeft: 12, marginRight: 12 }}>
            <Text style={[{ color: g[0], fontSize: 16 }]}>{mint.name}</Text>

            <HStack className="flex-wrap">
              {mint.supportedUnits.map((unit) => (
                <View
                  key={unit}
                  className="rounded"
                  style={[
                    {
                      backgroundColor: g[700],
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      marginBottom: 4,
                      marginRight: 4,
                    },
                  ]}>
                  <Text weight="bold" style={[{ color: g[0] }]}>
                    {unit}
                  </Text>
                </View>
              ))}
            </HStack>
          </VStack>

          {mint.loading ? (
            <ActivityIndicator />
          ) : selected ? (
            <Icon name="gala:remove" color={reds[300]} />
          ) : (
            <Icon name="gala:add" color={greens[300]} />
          )}
        </HStack>
      </TouchableOpacity>

      {/* {showReviews && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 12, paddingTop: 0 }}>
          {mint.reviews
            .filter((r) => r.message)
            .map((r) => (
              <Comment
                key={r.pubkey + r.message.slice(0, 10)}
                pubkey={r.pubkey}
                message={r.message}
                theme={theme}
              />
            ))}
        </ScrollView>
      )} */}
    </View>
  );
}

interface MintAddMoreProps {
  onClose: (data: { mints: string[] }) => void;
  payload: { currencies: string[] };
}

export function MintAddMore({ onClose, payload }: MintAddMoreProps) {
  const theme = useSelector(memoizedGetTheme);
  const g = greys(theme);
  const router = useSheetRouter('mint');

  /* State */
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => {
    if (payload?.currencies?.length === 1 && payload.currencies[0].toUpperCase() === 'SAT') {
      return 'SAT';
    }
    return 'All';
  });

  const { mints } = useRecommendedMints();

  /* Toggle */
  const handleToggleMint = (id: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* Currency filter */
  const filteredMints = useMemo(() => {
    if (selectedCurrency === 'All') return mints;
    return mints.filter((m) => m.supportedUnits.includes(selectedCurrency));
  }, [mints, selectedCurrency]);

  /* Save */
  const handleSave = async () => {
    // Use Promise.all to get all results, but don't call onClose if any are Err
    const results = await Promise.all(
      Array.from(selectedMints).map((mintUrl) => getMint({ mintUrl, forceRefresh: true }))
    );

    const hasError = results.some((res) => res.isErr());

    if (hasError) {
      showMessage(results.find((res) => res.isErr())?.error.message ?? 'Error adding mint');
      return;
    }

    await onClose({ mints: Array.from(selectedMints) });
    router?.goBack();
  };

  /* Allowed‑currency set (from payload or default) */
  const allowedCurrencies = useMemo(
    () =>
      new Set((payload?.currencies ?? ['SAT', 'USD', 'EUR', 'GBP']).map((c) => c.toUpperCase())),
    [payload]
  );

  /* Rendered selector options */
  const currencyOptions = useMemo(() => {
    const opts: string[] = [];
    if (allowedCurrencies.has('SAT')) opts.push('BTC'); // show BTC but store SAT
    if (allowedCurrencies.has('USD')) opts.push('USD');
    if (allowedCurrencies.has('EUR')) opts.push('EUR');
    if (allowedCurrencies.has('GBP')) opts.push('GBP');
    if (opts.length > 1) opts.unshift('All');
    return opts;
  }, [allowedCurrencies]);

  /* Render */
  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              testID: 'save-mints',
              text: `Save (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0,
            },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => {
                setSelectedMints(new Set());
                router?.goBack();
              },
            },
          ]}
        />
      }>
      <View className={`flex-1`}>
        <Text
          weight="bold"
          style={{
            color: g[0],
            fontSize: 18,
            fontWeight: '600',
          }}>
          Currency options
        </Text>
        <Spacer size={4} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 12 }}>
          {currencyOptions.map((option) => {
            const isSelected =
              (option === 'BTC' && selectedCurrency === 'SAT') ||
              (option === 'All' && selectedCurrency === 'All') ||
              (option !== 'BTC' && option !== 'All' && selectedCurrency === option);

            return (
              <TouchableOpacity
                key={option}
                onPress={() => setSelectedCurrency(option === 'BTC' ? 'SAT' : option)}>
                <HStack
                  blur
                  align="center"
                  className="rounded-lg"
                  style={{
                    padding: 12,
                    minWidth: 100,
                    backgroundColor: isSelected ? g[700] : g[800],
                    borderWidth: 0.5,
                    borderColor: g[900],
                    marginRight: 12,
                  }}>
                  {option === 'USD' || option === 'EUR' || option === 'GBP' ? (
                    <FlagIcon
                      country={option === 'USD' ? 'US' : option === 'EUR' ? 'EU' : 'GB'}
                      height={32}
                      width={32}
                    />
                  ) : option === 'BTC' ? (
                    <CurrencyIcon width={32} currency="sat" />
                  ) : (
                    <View className="h-[32px] "></View>
                  )}
                  <Spacer size={8} />
                  <Text weight="bold" style={{ color: g[0], fontSize: 14 }}>
                    {option}
                  </Text>
                </HStack>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Spacer size={24} />

        <Text
          weight="bold"
          style={[
            {
              color: g[0],
              fontSize: 18,
              fontWeight: '600',
            },
          ]}>
          Discovered mints
        </Text>
        <Spacer size={4} />

        {filteredMints.length === 0 ? (
          <Text style={[{ color: g[400], textAlign: 'center', marginTop: 20 }]}>
            No mints found
          </Text>
        ) : (
          <RNScrollView className={`flex-1`}>
            {filteredMints.map((mint, i) => (
              <AddMintItem
                key={mint.id}
                index={i}
                mint={mint}
                onToggle={handleToggleMint}
                selected={selectedMints.has(mint.id)}
              />
            ))}
          </RNScrollView>
        )}
      </View>
    </Wrapper>
  );
}
