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
 * Structurally this is a `PopupHost` custom sheet — heroui standalone
 * `<BottomSheet>` via the `CUSTOM_SHEET_CONTENT` registry — so we get
 * FullWindowOverlay support "for free" if the picker is ever invoked from
 * inside a route modal. It sizes itself, like `actionMenuSheet` and
 * `paymentOptionsSheet`; it deliberately does NOT share `emojiPickerPopup`'s
 * fixed-detent layout, which is what left its rows and tabs unable to take a
 * tap (see `sheets/sheetLayoutConfig.ts`).
 *
 * Usage:
 *   import { modelPickerPopup } from '@/shared/lib/popup';
 *   modelPickerPopup({});
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BottomSheet, Menu } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import {
  isE2eeModelId,
  lineupHasEntries,
  type AiLineup,
  type AiProviderId,
  type LineupEntry,
} from '@/shared/lib/routstr/lineup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { SheetMenuRowContent } from './sheetMenuRow';
import { log, useMountLog } from '@/shared/lib/logger';

import {
  AFFORD_BUFFER,
  AI_TIERS,
  E2EE_BADGE_ICON,
  E2EE_BADGE_LABEL,
  type AiProvider,
  type AiTier,
  entryForSlot,
  providersForLineup,
  estimateTurnCostSatsFromPricing,
} from '@/features/ai/lib/format';
import { affordableForEntry, reservedSatsTypical } from '@/features/ai/lib/reserve';

import { showActionSheet } from './bridge';
import { E2EActionMenuRenderMarker, E2EActionMenuTargetMarker } from '../E2EActionMenuProbe';
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

/**
 * Sats Routstr will actually hold to admit one turn on this entry.
 *
 * `requiredReserveSatsFromPricing` prices the node's *discounted* admission
 * path: send a `max_tokens` bound and the node reserves prompt +
 * max_tokens×completion instead of the raw `max_cost` ceiling. A node cannot
 * read a sealed request body, so it cannot verify that bound — the SDK skips
 * both completion discounts for an end-to-end-encrypted model and reserves the
 * flat ceiling, and every sealed catalogue row prices
 * `max_completion_cost === max_cost`, so no `max_tokens` moves it.
 *
 * Without the floor the picker quoted ~10 sats against a node that demanded
 * 307 (the reservations in the 2026-09-25 device log were 307, 896 and 1): a
 * 50-sat wallet was told "affordable · ~40 messages left" and refused at send,
 * while the very same row's "needs 307 sats reserved" line — which reads
 * `max_cost` directly — was right. One row, two contradictory numbers.
 *
 * The rule belongs beside the send gate in `features/ai`; it lives here until
 * that module exports it, and `isE2eeModelId` is the single spelling of the
 * sealed test (never the raw id prefix — sealing is per model, not per node).
 */
function reserveSatsForEntry(entry: LineupEntry): number | null {
  // Delegates to the SDK mirror the spend sheet prices with, so a row and the
  // sheet it leads to cannot quote two different numbers for the same model.
  // It carries the sealed rule too: a `tinfoil-` id gets no completion
  // discount, because the node cannot read the body to verify the bound.
  return reservedSatsTypical(entry);
}

/**
 * Whether `balanceSats` clears that reservation. Delegates to the one verdict
 * the chip and the spend sheet also read, and is the ONE the picker uses — the
 * `modelPicker.rows` log counts pressable rows with it too, so the event can
 * never disagree with the rows the user is looking at.
 */
function isEntryAffordable(entry: LineupEntry, balanceSats: number): boolean {
  return affordableForEntry(entry, balanceSats);
}

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
 *
 * The bare `<Menu>` was the prime suspect when the picker stopped taking
 * taps, on the theory that an item in a menu that was never opened treats
 * presses as no-ops. It does not. heroui's press path
 * (`primitives/menu/menu.tsx`, `Item`) reads the root context only for
 * `onOpenChange` / `setTriggerPosition` / `setContentLayout` when closing
 * after a select; there is no `isOpen` guard anywhere in it, and
 * `components/menu/menu.tsx`'s `Menu.Item` adds press-feedback animation
 * and nothing else. `isOpen` gates `Menu.Content` and `Menu.Overlay`,
 * neither of which is in this tree. Rendering the real component outside a
 * `Menu.Content` and firing the rendered Pressable delivers `onPress`.
 * Don't re-suspect this; the fault was the sheet's container shape (see
 * `sheets/sheetLayoutConfig.ts`).
 */
