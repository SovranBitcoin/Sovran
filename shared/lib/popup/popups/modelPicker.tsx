/**
 * AI tab model picker — tabbed sheet with one tab per provider (OpenAI /
 * Claude / Grok), each showing the same three tier rows (Auto / Pro /
 * Max) for that provider's curated lineup.
 *
 * Why a custom sheet instead of `actionMenuPopup` with sections:
 *   `actionMenuPopup`'s tabbed mode (used by Select Profile) renders all
 *   sections in one scrolling list and uses the tab pills as
 *   scroll-to-section anchors. The model picker needs the *opposite* UX
 *   — tapping a provider tab should HIDE the other providers' rows and
 *   only show the active provider's three tiers. That's stateful filter
 *   behaviour, which `SectionAnchorList` doesn't support, so the picker
 *   keeps its own `activeProviderTab` state and re-derives the rows on
 *   each tab switch.
 *
 * Structurally this lives in the same lane as `emojiPickerPopup` —
 * heroui standalone `<BottomSheet>` via `PopupHost`'s
 * `CUSTOM_SHEET_CONTENT` registry — so we get FullWindowOverlay support
 * "for free" if the picker is ever invoked from inside a route modal.
 *
 * Usage:
 *   import { modelPickerPopup } from '@/shared/lib/popup';
 *   modelPickerPopup({});
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BottomSheet, Menu } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { RoutstrModel } from '@/shared/lib/routstr/api';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { log } from '@/shared/lib/logger';

import {
  AI_PROVIDERS,
  AI_TIERS,
  type AiProvider,
  type AiProviderId,
  type AiTier,
  canAffordModel,
  estimateMessagesRemaining,
  estimateTurnCostSats,
  getModelDisplayName,
  maxCostSats,
  modelIdForSlot,
  topUpDeficitSats,
} from '@/features/ai/lib/format';

import { showActionSheet } from './bridge';
import { modelSwitchedPopup } from './';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

const pickerLog = log.child({ module: 'modelPicker' });

const formatTypicalCost = (sats: number | null): string => {
  if (sats == null) return 'cost unavailable';
  if (sats >= 1) return `~${Math.round(sats).toLocaleString()} sats / msg`;
  if (sats >= 0.01) return `~${sats.toFixed(2)} sats / msg`;
  return '< 1 sat / msg';
};

interface TierRowProps {
  tier: AiTier;
  provider: AiProvider;
  models: RoutstrModel[];
  balanceSats: number;
  isCurrent: boolean;
  onPress: () => void;
}

/**
 * One tier row inside the active provider tab. Uses heroui-native's real
 * `<Menu.Item>` so the visual is byte-identical to the "as Ecash" /
 * Select Profile rows — same press-scale animation, same `text-base
 * font-medium` title, same `text-sm text-muted` description, same
 * disabled fade. The parent `<Menu>` (in `ModelPickerContent`) provides
 * the context Menu.Item reads via `useMenu()` / `useMenuItemAnimation`;
 * neither Trigger, Portal, nor Content is required because Menu.Root
 * just renders its children inline through a context Provider.
 */
