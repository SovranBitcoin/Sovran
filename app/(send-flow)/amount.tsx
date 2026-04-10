/**
 * @fileoverview Send flow amount route — thin wrapper around AmountFlowScreen.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { AmountFlowScreen } from '@/features/send/screens/AmountFlowScreen';

function AmountRoute() {
  const { amountEntry } = useLocalSearchParams<{ amountEntry?: string }>();
  return <AmountFlowScreen amountEntry={amountEntry} />;
}

export default AmountRoute;
