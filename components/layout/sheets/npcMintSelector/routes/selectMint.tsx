import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { RouteScreenProps, useSheetRouter, useSheetRef } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetMints } from 'helper/redux/cashu/selectors';
import { useGetMintInfo } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { MintItem } from '../../mints/MintSelect';
import Wrapper, { SheetButton } from '../../wrapper';
import { Text } from 'components/common/Themed';
import { useNostr } from 'helper/redux/nostr';
import { addMints } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { getMint } from 'helper/cashu';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

interface MintCount { mintUrl: string; count: number; }

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
    const uniqueUrls = Array.from(new Set([...mintUrls]));
    const counts: MintCount[] = uniqueUrls.map((url) => ({
      mintUrl: url,
      count: mintUrls.filter((u) => u === url).length,
    }));
    return counts;
  }, [events]);
  return { mintCounts };
}

function RecommendedItem({ mintUrl, onSelect }: { mintUrl: string; onSelect: (u: string) => void }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const mint = await getMint({ mintUrl });
        const data = await mint.getInfo();
        setInfo(data);
      } catch {}
    }
    fetchInfo();
  }, [mintUrl]);

  return (
    <MintItem
      mint={{ id: mintUrl, name: mintUrl.replace('https://', '').split('/')[0], iconUrl: info?.icon_url || null }}
      balance={undefined}
      isSelected={false}
      isLoading={!info}
      globalLoading={false}
      selectedCurrency={'SAT'}
      theme={theme}
      onPress={() => onSelect(mintUrl)}
    />
  );
}

const SelectMint = ({ router }: RouteScreenProps<'npc-mint-selector', 'select'>) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const ref = useSheetRef('npc-mint-selector');
  const mints = useSelector(memoizedGetMints);
  const { currentProfile, profiles, setProfiles, setCurrentProfile } = useNostr();
  const { mintCounts } = useRecommendedMints();

  const handleSelect = (mintUrl: string) => {
    const updatedProfiles = profiles.map((p) =>
      p.id === currentProfile.id ? { ...p, npcMint: mintUrl } : p
    );
    setProfiles(updatedProfiles);
    const newProfile = updatedProfiles.find((p) => p.id === currentProfile.id);
    if (newProfile) setCurrentProfile(newProfile);
    store.dispatch(addMints({ profileId: currentProfile.id, mints: [mintUrl] }));
    ref.current?.hide();
  };

  return (
    <Wrapper
      containerStyle={{ backgroundColor: greys(theme)[2300] }}
      buttons={
        <SheetButton onPress={() => router?.goBack()}>Close</SheetButton>
      }
      children={
        <View>
          <Text weight="bold" style={styles.sectionHeader}>Choose mint</Text>
          <View style={styles.mintScroll}>
            {mints.map((m) => {
              const info = useGetMintInfo({ mintUrl: m });
              return (
                <MintItem
                  key={m}
                  mint={{ id: m, name: m.replace('https://', '').split('/')[0], iconUrl: info?.icon_url || null }}
                  balance={undefined}
                  isSelected={currentProfile.npcMint === m}
                  isLoading={false}
                  globalLoading={false}
                  selectedCurrency={'SAT'}
                  theme={theme}
                  onPress={() => handleSelect(m)}
                />
              );
            })}
          </View>
          {mintCounts.length > 0 && (
            <Text weight="bold" style={[styles.sectionHeader, { marginTop: 24 }]}>Recommended mints</Text>
          )}
          <View style={styles.mintScroll}>
            {mintCounts.map((m) => (
              <RecommendedItem key={m.mintUrl} mintUrl={m.mintUrl} onSelect={handleSelect} />
            ))}
          </View>
        </View>
      }
    />
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    mintScroll: {},
  });

export default SelectMint;
