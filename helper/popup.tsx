/**
 * @fileoverview Popup and notification system for the Sovran Bitcoin wallet
 *
 * This module provides a comprehensive popup and notification system for displaying
 * various types of messages to users throughout the application. It supports different
 * message types (error, warning, info, success), customizable variants, and interactive
 * buttons with navigation capabilities.
 *
 * @example
 * // Import popup function
 * import { popup } from '@/helper/popup';
 *
 * // Simple message
 * popup('general_error');
 *
 * // Custom message with parameters
 * popup({
 *   message: 'insufficient_balance',
 *   params: { amount: 1000, unit: 'sats', fee: 50 }
 * });
 *
 * // Custom popup with buttons
 * popup({
 *   message: 'Custom Title',
 *   text: 'Custom message text',
 *   type: 'error',
 *   buttons: [{ text: 'OK', onPress: () => console.log('OK pressed') }]
 * });
 */

import { SheetManager } from 'react-native-actions-sheet';
import { router } from 'expo-router';
import React from 'react';
import { Text } from 'components/ui/Text';
import { AmountFormatter } from 'components/ui/AmountFormatter';

/**
 * Message type constants for different popup categories
 *
 * These constants define the available message types that can be used
 * to categorize and style popups appropriately.
 *
 * @readonly
 * @enum {string}
 */
const MESSAGE_TYPES = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  SUCCESS: 'success',
};

/**
 * Emoji mappings for different message types
 *
 * These emojis are automatically displayed with their corresponding
 * message types to provide visual context and improve user experience.
 *
 * @readonly
 * @enum {string}
 */
const MESSAGE_EMOJIS = {
  [MESSAGE_TYPES.ERROR]: '🚨',
  [MESSAGE_TYPES.WARNING]: '⚠️',
  [MESSAGE_TYPES.INFO]: '💡',
  [MESSAGE_TYPES.SUCCESS]: '🎉',
};

/**
 * Type definition for message text content
 *
 * Message text can be a simple string, a React component, or a function
 * that returns a React component with access to parameters.
 */
type MessageText = string | React.ReactNode | ((params: any) => React.ReactNode);

/**
 * Configuration for popup action buttons
 *
 * @interface MessageButton
 * @property {string} text - The text to display on the button
 * @property {string} [page] - Optional page to navigate to when button is pressed
 * @property {() => void} [onPress] - Optional callback function when button is pressed
 */
type MessageButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

/**
 * Configuration object for predefined message templates
 *
 * @interface MessageConfig
 * @property {string} title - The title/heading of the popup
 * @property {MessageText} text - The main message content
 * @property {string} type - The message type (error, warning, info, success)
 * @property {MessageButton[]} [buttons] - Optional array of action buttons
 * @property {string} [variant] - Optional variant for special display behavior
 */
type MessageConfig = {
  title: string;
  text: MessageText;
  type: string;
  buttons?: MessageButton[]; // Make button optional
  variant?: string; // Add variant as optional property
};

/**
 * Predefined message configurations for common application scenarios
 *
 * This object contains all the predefined message templates that can be
 * referenced by their key names. Each configuration includes title, text,
 * type, and optional buttons or variants.
 *
 * @readonly
 * @constant {Record<string, MessageConfig>}
 */
