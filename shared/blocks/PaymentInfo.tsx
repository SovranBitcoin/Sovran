import React, { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
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
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Log, paymentLog } from '@/shared/lib/logger';

// Threshold matches AnimatedQRCode's ANIMATE_THRESHOLD
const ANIMATE_THRESHOLD = 500;

/**
 * camelCase → kebab-case for testID generation. Keeps the AX testIDs
 * uniform with the kebab-case `<screen>-<action>` convention used
 * across the app, so log-doctor's selector parser (which only accepts
 * [a-z0-9-]) can target them. `paymentRequest` -> `payment-request`,
 * `lightningInvoice` -> `lightning-invoice`, `token` stays `token`.
 */
function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

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
    return '';
  }, [data]);

  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [densityIndex, setDensityIndex] = useState(DEFAULT_DENSITY_INDEX);

  const willAnimate = animated && selectedValue.length >= ANIMATE_THRESHOLD;

  const cycleSpeed = () => {
    setSpeedIndex((prev) => {
      const next = (prev + 1) % SPEED_PRESETS.length;
      paymentLog.info('ui.qrcode.speed_changed', {
        from: SPEED_PRESETS[prev].label,
        to: SPEED_PRESETS[next].label,
        intervalMs: SPEED_PRESETS[next].intervalMs,
      });
      return next;
    });
  };

  const cycleDensity = () => {
    setDensityIndex((prev) => {
      const next = (prev + 1) % DENSITY_PRESETS.length;
      paymentLog.info('ui.qrcode.density_changed', {
        from: DENSITY_PRESETS[prev].label,
        to: DENSITY_PRESETS[next].label,
        fragmentSize: DENSITY_PRESETS[next].fragmentSize,
      });
      return next;
    });
  };

  const handleCopyPress = async () => {
    paymentLog.info('ui.payment_info.copy', {
      copyTarget,
      hasLink: Boolean(link),
      valueLength: selectedValue.length,
    });
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(link || selectedValue);
    copyPopup(copyTarget);
  };

  const loading = !selectedValue;
  if (loading) {
    paymentLog.debug('ui.payment_info.empty', {
      dataType: typeof data,
      isArray: Array.isArray(data),
    });
  } else {
    paymentLog.debug('ui.payment_info.render', {
      unit,
      copyTarget,
      animated: willAnimate,
      variant,
      dataLength: selectedValue.length,
    });
  }

  return (
    <SkeletonContentCrossfade
      loading={loading}
      visualKey="payment-info"
      visualSurface="payment"
      renderSkeleton={() => (
        <HStack align="center" justify="center">
          <Skeleton className="bg-surface-secondary h-64 w-64" />
        </HStack>
      )}
      renderContent={() => (
        <Log name="PaymentInfo">
          <View>
            {/* Hidden Text node carrying the full payment value, so log-doctor's
            `capture-id-label` step can read the token/address straight from
            the AX tree without bouncing through the iOS pasteboard. Text
            elements are always included in the iOS AX tree (unlike Views
            with opacity:0, which iOS strips), and the visible content is
            what populates the WDA `name`/`label` fields — that's why the
            value is the Text child rather than `accessibilityLabel`. */}
            <Text
              testID={`payment-info-${kebabCase(copyTarget)}-data`}
              numberOfLines={1}
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                fontSize: 1,
                color: 'transparent',
                overflow: 'hidden',
              }}>
              {selectedValue}
            </Text>
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
      )}
    />
  );
}
