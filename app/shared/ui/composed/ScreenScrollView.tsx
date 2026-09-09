import { type Ref } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useScreenBottomPadding } from '@/shared/hooks/useScreenInsets';

/**
 * A page scroller inside Screen scroll="custom" or a manually framed page.
 * The page owns its top/header spacing; this owns safe-bottom and footer clearance.
 * Use plain ScrollView for horizontal rows and nested, non-page scrolling.
 */
export function ScreenScrollView({
  ref,
  bottomSpacing,
  contentContainerStyle,
  scrollIndicatorInsets,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView>; bottomSpacing?: number }) {
  const bottomPadding = useScreenBottomPadding(bottomSpacing);
  return (
    <ScrollView
      nestedScrollEnabled
      {...props}
      ref={ref}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPadding }]}
      scrollIndicatorInsets={{ ...scrollIndicatorInsets, bottom: bottomPadding }}
    />
  );
}
