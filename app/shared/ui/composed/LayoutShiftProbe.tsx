/**
 * Dev-only layout-shift attribution: wraps a block-level section and logs
 * whenever its frame moves or resizes after first measure. Wrap the suspects
 * (balance carousel, action row, transactions, charts) and the shifting
 * element names itself in the logs:
 *
 *   wallet.layout.shift { tag, dy, dh, y, height }
 *
 * Production builds render children unwrapped (no extra view, no logging).
 */

import React, { useRef } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { View } from '@/shared/ui/primitives/View/View';
import { walletLog } from '@/shared/lib/logger';

export function LayoutShiftProbe({
  tag,
  children,
}: {
  tag: string;
  children: React.ReactNode;
}): React.ReactElement {
  const lastRef = useRef<{ y: number; height: number } | null>(null);

  if (!__DEV__) return <>{children}</>;

  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const prev = lastRef.current;
    lastRef.current = { y, height };
    if (!prev) return;
    const dy = y - prev.y;
    const dh = height - prev.height;
    if (Math.abs(dy) < 0.5 && Math.abs(dh) < 0.5) return;
    walletLog.info('wallet.layout.shift', {
      tag,
      dy: Math.round(dy * 10) / 10,
      dh: Math.round(dh * 10) / 10,
      y: Math.round(y),
      height: Math.round(height),
    });
  };

  return <View onLayout={onLayout}>{children}</View>;
}
