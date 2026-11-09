/**
 * What the AI model picker shows: one tab per provider the node serves, each
 * with up to three tier rows (Auto / Pro / Max) from that provider's
 * dynamically derived lineup (see `shared/lib/routstr/lineup.ts`). Rows carry
 * live per-message cost and a small image glyph on vision-capable models.
 *
 * Tabs filter: the picker sheet shows only the active provider's rows. A
 * provider with nothing to offer keeps its tab and says why in one disabled
 * row, rather than a dangling lookup.
 *
 * Pure: `useModelPicker` feeds it the stores and the balance, and keeps the
 * open sheet current as they change.
 */

import { View } from 'react-native';
import Icon from 'assets/icons';

import {
  isE2eeModelId,
  lineupHasEntries,
  type AiLineup,
  type AiProviderId,
  type AiTierId,
  type LineupEntry,
} from '@/shared/lib/routstr/lineup';
import type { PickerOption, PickerRequest, PickerSection } from '@/shared/lib/picker/types';

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
} from './format';
import { affordableForEntry, reservedSatsTypical } from './reserve';

// "cost unavailable" now only renders when a live catalog row genuinely
// ships without pricing — the dynamic lineup can no longer point at a
// model that doesn't exist (the old hardcoded-id failure mode).
const formatTypicalCost = (sats: number | null): string => {
  if (sats == null) return 'cost unavailable';
  if (sats >= 1) return `~${Math.round(sats).toLocaleString()} sats / msg`;
  if (sats >= 0.01) return `~${sats.toFixed(2)} sats / msg`;
  return '< 1 sat / msg';
};

/** A row's id: the slot it selects. */
export function modelOptionId(provider: AiProviderId, tier: AiTierId): string {
  return `${provider}:${tier}`;
}

interface ModelPickerState {
  lineup: AiLineup | null;
  /** Size of the catalog the node answered with, or `null` before any answer. */
  catalogSize: number | null;
  selectedProvider: AiProviderId;
  selectedTier: AiTierId;
  balanceSats: number;
}

/**
 * One tier row.
 *
 * Every figure comes from the lineup entry's compact pricing — identical math
 * against a live catalog row or the persisted offline snapshot, so the picker
 * keeps real prices across an offline relaunch. One reservation figure drives
 * every number on the row — the verdict, the "needs N reserved" line, the
 * top-up shortfall and the messages-left count. They used to come from three
 * different calls and could contradict each other: the ceiling line read
 * `max_cost` while the verdict priced the discounted path, so a sealed row
 * said "affordable" beside "needs 307 sats reserved".
 *
 * `reservedSatsTypical` is the SDK mirror the spend sheet prices with, so a
 * row and the sheet it leads to cannot quote two different numbers for the
 * same model. It carries the sealed rule too: a node cannot read a sealed
 * request body to verify a `max_tokens` bound, so a `tinfoil-` id gets no
 * completion discount and reserves the flat ceiling.
 */
