/**
 * @fileoverview Utility functions for the Sovran application
 *
 * This module contains various utility functions used throughout the application,
 * including number formatting, Lightning Network payment request handling,
 * Tailwind CSS class merging utilities,
 * and React provider composition.
 */

import { MintHistoryEntry } from 'coco-cashu-core';
import { decode } from '@gandlaf21/bolt11-decode';
import _ from 'lodash';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import React from 'react';

/**
 * Checks if a mint history entry has expired based on its payment request
 *
 * This function decodes the Lightning Network payment request from the history entry
 * and checks if the current time exceeds the expiry time. If no payment request
 * exists or decoding fails, it returns false (not expired).
 *
 * @param historyEntry - The mint history entry containing the payment request
 * @returns True if the entry has expired, false if not expired or if no payment request exists
 * @throws Will log an error to console if payment request decoding fails, but returns false
 *
 * @example
 * const entry = { paymentRequest: 'lnbc...', ... };
 * const isExpired = mintHistoryEntryExpired(entry);
 * if (isExpired) {
 *   // Handle expired entry - remove from UI or show warning
 * }
 */
export function mintHistoryEntryExpired(historyEntry: MintHistoryEntry): boolean {
  try {
    if (!historyEntry.paymentRequest) {
      return false;
    }
    const paymentRequest = decode(historyEntry.paymentRequest);

    const expiry = paymentRequest.expiry ?? 3600;
    const timestamp = _.find(paymentRequest.sections, { name: 'timestamp' })?.value ?? 0;
    const expiryTime = (timestamp + expiry) * 1000;

    return Date.now() > expiryTime;
  } catch (error) {
    console.error('Error decoding payment request:', error);
    return false;
  }
}

/**
 * Gets the time remaining until a mint history entry expires
 *
 * @param historyEntry - The mint history entry containing the payment request
 * @returns Formatted string like "expires in 14m 32s" or null if no expiry or already expired
 */
export function getMintHistoryEntryTimeUntilExpiry(historyEntry: MintHistoryEntry): string | null {
  try {
    if (!historyEntry.paymentRequest) {
      return null;
    }
    const paymentRequest = decode(historyEntry.paymentRequest);

    const expiry = paymentRequest.expiry ?? 3600;
    const timestamp = _.find(paymentRequest.sections, { name: 'timestamp' })?.value ?? 0;
    const expiryTime = (timestamp + expiry) * 1000;

    const timeLeft = Math.floor((expiryTime - Date.now()) / 1000);

    if (timeLeft <= 0) return null;

    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;

    if (hours > 0) {
      return `expires in ${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `expires in ${minutes}m ${seconds}s`;
    } else {
      return `expires in ${seconds}s`;
    }
  } catch (error) {
    console.error('Error calculating expiry time:', error);
    return null;
  }
}

/**
 * Checks if a melt quote has expired based on its expiry timestamp
 *
 * This function checks if the current time exceeds the melt quote's expiry time.
 * If no expiry timestamp exists, it returns false (not expired).
 *
 * @param meltQuote - The melt quote response containing the expiry timestamp
 * @returns True if the melt quote has expired, false if not expired or if no expiry exists
 *
 * @example
 * const quote = { expiry: 1234567890, ... };
 * const isExpired = meltQuoteExpired(quote);
 * if (isExpired) {
 *   // Handle expired melt quote - show refresh component
 * }
 */
export function meltQuoteExpired(meltQuote: MeltQuoteBolt11Response): boolean {
  if (!meltQuote.expiry) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return now > meltQuote.expiry;
}

/**
 * Utility function to merge Tailwind CSS classes with proper conflict resolution
 *
 * This function combines clsx for conditional class handling and tailwind-merge
 * for intelligent Tailwind CSS class merging. It resolves conflicts by keeping
 * the last conflicting class and removes duplicates.
 *
 * @param inputs - Variable number of class values to merge (strings, objects, arrays, etc.)
 * @returns A merged string of CSS classes with conflicts resolved and duplicates removed
 *
 * @example
 * // Basic usage
 * cn('px-2 py-1', 'px-4') // 'py-1 px-4' (px-2 is overridden by px-4)
 *
 * // Conditional classes
 * cn('text-red-500', { 'text-blue-500': isBlue }) // 'text-blue-500' if isBlue is true
 *
 * // Complex conditional logic
 * cn('base-class', condition && 'conditional-class', isActive && 'active-class')
 *
 * // Arrays and mixed types
 * cn(['class1', 'class2'], { 'class3': true }, 'class4')
 *
 * @see {@link https://github.com/dcastil/tailwind-merge} tailwind-merge documentation
 * @see {@link https://github.com/lukeed/clsx} clsx documentation
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Composes multiple React providers into a single provider component.
 *
 * Given an array of providers, this utility nests them so that children are rendered
 * within all providers, in the order provided. Supports both direct component references
 * and component-props tuples for providers that need configuration.
 *
 * @example
 * // Direct component references (clean API)
 * const AppProviders = compose([ProviderA, ProviderB, ProviderC]);
 *
 * // Mixed approach (tuples + direct)
 * const AppProviders = compose([
 *   [NostrProvider, { relayUrls: RELAY_URLS }],
 *   [PersistGate, { loading: null, persistor }],
 *   [Provider, { store }],
 *   ThemeProvider,  // Direct component (no props needed)
 *   ActionSheetProvider, // Automatically wrapped in Fragment for single-child requirement
 * ]);
 *
 * <AppProviders>
 *   <App />
 * </AppProviders>
 */
export const compose = (
  providers: (
    | React.FC<{ children: React.ReactNode }>
    | React.ComponentType<any>
    | [React.ComponentType<any>, Record<string, any>]
  )[]
): React.FC<{ children: React.ReactNode }> => {
  const ComposedProvider = providers.reduce((Prev, Curr) => {
    const ProviderComponent = ({ children }: { children: React.ReactNode }) => {
      let CurrentProvider: React.FC<{ children: React.ReactNode }>;

      // Handle tuple syntax [Component, props]
      if (Array.isArray(Curr) && Curr.length === 2) {
        const [Component, props] = Curr;
        const ConfiguredProvider = ({ children }: { children: React.ReactNode }) => {
          const wrappedChildren = React.Children.count(children) > 1 ? <>{children}</> : children;
          return <Component {...props}>{wrappedChildren}</Component>;
        };
        ConfiguredProvider.displayName = `ConfiguredProvider(${Component.displayName || Component.name || 'Unknown'})`;
        CurrentProvider = ConfiguredProvider;
      }
      // Handle direct component reference
      else if (typeof Curr === 'function' && Curr.length === 1) {
        CurrentProvider = Curr as React.FC<{ children: React.ReactNode }>;
      }
      // Handle configured component (arrow function)
      else {
        CurrentProvider = Curr as React.FC<{ children: React.ReactNode }>;
      }

      if (!Prev) return <CurrentProvider>{children}</CurrentProvider>;
      return (
        <Prev>
          <CurrentProvider>{children}</CurrentProvider>
        </Prev>
      );
    };
    const componentName = Array.isArray(Curr)
      ? Curr[0].displayName || Curr[0].name
      : Curr.displayName || Curr.name;
    ProviderComponent.displayName = `ProviderWrapper(${componentName || 'Unknown'})`;
    return ProviderComponent;
  }, undefined as any);

  ComposedProvider.displayName = 'ComposedProvider';
  return ComposedProvider;
};
