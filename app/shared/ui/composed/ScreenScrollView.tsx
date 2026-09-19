import { type Ref } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useScreenContentPadding } from '@/shared/hooks/useScreenInsets';

/**
 * A page scroller inside Screen scroll="custom" or a manually framed page.
 * Screen safeArea="scroll" supplies scrolling header clearance; otherwise the
 * page owns its top spacing. This also owns safe-bottom and footer clearance.
 * Use plain ScrollView for horizontal rows and nested, non-page scrolling.
 */
export function ScreenScrollView({
  ref,
  bottomSpacing,
  contentContainerStyle,
  scrollIndicatorInsets,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView>; bottomSpacing?: number }) {
  const { headerPadding, contentPadding } = useScreenContentPadding(
    contentContainerStyle,
    bottomSpacing
  );
  return (
    <ScrollView
      nestedScrollEnabled
      {...props}
      ref={ref}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[contentContainerStyle, contentPadding]}
      scrollIndicatorInsets={{
        top: headerPadding,
        ...scrollIndicatorInsets,
        bottom: contentPadding.paddingBottom,
      }}
    />
  );
}
