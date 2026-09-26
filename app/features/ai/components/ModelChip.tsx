import { useCallback, useEffect } from 'react';
import { useRoutstrFunds } from '../hooks/useRoutstrFunds';
import { useModelCatalog } from '../hooks/useModelCatalog';
import { Keyboard } from 'react-native';
import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { isE2eeModelId, lineupProviderIds } from '@/shared/lib/routstr/lineup';
import { refreshRoutstrLineup } from '@/shared/lib/routstr/refreshLineup';
import { sweepUnsettledPayments } from '@/shared/lib/routstr/sdk/client';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { modelPickerPopup } from '@/shared/lib/popup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { affordableForEntry } from '@/features/ai/lib/reserve';
import {
  AFFORD_BUFFER,
  AI_TIERS,
  E2EE_BADGE_ICON,
  E2EE_BADGE_LABEL,
  entryForSlot,
  providersForLineup,
  estimateTurnCostSatsFromPricing,
  getProviderById,
  getTierById,
  isSelectionServed,
  resolveSelectedEntry,
  UNSERVED_SELECTION_LABEL,
} from '../lib/format';
import { aiLog } from '@/shared/lib/logger';
import { withAlpha } from '@/shared/lib/color';

/**
 * Inline pill chip showing the current AI tier + provider + the model the
 * pair currently resolves to. Tapping the chip opens a tabbed bottom sheet
 * styled like the profile switcher: each tab is a provider (OpenAI /
 * Claude / Grok), each row inside is a tier (Auto / Pro / Max). Selection
 * writes both `selectedProvider` and `selectedTier` atomically through
 * `setSelectedSlot`, so the chip never spends a render in a half-updated
 * state.
 *
 * Selection rules:
 *   - Both `selectedProvider` and `selectedTier` are session-only (see the
 *     store's `partialize`), so the app always boots into the defaults
 *     (`openai` / `auto`).
 *   - Each (provider, tier) pair resolves against the DYNAMIC lineup
 *     derived from the live catalog (persisted last-known snapshot when
 *     offline — see `shared/lib/routstr/lineup.ts`). Send-time runtime
 *     fallback (5xx / network) walks the same tier across the *other*
 *     providers — the user's chosen provider stays the primary attempt.
 *   - Rows whose underlying model exceeds the user's balance render
 *     half-faded with the gap shown as the row description.
 *
 * The app's SOLE catalog fetch hangs off this chip, but it is no longer this
 * chip's business: `useModelCatalog` owns it, including the retry ladder a
 * failed first fetch needs. A successful read lands in `setCachedModels`,
 * which derives the lineup and persists the compact last-known snapshot.
 */
