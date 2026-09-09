/**
 * @jest-environment node
 */

import React from 'react';
import { Dimensions } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { QRCodeFrame, qrCodeGeometry, PAYMENT_QR_PADDING } from '@/shared/ui/composed/QRCodeFrame';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockQrRendered = jest.fn();
let mockScheme = 'dark';
const mockDimensions = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => mockScheme }));
jest.mock('@/shared/ui/composed/GradientCard', () => ({
  GradientCard: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/ui/composed/QRCode', () => ({
  AnimatedQRCode: (props: unknown) => {
    mockQrRendered(props);
    return null;
  },
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
  beforeEach(() => Dimensions.set({ window: mockDimensions, screen: mockDimensions }));
  it.each(['dark', 'light'])(
    'reserves the shared QR frame while empty in %s mode without encoding or exposing a payload',
    (scheme) => {
      mockScheme = scheme;
      mockQrRendered.mockClear();
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<PaymentInfo unit="sat" data="" copyTarget="token" />);
      });
      const frame = renderer.root.findByType(QRCodeFrame);
      expect(frame.props.children.props.style).toEqual({ width: 329, height: 329 });
      expect(mockQrRendered).not.toHaveBeenCalled();
      expect(renderer.root.findAllByProps({ testID: 'payment-info-token-data' })).toHaveLength(0);
      act(() =>
        renderer.update(<PaymentInfo unit="sat" data="fixture-token" copyTarget="token" />)
      );
      expect(mockQrRendered).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'fixture-token', padding: PAYMENT_QR_PADDING })
      );
      expect(renderer.root.findAllByProps({ testID: 'payment-info-qr-placeholder' })).toHaveLength(
        0
      );
      act(() => renderer.unmount());
    }
  );

  it('does not encode a hidden receive rail and mounts only when active', () => {
    mockQrRendered.mockClear();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PaymentInfo unit="sat" data="fixture-token" copyTarget="token" active={false} />
      );
    });
    expect(mockQrRendered).not.toHaveBeenCalled();
    act(() =>
      renderer.update(<PaymentInfo unit="sat" data="fixture-token" copyTarget="token" active />)
    );
    expect(mockQrRendered).toHaveBeenCalledTimes(1);
    act(() =>
      renderer.update(
        <PaymentInfo unit="sat" data="fixture-token" copyTarget="token" active={false} />
      )
    );
    expect(mockQrRendered).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: 'payment-info-token-data' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it.each([320, 393, 430, 768])('shares responsive QR card geometry at width %i', (width) => {
    const geometry = qrCodeGeometry(width, PAYMENT_QR_PADDING);
    expect(geometry.frameSize).toBe(Math.min(width, 600) - 32);
    expect(geometry.qrSize + 32).toBe(geometry.frameSize);
  });

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
