/**
 * @fileoverview The top of the wallet home: the balance and the actions.
 *
 * The home has three jobs, in this order: show what you have, let you pay or
 * get paid, show what happened. This is the first two; activity follows
 * underneath. It receives the actions as data (`./types`).
 *
 *  - The rare jobs sit in a row of glass circles above the payment row. The
 *    row holds three: past that the tail collapses into "More", so it is
 *    Split, Theme and More whatever is added later.
 *  - Receive and Send are two liquid-glass capsules that meet in the middle,
 *    and the scan button sits over the seam between them. It is the real
 *    `QRButton`: the splash-morph anchor.
 *
 * The row heights are locked. Without that the splash → QR morph drifts: the
 * SwiftUI hosts inside the circle buttons take a frame or two to settle their
 * size, and the capsules can grow as their labels lay out, moving the QR's Y
 * on first paint.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { zIndex } from '@/shared/styles/tokens';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { CircleActionRow, type CircleRowAction } from '@/shared/ui/composed/CircleActionRow';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { View } from '@/shared/ui/primitives/View/View';

import type { HomeAction, HomeLayoutProps } from './types';

const QR_BUTTON_SIZE = 64;
const CAPSULE_BUTTON_HEIGHT = 48;
const PRIMARY_ACTION_ROW_HEIGHT = Math.max(QR_BUTTON_SIZE, CAPSULE_BUTTON_HEIGHT);
// Circle (52) + label margin-top (6) + label line height (~18).
const SECONDARY_ACTION_ROW_HEIGHT = 76;
const SHORTCUTS = ['split', 'theme', 'history', 'map'] as const;

/** SF Symbols only exist on iPhone; elsewhere the Monicon name is used. */
const systemIcon = (action: HomeAction) => (Platform.OS === 'ios' ? action.systemIcon : undefined);

const circle = (action: HomeAction): CircleRowAction => ({
  icon: action.icon,
  label: action.label,
  testID: action.testID,
  onPress: action.onPress,
  ...(action.systemIcon ? { systemIcon: action.systemIcon } : {}),
  ...(action.menuText ? { menuText: action.menuText } : {}),
  ...(action.description ? { description: action.description } : {}),
  ...(action.disabled ? { disabled: true } : {}),
});

export function HomeTop({
  actions,
  renderBalance,
  paymentsLocked,
}: HomeLayoutProps): React.ReactElement {
  return (
    <View style={styles.top}>
      {renderBalance(1)}

      <CircleActionRow
        actions={SHORTCUTS.map((id) => circle(actions[id]))}
        moreTestID="wallet-more"
        style={styles.secondaryActions}
      />

      {/* One pointerEvents shroud over Receive / Send / scan while a swap
          holds the wallet: CapsuleButton and QRButton take no `disabled`
          prop, so touches stop at the parent and the opacity matches the
          circle buttons' own disabled look (0.4). */}
      <View
        pointerEvents={paymentsLocked ? 'none' : 'auto'}
        style={[styles.primaryActions, paymentsLocked ? styles.locked : null]}>
        <View style={styles.capsuleRow}>
          <View style={styles.capsuleSlot}>
            <CapsuleButton
              testID={actions.receive.testID}
              label={actions.receive.label}
              icon={actions.receive.icon}
              systemIcon={systemIcon(actions.receive)}
              roundedSide="left"
              onPress={actions.receive.onPress}
            />
          </View>
          <View style={styles.capsuleSlot}>
            <CapsuleButton
              testID={actions.send.testID}
              label={actions.send.label}
              icon={actions.send.icon}
              systemIcon={systemIcon(actions.send)}
              roundedSide="right"
              onPress={actions.send.onPress}
            />
          </View>
        </View>

        <View pointerEvents="box-none" style={styles.qrAnchor}>
          <QRButton
            onPress={actions.scan.onPress}
            size={QR_BUTTON_SIZE}
            testID={actions.scan.testID}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    gap: 18,
    paddingBottom: 16,
  },
  secondaryActions: {
    alignItems: 'flex-start',
    height: SECONDARY_ACTION_ROW_HEIGHT,
    paddingHorizontal: 32,
  },
  primaryActions: {
    height: PRIMARY_ACTION_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
    width: '100%',
  },
  locked: { opacity: 0.4 },
  capsuleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  capsuleSlot: {
    flex: 1,
  },
  qrAnchor: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: zIndex.modal,
  },
});
