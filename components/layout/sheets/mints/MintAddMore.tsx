import React, { useState, useEffect } from "react";
import {
  View,
  Image,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { greens, greys, reds } from "helper/colors";
import { useSelector } from "react-redux";
import { memoizedGetMints } from "helper/redux/cashu/selectors";
import { getMint } from "helper/cashu";
import Icon, { CurrencyIcon, FlagIcon } from "assets/icons";
import { TouchableOpacity } from "components/common/TouchableOpacity";
import { useSheetRouter } from "react-native-actions-sheet/dist/src/hooks/use-router";
import { Text } from "components/common/Themed";
import { useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/ndk-mobile";
import { addMintsAction } from "helper/redux/cashu";
import { store } from "helper/redux/store";
import Wrapper, { SheetButton } from "../wrapper";
import { sovran } from ".";

interface MintCount {
  url: string;
  count: number;
}

function useRecommendedMints(): { mintCounts: MintCount[] } {
  const filters = useMemo(() => ({ kinds: [38000], limit: 2000 }), []);

  const { events } = useSubscribe({ filters });
  const mintCounts = useMemo(() => {
    if (!events || events.length === 0) return [];
    const mintUrls: string[] = [];

    events.forEach((event: { tags: string[][] }) => {
      const tags = event.tags || [];
      const kTag = tags.find((t) => t[0] === "k" && t[1] === "38172");
      const uTag = tags.find((t) => t[0] === "u");

      if (
        kTag &&
        uTag &&
        typeof uTag[1] === "string" &&
        uTag[1].startsWith("https://")
      ) {
        mintUrls.push(uTag[1]);
      }
    });

    const uniqueUrls = Array.from(new Set(mintUrls));
    const counts: MintCount[] = uniqueUrls.map((url) => ({
      url,
      count: mintUrls.filter((u) => u === url).length,
    }));

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

  if (mintData.isLoading) {
    return (
      <View
        style={[
          styles.mintItem,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => handleToggleMint(mint.id)}
      key={mint.id}
      style={[
        styles.mintItem,
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
      ]}
    >
      <Image source={{ uri: mintData.info.icon_url }} style={styles.mintIcon} />
      <View style={styles.mintDetails}>
        <Text style={styles.mintName}>{mint.name}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
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
              }}
            >
              <Text
                weight="bold"
                style={{ fontSize: 12, color: greys(theme)[0] }}
              >
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

function MintAddMore() {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [selectedCurrency, setSelectedCurrency] = useState<string>("All");
  const [mintsData, setMintsData] = useState<Map<string, ProcessedMintData>>(
    new Map()
  );
  const router = useSheetRouter("mint");
  const { mintCounts } = useRecommendedMints();

  const recommendedMints = useMemo(
    () => [
      {
        id: "https://mint.sovran.cash",
        name: "mint.sovran.cash (1)",
        supportedUnits: [],
      },
      ...mintCounts.map((mint) => {
        let hostname: string;
        try {
          const urlObj = new URL(mint.url);
          hostname = urlObj.hostname;
        } catch {
          hostname = mint.url;
        }
        return {
          id: mint.url,
          name: `${hostname} (${mint.count})`,
          supportedUnits: [],
        };
      }),
    ],
    [mintCounts]
  );

  useEffect(() => {
    recommendedMints.forEach((mint) => {
      setMintsData((prev) =>
        new Map(prev).set(mint.id, {
          info: {} as MintInfo,
          supportedUnits: [],
          isLoading: true,
        })
      );

      (async () => {
        try {
          const mintData = await getMint({ mintUrl: mint.id });
          const info = await mintData.getInfo();
          const supportedUnits: string[] = [];

          if (info?.nuts?.[4]?.methods) {
            info.nuts[4].methods.forEach((method) => {
              const unit =
                method.unit.toUpperCase() === "BTC"
                  ? "SAT"
                  : method.unit.toUpperCase();
              if (!supportedUnits.includes(unit)) {
                supportedUnits.push(unit);
              }
            });
          }

          if (supportedUnits.length > 0) {
            setMintsData((prev) =>
              new Map(prev).set(mint.id, {
                info,
                supportedUnits,
                isLoading: false,
              })
            );
          } else {
            setMintsData((prev) => {
              const newMap = new Map(prev);
              newMap.delete(mint.id);
              return newMap;
            });
          }
        } catch (error) {
          setMintsData((prev) => {
            const newMap = new Map(prev);
            newMap.delete(mint.id);
            return newMap;
          });
        }
      })();
    });
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

  const mints = useSelector(memoizedGetMints);

  const filteredMints = recommendedMints.filter((mint) => {
    if (mints.includes(mint.id)) {
      return false;
    }
    const mintData = mintsData.get(mint.id);
    if (!mintData) return false;
    return (
      mintData.isLoading ||
      selectedCurrency === "All" ||
      mintData.supportedUnits.includes(selectedCurrency)
    );
  });

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
            style={styles.currencyScroll}
          >
            {["All", "BTC", "USD", "EUR", "GBP"].map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.currencyButton,
                  sovran.borderSubtle,
                  ((option === "BTC" && selectedCurrency === "SAT") ||
                    (option === "All" && selectedCurrency === "All") ||
                    (option !== "BTC" &&
                      option !== "All" &&
                      selectedCurrency === option)) &&
                    styles.selectedCurrencyButton,
                ]}
                onPress={() => {
                  setSelectedCurrency(option === "BTC" ? "SAT" : option);
                }}
              >
                <View style={styles.currencyContent}>
                  {option === "USD" || option === "EUR" || option === "GBP" ? (
                    <FlagIcon
                      country={
                        option === "USD" ? "US" : option === "EUR" ? "EU" : "GB"
                      }
                      height={32}
                      width={32}
                    />
                  ) : option === "BTC" ? (
                    <CurrencyIcon currency="sat" />
                  ) : null}
                  <Text style={styles.currencyText}>{option}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text
            weight="bold"
            style={[styles.sectionHeader, { marginTop: 24, marginBottom: 0 }]}
          >
            Recommended mints
          </Text>
          <Text style={[{ marginBottom: 12, color: greys(theme)[700] }]}>
            Found {filteredMints.length}{" "}
            {filteredMints.length === 1 ? "mint" : "mints"}
          </Text>
          <View>
            {filteredMints.length > 0 ? (
              filteredMints.map((mint) => {
                const mintData = mintsData.get(mint.id);
                if (!mintData) return null;
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
              <Text
                style={[
                  styles.noResults,
                  { marginTop: 20, textAlign: "center" },
                ]}
              >
                No mints found for the selected currency
              </Text>
            )}
          </View>
        </>
      }
      buttons={
        <>
          <SheetButton
            onPress={() => {
              store.dispatch(
                addMintsAction({
                  profileId: store.getState().nostr?.currentProfile?.id,
                  mintUrls: Array.from(selectedMints),
                })
              );

              router?.close();
            }}
          >
            Save ({selectedMints.size})
          </SheetButton>{" "}
          <SheetButton
            onPress={() => {
              setSelectedMints(new Set());
              router?.goBack();
            }}
          >
            Cancel
          </SheetButton>
        </>
      }
    ></Wrapper>
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
      fontWeight: "600",
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: "OverpassBold",
    },
    mintItem: {
      flexDirection: "row",
      alignItems: "center",
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
