/**
 * Menu rows for every action menu: the sheets (`ActionMenuHost`,
 * `actionMenuSheet`) and `ActionMenuButton`'s popover. `MenuItem` is the
 * pressable row (tinted and shrunk while held); `SheetMenuRowContent` its
 * body: leading icon, title, optional description, optional trailing
 * accessory.
 */

import { type ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { cn } from '@/shared/lib/classNames';
import { injectParts } from '@/shared/lib/injectParts';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { SELECTION_HAPTICS } from '@/shared/ui/primitives/Haptics';
import { HStack } from '@/shared/ui/primitives/View/HStack';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MenuItemProps = {
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; busy?: boolean; selected?: boolean };
  isDisabled?: boolean;
  isSelected?: boolean;
  variant?: 'default' | 'danger';
  onPress: () => void;
  children: ReactNode;
};

export function MenuItem({
  isDisabled = false,
  isSelected = false,
  variant = 'default',
  accessibilityState,
  onPress,
  children,
  ...rest
}: MenuItemProps) {
  const [fill, danger] = useThemeColor(['default', 'danger'] as const);
  const pressedFill = variant === 'danger' ? withAlpha(danger, 0.1) : fill;
  const restFill = withAlpha(fill, 0);
  const pressed = useSharedValue(false);
  const feedback = useAnimatedStyle(() => ({
    backgroundColor: withTiming(pressed.get() ? pressedFill : restFill, {
      duration: 150,
    }),
    transform: [{ scale: withTiming(pressed.get() ? 0.98 : 1, { duration: 150 }) }],
  }));
  return (
    <AnimatedPressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: isDisabled, selected: isSelected, ...accessibilityState }}
      disabled={isDisabled}
      activeOpacity={1}
      onPressIn={() => pressed.set(true)}
      onPressOut={() => pressed.set(false)}
      haptics={SELECTION_HAPTICS}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-2.5 rounded-2xl px-2.5 py-2',
        isDisabled && 'opacity-disabled'
      )}
      style={[{ borderCurve: 'continuous' }, feedback]}
      {...rest}>
      {injectParts(children, [SheetMenuRowContent], { variant })}
    </AnimatedPressable>
  );
}

/** The bold sheet title above a menu's rows. */
export function MenuTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RNText
      className={cn('text-foreground -mt-2 mb-2 ml-3 text-left text-lg font-bold', className)}>
      {children}
    </RNText>
  );
}

function SheetItemTitle({
  children,
  singleLine = true,
  variant,
}: {
  children: ReactNode;
  singleLine?: boolean;
  variant: 'default' | 'danger';
}) {
  return (
    <RNText
      className={cn(
        'text-left text-base font-medium',
        variant === 'danger' ? 'text-danger' : 'text-foreground'
      )}
      numberOfLines={singleLine ? 1 : undefined}>
      {children}
    </RNText>
  );
}

interface SheetMenuRowContentProps {
  /** Leading icon node (already sized); `null` renders nothing. */
  icon: ReactNode;
  title: ReactNode;
  /** A muted second line when non-null. */
  description?: ReactNode;
  /** Trailing accessory (amount, check, capability glyphs …). */
  trailing?: ReactNode;
  /** One line, truncated (pickers); `false` lets the title wrap. */
  singleLineTitle?: boolean;
  /** Handed down by `MenuItem`: danger rows title in the danger colour. */
  variant?: 'default' | 'danger';
}

export function SheetMenuRowContent({
  icon,
  title,
  description,
  trailing,
  singleLineTitle = true,
  variant = 'default',
}: SheetMenuRowContentProps) {
  return (
    <HStack align="center" gap={10} style={{ flex: 1 }}>
      {icon}
      <View style={{ flex: 1 }}>
        <SheetItemTitle singleLine={singleLineTitle} variant={variant}>
          {title}
        </SheetItemTitle>
        {description != null ? (
          <RNText className="text-muted text-left text-sm leading-[1.375]">{description}</RNText>
        ) : null}
      </View>
      {trailing}
    </HStack>
  );
}

/**
 * Row tint for a menu item's state. `variant="danger"` only colours
 * text, so a failed row (red) or a caution row (yellow) gets its whole
 * background tinted to read at a glance. The description still carries the
 * meaning for screen readers; colour alone is not an accessibility signal.
 */
export function MenuRowTint({
  tone,
  disabled = false,
  children,
}: {
  tone: 'failed' | 'caution' | undefined;
  /** A disabled row is already dimmed; a caution tint on top would only add noise. */
  disabled?: boolean;
  children: ReactNode;
}) {
  if (!tone || (tone === 'caution' && disabled)) return <>{children}</>;
  return (
    <View className={`${tone === 'failed' ? 'bg-danger/10' : 'bg-warning/15'} mx-1 rounded-2xl`}>
      {children}
    </View>
  );
}
