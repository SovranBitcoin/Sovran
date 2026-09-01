/**
 * "Choose how to pay" custom sheet — same row chrome as `ActionMenuHost`'s
 * payment-option menu, but routed through `PopupHost`'s heroui standalone
 * `<BottomSheet>` so it mounts inside iOS FullWindowOverlay.
 *
 * Why not `actionMenuPopup`: the menu-lane host uses `disableFullWindowOverlay`
 * (heroui `<Menu presentation="bottom-sheet">` silently fails to mount inside
 * FWO — see `ActionMenuHost.tsx`). That's fine for menus opened from regular
 * screens, but the send-flow camera screen lives inside an iOS route modal —
 * the menu renders in the root window, below the modal, and is invisible.
 */

import { useEffect, useRef } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { View } from 'react-native';
import { BottomSheet, Menu } from 'heroui-native';
import { decodeEcashTokenMetadata, defaultDetectors, type AnnotatedOption } from 'wallet';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { cashuLog } from '@/shared/lib/logger';

import { showActionSheet } from './bridge';
import { SheetMenuRowContent } from './sheetMenuRow';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

type OptionKind = AnnotatedOption['option']['kind'];

const CASHU_KINDS: readonly OptionKind[] = ['paymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: readonly OptionKind[] = ['lightningInvoice', 'lightningAddress', 'lnurlp'];

function getMethodLabel(kind: OptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  if (kind === 'onchainAddress') return 'Onchain';
  return kind;
}

function getMethodIcon(kind: OptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  if (kind === 'onchainAddress') return 'hugeicons:blockchain-01';
  return 'ph:contactless-payment-fill';
}

function getOptionAmount(option: AnnotatedOption['option']): number | undefined {
  if (option.amount != null && option.amount > 0) {
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'option.amount',
      hasAmount: true,
      amount: option.amount,
    });
    return option.amount;
  }
  if (option.kind === 'paymentRequest') {
    const amount = defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'payment-request-info',
      hasAmount: amount != null,
      valueLength: option.value.length,
      amount,
    });
    return amount;
  }
  if (option.kind === 'ecashToken') {
    const amount = decodeEcashTokenMetadata(option.value)?.amount;
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'ecash-token',
      hasAmount: amount != null,
      valueLength: option.value.length,
      amount,
    });
    return amount;
  }
  cashuLog.debug('payment.options.amount.result', {
    kind: option.kind,
    source: 'none',
    hasAmount: false,
    valueLength: option.value.length,
  });
  return undefined;
}

interface OptionRowProps {
  annotated: AnnotatedOption;
  unit: string;
  isFailed: boolean;
  failedReason?: string;
  onPress: () => void;
}

function OptionRow({ annotated, unit, isFailed, failedReason, onPress }: OptionRowProps) {
  const { option, status } = annotated;
  const amount = getOptionAmount(option);
  const hasAmount = amount != null && amount > 0;
  const disabled = status === 'disabled' || isFailed;
  const descriptionText = isFailed
    ? (failedReason ?? 'Failed')
    : disabled
      ? annotated.reason?.message
      : status === 'recommended'
        ? 'Recommended'
        : undefined;

  const item = (
    <Menu.Item isDisabled={disabled} variant={isFailed ? 'danger' : 'default'} onPress={onPress}>
      <SheetMenuRowContent
        icon={<Icon name={getMethodIcon(option.kind)} size={20} />}
        title={getMethodLabel(option.kind)}
        description={descriptionText || null}
        trailing={
          hasAmount ? (
            <View>
              <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
            </View>
          ) : null
        }
      />
    </Menu.Item>
  );

  return isFailed ? <View className="bg-danger/10 mx-1 rounded-2xl">{item}</View> : item;
}

interface PaymentOptionsContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['payment-options'] | ActionSheetPayloads['payment-fallback'];
  isFallback: boolean;
}

export function PaymentOptionsContent({ payload, close, isFallback }: PaymentOptionsContentProps) {
  const { options, unit, machine, onDismiss } = payload;
  const failedSet =
    isFallback && 'failedOptionValues' in payload
      ? new Set(payload.failedOptionValues)
      : new Set<string>();
  const lastFailedMessage =
    isFallback && 'lastFailedMessage' in payload ? payload.lastFailedMessage : undefined;

  // Distinguish user-pick close (machine.chooseOption already fired) from
  // overlay-tap / swipe-down close (machine still needs `onDismiss`).
  const pickedRef = useRef(false);
  const dismissLogRef = useLatestRef({
    isFallback,
    optionCount: options.length,
    failedCount: failedSet.size,
    hasLastFailedMessage: !!lastFailedMessage,
  });
  useEffect(
    () => () => {
      if (!pickedRef.current) {
        cashuLog.info('payment.options.dismissed', dismissLogRef.current);
        onDismiss?.();
      }
    },
    [onDismiss]
  );

  const title = isFallback ? 'Payment failed — try another method' : 'Choose how to pay';
  useEffect(() => {
    cashuLog.info('payment.options.presented', {
      isFallback,
      optionCount: options.length,
      failedCount: failedSet.size,
      optionKinds: options.map((option) => option.option.kind),
      recommendedCount: options.filter((option) => option.status === 'recommended').length,
      disabledCount: options.filter((option) => option.status === 'disabled').length,
    });
  }, [failedSet.size, isFallback, options]);

  return (
    <View>
      <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
        {title}
      </BottomSheet.Title>
      {/* Wrapping the rows in a bare `<Menu>` gives `Menu.Item` the contexts
          it reads via `useMenu()` — same trick as `modelPicker`. No
          Trigger/Portal/Content needed; Menu.Root is just a context Provider. */}
      <Menu>
        {options.map((annotated) => (
          <OptionRow
            key={annotated.option.value}
            annotated={annotated}
            unit={unit}
            isFailed={failedSet.has(annotated.option.value)}
            failedReason={lastFailedMessage}
            onPress={() => {
              pickedRef.current = true;
              cashuLog.info('payment.options.choice', {
                isFallback,
                kind: annotated.option.kind,
                status: annotated.status,
                isFailed: failedSet.has(annotated.option.value),
                valueLength: annotated.option.value.length,
                hasAmount: getOptionAmount(annotated.option) != null,
              });
              void machine.chooseOption(annotated.option);
              close();
            }}
          />
        ))}
      </Menu>
    </View>
  );
}

export function paymentOptionsPopup(payload: ActionSheetPayloads['payment-options']): void {
  cashuLog.info('payment.options.popup', {
    isFallback: false,
    optionCount: payload.options.length,
    optionKinds: payload.options.map((option) => option.option.kind),
  });
  showActionSheet('payment-options', payload);
}

export function paymentFallbackPopup(payload: ActionSheetPayloads['payment-fallback']): void {
  cashuLog.info('payment.options.popup', {
    isFallback: true,
    optionCount: payload.options.length,
    failedCount: payload.failedOptionValues.length,
    optionKinds: payload.options.map((option) => option.option.kind),
  });
  showActionSheet('payment-fallback', payload);
}
