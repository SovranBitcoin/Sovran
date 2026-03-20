/**
 * @fileoverview Receive flow amount route — mint quote amount entry.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { AmountFlowScreen } from '@/features/send/screens/AmountFlowScreen';

function ReceiveAmountRoute() {
  const { amountEntry } = useLocalSearchParams<{ amountEntry?: string }>();
  return <AmountFlowScreen amountEntry={amountEntry} />;
}

export default ReceiveAmountRoute;
