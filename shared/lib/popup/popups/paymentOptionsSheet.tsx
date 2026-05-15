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

import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { BottomSheet, Menu } from 'heroui-native';
import { defaultDetectors, type AnnotatedOption } from 'coco-payment-ux';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { getEcashTokenAmount } from '@/shared/lib/cashu/utils';

import { showActionSheet } from './bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

type OptionKind = AnnotatedOption['option']['kind'];

const CASHU_KINDS: readonly OptionKind[] = ['paymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: readonly OptionKind[] = ['lightningInvoice', 'lightningAddress', 'lnurlp'];

function getMethodLabel(kind: OptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  return kind;
}

function getMethodIcon(kind: OptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  return 'ph:contactless-payment-fill';
}

function getOptionAmount(option: AnnotatedOption['option']): number | undefined {
  if (option.amount != null && option.amount > 0) return option.amount;
  if (option.kind === 'paymentRequest') {
    return defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
  }
  if (option.kind === 'ecashToken') return getEcashTokenAmount(option.value);
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
      <HStack align="center" gap={10} style={{ flex: 1 }}>
        <Icon name={getMethodIcon(option.kind)} size={20} />
        <View style={{ flex: 1 }}>
          {/* `flex: 0` + `numberOfLines={1}` neutralises heroui's baked-in
              `flex-1` on Menu.ItemTitle, which collapses to zero height
              outside a `Menu.Content` host. Same defence as `modelPicker`. */}
          <Menu.ItemTitle className="flex-none" numberOfLines={1} style={{ flex: 0 }}>
            {getMethodLabel(option.kind)}
          </Menu.ItemTitle>
          {descriptionText ? <Menu.ItemDescription>{descriptionText}</Menu.ItemDescription> : null}
        </View>
        {hasAmount ? (
          <View>
            <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
          </View>
        ) : null}
      </HStack>
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
  useEffect(
    () => () => {
      if (!pickedRef.current) onDismiss?.();
    },
    [onDismiss]
  );

  const title = isFallback ? 'Payment failed — try another method' : 'Choose how to pay';

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
  showActionSheet('payment-options', payload);
}

export function paymentFallbackPopup(payload: ActionSheetPayloads['payment-fallback']): void {
  showActionSheet('payment-fallback', payload);
}
