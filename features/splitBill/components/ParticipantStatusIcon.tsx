/**
 * @fileoverview Renders the right-edge status icon for a split-bill
 * participant row. Maps `(payment | delivery)` state to a LoadingIndicator
 * variant. Shared by the Summary and Detail screens so the
 * pending/sent/paid/failed/expired vocabulary lives in one place.
 */

import React from 'react';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { LoadingIndicator } from '@/shared/blocks/status';
import type { SplitBillParticipant } from '@/shared/stores/profile/splitBillTransactionsStore';

interface Props {
  participant: SplitBillParticipant;
  foreground: string;
  danger: string;
  success: string;
}

export function ParticipantStatusIcon({ participant, foreground, danger, success }: Props) {
  if (participant.paymentState === 'paid') {
    return (
      <LoadingIndicator
        size={22}
        phase="done"
        result="success"
        color={foreground}
        successColor={success}
        errorColor={danger}
      />
    );
  }
  if (participant.paymentState === 'expired' || participant.deliveryState === 'failed') {
    return (
      <LoadingIndicator
        size={22}
        phase="done"
        result="error"
        color={foreground}
        successColor={success}
        errorColor={danger}
      />
    );
  }
  if (participant.deliveryState === 'pending') {
    return (
      <LoadingIndicator
        size={22}
        phase="loading"
        color={opacity(foreground, 0.4)}
        successColor={success}
        errorColor={danger}
      />
    );
  }
  // Scheduled but not yet delivered — keep the clock metaphor since the
  // LoadingIndicator's idle dashed-arc doesn't read as "scheduled".
  return <Icon name="mdi:clock-outline" size={22} color={opacity(foreground, 0.5)} />;
}
