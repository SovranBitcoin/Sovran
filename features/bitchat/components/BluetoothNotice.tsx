/**
 * Inline notice for the BLE mesh surfaces (Nut Drop, network sheet, BLE DMs)
 * when Bluetooth isn't ready. One component for every not-ready state so the
 * wording and recovery affordances stay consistent:
 *
 * - poweredOff   → Android: [Turn On Bluetooth] (system ACTION_REQUEST_ENABLE
 *                  dialog); iOS: instruction + [Open Settings] (no public
 *                  enable API).
 * - unauthorized → [Allow Bluetooth] (runtime permission dialog); falls back
 *                  to [Open Settings] when the dialog can't be shown again
 *                  ("don't ask again").
 * - unsupported  → text only (emulators / BLE-less hardware).
 */
import React from 'react';
import { Platform } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { useBluetoothState, type UseBluetoothStateResult } from '../hooks/useBluetoothState';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha } from '@/shared/styles/tokens';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { EmptyState } from '@/shared/ui/composed/EmptyState';

interface BluetoothNoticeProps {
  /** Pass the surrounding screen's hook result to share one subscription. */
  bluetooth?: UseBluetoothStateResult;
}

function noticeAction(
  bluetooth: UseBluetoothStateResult
): { label: string; onPress: () => void } | null {
  switch (bluetooth.status) {
    case 'poweredOff':
      return Platform.OS === 'android'
        ? { label: 'Turn On Bluetooth', onPress: () => void bluetooth.enableBluetooth() }
        : { label: 'Open Settings', onPress: () => void bluetooth.openSettings() };
    case 'unauthorized':
      return {
        label: 'Allow Bluetooth',
        onPress: () =>
          void bluetooth.requestPermissions().then((granted) => {
            // "Don't ask again" → the dialog never shows; settings is the only
            // remaining path.
            if (!granted) void bluetooth.openSettings();
          }),
      };
    default:
      return null;
  }
}

const COPY: Record<string, { title: string; subtitle: string }> = {
  poweredOff: {
    title: 'Bluetooth is off',
    subtitle:
      Platform.OS === 'android'
        ? 'Nearby payments and chat need Bluetooth to find people around you.'
        : 'Enable Bluetooth in Control Center or Settings so Sovran can find people around you.',
  },
  unauthorized: {
    title: 'Bluetooth permission needed',
    subtitle: 'Sovran uses Bluetooth to pay and chat with people nearby — no internet required.',
  },
  unsupported: {
    title: 'Bluetooth unavailable',
    subtitle: "This device doesn't support Bluetooth LE, so nearby features stay quiet here.",
  },
};

export function BluetoothNotice({ bluetooth: bluetoothProp }: BluetoothNoticeProps) {
  const ownBluetooth = useBluetoothState();
  const bluetooth = bluetoothProp ?? ownBluetooth;
  const copy = COPY[bluetooth.status];
  const action = noticeAction(bluetooth);
  const handlePress = () => action?.onPress();

  if (!copy) return null;

  return (
    <EmptyState
      icon="mdi:bluetooth-off"
      title={copy.title}
      subtitle={copy.subtitle}
      action={
        action ? (
          <Button text={action.label} onPress={handlePress} variant="primary" size="compact" />
        ) : undefined
      }
    />
  );
}

/**
 * One-line banner variant for surfaces that keep their content visible while
 * Bluetooth is unavailable (e.g. a BLE DM thread with history). Matches the
 * peer-reachability banner styling in GeohashChatScreen.
 */
export function BluetoothInlineNotice({ bluetooth: bluetoothProp }: BluetoothNoticeProps) {
  const ownBluetooth = useBluetoothState();
  const bluetooth = bluetoothProp ?? ownBluetooth;
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  const copy = COPY[bluetooth.status];
  const action = noticeAction(bluetooth);
  const handlePress = () => action?.onPress();

  if (!copy) return null;

  const muted = opacity(foreground, alpha.muted);
  return (
    <HStack
      spacing={8}
      align="center"
      style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: surfaceSecondary }}>
      <Icon name="mdi:bluetooth-off" size={16} color={muted} />
      <Text size={12} style={{ color: muted, flex: 1 }} numberOfLines={2}>
        {copy.title}
      </Text>
      {action ? (
        <Button text={action.label} onPress={handlePress} variant="secondary" size="compact" />
      ) : null}
    </HStack>
  );
}