function TierRow({ tier, provider, entry, balanceSats, isCurrent, onPress }: TierRowProps) {
  // Every figure comes from the lineup entry's compact pricing — identical
  // math against a live catalog row or the persisted offline snapshot, so
  // the picker keeps real prices across an offline relaunch.
  const pricing = entry.satsPricing;
  const typicalCost = estimateTurnCostSatsFromPricing(pricing);
  // One reservation figure drives every number on the row — the verdict, the
  // "needs N reserved" line, the top-up shortfall and the messages-left count.
  // They used to come from three different calls and could contradict each
  // other: the ceiling line read `max_cost` while the verdict priced the
  // discounted path, so a sealed row said "affordable" beside "needs 307 sats
  // reserved". See `reserveSatsForEntry` for why sealed models don't discount.
  const reserve = reserveSatsForEntry(entry);
  const affordable = isEntryAffordable(entry, balanceSats);
  // `floor((balance − reserve) / typical) + 1` — the same shape as
  // `estimateMessagesRemainingFromPricing`, re-derived here so it counts
  // against the reservation the node will really take.
  const messagesLeft =
    reserve == null || typicalCost == null || typicalCost <= 0
      ? null
      : balanceSats < reserve
        ? 0
        : Math.floor((balanceSats - reserve) / typicalCost) + 1;
  const required = reserve != null ? Math.ceil(reserve * AFFORD_BUFFER) : null;
  const deficit = !affordable && required != null ? Math.max(1, required - balanceSats) : null;

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
    : `needs ${reserve != null ? Math.ceil(reserve).toLocaleString() : '?'} sats reserved`;
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

  // Per MODEL, never per node and never per vendor. A node badged E2EE serves
  // 9 sealed models out of 582, and 8 of those 9 have an identically-named,
  // identically-priced plaintext twin in the same catalog (`glm-5-3` beside
  // `tinfoil-glm-5-3`). Sealing is request routing to an enclave, decided by
  // the model id — so a lock drawn from the provider would tell the user their
  // `glm-5-3` turn is encrypted when the encrypted one is the row next to it.
  const sealed = isE2eeModelId(entry.modelId);

  return (
    <Menu.Item
      testID={`ai-model-${provider.id}-${tier.id}`}
      isDisabled={disabled}
      onPress={onPress}>
      {/* Publishes this row's measured centre so the iOS harness can issue a
          real physical tap on it. Without it the picker's rows are
          unaddressable inside the FullWindowOverlay and no scenario can press
          one — same marker `actionMenuSheet` rows carry. */}
      <E2EActionMenuTargetMarker
        actionId={`ai-model-${provider.id}-${tier.id}`}
        disabled={disabled}
      />
      <SheetMenuRowContent
        icon={<Icon name={tier.icon} size={20} />}
        title={labelText}
        description={descriptionText}
        trailing={
          <>
            {sealed ? (
              // Sits inside the Menu.Item's accessibility container, so the
              // row is announced as "Max, GLM 5.3 · ~4 sats / msg, End-to-end
              // encrypted" rather than as a padlock nobody can name.
              <View
                testID={`ai-model-${provider.id}-${tier.id}-e2ee`}
                accessible
                accessibilityRole="image"
                accessibilityLabel={E2EE_BADGE_LABEL}>
                <Icon name={E2EE_BADGE_ICON} size={14} />
              </View>
            ) : null}
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

/**
 * What a tab with no rows can honestly say.
 *
 * "Models loading" is a promise that something is coming, and it is only true
 * before a catalog has come back. Once one has, an empty tab is an ANSWER —
 * this node serves nothing this tab can offer — and the user can act on it by
 * switching tab or switching provider. Showing the spinner copy over a catalog
 * that already landed is what left the picker saying "Models loading" forever:
 * a node whose catalog qualified zero models (a real, repeated event — 582
 * models one read, 10 the next) produced an empty lineup and nothing in the
 * app ever re-fetched it.
 *
 * `catalogSize` is `null` only while no catalog read has come back for the
 * current node, which is the one fact that separates the two states.
 */
function emptyTabCopy(
  lineup: AiLineup | null,
  catalogSize: number | null
): { title: string; description: string } {
  if (lineupHasEntries(lineup)) {
    return {
      title: 'No models here',
      description: 'This provider has nothing to offer on this node — try another tab',
    };
  }
  if (catalogSize == null) {
    return {
      title: 'Models loading',
      description: 'Connect to the internet to load the model list',
    };
  }
  return {
    title: 'No models available',
    description: `This node answered with ${catalogSize.toLocaleString()} model${
      catalogSize === 1 ? '' : 's'
    }, none of them usable here — choose a different provider`,
  };
}

interface ModelPickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['model-picker'];
  /** Live wallet value captured above the native portal's context boundary. */
  balanceSats: number;
}

/**
 * Body of the model-picker custom sheet, mounted by `PopupHost`'s
 * `CUSTOM_SHEET_CONTENT` registry. Local `activeProviderTab` state filters
 * the row list to a single provider — the other two providers' rows are
 * NOT mounted, by design (this is the user-facing difference from the
 * profile / emoji pickers, which scroll between sections).
 */
export function ModelPickerContent({ close, balanceSats }: ModelPickerContentProps) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  // Keyed on the live openSeq: the snapPoints sheet mounts its content while
  // openSeq is still settling, so a static render-marker key captures a stale
  // openSeq and the probe's renderedOpenSeq never matches. Re-firing on the
  // live value fixes the gate (contentHeight sheets don't hit this race).
  const popupOpenSeq = usePopupStore((s) => s.openSeq);
  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const setSelectedSlot = useRoutstrStore((s) => s.setSelectedSlot);
  // Live-derived lineup when a catalog fetch has landed this session,
  // else the persisted last-known snapshot, else null (true first-run
  // offline → "models loading" rows).
  //
  // The fall-through tests for ENTRIES, not for presence. A derivation that
  // qualified nothing is an empty object, which is truthy — under `??` it
  // shadowed a perfectly good last-known snapshot and turned a working menu
  // into a permanent "Models loading".
  const sessionLineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  // Size of the catalog this node answered with, or `null` when no read has
  // come back yet. Session-only and cleared on every node change, so it can
  // only ever mean "the node currently in play has answered".
  const catalogSize = useRoutstrStore((s) => s.modelsCache?.data.length ?? null);
  const lineup = lineupHasEntries(sessionLineup)
    ? sessionLineup
    : (lastKnownLineup?.lineup ?? sessionLineup ?? null);
  const lineupSource = lineupHasEntries(sessionLineup)
    ? 'live'
    : lineupHasEntries(lastKnownLineup?.lineup)
      ? 'persisted'
      : 'empty';

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

  // Tabs come from the lineup, not from a list compiled into the app: the
  // catalog decides which vendors a node actually serves, and pinning the
  // menu to four of them hid most of what the user was paying for.
  const providers = useMemo(() => providersForLineup(lineup), [lineup]);
  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderTab) ?? providers[0],
    [activeProviderTab, providers]
  );

  // Partial-lineup rendering is explicit: only filled tier cells get rows (a
  // provider with 2 qualifying models shows 2 rows — never duplicated entries,
  // and the tab itself never hides). A provider with no entries at all renders
  // one neutral loading/empty row instead of a dangling-id lookup.
  const rows = useMemo(
    () =>
      AI_TIERS.map((tier) => ({
        tier,
        entry: entryForSlot(lineup, activeProvider.id, tier.id),
      })).filter((r): r is { tier: AiTier; entry: LineupEntry } => r.entry != null),
    [lineup, activeProvider.id]
  );

  // What the open sheet actually offers, per tab.
  //
  // A row is inert when it is the current selection or the balance cannot
  // cover its reservation, and `Menu.Item` renders both the same way. So a tab
  // whose every row is inert looks exactly like a tab whose rows stopped
  // responding — which is the report this event exists to tell apart. Counts
  // and ids only; no balance figure and no model pricing.
  useEffect(() => {
    const pressable = rows.filter(
      (r) =>
        isEntryAffordable(r.entry, balanceSats) &&
        !(selectedProvider === activeProvider.id && selectedTier === r.tier.id)
    ).length;
    pickerLog.info('modelPicker.rows', {
      tab: activeProvider.id,
      rows: rows.length,
      pressable,
      providers: providers.length,
      selectedProvider,
      selectedTier,
      lineupSource,
    });
  }, [
    rows,
    balanceSats,
    activeProvider.id,
    providers.length,
    selectedProvider,
    selectedTier,
    lineupSource,
  ]);

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
    // No `flex: 1`. The picker is a `contentHeight` sheet, so gorhom measures
    // this subtree to derive the sheet's own height — the container above it
    // has no height yet when that measurement is taken, and `flex: 1` against
    // an indefinite parent collapses to zero in Yoga (the same trap
    // `SheetItemTitle` defends `Menu.ItemTitle` from). Self-sizing is what the
    // other `contentHeight` bodies do.
    <View>
      <E2EActionMenuRenderMarker presentationKey={popupOpenSeq} />
      {/* Title — same typographic position as `<Menu.Label>` in
          ActionMenuHost so the surface reads as a menu sibling. No wrapper
          inset: `contentHeight` sheets get heroui's `px-3` from
          `PopupHost`, exactly like `actionMenuSheet`'s title. */}
      <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
        Model
      </BottomSheet.Title>

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
          {providers.map((p) => {
            // Against `activeProvider`, not against `activeProviderTab`. The
            // tab opens on the current selection, and a selection can name a
            // vendor this node does not serve — a sealed pick after a node
            // swap, which the store deliberately does not move. The row list
            // already falls through to the first real vendor in that case, so
            // comparing the raw tab id left every pill reading unselected
            // while another vendor's rows were the ones on offer, and the one
            // surface that exists to change vendor did not say which vendor
            // was showing.
            const isSelected = activeProvider.id === p.id;
            return (
              <Pressable
                key={p.id}
                testID={`model-tab-${p.id}`}
                // Which vendor is active is carried only by a background
                // colour, so without this the tab strip is unreadable to a
                // screen reader and unassertable by the native harness — a
                // device capture shows these pills shipping with no role and
                // no selected state, which is how a tab that stops responding
                // reaches a user before it reaches a test. Same three props
                // the identical pills in `SectionAnchorList` already carry.
                accessibilityRole="tab"
                accessibilityLabel={p.label}
                accessibilityState={{ selected: isSelected }}
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
      <View style={{ paddingTop: 8 }}>
        <Menu>
          {(() => {
            if (rows.length === 0) {
              const { title, description } = emptyTabCopy(lineup, catalogSize);
              return (
                <Menu.Item testID="ai-model-empty" isDisabled onPress={() => {}}>
                  <SheetMenuRowContent
                    icon={<Icon name="mdi:cloud-off-outline" size={20} />}
                    title={title}
                    description={description}
                  />
                </Menu.Item>
              );
            }
            return rows.map(({ tier, entry }) => (
              <TierRow
                key={`${activeProvider.id}-${tier.id}`}
                tier={tier}
                provider={activeProvider}
                entry={entry}
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
    // Cancels exactly the `px-3` heroui puts on a `contentHeight` sheet's
    // content container, so the strip still bleeds to the sheet's own edge
    // while its first pill lines up with the rows below.
    marginHorizontal: -12,
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
