/**
 * @fileoverview PaymentInfo component for displaying QR codes with copy functionality
 *
 * This module contains the PaymentInfo component that displays payment information
 * as QR codes with integrated copy-to-clipboard functionality. The component supports
 * both simple string data and complex array-based data structures, with optional
 * animation and visual variants.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { AnimatedQRCode } from 'components/ui/QRCode';
import { HStack } from 'components/ui/View';
import { Skeleton } from '@/components/ui/Skeleton';
import { popup } from '@/helper/popup';

interface PaymentInfoProps {
  unit: string;
  data: string | { name: string; value: string }[];
  link?: string;
  popupMessage: string | { [key: number]: { name: string } };
  setUri?: (uri: string) => void;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
}

/**
 * PaymentInfo component displays a QR code for payment information with copy functionality.
 *
 * The component can handle both simple string data and array of objects with name/value pairs.
 * When the QR code is pressed, it copies the payment information to the clipboard and shows
 * a success message. If no data is available, it displays a skeleton loading state.
 *
 * @param props - The component props
 * @returns A React element containing either a QR code or skeleton loader
 *
 * @example
 * ```tsx
 * // Simple string data
 * <PaymentInfo
 *   unit="sat"
 *   data="bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
 *   popupMessage="Bitcoin address copied!"
 * />
 *
 * // Array data (uses first item)
 * <PaymentInfo
 *   unit="usd"
 *   data={[{ name: 'Lightning', value: 'lnbc1000n1...' }]}
 *   popupMessage="Lightning invoice copied!"
 *   animated={true}
 * />
 * ```
 */
export function PaymentInfo({
  unit,
  data,
  link,
  popupMessage,
  setUri,
  animated = false,
  variant = 'primary',
}: PaymentInfoProps): React.ReactElement {
  /**
   * Extracts the value to display from the data prop.
   * Handles both string data and array of objects (uses first item's value).
   */
  const selectedValue = useMemo(() => {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) return data[0].value;
    return '';
  }, [data]);

  /**
   * Handles copying payment information to clipboard when QR code is pressed.
   * Copies either the link prop or the selectedValue, then shows a success popup.
   */
  const handleCopyPress = useCallback(async () => {
    const textToCopy = link || selectedValue;
    await Clipboard.setStringAsync(textToCopy);

    const message =
      typeof popupMessage === 'string'
        ? popupMessage
        : (popupMessage[0]?.name ?? 'Copied to clipboard');

    popup({ message, type: 'success' });
  }, [link, selectedValue, popupMessage]);

  if (!selectedValue) {
    return (
      <HStack align="center" justify="center">
        <Skeleton className="h-64 w-64 bg-primary-800" />
      </HStack>
    );
  }

  return (
    <Pressable onPress={handleCopyPress}>
      <ViewShot captureMode="mount" onCapture={setUri}>
        <AnimatedQRCode
          padding={32}
          unit={unit}
          address={selectedValue}
          animate={animated}
          variant={variant}
        />
      </ViewShot>
    </Pressable>
  );
}
