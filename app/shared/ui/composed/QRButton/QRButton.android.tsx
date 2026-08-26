import React from 'react';
import { StyleSheet } from 'react-native';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import Animated from 'react-native-reanimated';

import { Log } from '@/shared/lib/logger';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import {
  DEFAULT_SIZE,
  usePublishAnchorInWindow,
  useQRButtonAnchorRegistration,
  useQRButtonChrome,
} from './QRButton.shared';
import type { QRButtonProps } from './QRButton.shared';
import { QRButtonFace, QRButtonGlyph } from './QRButtonFace';

export function QRButton(props: QRButtonProps): React.ReactElement {
  const { onPress, size = DEFAULT_SIZE } = props;
  const {
    foreground,
    background,
    borderRadius,
    containerStyle,
    pressableStyle,
    animatedRef,
    visibilityStyle,
    pressFeedback,
  } = useQRButtonChrome(size);

  // Android's UI-thread measurement can report pageX/pageY in a different
  // space than the root view during boot on devices with variable system
  // nav bars. The splash morph consumes window coordinates, so keep this
  // path on measureInWindow only.
  const publishAnchor = usePublishAnchorInWindow(animatedRef, borderRadius);
  useQRButtonAnchorRegistration(publishAnchor);

  return (
    <Log name="QRButton">
      <Animated.View
        ref={animatedRef}
        onLayout={publishAnchor}
        collapsable={false}
        style={[{ width: size, height: size }, visibilityStyle]}>
        <Animated.View style={[{ width: size, height: size }, pressFeedback.animatedStyle]}>
          <Pressable
            accessibilityLabel="Scan QR code"
            accessibilityRole="button"
            style={[styles.touchable, pressableStyle]}
            className="items-center justify-center"
            activeOpacity={1}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={onPress}
            onPressIn={pressFeedback.onPressIn}
            onPressOut={pressFeedback.onPressOut}>
            <SquircleView style={[styles.container, containerStyle]} pointerEvents="none">
              <QRButtonFace foreground={foreground} background={background} />
            </SquircleView>
            <QRButtonGlyph background={background} />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Log>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
    elevation: 5,
  },
  container: {
    overflow: 'hidden',
    position: 'absolute',
  },
});