function tierOption(
  tier: AiTier,
  provider: AiProvider,
  entry: LineupEntry,
  { balanceSats, selectedProvider, selectedTier }: ModelPickerState
): PickerOption {
  const typicalCost = estimateTurnCostSatsFromPricing(entry.satsPricing);
  const reserve = reservedSatsTypical(entry);
  const affordable = affordableForEntry(entry, balanceSats);
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

  // Affordable copy: "{Model} · ~N sats / msg" using the realistic per-turn
  // estimate. Unaffordable copy: "{Model} · needs N sats reserved" so the
  // number lines up with the node's actual reservation. Entries substituted
  // from the last-known snapshot are annotated — their ids may no longer
  // exist on the API, and the send-path candidate chain absorbs that.
  const costCopy = affordable
    ? formatTypicalCost(typicalCost)
    : `needs ${reserve != null ? Math.ceil(reserve).toLocaleString() : '?'} sats reserved`;
  const description = `${entry.displayName || tier.label} · ${costCopy}${
    entry.lastKnown ? ' · last known' : ''
  }`;

  // Per MODEL, never per node and never per vendor. A node badged E2EE serves
  // 9 sealed models out of 582, and 8 of those 9 have an identically-named,
  // identically-priced plaintext twin in the same catalog (`glm-5-3` beside
  // `tinfoil-glm-5-3`). Sealing is request routing to an enclave, decided by
  // the model id — so a lock drawn from the provider would tell the user their
  // `glm-5-3` turn is encrypted when the encrypted one is the row next to it.
  const sealed = isE2eeModelId(entry.modelId);
  const testID = `ai-model-${provider.id}-${tier.id}`;

  return {
    id: modelOptionId(provider.id, tier.id),
    title:
      affordable && messagesLeft != null && messagesLeft > 0
        ? `${tier.label} · ~${messagesLeft.toLocaleString()} left`
        : tier.label,
    description,
    leading: { icon: { name: tier.icon, size: 20 } },
    trailing:
      sealed || entry.visionInput ? (
        <View className="flex-row items-center gap-1.5">
          {sealed ? (
            // Inside the row's accessibility container, so the row is
            // announced with "End-to-end encrypted" rather than as a padlock
            // nobody can name.
            <View
              testID={`${testID}-e2ee`}
              accessible
              accessibilityRole="image"
              accessibilityLabel={E2EE_BADGE_LABEL}>
              <Icon name={E2EE_BADGE_ICON} size={14} />
            </View>
          ) : null}
          {/* Image-input capability: "you can attach photos with this model". */}
          {entry.visionInput ? <Icon name="mdi:image-outline" size={14} /> : null}
        </View>
      ) : undefined,
    selected: selectedProvider === provider.id && selectedTier === tier.id,
    disabled: !affordable,
    reason:
      !affordable && deficit != null
        ? `Top up ${deficit.toLocaleString()} more sats to use this tier`
        : description,
    testID,
  };
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
 */
function emptyTabOption(lineup: AiLineup | null, catalogSize: number | null): PickerOption {
  const copy = lineupHasEntries(lineup)
    ? {
        title: 'No models here',
        reason: 'This provider has nothing to offer on this node — try another tab',
      }
    : catalogSize == null
      ? { title: 'Models loading', reason: 'Connect to the internet to load the model list' }
      : {
          title: 'No models available',
          reason: `This node answered with ${catalogSize.toLocaleString()} model${
            catalogSize === 1 ? '' : 's'
          }, none of them usable here — choose a different provider`,
        };
  return {
    id: 'empty',
    ...copy,
    leading: { icon: { name: 'mdi:cloud-off-outline', size: 20 } },
    disabled: true,
    testID: 'ai-model-empty',
  };
}

/**
 * The picker's inputs, read from the Routstr store's fields and the balance.
 *
 * The lineup is the live one when a catalog fetch has landed this session,
 * else the persisted last-known snapshot, else null (true first-run offline →
 * "Models loading"). The fall-through tests for ENTRIES, not for presence: a
 * derivation that qualified nothing is an empty object, which is truthy, and
 * under `??` it shadowed a perfectly good last-known snapshot and turned a
 * working menu into a permanent "Models loading". The catalog size is
 * session-only and cleared on every node change, so it can only ever mean
 * "the node currently in play has answered".
 */
export function modelPickerState(
  routstr: {
    lineup: AiLineup | null;
    lastKnownLineup: { lineup: AiLineup } | null;
    modelsCache: { data: readonly unknown[] } | null;
    selectedProvider: AiProviderId;
    selectedTier: AiTierId;
  },
  balanceSats: number
): ModelPickerState {
  return {
    lineup: lineupHasEntries(routstr.lineup)
      ? routstr.lineup
      : (routstr.lastKnownLineup?.lineup ?? routstr.lineup ?? null),
    catalogSize: routstr.modelsCache?.data.length ?? null,
    selectedProvider: routstr.selectedProvider,
    selectedTier: routstr.selectedTier,
    balanceSats,
  };
}

export function modelPickerRequest(state: ModelPickerState): PickerRequest {
  // Tabs come from the lineup, not from a list compiled into the app: the
  // catalog decides which vendors a node actually serves.
  const sections: PickerSection[] = providersForLineup(state.lineup).map((provider) => {
    // Only filled tier cells get rows: a provider with 2 qualifying models
    // shows 2 rows, never duplicated entries.
    const options = AI_TIERS.flatMap((tier) => {
      const entry = entryForSlot(state.lineup, provider.id, tier.id);
      return entry ? [tierOption(tier, provider, entry, state)] : [];
    });
    return {
      id: provider.id,
      title: provider.label,
      icon: provider.icon,
      testID: `model-tab-${provider.id}`,
      options: options.length > 0 ? options : [emptyTabOption(state.lineup, state.catalogSize)],
    };
  });
  return {
    title: 'Model',
    testID: 'ai-model-picker',
    sections,
    // Open onto the selected provider: people come here to swap tier far more
    // often than provider. A selection can name a vendor this node does not
    // serve (a sealed pick after a node swap, which the store deliberately does
    // not move); the sheet then opens on the first vendor it does serve.
    initialSectionId: state.selectedProvider,
  };
}
