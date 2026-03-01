import React, { useCallback, useMemo } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { AnimatedQRCode } from 'components/ui/QRCode';
import { HStack } from 'components/ui/View/HStack';
import { Skeleton } from '@/components/ui/Skeleton';
import { popup } from '@/helper/popup';
import { EnhancedHaptics } from 'components/ui/Haptics';

interface PaymentInfoProps {
  unit: string;
  data: string | { name: string; value: string }[];
  link?: string;
  popupMessage: string | { [key: number]: { name: string } };
  setUri?: (uri: string) => void;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
}

export function PaymentInfo({
  unit,
  data,
  link,
  popupMessage,
  setUri,
  animated = false,
  variant = 'primary',
}: PaymentInfoProps): React.ReactElement {
  const selectedValue = useMemo(() => {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) return data[0].value;
    return '';
  }, [data]);

  const handleCopyPress = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(link || selectedValue);

    const message =
      typeof popupMessage === 'string'
        ? popupMessage
        : (popupMessage[0]?.name ?? 'Copied to clipboard');

    popup({ message, type: 'success' });
  }, [link, selectedValue, popupMessage]);

  if (!selectedValue) {
    return (
      <HStack align="center" justify="center">
        <Skeleton className="bg-surface-secondary h-64 w-64" />
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
