import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { calculatePosition, calculateSize, calculateOpacity } from './helper';
import { Avatar } from 'components/ui/Avatar';

interface MintItemProps {
  mint: any;
  mintIndex: number;
  activeMintId: string;
  mintIndices: string[];
  renderProgressCircle: (
    progress: number,
    size: number,
    getPrimaryColor: (shade: string) => string
  ) => React.ReactNode;
  getMintProgress: (mintUrl: string) => number;
}

// Individual mint component that animates based on active state
export const MintItem = ({
  mint,
  mintIndex,
  activeMintId,
  mintIndices,
  renderProgressCircle,
  getMintProgress,
}: MintItemProps) => {
  const { getPrimaryColor } = useTheme();
  const isMintActive = activeMintId === mint.id;
  const positionIndex = mintIndex - mintIndices.findIndex((m) => m === activeMintId);

  // Create animated values for scale and position
  const scaleValue = useRef(new Animated.Value(isMintActive ? 1 : 0.5)).current;
  const translateXValue = useRef(new Animated.Value(positionIndex * 16)).current;

  // Animate scale and position when mint becomes active or inactive
  useEffect(() => {
    Animated.parallel([
      Animated.timing(scaleValue, {
        toValue: calculateSize(positionIndex),
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateXValue, {
        toValue: calculatePosition(positionIndex),
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeMintId, positionIndex, scaleValue, translateXValue]);

  const mintProgress = getMintProgress(mint.mintUrl);

  // Calculate z-index value for proper layering
  const zIndexValue = -Math.abs(positionIndex);

  return (
    <Animated.View
      style={{
        marginHorizontal: 4,
        transform: [{ scale: scaleValue }, { translateX: translateXValue }],
        borderRadius: 100000,
        width: 100,
        height: 100,
        marginRight: -100,
        zIndex: zIndexValue,
        backgroundColor: getPrimaryColor('950'),
      }}>
      <View
        style={{
          position: 'relative',
          width: 100,
          height: 100,
          marginBottom: 8,
          overflow: 'hidden',
        }}>
        {renderProgressCircle(mintProgress, 100, getPrimaryColor)}
        <View
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: 100000,
            padding: 4,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: isMintActive ? 1000 : 0,
          }}>
          <View style={{ opacity: calculateOpacity(positionIndex) }}>
            <Avatar picture={mint.iconUrl} variant="mint" size={100} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
};
