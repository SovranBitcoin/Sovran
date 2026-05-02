import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { getModels, type RoutstrModel } from '@/shared/lib/routstr/api';
import { modelPickerPopup } from '@/shared/lib/popup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import {
  AFFORD_BUFFER,
  AI_PROVIDERS,
  AI_TIERS,
  getAffordabilityDetails,
  getModelDisplayName,
  getProviderById,
  getTierById,
  modelIdForSlot,
  resolveSelectedModel,
} from '../lib/format';
import { aiLog } from '@/shared/lib/logger';
import opacity from 'hex-color-opacity';

const ACTION_HEIGHT = 32;

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
 *     store's `partialize`), so the app always boots into the curated
 *     defaults (`openai` / `auto`).
 *   - Each (provider, tier) pair maps to a single model id via
 *     `TIER_MATRIX`. Send-time runtime fallback (5xx / network) walks the
 *     same tier across the *other* providers — the user's chosen provider
 *     stays the primary attempt.
 *   - Rows whose underlying model exceeds the user's balance render
 *     half-faded with the gap shown as the row description.
 */
export function ModelChip() {
  const [foreground, surfaceTertiary, accent] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'accent',
  ] as const);

  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const balanceMsats = useRoutstrStore((s) => s.balance);
  const cachedModels = useRoutstrStore((s) => s.modelsCache?.data ?? null);
  const setCachedModels = useRoutstrStore((s) => s.setCachedModels);
  const isCacheStale = useRoutstrStore((s) => s.isCacheStale);

  const [models, setModels] = useState<RoutstrModel[]>(cachedModels ?? []);

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
  const resolvedModelId = resolveSelectedModel(
    currentProvider.id,
    currentTier.id,
    balanceSats,
    models
  );

  // Diagnostic snapshot — fires once per (balance, models, slot) change.
  // Captures every cell of the (provider, tier) matrix the chip's
  // affordability gate uses, so a "Top up X sats" indicator that doesn't
  // match send-time behaviour is debuggable from logs alone.
  useEffect(() => {
    if (models.length === 0) return;
    const cellSnapshots: Array<Record<string, unknown>> = [];
    for (const tier of AI_TIERS) {
      for (const provider of AI_PROVIDERS) {
        const modelId = modelIdForSlot(provider.id, tier.id);
        const details = getAffordabilityDetails(modelId, balanceSats, models);
        const model = models.find((m) => m.id === modelId);
        cellSnapshots.push({
          tierId: tier.id,
          providerId: provider.id,
          modelId,
          ...details,
          catalog_max_cost_sats: model?.sats_pricing?.max_cost ?? null,
          catalog_max_cost_usd: model?.pricing?.max_cost ?? null,
          catalog_max_prompt_cost_sats: model?.sats_pricing?.max_prompt_cost ?? null,
          catalog_max_completion_cost_sats: model?.sats_pricing?.max_completion_cost ?? null,
        });
      }
    }
    aiLog.info('ai.tier.affordability_snapshot', {
      balanceMsats: balanceMsats ?? 0,
      balanceSats,
      selectedTier,
      selectedProvider,
      buffer: AFFORD_BUFFER,
      catalogSize: models.length,
      cells: cellSnapshots,
    });
  }, [balanceMsats, balanceSats, models, selectedTier, selectedProvider]);

  const resolvedModelName = getModelDisplayName(resolvedModelId, models);
  // Catalog hasn't loaded → `getModelDisplayName` returns the raw id; show
  // the tier label in that case so the chip never reads like a dev string.
  const friendlyResolvedName =
    resolvedModelName === resolvedModelId ? currentTier.label : resolvedModelName;

  const chipLabel = `${currentTier.label} · ${friendlyResolvedName}`;

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

  return (
    <Pressable
      onPress={onPress}
      testID="ai-model-chip"
      style={{
        height: ACTION_HEIGHT,
        paddingHorizontal: 12,
        borderRadius: ACTION_HEIGHT / 2,
        backgroundColor: surfaceTertiary,
        justifyContent: 'center',
      }}>
      <HStack align="center" spacing={6}>
        <Icon
          name={currentTier.icon}
          size={14}
          color={selectedTier === 'auto' ? accent : foreground}
        />
        <Text size={13} style={{ color: foreground, fontWeight: '500' }}>
          {chipLabel}
        </Text>
        <Icon name="mdi:chevron-down" size={12} color={opacity(foreground, 0.6)} />
      </HStack>
    </Pressable>
  );
}