const MESSAGE_CONFIGS: Record<string, MessageConfig> = {
  funds_sent: {
    title: 'Funds Sent',
    text: 'Funds have been sent successfully.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  ecash_token_shared_via_nfc: {
    title: 'Ecash Token Shared via NFC',
    text: 'Ecash token has been shared via NFC.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  // Authentication & Permissions
  latest_version: {
    title: 'New Version Available',
    text: ({ version: _version }: { version: string }) =>
      `A new version of the app is available. Please update to the latest version.`,
    type: MESSAGE_TYPES.INFO,
    variant: 'persistent',
  },
  ecash_token_copied: {
    title: 'Token Copied',
    text: 'Ecash token has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  npub_copied: {
    title: 'NPUB Copied',
    text: 'Nostr public key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  nsec_copied: {
    title: 'NSEC Copied',
    text: 'Nostr secret key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  p2pk_copied: {
    title: 'P2PK Key Copied',
    text: 'P2PK public key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  lightning_address_copied: {
    title: 'Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  camera_permission_denied: {
    title: 'Camera Permission Denied',
    text: 'Camera access is denied. Please enable it in your device settings.',
    type: MESSAGE_TYPES.ERROR,
  },
  camera_permission_granted: {
    title: 'Camera Permission Granted',
    text: 'Camera access has been granted.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  camera_permission_blocked: {
    title: 'Camera Permission Blocked',
    text: 'Camera access is blocked. Please enable it in your device settings.',
    buttons: [
      {
        text: 'Open Settings',
        page: 'settings',
      },
    ],
    type: MESSAGE_TYPES.ERROR,
  },
  insufficient_balance: {
    title: 'Insufficient Balance',
    text: ({ amount, unit, fee }: { amount: number; unit: string; fee: number }) => (
      <Text
        style={{
          textAlign: 'center',
        }}>
        Not enough funds to send{' '}
        <AmountFormatter
          style={{
            marginBottom: -4,
            marginLeft: 3,
          }}
          size={14}
          amount={amount}
          unit={unit}
        />{' '}
        with a fee of{' '}
        <AmountFormatter
          style={{
            marginBottom: -4,
            marginLeft: 3,
          }}
          size={14}
          amount={fee}
          unit={unit}
        />
        .
      </Text>
    ),
    type: MESSAGE_TYPES.ERROR,
  },
  funds_received: {
    title: 'Funds Received',
    text: ({ amount, unit }: { amount: number; unit: string }) =>
      `${amount} ${unit} has been added to your wallet.`,
    type: MESSAGE_TYPES.SUCCESS,
  },
  invalid_address: {
    title: 'Invalid Address',
    text: ({ address }: { address: string }) =>
      `The address "${address}" is not a valid Ecash or Lightning address.`,
    type: MESSAGE_TYPES.ERROR,
  },
  no_clipboard_address: {
    title: 'No Address Found',
    text: 'No valid address was found in your clipboard.',
    type: MESSAGE_TYPES.WARNING,
  },
  general_error: {
    title: 'Error Occurred',
    text: 'Something went wrong. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  feature_coming_soon: {
    title: 'Coming Soon',
    text: 'This feature is currently under development.',
    type: MESSAGE_TYPES.INFO,
  },
  not_implemented: {
    title: 'Not Implemented',
    text: 'This feature is not yet implemented.',
    type: MESSAGE_TYPES.INFO,
  },
  passcode_not_match: {
    title: 'Passcode Not Match',
    text: 'The passcode does not match. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  'outputs have already been signed before.': {
    title: 'Outputs have been signed before',
    text: 'Trying again should fix this. If not contact support.',
    type: MESSAGE_TYPES.INFO,
  },
  'keyset id inactive.': {
    title: 'Keyset Inactive',
    text: 'You need to update your wallet',
    buttons: [
      {
        text: 'Update Wallet',
        page: 'update-wallet',
      },
    ],
    type: MESSAGE_TYPES.INFO,
  },
  'bad response': {
    title: 'Bad Response',
    text: 'This error is typically due to a problem with the mint you are trying to use. Please try a different mint.',
    type: MESSAGE_TYPES.ERROR,
  },
  'Error Rate limit exceeded.': {
    title: 'Rate Limit Exceeded',
    text: 'You have exceeded the allowed number of requests. Please try again later.',
    type: MESSAGE_TYPES.ERROR,
  },
  'Token already spent.': {
    title: 'Token Already Spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
    type: MESSAGE_TYPES.WARNING,
  },
  'Insufficient funds': {
    title: 'Insufficient Funds',
    text: 'You do not have enough funds to complete this transaction.',
    type: MESSAGE_TYPES.ERROR,
  },
  'Witness is missing for p2pk signature': {
    title: 'Witness is missing for p2pk signature',
    text: "This happens when you try to spend ecash locked to someone else's pubkey",
    type: MESSAGE_TYPES.ERROR,
  },
  'mint quote already issued': {
    title: 'Invoice already paid',
    text: 'This invoice has already been paid.',
    type: MESSAGE_TYPES.ERROR,
  },
  'Lightning payment failed: no_route.': {
    title: 'Lightning Payment Failed',
    text: "Your mint isn't well connected to the recipient's lightning network.",
    type: MESSAGE_TYPES.ERROR,
  },
};

/**
 * Type for predefined message configuration keys
 *
 * This type represents all the available keys in the MESSAGE_CONFIGS object,
 * allowing for type-safe access to predefined message templates.
 */
type MessageCode = keyof typeof MESSAGE_CONFIGS;

/**
 * Configuration interface for the popup function
 *
 * @interface popupConfig
 * @property {string | MessageCode} message - The message content or predefined message code
 * @property {Record<string, any>} [params] - Optional parameters for message template functions
 * @property {string} [emoji] - Optional custom emoji to override the default
 * @property {'alert' | 'persistent' | 'toast'} [variant] - Display variant for the popup
 * @property {boolean} [dismissable] - Whether the popup can be dismissed by the user
 * @property {number} [duration] - Auto-dismiss duration in milliseconds
 * @property {MessageButton[]} [buttons] - Custom action buttons for the popup
 * @property {(data: unknown) => void} [onClose] - Callback function when popup is closed
 * @property {'success' | 'error' | 'warning' | 'info'} [type] - Override the message type
 */
interface popupConfig {
  // Core message content
  message: string | MessageCode;
  params?: Record<string, any>;
  /**
   * Optional override for the popup body text.
   * Useful when `message` is a raw string (not a MessageCode) but you still want a separate body.
   */
  text?: MessageText;

  // Visual customization
  emoji?: string;
  variant?: 'alert' | 'persistent' | 'toast';

  // Behavior
  dismissable?: boolean;
  duration?: number; // for auto-dismiss

  // Actions
  buttons?: MessageButton[];
  onClose?: (data: unknown) => void;

  // Type-specific overrides
  type?: 'success' | 'error' | 'warning' | 'info';
}

/**
 * Displays a popup message to the user
 *
 * This function is the main entry point for showing popups throughout the application.
 * It supports both simple string messages and complex configuration objects with
 * custom styling, buttons, and behavior options.
 *
 * @param config - Either a simple string message or a popupConfig object
 *
 * @example
 * // Simple string message
 * popup('general_error');
 *
 * // Predefined message with parameters
 * popup({
 *   message: 'insufficient_balance',
 *   params: { amount: 1000, unit: 'sats', fee: 50 }
 * });
 *
 * // Custom popup with full configuration
 * popup({
 *   message: 'Custom Error',
 *   text: 'Something went wrong',
 *   type: 'error',
 *   variant: 'alert',
 *   buttons: [
 *     { text: 'Retry', onPress: () => retryAction() },
 *     { text: 'Cancel', onPress: () => cancelAction() }
 *   ],
 *   onClose: (data) => console.log('Popup closed', data)
 * });
 */
export const popup = (config: popupConfig | string) => {
  // Handle both object config and simple string
  if (typeof config === 'string') {
    config = { message: config };
  }

  const { message, params = {}, text: overrideText, ...options } = config;

  // Handle both message codes and raw strings
  const messageConfig =
    typeof message === 'string' && MESSAGE_CONFIGS[message]
      ? MESSAGE_CONFIGS[message]
      : { title: message, text: message, type: MESSAGE_TYPES.INFO };

  const resolvedText =
    typeof messageConfig.text === 'function' ? messageConfig.text(params) : messageConfig.text;
  const resolvedOverrideText =
    typeof overrideText === 'function' ? overrideText(params) : overrideText;
  const text = resolvedOverrideText ?? resolvedText;

  const variant = options.variant || messageConfig.variant || 'alert';
  const messageType = options.type || messageConfig.type || MESSAGE_TYPES.INFO;

  const payload = {
    message: messageConfig.title,
    buttons: options.buttons || messageConfig.buttons || [],
    submessage: text,
    emoji: options.emoji || MESSAGE_EMOJIS[messageType] || MESSAGE_EMOJIS.INFO,
    dismissable: options.dismissable ?? true,
    variant,
    ...options,
  };

  const isModal = router?.canGoBack();

  SheetManager.show('popup-sheet', {
    context: isModal ? undefined : 'global',
    payload,
    onClose: options.onClose,
  });
};
