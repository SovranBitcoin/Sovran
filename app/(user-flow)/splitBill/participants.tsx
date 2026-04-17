/**
 * @fileoverview Split-Bill — Step 2: pick who pays.
 *
 * Multi-select picker aggregating 3 data sources (BLE, Nostr recents, search)
 * via `useSplitBillParticipantPicker`. Selected participants appear as a chip
 * strip above the list, and the per-person split (totalAmount ÷ N) renders
 * live under it so the user can gauge how the bill divides as they adjust
 * the selection.
 *
 * "Next" seeds a `draft` SplitBillGroup in the store and navigates to
 * `summary` — actual invoice generation + delivery happens there.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useRouter, useLocalSearchParams } from 'expo-router';
import opacity from 'hex-color-opacity';

import { useSplitBillParticipantPicker } from '@/features/splitBill/hooks/useSplitBillParticipantPicker';
import { ParticipantPickerRow } from '@/features/splitBill/components/ParticipantPickerRow';
import { SelectedChipsRow } from '@/features/splitBill/components/SelectedChipsRow';
import { useSplitBillTransactionsStore } from '@/shared/stores/profile/splitBillTransactionsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import Icon from 'assets/icons';
import { Screen, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export default function SplitBillParticipantsScreen() {
  useLifecycleLogger('SplitBillParticipantsScreen', walletLog);
  const router = useRouter();
  const { totalAmount: totalAmountStr, unit: unitParam } = useLocalSearchParams<{
    totalAmount?: string;
    unit?: string;
  }>();
  const totalAmount = parseInt(totalAmountStr ?? '0', 10) || 0;
  const unit = (unitParam as string) || 'sat';

  const [foreground, background, surfaceSecondary] = useThemeColor([
    'foreground',
    'background',
    'surface-secondary',
  ] as const);

  const picker = useSplitBillParticipantPicker();
  const { keys: nostrKeys } = useNostrKeysContext();
  const activeMintUrl = useMintStore((s) =>
    nostrKeys?.pubkey ? s.selectedMints[nostrKeys.pubkey] : undefined
  );
  const startGroup = useSplitBillTransactionsStore((s) => s.startGroup);

  const perPerson = useMemo(() => {
    if (picker.selected.length === 0) return 0;
    return Math.floor(totalAmount / picker.selected.length);
  }, [totalAmount, picker.selected.length]);

  const remainder = useMemo(() => {
    if (picker.selected.length === 0) return 0;
    return totalAmount - perPerson * picker.selected.length;
  }, [totalAmount, perPerson, picker.selected.length]);

  const canProceed =
    picker.selected.length > 0 && perPerson > 0 && !!activeMintUrl;

  const handleNext = useCallback(async () => {
    if (!canProceed || !activeMintUrl) return;
    // Even split; the first participant absorbs any rounding remainder so
    // the sum exactly equals `totalAmount`. Matches how most bill-split apps
    // handle fractions-of-a-cent/sat.
    const group = startGroup({
      unit,
      mintUrl: activeMintUrl,
      totalAmount,
      participants: picker.selected.map((c, idx) => ({
        source: c.source,
        channel: c.channel,
        pubkey: c.pubkey,
        peerID: c.peerID,
        nickname: c.nickname,
        avatarUrl: c.avatarUrl,
        amount: idx === 0 ? perPerson + remainder : perPerson,
      })),
    });
    walletLog.info('split_bill.participants.next', {
      groupId: group.id,
      participants: picker.selected.length,
      totalAmount,
      perPerson,
    });
    router.push({
      pathname: '/(user-flow)/splitBill/summary' as any,
      params: { groupId: group.id },
    });
  }, [canProceed, activeMintUrl, startGroup, unit, totalAmount, picker.selected, perPerson, remainder, router]);

  const sectionedData = useMemo(() => {
    // Flatten sections into a single list with section-header sentinels.
    type Row =
      | { kind: 'header'; title: string; id: string }
      | { kind: 'item'; data: (typeof picker.sections)[number]['data'][number] };
    const rows: Row[] = [];
    for (const section of picker.sections) {
      rows.push({ kind: 'header', title: section.title, id: `header-${section.title}` });
      for (const item of section.data) rows.push({ kind: 'item', data: item });
    }
    return rows;
  }, [picker.sections]);

  const renderItem = useCallback(
    ({ item }: { item: (typeof sectionedData)[number] }) => {
      if (item.kind === 'header') {
        return (
          <Text
            size={13}
            heavy
            style={[styles.sectionHeader, { color: opacity(foreground, 0.4) }]}>
            {item.title.toUpperCase()}
          </Text>
        );
      }
      return (
        <ParticipantPickerRow
          candidate={item.data}
          selected={picker.isSelected(item.data.id)}
          onToggle={picker.toggle}
        />
      );
    },
    [foreground, picker.isSelected, picker.toggle]
  );

  const keyExtractor = useCallback((item: (typeof sectionedData)[number]) => {
    return item.kind === 'header' ? item.id : item.data.id;
  }, []);

  return (
    <Screen name="SplitBillParticipantsScreen" style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1 }}>
        {/* Header: total + per-person live split */}
        <VStack align="center" spacing={2} style={styles.headerBlock}>
          <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
            Total
          </Text>
          <AmountFormatter amount={totalAmount} unit={unit} size={22} weight="heavy" centered />
          <HStack align="center" spacing={6} style={{ marginTop: 4 }}>
            <Text size={13} style={{ color: opacity(foreground, 0.6) }}>
              {picker.selected.length === 0
                ? 'Pick participants below'
                : `${picker.selected.length} × `}
            </Text>
            {picker.selected.length > 0 && (
              <AmountFormatter amount={perPerson} unit={unit} size={13} weight="heavy" />
            )}
          </HStack>
        </VStack>

        {/* Search bar */}
        <View style={[styles.searchBarWrapper, { backgroundColor: surfaceSecondary }]}>
          <Icon name="mdi:magnify" size={18} color={opacity(foreground, 0.5)} />
          <TextInput
            value={picker.searchQuery}
            onChangeText={picker.setSearchQuery}
            placeholder="Search Nostr for anyone…"
            placeholderTextColor={opacity(foreground, 0.4)}
            style={[styles.searchInput, { color: foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {/* Selected chips */}
        <SelectedChipsRow selected={picker.selected} onRemove={picker.remove} />

        {/* Picker list */}
        <LegendList
          data={sectionedData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={68}
          keyboardDismissMode="on-drag"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListEmptyComponent={
            <VStack align="center" spacing={8} style={styles.emptyBlock}>
              <Icon name="mdi:account-group" size={32} color={opacity(foreground, 0.3)} />
              <Text size={14} style={{ color: opacity(foreground, 0.5), textAlign: 'center' }}>
                {picker.searchLoading
                  ? 'Searching…'
                  : picker.searchQuery
                    ? 'No matches. Try a different query.'
                    : 'No Bluetooth peers or recent contacts. Start a chat first or search above.'}
              </Text>
            </VStack>
          }
        />
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={16}>
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                testID: 'split-bill-participants-next',
                text:
                  picker.selected.length > 0
                    ? `Next (${picker.selected.length})`
                    : 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                disabled: !canProceed,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 20,
    marginTop: 8,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  emptyBlock: {
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
});
