import React, { useCallback, useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import {
  AnimatedQRCode,
  QRSpeedControls,
  SPEED_PRESETS,
  DENSITY_PRESETS,
  DEFAULT_SPEED_INDEX,
  DEFAULT_DENSITY_INDEX,
} from '@/shared/ui/composed/QRCode';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { log, Log } from '@/shared/lib/logger';

// Threshold matches AnimatedQRCode's ANIMATE_THRESHOLD
const ANIMATE_THRESHOLD = 500;

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
    if (data instanceof String) return data.valueOf();
    return '';
  }, [data]);

  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [densityIndex, setDensityIndex] = useState(DEFAULT_DENSITY_INDEX);

  const willAnimate = animated && selectedValue.length >= ANIMATE_THRESHOLD;

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((prev) => {
      const next = (prev + 1) % SPEED_PRESETS.length;
      log.info('ui.qrcode.speed_changed', {
        from: SPEED_PRESETS[prev].label,
        to: SPEED_PRESETS[next].label,
        intervalMs: SPEED_PRESETS[next].intervalMs,
      });
      return next;
    });
  }, []);

  const cycleDensity = useCallback(() => {
    setDensityIndex((prev) => {
      const next = (prev + 1) % DENSITY_PRESETS.length;
      log.info('ui.qrcode.density_changed', {
        from: DENSITY_PRESETS[prev].label,
        to: DENSITY_PRESETS[next].label,
        fragmentSize: DENSITY_PRESETS[next].fragmentSize,
      });
      return next;
    });
  }, []);

  const handleCopyPress = useCallback(async () => {
    log.info('ui.payment_info.copy', { copyTarget, hasLink: Boolean(link), valueLength: selectedValue.length });
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(link || selectedValue);
    copyPopup(copyTarget);
  }, [link, selectedValue, copyTarget]);

  if (!selectedValue) {
    log.debug('ui.payment_info.empty', { dataType: typeof data, isArray: Array.isArray(data) });
    return (
      <HStack align="center" justify="center">
        <Skeleton className="bg-surface-secondary h-64 w-64" />
      </HStack>
    );
  }

  log.debug('ui.payment_info.render', {
    unit,
    copyTarget,
    animated: willAnimate,
    variant,
    dataLength: selectedValue.length,
    preview: selectedValue.slice(0, 30),
  });

  return (
    <Log name="PaymentInfo">
      <View>
        {/* QR code — tap to copy */}
        <Pressable onPress={handleCopyPress}>
          <ViewShot captureMode="mount" onCapture={setUri}>
            <AnimatedQRCode
              padding={32}
              unit={unit}
              address={selectedValue}
              animate={animated}
              variant={variant}
              intervalMs={SPEED_PRESETS[speedIndex].intervalMs}
              fragmentSize={DENSITY_PRESETS[densityIndex].fragmentSize}
            />
          </ViewShot>
        </Pressable>

        {/* Speed + Density controls — outside the copy pressable */}
        {willAnimate && (
          <View style={{ marginTop: 12 }}>
            <QRSpeedControls
              speedIndex={speedIndex}
              densityIndex={densityIndex}
              onCycleSpeed={cycleSpeed}
              onCycleDensity={cycleDensity}
            />
          </View>
        )}
      </View>
    </Log>
  );
}
