import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import * as Clipboard from 'expo-clipboard';
import {
  AnimatedQRCode,
  QRSpeedControls,
  SPEED_PRESETS,
  DENSITY_PRESETS,
  DEFAULT_SPEED_INDEX,
  DEFAULT_DENSITY_INDEX,
} from '@/shared/ui/composed/QRCode';
import { View } from '@/shared/ui/primitives/View/View';
import { PAYMENT_QR_PADDING, PaymentQRCodePlaceholder } from '@/shared/ui/composed/QRCodeFrame';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Log, paymentLog } from '@/shared/lib/logger';

import {
  ANIMATE_THRESHOLD,
  expectedQrPayloadLength,
  rememberQrPayloadLength,
} from '@/shared/lib/qr';

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
  /** Hidden receive rails preload data without encoding or animating a QR. */
  active?: boolean;
  /** Keep the QR visible while temporarily disabling its copy gesture. */
  copyDisabled?: boolean;
  data: string | { name: string; value: string }[];
  copyTarget: CopyTarget;
  animated?: boolean;
  variant?: 'primary' | 'secondary';
  /** The data just arrived from a lazy fetch: play the QR decode once. The
   * block also reveals on its own when it showed the placeholder first. */
  reveal?: boolean;
  /** Density hint for the placeholder; defaults to the copy target's estimate. */
  expectedLength?: number;
}

export function PaymentInfo({
  unit,
  active = true,
  copyDisabled = false,
  data,
  copyTarget,
  animated = false,
  variant = 'primary',
  reveal = false,
  expectedLength,
}: PaymentInfoProps): React.ReactElement {
  const selectedValue = useMemo(() => {
    if (Array.isArray(data) && data.length > 0) return data[0].value;
    if (typeof data === 'string') return data;
    return '';
  }, [data]);

  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [densityIndex, setDensityIndex] = useState(DEFAULT_DENSITY_INDEX);

  const willAnimate = animated && selectedValue.length >= ANIMATE_THRESHOLD;

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((prev) => {
      const next = (prev + 1) % SPEED_PRESETS.length;
      paymentLog.info('ui.qrcode.speed_changed', {
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
      paymentLog.info('ui.qrcode.density_changed', {
        from: DENSITY_PRESETS[prev].label,
        to: DENSITY_PRESETS[next].label,
        fragmentSize: DENSITY_PRESETS[next].fragmentSize,
      });
      return next;
    });
  }, []);

  const handleCopyPress = useCallback(async () => {
    paymentLog.info('ui.payment_info.copy', {
      copyTarget,
      valueLength: selectedValue.length,
    });
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(selectedValue);
    copyPopup(copyTarget);
  }, [selectedValue, copyTarget]);

  const loading = !selectedValue;
  // Once this block has shown the placeholder, the value that replaces it is
  // a lazy-fetch arrival and gets the decode; a block mounted with data does
  // not (unless the caller says so via `reveal`).
  const [sawPlaceholder, setSawPlaceholder] = useState(loading);
  useEffect(() => {
    if (loading) setSawPlaceholder(true);
  }, [loading]);
  // Teach the placeholder the density of this target's real payload, so the
  // next time it loads (tab revisit, unit switch) the junk QR matches.
  useEffect(() => {
    if (selectedValue) rememberQrPayloadLength(copyTarget, selectedValue.length);
  }, [copyTarget, selectedValue]);
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

  if (loading || !active)
    return (
      <PaymentQRCodePlaceholder
        testID="payment-info-qr-placeholder"
        unit={unit}
        expectedLength={expectedLength ?? expectedQrPayloadLength(copyTarget)}
      />
    );

  return (
    <Log name="PaymentInfo">
      <View>
        {/* Explicit 1×1 accessibility probe carrying the payment value.
            A hidden Text child keeps its label on iOS but can lose its
            accessibilityIdentifier, making exact simulator capture unsafe.
            This mirrors TransactionProbe's proven stable View contract. */}
        <View
          testID={`payment-info-${kebabCase(copyTarget)}-data`}
          accessible
          accessibilityRole="text"
          accessibilityLabel={selectedValue}
          importantForAccessibility="yes"
          collapsable={false}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1,
            height: 1,
          }}
        />
        {/* QR code — tap to copy */}
        <View
          testID="payment-info-sensitive-visual"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Sensitive payment visual"
          importantForAccessibility="yes"
          collapsable={false}>
          <Pressable disabled={copyDisabled} onPress={handleCopyPress}>
            <AnimatedQRCode
              padding={PAYMENT_QR_PADDING}
              unit={unit}
              address={selectedValue}
              animate={animated}
              variant={variant}
              intervalMs={SPEED_PRESETS[speedIndex].intervalMs}
              fragmentSize={DENSITY_PRESETS[densityIndex].fragmentSize}
              reveal={reveal || sawPlaceholder}
            />
          </Pressable>
        </View>

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
