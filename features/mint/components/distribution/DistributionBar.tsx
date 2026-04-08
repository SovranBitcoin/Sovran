import React, { useMemo, useEffect, useState } from 'react';
import { StyleSheet, View, LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getContrastColors, FALLBACK_COLORS, useDominantColor } from './colorUtils';
import { Log } from '@/shared/lib/logger';

const MIN_PERCENTAGE_FOR_AVATAR = 12;
const AVATAR_SIZE = 20;
const GAP_WIDTH = 2;

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

const INNER_SHADOW_TOP = ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.08)', 'transparent'] as const;
const INNER_HIGHLIGHT_BOTTOM = ['transparent', 'rgba(0,0,0,0.03)', 'rgba(0,0,0,0.08)'] as const;

// ============================================
// COMPONENTS
// ============================================

interface SegmentProps {
  mintInfo: any;
  bp: number;
  totalWidth: number;
  colorIndex: number;
  isFirst: boolean;
  activeCount: number;
}

const AnimatedSegment: React.FC<SegmentProps> = ({
  mintInfo,
  bp,
  totalWidth,
  colorIndex,
  isFirst,
  activeCount,
}) => {
  const [defaultColor, surfaceTertiary] = useThemeColor(['default', 'surface-tertiary'] as const);
  const mintName = mintInfo?.name || 'Mint';
  const mintIcon = mintInfo?.icon_url;

  const { baseColors, baseColor, hasLoaded } = useDominantColor(mintIcon, colorIndex);

  const { gradientColors, borderColor } = useMemo(() => {
    if (!hasLoaded) {
      return {
        gradientColors: [defaultColor, surfaceTertiary] as const,
        borderColor: surfaceTertiary,
      };
    }
    const mainColor = baseColors[1] || baseColor;
    if (FALLBACK_COLORS.includes(mainColor as any)) {
      return {
        gradientColors: [defaultColor, surfaceTertiary] as const,
        borderColor: surfaceTertiary,
      };
    }
    const { contrastColor, borderColor: border } = getContrastColors(mainColor, 0.3);
    return {
      gradientColors: [mainColor, contrastColor] as const,
      borderColor: border,
    };
  }, [hasLoaded, baseColors, baseColor, defaultColor, surfaceTertiary]);

  const gapSpace = (activeCount - 1) * GAP_WIDTH;
  const availableWidth = totalWidth - gapSpace;
  const targetWidth = (bp / TOTAL_BASIS_POINTS) * availableWidth;
  const percentage = (bp / TOTAL_BASIS_POINTS) * 100;
  const showAvatar = percentage >= MIN_PERCENTAGE_FOR_AVATAR;

  const animatedWidth = useSharedValue(targetWidth);

  useEffect(() => {
    animatedWidth.value = withSpring(targetWidth, SPRING_CONFIG);
  }, [targetWidth, animatedWidth]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: animatedWidth.value,
    marginLeft: isFirst ? 0 : GAP_WIDTH,
  }));

  if (bp === 0) return null;

  return (
    <Animated.View
      style={[
        styles.segment,
        animatedStyle,
        {
          borderWidth: 1,
          borderColor: borderColor,
        },
      ]}>
      <LinearGradient
        colors={gradientColors}
        locations={[0, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.segmentGradient}>
        <LinearGradient
          colors={INNER_SHADOW_TOP}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.innerShadowTop}
        />
        <LinearGradient
          colors={INNER_HIGHLIGHT_BOTTOM}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.innerHighlightBottom}
        />
        {showAvatar && (
          <View className="items-center justify-center">
            <Avatar
              picture={mintIcon}
              size={AVATAR_SIZE}
              name={mintName}
              alt={`${mintName} icon`}
            />
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
};

interface DistributionBarProps {
  distribution: Record<string, number>;
  mintInfoMap: Record<string, any>;
  mintUrls: string[];
}

export const DistributionBar: React.FC<DistributionBarProps> = ({
  distribution,
  mintInfoMap,
  mintUrls,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const activeCount = useMemo(() => {
    return mintUrls.filter((url) => (distribution[url] || 0) > 0).length;
  }, [distribution, mintUrls]);

  const isEmpty = activeCount === 0;

  return (
    <Log name="DistributionBar">
      <View className="mx-4 mb-2 h-8 overflow-visible" onLayout={handleLayout}>
        {containerWidth > 0 && !isEmpty && (
          <View className="flex-1 flex-row">
            {mintUrls.map((mintUrl, index) => {
              const bp = distribution[mintUrl] || 0;
              if (bp === 0) return null;

              const activeIndexBeforeThis = mintUrls
                .slice(0, index)
                .filter((url) => (distribution[url] || 0) > 0).length;

              return (
                <AnimatedSegment
                  key={mintUrl}
                  mintInfo={mintInfoMap[mintUrl]}
                  bp={bp}
                  totalWidth={containerWidth}
                  colorIndex={index}
                  isFirst={activeIndexBeforeThis === 0}
                  activeCount={activeCount}
                />
              );
            })}
          </View>
        )}
      </View>
    </Log>
  );
};

const styles = StyleSheet.create({
  segment: {
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  segmentGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerShadowTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '50%',
  },
  innerHighlightBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
});
