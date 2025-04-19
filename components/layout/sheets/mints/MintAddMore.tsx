import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { greens, greys, reds } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetMints } from 'helper/redux/cashu/selectors';
import Icon, { CurrencyIcon, FlagIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { Text } from 'components/common/Themed';
import { useMemo } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { addMintsAction } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import Wrapper, { SheetButton } from '../wrapper';
import { sovran } from '.';
import { useSheetRef } from 'react-native-actions-sheet';
import { getMint } from 'components/cashu';

interface MintCount {
  mintUrl: string;
  count: number;
}

function getMintsFromAudit() {
  const mints = [
    {
      mintUrl: 'https://mint.lnw.cash',
      averageTimeTaken: 3448,
      successRate: 0.6764705882352942,
      successCount: 23,
      totalCount: 34,
      count: 0,
    },
    {
      mintUrl: 'https://mint.mountainlake.io',
      averageTimeTaken: 3924,
      successRate: 0.9642857142857143,
      successCount: 54,
      totalCount: 56,
      count: 0,
    },
    {
      mintUrl: 'https://mint.mjex.me',
      averageTimeTaken: 24937,
      successRate: 0.2222222222222222,
      successCount: 2,
      totalCount: 9,
      count: 0,
    },
    {
      mintUrl: 'https://mint.utxo.one',
      averageTimeTaken: 3088,
      successRate: 0.38095238095238093,
      successCount: 8,
      totalCount: 21,
      count: 0,
    },
    {
      mintUrl: 'https://mint.103100.xyz',
      averageTimeTaken: 5401,
      successRate: 0.9117647058823529,
      successCount: 31,
      totalCount: 34,
      count: 0,
    },
    {
      mintUrl: 'https://antifiat.cash',
      averageTimeTaken: 4522,
      successRate: 0.5357142857142857,
      successCount: 15,
      totalCount: 28,
      count: 0,
    },
    {
      mintUrl: 'https://mint.lnpay.cz',
      averageTimeTaken: 2608,
      successRate: 0.8604651162790697,
      successCount: 37,
      totalCount: 43,
      count: 0,
    },
    {
      mintUrl: 'https://cashu.boats',
      averageTimeTaken: 10364,
      successRate: 0.9583333333333334,
      successCount: 23,
      totalCount: 24,
      count: 0,
    },
    {
      mintUrl: 'https://mint.coinos.io',
      averageTimeTaken: 14770,
      successRate: 0.972972972972973,
      successCount: 36,
      totalCount: 37,
      count: 0,
    },
    {
      mintUrl: 'https://mint.minibits.cash/Bitcoin',
      averageTimeTaken: 3096,
      successRate: 0.9545454545454546,
      successCount: 42,
      totalCount: 44,
      count: 0,
    },
    {
      mintUrl: 'https://server.githappens.space:3339',
      averageTimeTaken: 0,
      successRate: 0,
      successCount: 0,
      totalCount: 28,
      count: 0,
    },
    {
      mintUrl: 'https://mint.azzamo.net',
      averageTimeTaken: 10722,
      successRate: 0.7142857142857143,
      successCount: 20,
      totalCount: 28,
      count: 0,
    },
    {
      mintUrl: 'https://mint.westernbtc.com',
      averageTimeTaken: 3716,
      successRate: 0.9302325581395349,
      successCount: 40,
      totalCount: 43,
      count: 0,
    },
    {
      mintUrl: 'https://mint.belgianbitcoinembassy.org',
      averageTimeTaken: 8317,
      successRate: 0.7804878048780488,
      successCount: 32,
      totalCount: 41,
      count: 0,
    },
    {
      mintUrl: 'https://mint.nodenebula.com',
      averageTimeTaken: 8167,
      successRate: 0.9736842105263158,
      successCount: 37,
      totalCount: 38,
      count: 0,
    },
    {
      mintUrl: 'https://mint.gwoq.com',
      averageTimeTaken: 3944,
      successRate: 1,
      successCount: 20,
      totalCount: 20,
      count: 0,
    },
    {
      mintUrl: 'https://8333.space:3338',
      averageTimeTaken: 3456,
      successRate: 1,
      successCount: 54,
      totalCount: 54,
      count: 0,
    },
    {
      mintUrl: 'https://mint.data.haus',
      averageTimeTaken: 3591,
      successRate: 0.9285714285714286,
      successCount: 39,
      totalCount: 42,
      count: 0,
    },
    {
      mintUrl: 'https://stablenut.cashu.network',
      averageTimeTaken: 2980,
      successRate: 0.9183673469387755,
      successCount: 45,
      totalCount: 49,
      count: 0,
    },
    {
      mintUrl: 'https://21mint.me',
      averageTimeTaken: 6408,
      successRate: 0.92,
      successCount: 23,
      totalCount: 25,
      count: 0,
    },
    {
      mintUrl: 'https://mint.lnwasanee.com',
      averageTimeTaken: 5805,
      successRate: 0.8148148148148148,
      successCount: 22,
      totalCount: 27,
      count: 0,
    },
    {
      mintUrl: 'https://mint.lnwallet.app',
      averageTimeTaken: 4801,
      successRate: 1,
      successCount: 13,
      totalCount: 13,
      count: 0,
    },
    {
      mintUrl: 'http://lbutlh5lfggq5r7xpiwhrajdl7sxpupgagazxl65w4c5cg72wtofasad.onion:3338',
      averageTimeTaken: 2941,
      successRate: 0.8333333333333334,
      successCount: 25,
      totalCount: 30,
      count: 0,
    },
    {
      mintUrl: 'https://mint.agorist.space',
      averageTimeTaken: 4579,
      successRate: 0.9736842105263158,
      successCount: 37,
      totalCount: 38,
      count: 0,
    },
    {
      mintUrl: 'https://cashu.21m.lol',
      averageTimeTaken: 3573,
      successRate: 0.9591836734693877,
      successCount: 47,
      totalCount: 49,
      count: 0,
    },
    {
      mintUrl: 'https://mint.pailakapo.com',
      averageTimeTaken: 3908,
      successRate: 1,
      successCount: 22,
      totalCount: 22,
      count: 0,
    },
    {
      mintUrl: 'https://mint.lnvoltz.com',
      averageTimeTaken: 6377,
      successRate: 0.9230769230769231,
      successCount: 36,
      totalCount: 39,
      count: 0,
    },
    {
      mintUrl: 'https://mint.nimo.cash',
      averageTimeTaken: 10116,
      successRate: 0.88,
      successCount: 22,
      totalCount: 25,
      count: 0,
    },
    {
      mintUrl: 'https://mint2.nutmix.cash',
      averageTimeTaken: 5077,
      successRate: 0.9302325581395349,
      successCount: 40,
      totalCount: 43,
      count: 0,
    },
    {
      mintUrl: 'https://mint.mnt.cash',
      averageTimeTaken: 8559,
      successRate: 0.9375,
      successCount: 15,
      totalCount: 16,
      count: 0,
    },
  ];

  return mints;
}

function useRecommendedMints(): { mintCounts: MintCount[] } {
  const filters = useMemo(() => ({ kinds: [38000], limit: 2000 }), []);

  const { events } = useSubscribe({ filters });
  const mintCounts = useMemo(() => {
    if (!events || events.length === 0) return [];
    const mintUrls: string[] = [];

    events.forEach((event: { tags: string[][] }) => {
      const tags = event.tags || [];
      const kTag = tags.find((t) => t[0] === 'k' && t[1] === '38172');
      const uTag = tags.find((t) => t[0] === 'u');

      if (kTag && uTag && typeof uTag[1] === 'string' && uTag[1].startsWith('https://')) {
        mintUrls.push(uTag[1]);
      }
    });

    const uniqueUrls = Array.from(new Set(mintUrls));
    const counts: MintCount[] = [
      ...getMintsFromAudit(),
      ...uniqueUrls.map((url) => ({
        mintUrl: url,
        count: mintUrls.filter((u) => u === url).length,
      })),
    ].reduce((acc: MintCount[], curr) => {
      const existing = acc.find((item) => item.mintUrl === curr.mintUrl);
      if (!existing) {
        acc.push(curr);
      } else if (curr.count > existing.count) {
        existing.count = curr.count;
      }
      return acc;
    }, []);

    counts.sort((a, b) => b.count - a.count);
    return counts;
  }, [events]);
  return { mintCounts };
}

interface Mint {
  id: string;
  name: string;
  logo?: string;
  supportedUnits: string[];
}

interface MintInfo {
  icon_url: string;
  nuts?: {
    methods?: Array<{ unit: string }>;
  }[];
}

interface ProcessedMintData {
  info: MintInfo;
  supportedUnits: string[];
  isLoading: boolean;
}

function AddMintItem({
  mint,
  mintData,
  handleToggleMint,
  selectedMints,
}: {
  mint: Mint;
  mintData: ProcessedMintData;
  handleToggleMint: (mintId: string) => void;
  selectedMints: Set<string>;
}) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);
  console.log(mintData);

  if (!mintData || mintData.isLoading || !mint) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={() => handleToggleMint(mint.id)}
      key={mint.id}
      style={[
        styles.mintItem,
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      ]}>
      <Image source={{ uri: mintData.info.icon_url }} style={styles.mintIcon} />
      <View style={styles.mintDetails}>
        <Text style={styles.mintName}>{mint.name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {mintData.supportedUnits.map((unit) => (
            <View
              key={unit}
              style={{
                backgroundColor: greys(theme)[1500],
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 4,
                marginRight: 4,
                marginBottom: 4,
              }}>
              <Text weight="bold" style={{ fontSize: 12, color: greys(theme)[0] }}>
                {unit}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {selectedMints.has(mint.id) ? (
        <Icon name="gala:remove" color={reds[300]} />
      ) : (
        <Icon name="gala:add" color={greens[300]} />
      )}
    </TouchableOpacity>
  );
}

export function MintAddMore({ onClose, params }) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [selectedCurrency, setSelectedCurrency] = useState<string>('All');
  const [mintsData, setMintsData] = useState<Map<string, ProcessedMintData>>(new Map());
  const [loading, setLoading] = useState(true);
  const router = useSheetRouter('mint');
  const { mintCounts } = useRecommendedMints();

  const recommendedMints = useMemo(
    () => [
      {
        id: 'https://mint.sovran.cash',
        name: 'mint.sovran.cash (1)',
        supportedUnits: [],
      },
      ...mintCounts.map((mint) => {
        let hostname: string;
        try {
          const urlObj = new URL(mint.mintUrl);
          hostname = urlObj.hostname;
        } catch {
          hostname = mint.mintUrl;
        }
        return {
          id: mint.mintUrl,
          name: `${hostname} (${mint.count})`,
          supportedUnits: [],
        };
      }),
    ],
    [mintCounts]
  );

  // Fetch all mint data
  useEffect(() => {
    const fetchAllMintData = async () => {
      setLoading(true);
      const newMintsData = new Map<string, ProcessedMintData>();

      // Fetch mint data for all recommended mints
      await Promise.all(
        recommendedMints.map(async (mint) => {
          try {
            const mintInfo = await (await getMint({ mintUrl: mint.id })).getInfo();
            const supportedUnits: string[] = [];

            if (mintInfo?.nuts?.[4]?.methods) {
              mintInfo.nuts[4].methods.forEach((method) => {
                const unit =
                  method.unit.toUpperCase() === 'BTC' ? 'SAT' : method.unit.toUpperCase();
                if (!supportedUnits.includes(unit)) {
                  supportedUnits.push(unit);
                }
              });
            }

            newMintsData.set(mint.id, {
              info: mintInfo,
              supportedUnits,
              isLoading: false,
              error: null,
            });
          } catch (err) {
            newMintsData.set(mint.id, {
              info: { icon_url: '' },
              supportedUnits: [],
              isLoading: false,
              error: 'Failed to fetch mint details',
            });
          }
        })
      );

      setMintsData(newMintsData);
      setLoading(false);
    };

    fetchAllMintData();
  }, [recommendedMints]);

  const handleToggleMint = (mintId: string) => {
    setSelectedMints((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(mintId)) {
        newSet.delete(mintId);
      } else {
        newSet.add(mintId);
      }
      return newSet;
    });
  };

  // Filter mints based on selected currency
  const filteredMints = useMemo(() => {
    if (selectedCurrency === 'All') {
      return recommendedMints;
    }

    return recommendedMints.filter((mint) => {
      const mintData = mintsData.get(mint.id);
      if (!mintData) return false;
      return mintData.supportedUnits.includes(selectedCurrency);
    });
  }, [recommendedMints, selectedCurrency, mintsData]);

  const mints = useSelector(memoizedGetMints);

  return (
    <Wrapper
      children={
        <>
          <Text weight="bold" style={styles.sectionHeader}>
            Currency options
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.currencyScroll}>
            {['All', 'BTC', 'USD', 'EUR', 'GBP'].map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.currencyButton,
                  sovran.borderSubtle,
                  ((option === 'BTC' && selectedCurrency === 'SAT') ||
                    (option === 'All' && selectedCurrency === 'All') ||
                    (option !== 'BTC' && option !== 'All' && selectedCurrency === option)) &&
                    styles.selectedCurrencyButton,
                ]}
                onPress={() => {
                  setSelectedCurrency(option === 'BTC' ? 'SAT' : option);
                }}>
                <View style={styles.currencyContent}>
                  {option === 'USD' || option === 'EUR' || option === 'GBP' ? (
                    <FlagIcon
                      country={option === 'USD' ? 'US' : option === 'EUR' ? 'EU' : 'GB'}
                      height={32}
                      width={32}
                    />
                  ) : option === 'BTC' ? (
                    <CurrencyIcon currency="sat" />
                  ) : null}
                  <Text style={styles.currencyText}>{option}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text weight="bold" style={[styles.sectionHeader, { marginTop: 24, marginBottom: 0 }]}>
            Recommended mints
          </Text>
          <Text style={[{ marginBottom: 12, color: greys(theme)[700] }]}>
            Found {filteredMints.length} {filteredMints.length === 1 ? 'mint' : 'mints'}
          </Text>
          <View>
            {loading ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <ActivityIndicator size="large" />
                <Text style={{ marginTop: 10 }}>Loading mints...</Text>
              </View>
            ) : filteredMints.length > 0 ? (
              filteredMints.map((mint) => {
                const mintData = mintsData.get(mint.id);
                // Skip mints with errors
                if (mintData?.error) return null;

                return (
                  <AddMintItem
                    key={mint.id}
                    mint={mint}
                    mintData={mintData}
                    handleToggleMint={handleToggleMint}
                    selectedMints={selectedMints}
                  />
                );
              })
            ) : (
              <Text style={[styles.noResults, { marginTop: 20, textAlign: 'center' }]}>
                No mints found for the selected currency
              </Text>
            )}
          </View>
        </>
      }
      buttons={
        <>
          <SheetButton
            onPress={async () => {
              // store.dispatch(
              //   addMintsAction({
              //     profileId: store.getState().nostr?.currentProfile?.id,
              //     mintUrls: Array.from(selectedMints),
              //   })
              // );

              // ref.current.hide({
              //   mints: Array.from(selectedMints),
              // });

              await onClose({
                mints: Array.from(selectedMints),
              });
            }}>
            Save ({selectedMints.size})
          </SheetButton>{' '}
          <SheetButton
            onPress={() => {
              setSelectedMints(new Set());
              router?.goBack();
            }}>
            Cancel
          </SheetButton>
        </>
      }></Wrapper>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    noResults: {
      color: greys(theme)[700],
    },
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    currencyScroll: {
      flexGrow: 1,
    },
    currencyButton: {
      marginRight: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[1800],
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
    mintItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[1800],
      marginBottom: 8,
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: greys(theme)[400],
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: greys(theme)[0],
      fontSize: 16,
    },
  });

export default MintAddMore;