function TierRow({
  tier,
  provider,
  models,
  balanceSats,
  isCurrent,
  onPress,
}: TierRowProps) {
  const modelId = modelIdForSlot(provider.id, tier.id);
  const reservationCeiling = maxCostSats(modelId, models);
  const typicalCost = estimateTurnCostSats(modelId, models);
  const affordable = canAffordModel(modelId, balanceSats, models);
  const messagesLeft = estimateMessagesRemaining(balanceSats, modelId, models);
  const deficit = !affordable ? topUpDeficitSats(modelId, balanceSats, models) : null;

  const modelName = getModelDisplayName(modelId, models);
  const friendlyModelName = modelName === modelId ? tier.label : modelName;

  // Affordable copy: "{Model} · ~N sats / msg" using the realistic
  // per-turn estimate. Unaffordable copy: "{Model} · needs N sats
  // reserved" so the deficit number lines up with the API's actual
  // reservation requirement. Mirrors `ActionMenuHost.renderActionButton`
  // exactly so the picker rows read as the same component family.
  const description = affordable
    ? `${friendlyModelName} · ${formatTypicalCost(typicalCost)}`
    : `${friendlyModelName} · needs ${reservationCeiling != null ? Math.ceil(reservationCeiling).toLocaleString() : '?'} sats reserved`;

  const labelText =
    affordable && messagesLeft != null && messagesLeft > 0
      ? `${tier.label} · ~${messagesLeft.toLocaleString()} left`
      : tier.label;

  const descriptionText =
    !affordable && deficit != null
      ? `Top up ${deficit.toLocaleString()} more sats to use this tier`
      : description;

  // Disabled = current selection (so the row doesn't re-fire the same
  // setSelectedSlot) OR unaffordable. heroui's Menu.Item handles both
  // states via `isDisabled` — same prop, same fade, same touchability
  // behaviour as the Select Profile rows.
  const disabled = isCurrent || !affordable;

  return (
    <Menu.Item
      testID={`ai-model-${provider.id}-${tier.id}`}
      isDisabled={disabled}
      onPress={onPress}>
      <HStack align="center" gap={10} style={{ flex: 1 }}>
        <Icon name={tier.icon} size={20} />
        <View style={{ flex: 1 }}>
          {/* Heroui's `Menu.ItemTitle` ships with `flex-1` baked into
              its tailwind variant. Inside a non-`Menu.Content` host
              (our custom `<BottomSheet>` lane) the surrounding column
              has no fixed height for `flex-grow` to claim, and the
              title collapses to zero height. Two overrides defend
              against that:
                1. `style.flex: 0` — RN's `style` wins over className
                   in the merge, so the tailwind `flex-1` is neutralised.
                2. `numberOfLines={1}` — forces RN to allocate at least
                   one line of layout height regardless of flex math.
              The rest of heroui's typography
              (`text-base font-medium text-foreground`) is preserved. */}
          <Menu.ItemTitle
            className="flex-none"
            numberOfLines={1}
            style={{ flex: 0 }}>
            {labelText}
          </Menu.ItemTitle>
          <Menu.ItemDescription>{descriptionText}</Menu.ItemDescription>
        </View>
        {isCurrent ? (
          <View>
            <Icon name="mdi:check-circle" size={18} />
          </View>
        ) : null}
      </HStack>
    </Menu.Item>
  );
}

interface ModelPickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['model-picker'];
}

/**
 * Body of the model-picker custom sheet, mounted by `PopupHost`'s
 * `CUSTOM_SHEET_CONTENT` registry. Local `activeProviderTab` state filters
 * the row list to a single provider — the other two providers' rows are
 * NOT mounted, by design (this is the user-facing difference from the
 * profile / emoji pickers, which scroll between sections).
 */
