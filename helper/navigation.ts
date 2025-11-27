/**
 * @fileoverview Navigation utilities for modal screen routing
 *
 * This module provides helper functions for building navigation paths
 * and navigating between screens in different modal contexts.
 */

import { router } from 'expo-router';
import type { MintHistoryEntry, SendHistoryEntry, ReceiveHistoryEntry, MeltHistoryEntry } from 'coco-cashu-core';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';

// Route context types
export type FlowContext = 'standalone' | 'receive-flow' | 'send-flow';

// Path builders
export function getReceiveTokenPath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'receive-flow':
      return '/(receive-flow)/receiveToken';
    case 'send-flow':
      return '/(receive-flow)/receiveToken'; // Ecash receive always goes to receive-flow
    default:
      return '/receiveToken';
  }
}

export function getSendTokenPath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'send-flow':
      return '/(send-flow)/sendToken';
    default:
      return '/sendToken';
  }
}

export function getMintQuotePath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'receive-flow':
      return '/(receive-flow)/mintQuote';
    default:
      return '/mintQuote';
  }
}

export function getMeltQuotePath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'send-flow':
      return '/(send-flow)/meltQuote';
    default:
      return '/meltQuote';
  }
}

export function getCurrencyPath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'receive-flow':
      return '/(receive-flow)/currency';
    case 'send-flow':
      return '/(send-flow)/currency';
    default:
      return '/currency';
  }
}

export function getCameraPath(context: FlowContext = 'standalone'): string {
  switch (context) {
    case 'receive-flow':
      return '/(receive-flow)/camera';
    case 'send-flow':
      return '/(send-flow)/camera';
    default:
      return '/camera';
  }
}

// Navigation helpers
export function navigateToReceiveToken(
  receiveHistoryEntry: ReceiveHistoryEntry & { token?: string },
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getReceiveTokenPath(context) as any,
    params: { receiveHistoryEntry: JSON.stringify(receiveHistoryEntry) },
  });
}

export function navigateToSendToken(
  sendHistoryEntry: SendHistoryEntry,
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getSendTokenPath(context) as any,
    params: { sendHistoryEntry: JSON.stringify(sendHistoryEntry) },
  });
}

export function navigateToMintQuote(
  mintHistoryEntry: MintHistoryEntry,
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getMintQuotePath(context) as any,
    params: { mintHistoryEntry: JSON.stringify(mintHistoryEntry) },
  });
}

export function navigateToMeltQuote(
  options: {
    meltQuote?: MeltQuoteResponse;
    meltHistoryEntry?: MeltHistoryEntry;
  },
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getMeltQuotePath(context) as any,
    params: {
      ...(options.meltQuote && { meltQuote: JSON.stringify(options.meltQuote) }),
      ...(options.meltHistoryEntry && { meltHistoryEntry: JSON.stringify(options.meltHistoryEntry) }),
    },
  });
}

export function navigateToCurrency(
  params: {
    to: string;
    unit: string;
    lnUrlOrAddress?: string;
    amount?: string;
    profile?: string;
    routstrTopUp?: string;
  },
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getCurrencyPath(context) as any,
    params,
  });
}

export function navigateToCamera(
  unit: string,
  context: FlowContext = 'standalone'
) {
  router.navigate({
    pathname: getCameraPath(context) as any,
    params: { unit },
  });
}

