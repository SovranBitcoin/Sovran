import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { checkBalance, getModels, type RoutstrModel } from '@/shared/lib/routstr/api';
import { modelPickerPopup } from '@/shared/lib/popup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import {
  AFFORD_BUFFER,
  AI_PROVIDERS,
  AI_TIERS,
  canAffordPricing,
  entryForSlot,
  estimateTurnCostSatsFromPricing,
  getProviderById,
  getTierById,
  resolveSelectedEntry,
} from '../lib/format';
import { aiLog } from '@/shared/lib/logger';
import opacity from 'hex-color-opacity';

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
 * This chip's mount effect is the app's SOLE catalog fetcher: a
 * successful `getModels()` lands in `setCachedModels`, which derives the
 * lineup and persists the compact last-known snapshot.
 */
export function ModelChip() {
  const background = useThemeColor('background');

  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const balanceMsats = useRoutstrStore((s) => s.balance);
  const cachedModels = useRoutstrStore((s) => s.modelsCache?.data ?? null);
  const setCachedModels = useRoutstrStore((s) => s.setCachedModels);
  const isCacheStale = useRoutstrStore((s) => s.isCacheStale);
  const sessionLineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  const lineup = sessionLineup ?? lastKnownLineup?.lineup ?? null;
  const lineupSource = sessionLineup ? 'live' : lastKnownLineup ? 'persisted' : 'empty';

  const [models, setModels] = useState<RoutstrModel[]>(cachedModels ?? []);

  // Balance self-heal on mount. The only other refresh point is the
  // post-stream diff in `useAiSend`, which a 402 never reaches — so a
  // drained key would otherwise leave the persisted balance stale
  // indefinitely and every affordability gate lying (observed: UI at 299
  // sats vs 0.2 sats actually available → endless insufficient-balance
  // popups). One fetch per chip mount keeps the pill and picker honest.
  const apiKey = useRoutstrStore((s) => s.apiKey);
  const setBalance = useRoutstrStore((s) => s.setBalance);
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    checkBalance(apiKey)
      .then((data) => {
        if (!cancelled) setBalance(data.balance);
      })
      .catch(() => {
        // Silent — offline keeps the last-known balance, same policy as
        // the models fetch below.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only: one refresh per AI-tab session, not per keystroke of
    // dependent state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cachedModels && !isCacheStale()) {
      setModels(cachedModels);
      return;
    }
    let cancelled = false;
    getModels()
      .then((next) => {
        if (cancelled) return;
        setCachedModels(next);
        setModels(next);
      })
      .catch(() => {
        // Silent — the chip still renders the tier label.
      });
    return () => {
      cancelled = true;
    };
  }, [cachedModels, isCacheStale, setCachedModels]);

  const balanceSats = balanceMsats != null ? Math.floor(balanceMsats / 1000) : 0;
  const currentTier = getTierById(selectedTier);
  const currentProvider = getProviderById(selectedProvider);
  const resolvedEntry = resolveSelectedEntry(
    currentProvider.id,
    currentTier.id,
    balanceSats,
    lineup
  );

  // Diagnostic snapshot — fires once per (balance, lineup, slot) change.
  // Captures every filled cell of the (provider, tier) matrix the chip's
  // affordability gate uses, so a "Top up X sats" indicator that doesn't
  // match send-time behaviour is debuggable from logs alone.
  useEffect(() => {
    if (!lineup) return;
    const cellSnapshots: Record<string, unknown>[] = [];
    for (const tier of AI_TIERS) {
      for (const provider of AI_PROVIDERS) {
        const entry = entryForSlot(lineup, provider.id, tier.id);
        if (!entry) continue; // partial provider — cell deliberately empty
        cellSnapshots.push({
          tierId: tier.id,
          providerId: provider.id,
          modelId: entry.modelId,
          lastKnown: entry.lastKnown ?? false,
          visionInput: entry.visionInput,
          estimatedTurnCostSats: estimateTurnCostSatsFromPricing(entry.satsPricing),
          affordable: canAffordPricing(entry.satsPricing, balanceSats),
          catalog_max_cost_sats: entry.satsPricing.max_cost,
          catalog_image_fee_sats: entry.satsPricing.image,
          contextLength: entry.contextLength,
        });
      }
    }
    aiLog.info('ai.tier.affordability_snapshot', {
      balanceMsats: balanceMsats ?? 0,
      balanceSats,
      selectedTier,
      selectedProvider,
      buffer: AFFORD_BUFFER,
      lineupSource,
      catalogSize: models.length,
      cells: cellSnapshots,
    });
  }, [
    balanceMsats,
    balanceSats,
    models.length,
    lineup,
    lineupSource,
    selectedTier,
    selectedProvider,
  ]);

  // No lineup yet (first run, fetch pending) → show the tier label so the
  // chip never reads like a dev string.
  const chipLabel = `${currentTier.label} · ${resolvedEntry?.displayName ?? currentTier.label}`;

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
      variant="primary"
      size="compact"
      onPress={onPress}
      icon={<Icon name={currentProvider.icon} size={16} color={background} />}
      text={
        <HStack align="center" spacing={4}>
          <Text size={13} style={{ color: background, fontFamily: 'OxygenBold' }}>
            {chipLabel}
          </Text>
          <Icon name="mdi:chevron-down" size={12} color={opacity(background, 0.7)} />
        </HStack>
      }
    />
  );
}
