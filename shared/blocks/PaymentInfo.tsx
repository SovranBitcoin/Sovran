import React, { useCallback, useMemo } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { AnimatedQRCode } from '@/shared/ui/composed/QRCode';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

interface PaymentInfoProps {
  unit: string;
  data: string | { name: string; value: string }[];
  link?: string;
  copyTarget: CopyTarget;
  setUri?: (uri: string) => void;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
}

export function PaymentInfo({
  unit,
  data,
  link,
  copyTarget,
  setUri,
  animated = false,
  variant = 'primary',
}: PaymentInfoProps): React.ReactElement {
  const selectedValue = useMemo(() => {
    if (Array.isArray(data) && data.length > 0) return data[0].value;
    if (typeof data === 'string') return data;
    // FormattedString (coco-payment-ux) extends String — typeof is 'object'
    if (data instanceof String) return data.valueOf();
    return '';
  }, [data]);

  const handleCopyPress = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(link || selectedValue);
    copyPopup(copyTarget);
  }, [link, selectedValue, copyTarget]);

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
