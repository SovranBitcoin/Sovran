import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useDominantColor, FALLBACK_COLORS } from '@/shared/lib/colorExtraction';
const SIZE = 200;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

interface DonutSegment {
  mintUrl: string;
  bp: number;
  /** Original index in the mint list — drives the deterministic colour ramp. */
  colorIndex: number;
  /** Fraction (0–1) of the ring before this segment starts. */
  startFraction: number;
  /** Fraction (0–1) this segment spans. */
  sweepFraction: number;
}

interface DistributionDonutProps {
  mintUrls: string[];
  distribution: Record<string, number>;
  mintInfoMap: Record<string, GetInfoResponse | null | undefined>;
  /** Centre content (e.g. a formatted total amount). */
  center?: React.ReactNode;
}

/**
 * A proportion ring for the chart-led variant. Each active mint becomes an arc
 * whose colour is resolved from its icon via the same `useDominantColor` seam
 * the proportion bar uses, so the donut and the legend agree.
 */
export function DistributionDonut({
  mintUrls,
  distribution,
  mintInfoMap,
  center,
}: DistributionDonutProps) {
  const [surfaceTertiary] = useThemeColor(['surface-tertiary'] as const);

  const segments = useMemo<DonutSegment[]>(() => {
    const total = mintUrls.reduce((sum, url) => sum + (distribution[url] || 0), 0);
    if (total <= 0) return [];
    let acc = 0;
    const result: DonutSegment[] = [];
    mintUrls.forEach((mintUrl, colorIndex) => {
      const bp = distribution[mintUrl] || 0;
      if (bp === 0) return;
      const sweepFraction = bp / total;
      result.push({ mintUrl, bp, colorIndex, startFraction: acc, sweepFraction });
      acc += sweepFraction;
    });
    return result;
  }, [mintUrls, distribution]);

  return (
    <View className="items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE}>
        {/* Track */}
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          stroke={surfaceTertiary}
          strokeWidth={STROKE}
          fill="none"
          opacity={0.4}
        />
        {/* Rotate so segments start at 12 o'clock. */}
        <G rotation={-90} origin={`${CENTER}, ${CENTER}`}>
          {segments.map((segment) => (
            <DonutArc
              key={segment.mintUrl}
              segment={segment}
              mintInfo={mintInfoMap[segment.mintUrl]}
            />
          ))}
        </G>
      </Svg>

      {!!center && (
        <View style={{ position: 'absolute', alignItems: 'center', paddingHorizontal: 24 }}>
          {center}
        </View>
      )}
    </View>
  );
}

function DonutArc({
  segment,
  mintInfo,
}: {
  segment: DonutSegment;
  mintInfo: GetInfoResponse | null | undefined;
}) {
  const [defaultColor] = useThemeColor(['default'] as const);
  const { baseColors, baseColor, hasLoaded } = useDominantColor(
    mintInfo?.icon_url,
    segment.colorIndex
  );

  const color = useMemo(() => {
    if (!hasLoaded) return defaultColor;
    const main = baseColors[1] || baseColor;
    if (FALLBACK_COLORS.includes(main as never)) return defaultColor;
    return main;
  }, [hasLoaded, baseColors, baseColor, defaultColor]);

  // A small gap between segments reads as separation without a stroke border.
  const GAP_FRACTION = segment.sweepFraction > 0.04 ? 0.006 : 0;
  const dash = Math.max(0, (segment.sweepFraction - GAP_FRACTION) * CIRCUMFERENCE);
  const gap = CIRCUMFERENCE - dash;
  const offset = -segment.startFraction * CIRCUMFERENCE;

  return (
    <Circle
      cx={CENTER}
      cy={CENTER}
      r={RADIUS}
      stroke={color}
      strokeWidth={STROKE}
      strokeDasharray={`${dash} ${gap}`}
      strokeDashoffset={offset}
      strokeLinecap="butt"
      fill="none"
    />
  );
}