export function ModelPickerContent({ close }: ModelPickerContentProps) {
  const [foreground, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-tertiary',
  ] as const);

  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const setSelectedSlot = useRoutstrStore((s) => s.setSelectedSlot);
  const balanceMsats = useRoutstrStore((s) => s.balance);
  const cachedModels = useRoutstrStore((s) => s.modelsCache?.data ?? null);

  // Open onto the user's currently-selected provider tab — they almost
  // always come here to swap *tier*, not provider, so the active tab
  // matching their current selection is the right default.
  const [activeProviderTab, setActiveProviderTab] = useState<AiProviderId>(
    () => selectedProvider
  );

  useEffect(() => {
    pickerLog.info('modelPicker.mount', {
      selectedProvider,
      selectedTier,
      catalogSize: cachedModels?.length ?? 0,
    });
    return () => pickerLog.info('modelPicker.unmount', {});
    // Mount-only — we want a single record per open cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const balanceSats = balanceMsats != null ? Math.floor(balanceMsats / 1000) : 0;
  const models = cachedModels ?? [];
  const activeProvider = useMemo(
    () => AI_PROVIDERS.find((p) => p.id === activeProviderTab) ?? AI_PROVIDERS[0],
    [activeProviderTab]
  );

  const handleSelect = useCallback(
    (tier: AiTier) => {
      pickerLog.info('modelPicker.select', {
        provider: activeProvider.id,
        tier: tier.id,
      });
      setSelectedSlot({ provider: activeProvider.id, tier: tier.id });
      modelSwitchedPopup({ modelName: `${activeProvider.label} ${tier.label}` });
      close();
    },
    [activeProvider.id, activeProvider.label, setSelectedSlot, close]
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Title — same typographic position as `<Menu.Label>` in
          ActionMenuHost so the surface reads as a menu sibling. */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
        <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
          Model
        </BottomSheet.Title>
      </View>

      {/* Tab strip — anchor pill style copied from `SectionAnchorList`'s
          anchor bar so visually identical to Select Profile's tabs.
          Tapping a pill SETS state instead of scrolling, which is the
          behavioural difference from the profile / emoji pickers. */}
      <View style={styles.anchorBarOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.anchorBarContent, { paddingHorizontal: 24 }]}
          style={styles.anchorBarWrapper}>
          {AI_PROVIDERS.map((p) => {
            const isSelected = activeProviderTab === p.id;
            return (
              <Pressable
                key={p.id}
                testID={`model-tab-${p.id}`}
                onPress={() => {
                  pickerLog.info('modelPicker.tab.switch', { tab: p.id });
                  setActiveProviderTab(p.id);
                }}
                activeOpacity={0.7}
                style={[
                  styles.anchorPill,
                  { backgroundColor: isSelected ? surfaceTertiary : 'transparent' },
                ]}>
                <Icon name={p.icon} size={16} color={foreground} />
                <Text
                  size={12}
                  bold
                  style={{ color: isSelected ? foreground : opacity(foreground, 0.7) }}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Body — exactly three rows for the active provider. The non-active
          providers' rows are not mounted at all, which is the requested
          UX: tabs filter, they don't scroll.

          Wrapped in a bare `<Menu>` (no Trigger / Portal / Content) so
          the `Menu.Item` rows can find the contexts they read via
          `useMenu()` / `useMenuItemAnimation()`. `Menu.Root` is just a
          `<View>` with a `RootContext.Provider` around it — no popover
          anchoring, no portal mount. That gives us the *real* heroui
          row chrome inside our own BottomSheet host. */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24 }}>
        <Menu>
          {AI_TIERS.map((tier) => (
            <TierRow
              key={`${activeProvider.id}-${tier.id}`}
              tier={tier}
              provider={activeProvider}
              models={models}
              balanceSats={balanceSats}
              isCurrent={
                selectedProvider === activeProvider.id && selectedTier === tier.id
              }
              onPress={() => handleSelect(tier)}
            />
          ))}
        </Menu>
      </View>
    </View>
  );
}

/**
 * Imperative trigger. Mirrors `emojiPickerPopup`'s 300ms delay so that if
 * the picker is invoked from inside another sheet, gorhom can finish the
 * outgoing close animation before this one tries to claim the portal.
 * Today nothing chains into the picker, but the shared trigger pattern
 * keeps future call sites safe.
 */
export function modelPickerPopup(): void {
  pickerLog.info('modelPicker.invoke', {});
  setTimeout(() => {
    pickerLog.info('modelPicker.dispatch.fire', {});
    showActionSheet('model-picker', {});
  }, 0);
}

const styles = StyleSheet.create({
  // Pill-bar layout copied verbatim from `SectionAnchorList` so the
  // chrome is byte-identical between the picker family.
  anchorBarOuter: {
    paddingTop: 12,
  },
  anchorBarWrapper: {
    marginHorizontal: -18,
    flexGrow: 0,
  },
  anchorBarContent: {
    gap: 4,
  },
  anchorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 1000,
  },
});
