/**
 * @fileoverview Receive hub — the method-first front door for receiving.
 *
 * Reached from the wallet Receive button (`machine.startReceive({reset:true})`
 * → the Colada `receiveHub` step → this route), mirroring the Send screen's
 * destination-first chooser. The user picks HOW to receive:
 *
 *   • QR Display — the standing receive rails (Unified / Lightning / Onchain /
 *     Cashu tabs), opened machine-side via `showReceiveQr` with a clean
 *     context so a backed-out sub-flow can't leak state into it;
 *   • Scan QR — camera scan of a token / invoice / creq;
 *   • Fixed Amount — request a specific amount (Lightning / Onchain / Ecash
 *     variants on the amount screen);
 *   • Paste — redeem whatever payment string is on the clipboard.
 *
 * All four run through the `receiveHub` screen actions, so availability
 * (e.g. Fixed Amount needs a bolt11-capable mint) and machine resets stay
 * colada-owned.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import opacity from 'hex-color-opacity';

import { useScreenActions, type UseScreenActionsResult } from 'wallet/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import Icon from 'assets/icons';

type HubActionName = 'qrDisplay' | 'scanQr' | 'fixedAmount' | 'paste';

interface ReceiveMethod {
  id: HubActionName;
  title: string;
  subtitle: string;
  /** Monicon glyph (Android + non-glass iOS fallback). */
  icon: string;
  /** SF Symbol — renders the circle as liquid glass on supported iOS devices. */
  systemIcon: string;
}

// Same option-row grammar as SendScreen's method list — one legible pattern
// for both front doors.
const METHODS: ReceiveMethod[] = [
  {
    id: 'qrDisplay',
    title: 'QR Display',
    subtitle: 'Show your receive codes',
    icon: 'mdi:qrcode',
    systemIcon: 'qrcode',
  },
  {
    id: 'scanQr',
    title: 'Scan QR',
    subtitle: 'Scan a code to receive',
    icon: 'mdi:qrcode-scan',
    systemIcon: 'qrcode.viewfinder',
  },
  {
    id: 'fixedAmount',
    title: 'Fixed Amount',
    subtitle: 'Request a specific amount',
    icon: 'mdi:decimal',
    systemIcon: 'textformat.123',
  },
  {
    id: 'paste',
    title: 'Paste',
    subtitle: 'Redeem from your clipboard',
    icon: 'lets-icons:copy',
    systemIcon: 'doc.on.clipboard',
  },
];

interface ReceiveHubScreenProps {
  receiveHubEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveHubScreen({ receiveHubEntry, unit }: ReceiveHubScreenProps) {
  useLifecycleLogger('ReceiveHubScreen');
  const headerHeight = useHeaderHeight();
  const [foreground, overlay] = useThemeColor(['foreground', 'overlay'] as const);

  const { entry, error, actions } = useScreenActions(
    'receiveHub',
    receiveHubEntry as string | Record<string, unknown> | undefined
  );
  const entryLoaded = Boolean(entry);

  const rows = useMemo(
    () =>
      METHODS.map((method) => {
        const action = actions[
          method.id
        ] as UseScreenActionsResult<'receiveHub'>['actions'][HubActionName];
        const available = entryLoaded && action.available;
        return (
          <ListRow
            key={method.id}
            leading={
              <CircleActionButton
                icon={method.icon}
                systemIcon={method.systemIcon}
                accessibilityLabel={method.title}
              />
            }
            title={method.title}
            // An unavailable row explains itself in place of the subtitle.
            subtitle={(!available && action.reason) || method.subtitle}
            trailing={<Icon name="mdi:chevron-right" size={24} color={opacity(foreground, 0.25)} />}
            disabled={!available || action.loading}
            onPress={async () => {
              paymentLog.info('receive.hub.method', { method: method.id, unit });
              await action.execute();
            }}
            testID={`receive-method-${method.id}`}
          />
        );
      }),
    [actions, entryLoaded, foreground, unit]
  );

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: overlay }]}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + 8 }]}>
      {rows}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: 24,
  },
});
