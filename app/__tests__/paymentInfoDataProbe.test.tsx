/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { PaymentInfo } from '@/shared/blocks/PaymentInfo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/ui/composed/QRCode', () => ({
  AnimatedQRCode: () => null,
  QRSpeedControls: () => null,
  SPEED_PRESETS: [{ label: 'Normal', intervalMs: 1000 }],
  DENSITY_PRESETS: [{ label: 'Normal', fragmentSize: 100 }],
  DEFAULT_SPEED_INDEX: 0,
  DEFAULT_DENSITY_INDEX: 0,
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: ({ renderContent }: { renderContent: () => React.ReactNode }) => (
    <>{renderContent()}</>
  ),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn() }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { copyHaptic: jest.fn() },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn() },
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('PaymentInfo device data probe', () => {
  it('binds the full payment value to a stable accessible view id', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PaymentInfo unit="sat" data="lnbc100n-test-value" copyTarget="lightningInvoice" />
      );
    });

    const probe = renderer!.root.findByProps({
      testID: 'payment-info-lightning-invoice-data',
    });
    expect(probe.props.accessible).toBe(true);
    expect(probe.props.accessibilityLabel).toBe('lnbc100n-test-value');
    expect(probe.props.importantForAccessibility).toBe('yes');
    expect(probe.props.collapsable).toBe(false);
    expect(probe.props.pointerEvents).toBe('none');

    const sensitiveVisual = renderer!.root.findByProps({
      testID: 'payment-info-sensitive-visual',
    });
    expect(sensitiveVisual.props.accessible).toBe(true);
    expect(sensitiveVisual.props.accessibilityRole).toBe('image');
    expect(sensitiveVisual.props.accessibilityLabel).not.toContain('lnbc100n-test-value');
    expect(sensitiveVisual.props.collapsable).toBe(false);
  });

  it('mounts the Lightning invoice probe on the fixed-amount destination screen', () => {
    const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const { resolve } = jest.requireActual<typeof import('node:path')>('node:path');
    const source = readFileSync(
      resolve(__dirname, '..', 'features/receive/screens/LightningReceiveScreen.tsx'),
      'utf8'
    );

    expect(source).toContain('copyTarget="lightningInvoice"');
  });
});
