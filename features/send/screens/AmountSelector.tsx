/**
 * Machine-driven adapter over the shared AmountEntryView primitive.
 * Unpacks colada's amountEntry screen state into the primitive's
 * typed contract and wires the bound actions through.
 */

import { useMemo } from 'react';
import {
  PixelRatio,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import type { ActionVariant, RecipientProfile, ScreenActionName } from '@sovranbitcoin/colada';
import type { BoundAction, QuickSendSuggestion } from '@sovranbitcoin/colada/react';

import { MintSelector } from '@/features/wallet';
import type { ActionMenuVariant } from '@/shared/ui/composed/ActionMenuButton';
import {
  AmountEntryView,
  type AmountEntryTransactionType,
} from '@/shared/ui/composed/AmountEntryView';
import { Log, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

type AmountEntryActions = Record<ScreenActionName['amountEntry'], BoundAction>;

const EMPTY_QUICK_SEND_SUGGESTIONS: QuickSendSuggestion[] = [];

function readAmountEntryFields(entry: Record<string, unknown>) {
  const rawInput = typeof entry.rawInput === 'string' ? entry.rawInput : '';
  const inputMode: 'sat' | 'fiat' = entry.inputMode === 'fiat' ? 'fiat' : 'sat';
  const numericValue = typeof entry.numericValue === 'number' ? entry.numericValue : 0;
  const keyboardUnit = typeof entry.keyboardUnit === 'string' ? entry.keyboardUnit : 'sat';
  const unit = typeof entry.unit === 'string' ? entry.unit : 'sat';
  const secondaryDisplay =
    typeof entry.secondaryDisplay === 'string' ? entry.secondaryDisplay : null;
  const fiatSymbol = typeof entry.fiatSymbol === 'string' ? entry.fiatSymbol : null;

  return {
    rawInput,
    inputMode,
    numericValue,
    keyboardUnit,
    unit,
    secondaryDisplay,
    fiatSymbol,
  };
}

interface AmountSelectorProps {
  entry: Record<string, unknown>;
  actions: AmountEntryActions;
  suggestions?: QuickSendSuggestion[];
  transactionType: 'send' | 'receive';
  /** True while the payment machine is busy (e.g. after Next). */
  machineBusy?: boolean;
  /**
   * When true, the mint selector has been moved out of the header (replaced
   * by a recipient avatar + "Pay <name>") and should render as a 50/50
   * bottom-bar pill alongside Next. The wallet flips this on once the
   * payment machine has resolved a Nostr identity for the melt target
   * (see `colada`'s `resolveRecipientPubkey` / `resolveRecipientProfile`
   * operations).
   */
  showMintBottomButton?: boolean;
  /** Mint URL — drives the MintSelector pill rendered in the bottom slot. */
  mintUrl?: string;
  /** Tap handler — opens the mint-list screen. */
  onRequestMintList?: () => void;
  /**
   * Resolved Nostr recipient identity for the current melt target. When
   * present, forwarded to `actions.next.execute(...)` as part of the params
   * so colada's default `next` handler can pass it into the
   * machine via `enterAmount`. Lets LightningSendScreen render the "Pay <name>"
   * header on first paint instead of paying a second NIP-05 round-trip.
   */
  recipientPubkey?: string;
  recipientProfile?: RecipientProfile;
  /** Hide variant menu when the caller owns delivery after ecash creation. */
  suppressNextVariants?: boolean;
}

export function AmountSelector({
  entry,
  actions,
  suggestions = EMPTY_QUICK_SEND_SUGGESTIONS,
  transactionType,
  machineBusy = false,
  showMintBottomButton = false,
  mintUrl,
  onRequestMintList,
  recipientPubkey,
  recipientProfile,
  suppressNextVariants = false,
}: AmountSelectorProps) {
  useLifecycleLogger('AmountSelector', walletLog);

  const { rawInput, inputMode, numericValue, keyboardUnit, unit, secondaryDisplay, fiatSymbol } =
    readAmountEntryFields(entry);

  const handleKeyPress = (value: string) => {
    walletLog.debug('amount.input.key', { value, inputMode });
    void actions.setInput.execute({ input: value });
  };

  const handleSuggestionTap = (suggestion: QuickSendSuggestion) => {
    walletLog.info('amount.suggestion.tap', {
      satoshis: suggestion.satoshis,
      label: suggestion.label,
      mode: suggestion.inputMode,
    });
    void actions.setInput.execute({
      input: suggestion.inputValue,
      mode: suggestion.inputMode,
    });
  };

  const handleToggle = () => {
    walletLog.info('amount.input.toggle', { fromMode: inputMode });
    void actions.toggle.execute();
  };

  // Pack recipient identity into the execute params on every `next` call.
  // Spread by the action manager into `ctx`, then read by colada's
  // default `next` handler — undefined values are ignored downstream, so
  // safe to always include.
  const nextExecuteParams = useMemo(
    () => ({
      ...(recipientPubkey ? { recipientPubkey } : {}),
      ...(recipientProfile ? { recipientProfile } : {}),
    }),
    [recipientPubkey, recipientProfile]
  );

  const handleNext = async () => {
    walletLog.info('amount.next', {
      numericValue,
      inputMode,
      unit,
      transactionType,
      recipientPubkeyPresent: !!('recipientPubkey' in nextExecuteParams),
      recipientProfilePresent: !!('recipientProfile' in nextExecuteParams),
      recipientDisplayName:
        (nextExecuteParams as { recipientProfile?: { displayName?: string } }).recipientProfile
          ?.displayName ?? null,
    });
    await actions.next.execute(nextExecuteParams);
  };

  // Map the colada availability variants (ecash/lightning/onchain on
  // send-money flows) into ActionMenuButton's variant shape. Each variant
  // invokes `actions.next.execute({ variantId })`, which routes through the
  // screen-action handler to the machine.
  const nextVariants = useMemo<ActionMenuVariant[] | undefined>(() => {
    if (suppressNextVariants) return undefined;
    const raw = actions.next.variants as ActionVariant[] | undefined;
    if (!raw || raw.length === 0) return undefined;
    return raw.map((v) => ({
      id: v.id,
      label: v.label,
      description: v.description,
      icon: v.icon,
      isDisabled: !v.available,
      reason: v.reason,
      isDestructive: v.isDestructive,
      onPress: async () => {
        walletLog.info('amount.next.variant', {
          variantId: v.id,
          recipientPubkeyPresent: !!('recipientPubkey' in nextExecuteParams),
          recipientProfilePresent: !!('recipientProfile' in nextExecuteParams),
          recipientDisplayName:
            (nextExecuteParams as { recipientProfile?: { displayName?: string } }).recipientProfile
              ?.displayName ?? null,
        });
        await actions.next.execute({ variantId: v.id, ...nextExecuteParams });
      },
    }));
  }, [actions.next, nextExecuteParams, suppressNextVariants]);

  // The AI-credit top-up flow lands on this screen via a hand-rolled
  // navigation (`useRoutstrTopUpStore.start()` → `/(send-flow)/amount`),
  // not through a QR/paste entry point. In that flow the only sensible
  // action is "Next" — Paste / Scan-QR don't apply because the
  // destination is fixed (the AI-credit wallet, not an arbitrary
  // recipient). Suppress the extras while the top-up flow is active so
  // the screen reduces to the keypad + Next button.
  const isRoutstrTopUpActive = useRoutstrTopUpStore((s) => s.active);

  const extraButtons = useMemo((): ButtonHandlerProps['buttons'] => {
    if (isRoutstrTopUpActive) return [];
    const buttons: ButtonHandlerProps['buttons'] = [];
    if (actions.paste.available) {
      buttons.push({
        testID: 'amount-paste',
        text: 'Paste',
        icon: 'lets-icons:copy',
        variant: 'secondary',
        onPress: async () => {
          walletLog.info('amount.paste');
          await actions.paste.execute();
        },
        loading: actions.paste.loading,
      });
    }
    if (actions.scanQr.available) {
      buttons.push({
        testID: 'amount-scan-qr',
        text: 'Scan QR',
        icon: 'stash:qr-code',
        variant: 'secondary',
        onPress: async () => {
          walletLog.info('amount.scan_qr');
          await actions.scanQr.execute();
        },
        loading: actions.scanQr.loading,
      });
    }
    return buttons;
  }, [isRoutstrTopUpActive, actions.paste, actions.scanQr]);

  const nextLoading = machineBusy || actions.next.loading;
  const nextDisabled = !actions.next.available;
  const nextNoticeText = nextDisabled ? actions.next.reason : undefined;
  // Over-balance is reported separately from `available`: an ecash send rounds
  // down to the balance and stays available, so it never surfaces as a notice.
  // The amount still reads as a problem (red) when the entry exceeds balance.
  const exceedsBalance = actions.next.exceedsBalance === true;
  const transactionTypeForView: AmountEntryTransactionType = transactionType;

  // When the recipient header is in play, surface the mint as a 50/50
  // bottom-bar pill — same component the header uses, so balance, icon,
  // and liquid/blur/flat chrome stay consistent across the swap.
  //
  // Sizing mirrors Button's `SIZES.default` so the pill and Next render
  // with identical outer footprints:
  //   • BottomButtons spans full window width (no horizontal padding),
  //     so each 50% slot is `windowWidth / 2`.
  //   • Button bakes `margin: 4` on all four sides + `marginBottom: 8`,
  //     consuming 8 px of horizontal space inside its slot. The pill
  //     gets the same margins on its wrapper, and `width = slot - 8`,
  //     so visible button widths match to the pixel.
  //   • Height 48 matches Button's `minHeight`; contentHeight 32 leaves
  //     visible padding inside the SwiftUI liquid-glass button instead
  //     of crowding the avatar + label + chevron row at 48 px.
  const { width: windowWidth } = useWindowDimensions();
  const mintBottomSlotWidth = useMemo(
    () => PixelRatio.roundToNearestPixel(windowWidth / 2),
    [windowWidth]
  );
  const mintBottomPillWidth = useMemo(
    () => Math.max(0, mintBottomSlotWidth - 8),
    [mintBottomSlotWidth]
  );
  const mintBottomPillWrapperStyle = useMemo<StyleProp<ViewStyle>>(() => {
    return [
      styles.mintBottomPillWrapper,
      {
        width: mintBottomPillWidth,
        height: 48,
      },
    ];
  }, [mintBottomPillWidth]);
  const leadingBottomButton = useMemo(() => {
    if (!showMintBottomButton || !onRequestMintList) return undefined;
    return (
      <View style={mintBottomPillWrapperStyle}>
        <MintSelector
          selectedMintUrl={mintUrl}
          onRequestMintList={onRequestMintList}
          width={mintBottomPillWidth}
          height={48}
          contentHeight={32}
        />
      </View>
    );
  }, [
    showMintBottomButton,
    onRequestMintList,
    mintUrl,
    mintBottomPillWidth,
    mintBottomPillWrapperStyle,
  ]);

  return (
    <Log name="AmountSelector" style={styles.amountSelectorRoot}>
      <AmountEntryView
        rawInput={rawInput}
        numericValue={numericValue}
        unit={unit}
        keyboardUnit={keyboardUnit}
        inputMode={inputMode}
        onKeyPress={handleKeyPress}
        onNext={handleNext}
        nextLoading={nextLoading}
        nextDisabled={nextDisabled}
        exceedsBalance={exceedsBalance}
        noticeText={nextNoticeText}
        nextTestID="amount-next"
        fiatSymbol={fiatSymbol}
        secondaryDisplay={secondaryDisplay}
        onToggleMode={handleToggle}
        suggestions={suggestions}
        onSuggestionTap={handleSuggestionTap}
        extraButtons={extraButtons}
        nextVariants={nextVariants}
        leadingBottomButton={leadingBottomButton}
        transactionType={transactionTypeForView}
      />
    </Log>
  );
}

const styles = StyleSheet.create({
  amountSelectorRoot: {
    flex: 1,
  },
  mintBottomPillWrapper: {
    margin: 4,
    marginBottom: 8,
  },
});
