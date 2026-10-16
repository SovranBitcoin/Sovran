import React from 'react';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';

interface SectionProps {
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}

/**
 * A titled group, in the manner of iOS Settings: a small title above grouped
 * content. Children own their surface and radius, so a ListGroup or Surface
 * is not clipped by a second rounded wrapper.
 *
 * The title starts where a row's text starts (the style's padding), not at
 * the group's outer edge, so the eye runs down one line. Its case is the
 * active style's.
 */
export const Section: React.FC<SectionProps> = ({ title, children, isDanger }) => {
  const danger = useThemeColor('danger');
  const paint = useStylePaint();
  const { pad, related, item } = paint.style.space;

  return (
    <View style={{ paddingVertical: item }}>
      <Text
        size={13}
        semibold
        // The harness finds a section by its capitalised title, which is what
        // this text was before its case became the style's. The accessible
        // name stays that one spelling in every style; the selector is the
        // stable way in for new scenarios.
        accessibilityRole="header"
        accessibilityLabel={title.toUpperCase()}
        testID={`section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        style={{
          color: isDanger ? danger : paint.text.secondary,
          paddingHorizontal: pad,
          paddingBottom: related * 2,
        }}>
        {paint.style.type.uppercaseLabels ? title.toUpperCase() : title}
      </Text>
      <View>{children}</View>
    </View>
  );
};
