/**
 * "Send another way" sheet for the machine's `chooseSendFallback` step: a
 * send picked from the amount screen failed, and a different way to pay the
 * same person can still work. The failed option stays visible in red with the
 * reason; each alternative is one tap, tinted yellow when it carries a caveat.
 *
 * Same standalone `<BottomSheet>` lane as `payment-fallback`, so it mounts
 * above the send-flow route modals.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { BottomSheet, Menu } from 'heroui-native';

import Icon from 'assets/icons';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { cashuLog } from '@/shared/lib/logger';

import { showActionSheet } from './bridge';
import { MenuRowTint, SheetMenuRowContent } from './sheetMenuRow';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

const ICONS: Record<string, string> = {
  ecash: 'ph:coins',
  'lightning-npc': 'mingcute:lightning-fill',
};

interface SendFallbackContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['send-fallback'];
}

export function SendFallbackContent({ payload, close }: SendFallbackContentProps) {
  const { failed, alternatives, machine } = payload;
  const pickedRef = useRef(false);
  const machineRef = useLatestRef(machine);
  useEffect(
    () => () => {
      if (!pickedRef.current) {
        cashuLog.info('payment.send_fallback.dismissed');
        void machineRef.current.chooseSendFallback(null);
      }
    },
    [machineRef]
  );

  return (
    <View>
      <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
        Payment failed — send another way
      </BottomSheet.Title>
      <Menu>
        <MenuRowTint tone="failed">
          <Menu.Item testID="send-fallback-failed" isDisabled variant="danger">
            <SheetMenuRowContent
              icon={<Icon name="mdi:alert-circle-outline" size={20} />}
              title={failed.label}
              description={failed.message}
            />
          </Menu.Item>
        </MenuRowTint>
        {alternatives.map((alternative) => (
          <MenuRowTint key={alternative.id} tone={alternative.isCaution ? 'caution' : undefined}>
            <Menu.Item
              testID={`send-fallback-${alternative.id}`}
              onPress={() => {
                pickedRef.current = true;
                cashuLog.info('payment.send_fallback.choice', { id: alternative.id });
                void machine.chooseSendFallback(alternative.id);
                close();
              }}>
              <SheetMenuRowContent
                icon={<Icon name={ICONS[alternative.id] ?? 'ph:coins'} size={20} />}
                title={alternative.label}
                description={alternative.description}
              />
            </Menu.Item>
          </MenuRowTint>
        ))}
      </Menu>
    </View>
  );
}

export function sendFallbackPopup(payload: ActionSheetPayloads['send-fallback']): void {
  cashuLog.info('payment.send_fallback.popup', {
    alternatives: payload.alternatives.map((alternative) => alternative.id),
  });
  showActionSheet('send-fallback', payload);
}