export function ModelChip() {
  const background = useThemeColor('background');

  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const funds = useRoutstrFunds();
  const sessionLineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  const lineup = sessionLineup ?? lastKnownLineup?.lineup ?? null;
  const lineupSource = sessionLineup ? 'live' : lastKnownLineup ? 'persisted' : 'empty';

  const models = useModelCatalog();

  useVisualActivityEffect(() => {
    void refreshRoutstrLineup();
    // Coming back to the screen is the moment to ask about money the node is
    // still holding — the request the app was closed on, the one the user
    // stopped. The launch sweep ran once; this is the maintainers' own
    // advice (sweep on launch, on foreground, after every aborted request),
    // and a sweep with nothing to ask costs one storage read.
    void sweepUnsettledPayments('launch');
  });

  const balanceSats = funds?.balanceSats ?? 0;
  const currentTier = getTierById(selectedTier);
  const currentProvider = getProviderById(selectedProvider);
  const resolvedEntry = resolveSelectedEntry(
    currentProvider.id,
    currentTier.id,
    balanceSats,
    lineup
  );
  // Nothing resolved, and the node HAS answered: this selection names a vendor
  // or a rung the node in front of us does not serve. The sealed selection is
  // the case that reaches a user — `routstrStore` deliberately refuses to move
  // one onto a plaintext vendor, because moving it is the silent downgrade, so
  // a node swap onto a node with no `tinfoil-` row legitimately leaves the
  // selection unresolvable. Saying so is the honest half of that bargain; the
  // chip used to repeat the tier instead and render "Auto · Auto", which reads
  // like a working selection and let a failed send be the first sign.
  const served = isSelectionServed(currentProvider.id, currentTier.id, balanceSats, lineup);

  // Diagnostic snapshot — fires once per (balance, lineup, slot) change.
  // Captures every filled cell of the (provider, tier) matrix the chip's
  // affordability gate uses, so a "Top up X sats" indicator that doesn't
  // match send-time behaviour is debuggable from logs alone.
  useEffect(() => {
    if (!lineup) return;
    const cellSnapshots: Record<string, unknown>[] = [];
    for (const tier of AI_TIERS) {
      for (const provider of providersForLineup(lineup)) {
        const entry = entryForSlot(lineup, provider.id, tier.id);
        if (!entry) continue; // partial provider — cell deliberately empty
        cellSnapshots.push({
          tierId: tier.id,
          providerId: provider.id,
          modelId: entry.modelId,
          lastKnown: entry.lastKnown ?? false,
          visionInput: entry.visionInput,
          estimatedTurnCostSats: estimateTurnCostSatsFromPricing(entry.satsPricing),
          // Priced through the same SDK mirror the picker row and the spend
          // sheet use, so all three answer the same question. `canAffordPricing`
          // called a sealed model affordable at roughly a tenth of what the
          // node demands, because it applies a completion discount the node
          // refuses on a body it cannot read.
          affordable: affordableForEntry(entry, balanceSats),
          maxCompletionTokens: entry.maxCompletionTokens ?? null,
          catalog_max_cost_sats: entry.satsPricing.max_cost,
          catalog_image_fee_sats: entry.satsPricing.image,
          contextLength: entry.contextLength,
        });
      }
    }
    aiLog.info('ai.tier.affordability_snapshot', {
      balanceSats,
      selectedTier,
      selectedProvider,
      buffer: AFFORD_BUFFER,
      // The mismatch this event was already carrying, stated rather than
      // inferred. `selectedProvider: "tinfoil"` over cells whose every
      // `providerId` is a plaintext vendor IS the stranded selection, and it
      // took reading both fields against each other to see it.
      selectionServed: served,
      lineupSource,
      catalogSize: models.length,
      cells: cellSnapshots,
    });
  }, [balanceSats, models.length, lineup, lineupSource, selectedTier, selectedProvider, served]);

  // No lineup yet (first run, fetch pending) → show the tier label so the
  // chip never reads like a dev string.
  const chipLabel = served
    ? `${currentTier.label} · ${resolvedEntry?.displayName ?? currentTier.label}`
    : `${currentProvider.label} · ${UNSERVED_SELECTION_LABEL}`;

  // The chip names the model a turn will actually be sent to, so the padlock
  // belongs to THAT model and nothing else. The display name cannot carry it:
  // a node serves `glm-5-3` and `tinfoil-glm-5-3` under one name at one price
  // and only the second is sealed, so the id is the only honest signal — and
  // the send path's own fallback can swap the resolved entry, which is exactly
  // when the user needs the lock to disappear.
  const sealed = isE2eeModelId(resolvedEntry?.modelId);

  // ONE glyph in the leading slot. The encrypted vendor's own icon is the
  // padlock, so drawing the vendor glyph AND a per-model padlock badge put two
  // locks on the chip for every sealed selection — the lock said the same
  // thing twice and the user read it as a bug. The padlock is the more
  // important of the two signals (it is a fact about the request, the vendor
  // glyph is decoration), so when the resolved model is sealed the lock takes
  // the slot and the vendor glyph yields it.
  const leadingIcon = sealed ? E2EE_BADGE_ICON : currentProvider.icon;

  // One line naming every state the selection can be in, emitted only when
  // one of them changes. `ai.tier.affordability_snapshot` below carries the
  // whole matrix and re-fires on every balance tick, which is the wrong
  // signal-to-noise for the question "why did the chip say THAT after I
  // switched provider" — that needs the node, the pin, the pair, what it
  // resolved to, whether the node serves it, and which lineup answered, on one
  // line, with nothing else.
  const nodeBaseUrl = useRoutstrStore((s) => s.nodeBaseUrl);
  const userNodeBaseUrl = useRoutstrStore((s) => s.userNodeBaseUrl);
  const resolvedModelId = resolvedEntry?.modelId ?? null;
  const catalogSize = models.length;
  useEffect(() => {
    aiLog.info('ai.selection.state', {
      nodeBaseUrl,
      pinned: userNodeBaseUrl != null,
      selectedProvider,
      selectedTier,
      resolvedModelId,
      sealed,
      served,
      lineupSource,
      lineupProviders: lineupProviderIds(lineup),
      catalogSize,
    });
  }, [
    nodeBaseUrl,
    userNodeBaseUrl,
    selectedProvider,
    selectedTier,
    resolvedModelId,
    sealed,
    served,
    lineupSource,
    lineup,
    catalogSize,
  ]);

  const onPress = useCallback(() => {
    // Picker has no in-sheet inputs, so gorhom can't lift over an
    // externally owned keyboard (the composer). Dismiss it so the sheet
    // isn't occluded. The picker itself is a custom heroui BottomSheet
    // (`PopupHost`'s lane) — tabs *filter* the row list to the active
    // provider instead of scrolling between sections, which is the
    // requested behaviour.
    Keyboard.dismiss();
    modelPickerPopup();
  }, []);

  // Routed through the shared `Button` primitive (variant="primary") so the
  // chip and the DM Send Money button share one visual contract — same fill,
  // same height, same padding scale. The ReactNode `text` slot gives us a
  // trailing chevron the Button primitive doesn't model directly.
  return (
    <Button
      testID="ai-model-chip"
      // The button flattens its children into one accessibility node, so the
      // badge cannot speak for itself here — it has to be said in the label.
      accessibilityLabel={`Model: ${chipLabel}${sealed ? `, ${E2EE_BADGE_LABEL}` : ''}`}
      accessibilityHint="Opens the model picker"
      variant="primary"
      size="compact"
      onPress={onPress}
      icon={
        // The test id rides on the slot only while it holds the lock, so a
        // test can still ask "is this chip badged" without a second glyph.
        <View testID={sealed ? 'ai-model-chip-e2ee' : undefined}>
          <Icon name={leadingIcon} size={16} color={background} />
        </View>
      }
      text={
        <HStack align="center" gap={4}>
          <Text size={13} bold color={background}>
            {chipLabel}
          </Text>
          <Icon name="mdi:chevron-down" size={12} color={withAlpha(background, 0.7)} />
        </HStack>
      }
    />
  );
}
