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
import { useCallback, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useBluetoothState, type UseBluetoothStateResult } from '../hooks/useBluetoothState';
import { Button } from '@/shared/ui/primitives/Button';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Notice } from '@/shared/ui/composed/Notice';

interface BluetoothNoticeProps {
  /** Pass the surrounding screen's hook result to share one subscription. */
  bluetooth?: UseBluetoothStateResult;
}

function noticeAction(
  bluetooth: UseBluetoothStateResult
): { label: string; testID: string; onPress: () => void } | null {
  switch (bluetooth.status) {
    case 'poweredOff':
      return Platform.OS === 'android'
        ? {
            label: 'Turn On Bluetooth',
            testID: 'bluetooth-notice-enable',
            onPress: () => void bluetooth.enableBluetooth(),
          }
        : {
            label: 'Open Settings',
            testID: 'bluetooth-notice-open-settings',
            onPress: () => void bluetooth.openSettings(),
          };
    case 'unauthorized':
      return {
        label: 'Allow Bluetooth',
        testID: 'bluetooth-notice-allow',
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
  const handlePress = useCallback(() => action?.onPress(), [action]);

  if (!copy) return null;

  return (
    <EmptyState
      icon="mdi:bluetooth-off"
      title={copy.title}
      subtitle={copy.subtitle}
      action={
        action ? (
          <Button
            text={action.label}
            testID={action.testID}
            onPress={handlePress}
            variant="primary"
            size="compact"
          />
        ) : undefined
      }
    />
  );
}

/**
 * One-line banner variant for surfaces that keep their content visible while
 * Bluetooth is unavailable (e.g. a BLE DM thread with history). Shares
 * `ChatStatusStrip` with GeohashChatScreen's peer-reachability banners.
 */
export function BluetoothInlineNotice({ bluetooth: bluetoothProp }: BluetoothNoticeProps) {
  const ownBluetooth = useBluetoothState();
  const bluetooth = bluetoothProp ?? ownBluetooth;
  const copy = COPY[bluetooth.status];
  const action = noticeAction(bluetooth);
  const handlePress = useCallback(() => action?.onPress(), [action]);

  if (!copy) return null;

  return (
    <ChatStatusStrip
      icon="mdi:bluetooth-off"
      text={copy.title}
      action={
        action ? (
          <Button
            text={action.label}
            testID={`${action.testID}-inline`}
            onPress={handlePress}
            variant="secondary"
            size="compact"
          />
        ) : undefined
      }
    />
  );
}

/**
 * The full-bleed status strip above a chat composer: an `info` Notice squared
 * off and pinned to the screen's edges, since it sits against the thread
 * rather than inside a padded card. GeohashChatScreen's reachability banners
 * use it too — they and the Bluetooth strip must stay identical.
 */
export function ChatStatusStrip({
  icon,
  text,
  action,
}: {
  icon: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <Notice
      status="info"
      size="compact"
      icon={icon}
      description={text}
      action={action}
      className="items-center rounded-none px-4 py-2.5"
    />
  );
}
