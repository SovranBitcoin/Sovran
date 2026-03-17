/**
 * Sovran usePaste — thin wrapper around coco-payment-ux.
 *
 * Injects expo-clipboard as the readClipboard implementation.
 * Consumers keep the same API: just provide onPaste/onEmpty/etc.
 */

import * as Clipboard from 'expo-clipboard';

import {
  usePaste as useCocoPaste,
  type UsePasteConfig as CocoUsePasteConfig,
} from 'coco-payment-ux/react';

export interface UsePasteConfig<TValue = string> extends Omit<
  CocoUsePasteConfig<TValue>,
  'readClipboard'
> {}

/**
 * Shared clipboard paste handler for flows that accept pasted payment input.
 * Owns clipboard read + empty checks so screens only implement domain logic.
 */
export function usePaste<TValue = string>(config: UsePasteConfig<TValue>) {
  return useCocoPaste({
    ...config,
    readClipboard: () => Clipboard.getStringAsync(),
  });
}
