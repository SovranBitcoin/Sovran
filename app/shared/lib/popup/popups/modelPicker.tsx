/**
 * AI tab model picker — tabbed sheet with one tab per provider (OpenAI /
 * Claude / Grok / Google), each showing up to three tier rows (Auto /
 * Pro / Max) from that provider's dynamically derived lineup (see
 * `shared/lib/routstr/lineup.ts`). Rows carry live per-message cost and a
 * small image glyph on vision-capable models.
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

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BottomSheet, Menu } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import type { AiProviderId, LineupEntry } from '@/shared/lib/routstr/lineup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { SheetMenuRowContent } from './sheetMenuRow';
import { log, useMountLog } from '@/shared/lib/logger';

import {
  AI_PROVIDERS,
  AI_TIERS,
  type AiProvider,
  type AiTier,
  canAffordPricing,
  entryForSlot,
  estimateMessagesRemainingFromPricing,
  estimateTurnCostSatsFromPricing,
  topUpDeficitSatsFromPricing,
} from '@/features/ai/lib/format';

import { showActionSheet } from './bridge';
import { E2EActionMenuRenderMarker } from '../E2EActionMenuProbe';
import { paramPopup } from './';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

const pickerLog = log.child({ module: 'modelPicker' });

// "cost unavailable" now only renders when a live catalog row genuinely
// ships without pricing — the dynamic lineup can no longer point at a
// model that doesn't exist (the old hardcoded-id failure mode).
const formatTypicalCost = (sats: number | null): string => {
  if (sats == null) return 'cost unavailable';
  if (sats >= 1) return `~${Math.round(sats).toLocaleString()} sats / msg`;
  if (sats >= 0.01) return `~${sats.toFixed(2)} sats / msg`;
  return '< 1 sat / msg';
};

interface TierRowProps {
  tier: AiTier;
  provider: AiProvider;
  entry: LineupEntry;
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
function TierRow({ tier, provider, entry, balanceSats, isCurrent, onPress }: TierRowProps) {
  // Every figure comes from the lineup entry's compact pricing — identical
  // math against a live catalog row or the persisted offline snapshot, so
  // the picker keeps real prices across an offline relaunch.
  const pricing = entry.satsPricing;
  const reservationCeiling = pricing.max_cost;
  const typicalCost = estimateTurnCostSatsFromPricing(pricing);
  const affordable = canAffordPricing(pricing, balanceSats);
  const messagesLeft = estimateMessagesRemainingFromPricing(balanceSats, pricing);
  const deficit = !affordable ? topUpDeficitSatsFromPricing(pricing, balanceSats) : null;

  const friendlyModelName = entry.displayName || tier.label;

  // Affordable copy: "{Model} · ~N sats / msg" using the realistic
  // per-turn estimate (text-only baseline — per-image fees apply only to
  // attachment drafts and are reflected in the send-path logs, not here).
  // Unaffordable copy: "{Model} · needs N sats reserved" so the deficit
  // number lines up with the API's actual reservation requirement.
  // Mirrors `ActionMenuHost.renderActionButton` exactly so the picker
  // rows read as the same component family. Entries substituted from the
  // last-known snapshot are annotated — their ids may no longer exist on
  // the API, and the send-path candidate chain absorbs that.
  const costCopy = affordable
    ? formatTypicalCost(typicalCost)
    : `needs ${reservationCeiling != null ? Math.ceil(reservationCeiling).toLocaleString() : '?'} sats reserved`;
  const description = `${friendlyModelName} · ${costCopy}${entry.lastKnown ? ' · last known' : ''}`;

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
      <SheetMenuRowContent
        icon={<Icon name={tier.icon} size={20} />}
        title={labelText}
        description={descriptionText}
        trailing={
          <>
            {entry.visionInput ? (
              // Image-input capability marker — the user-facing signal for
              // "you can attach photos with this model".
              <View>
                <Icon name="mdi:image-outline" size={14} />
              </View>
            ) : null}
            {isCurrent ? (
              <View>
                <Icon name="mdi:check-circle" size={18} />
              </View>
            ) : null}
          </>
        }
      />
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
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  // Keyed on the live openSeq: the snapPoints sheet mounts its content while
  // openSeq is still settling, so a static render-marker key captures a stale
  // openSeq and the probe's renderedOpenSeq never matches. Re-firing on the
  // live value fixes the gate (contentHeight sheets don't hit this race).
  const popupOpenSeq = usePopupStore((s) => s.openSeq);
  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const setSelectedSlot = useRoutstrStore((s) => s.setSelectedSlot);
  const balanceMsats = useRoutstrStore((s) => s.balance);
  // Live-derived lineup when a catalog fetch has landed this session,
  // else the persisted last-known snapshot, else null (true first-run
  // offline → "models loading" rows).
  const sessionLineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  const lineup = sessionLineup ?? lastKnownLineup?.lineup ?? null;
  const lineupSource = sessionLineup ? 'live' : lastKnownLineup ? 'persisted' : 'empty';

  // Open onto the user's currently-selected provider tab — they almost
  // always come here to swap *tier*, not provider, so the active tab
  // matching their current selection is the right default.
  const [activeProviderTab, setActiveProviderTab] = useState<AiProviderId>(() => selectedProvider);

  // `useMountLog` owns the mount-only log pair (and the exhaustive-deps
  // suppression it needs), so this component stays compilable.
  useMountLog(
    'modelPicker.mount',
    { selectedProvider, selectedTier, lineupSource },
    'modelPicker.unmount',
    pickerLog
  );

  const balanceSats = balanceMsats != null ? Math.floor(balanceMsats / 1000) : 0;
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
      paramPopup('model-switched', { modelName: `${activeProvider.label} ${tier.label}` });
      close();
    },
    [activeProvider.id, activeProvider.label, setSelectedSlot, close]
  );

  return (
    <View style={{ flex: 1 }}>
      <E2EActionMenuRenderMarker presentationKey={popupOpenSeq} />
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
                  style={{ color: isSelected ? foreground : withAlpha(foreground, 0.7) }}>
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
          {(() => {
            // Partial-lineup rendering is explicit: only filled tier cells
            // get rows (a provider with 2 qualifying models shows 2 rows —
            // never duplicated entries, and the tab itself never hides).
            // A provider with no entries at all renders one neutral
            // loading/empty row instead of a dangling-id lookup.
            const rows = AI_TIERS.map((tier) => ({
              tier,
              entry: entryForSlot(lineup, activeProvider.id, tier.id),
            })).filter((r) => r.entry != null);
            if (rows.length === 0) {
              return (
                <Menu.Item isDisabled onPress={() => {}}>
                  <SheetMenuRowContent
                    icon={<Icon name="mdi:cloud-off-outline" size={20} />}
                    title="Models loading"
                    description={
                      lineupSource === 'empty'
                        ? 'Connect to the internet to load the model list'
                        : 'No models available for this provider right now'
                    }
                  />
                </Menu.Item>
              );
            }
            return rows.map(({ tier, entry }) => (
              <TierRow
                key={`${activeProvider.id}-${tier.id}`}
                tier={tier}
                provider={activeProvider}
                entry={entry!}
                balanceSats={balanceSats}
                isCurrent={selectedProvider === activeProvider.id && selectedTier === tier.id}
                onPress={() => handleSelect(tier)}
              />
            ));
          })()}
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
