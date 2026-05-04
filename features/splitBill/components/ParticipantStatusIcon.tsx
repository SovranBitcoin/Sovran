/**
 * @fileoverview Renders the right-edge status icon for a split-bill
 * participant row. Maps `(payment | delivery)` state to a fixed icon +
 * theme color. Shared by the Summary and Detail screens so the
 * pending/sent/paid/failed/expired vocabulary lives in one place.
 */

import React from 'react';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import type { SplitBillParticipant } from '@/shared/stores/profile/splitBillTransactionsStore';

interface Props {
  participant: SplitBillParticipant;
  foreground: string;
  danger: string;
  success: string;
}

export function ParticipantStatusIcon({ participant, foreground, danger, success }: Props) {
  if (participant.paymentState === 'paid') {
    return <Icon name="mdi:check-circle" size={22} color={success} />;
  }
  if (participant.paymentState === 'expired') {
    return <Icon name="mdi:alert-circle" size={22} color={danger} />;
  }
  if (participant.deliveryState === 'failed') {
    return <Icon name="mdi:alert-circle" size={22} color={danger} />;
  }
  if (participant.deliveryState === 'pending') {
    return (
      <Icon
        name="ant-design:loading-outlined"
        size={22}
        color={opacity(foreground, 0.4)}
        spin={{ duration: 1000, outputRange: ['0deg', '360deg'], delay: 0, easing: 'linear' }}
      />
    );
  }
  return <Icon name="mdi:clock-outline" size={22} color={opacity(foreground, 0.5)} />;
}
