/**
 * The rows every Settings page is built from, inside a `ListGroup`:
 *
 * - `SettingsListActionItem`: a row that does something when tapped.
 * - `SettingsListLinkItem`: a row that opens another page.
 * - `SettingsToggleItem`: a row whose whole width flips a switch.
 *
 * Each row is ONE control. The switch in a toggle row is drawn, not pressed:
 * it is hidden from screen readers and takes no touches, so VoiceOver and
 * TalkBack read the row once, as a switch with its state.
 */
import type React from 'react';
import { type Href } from 'expo-router';
import { ListGroup, PressableFeedback } from 'heroui-native';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Switch } from '@/shared/ui/primitives/Switch';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

type SettingsListActionItemProps = {
  title: string;
  description?: string;
  descriptionNumberOfLines?: number;
  onPress: () => void;
  isDanger?: boolean;
  testID?: string;
};

export const SettingsListActionItem: React.FC<SettingsListActionItemProps> = ({
  title,
  description,
  descriptionNumberOfLines,
  onPress,
  isDanger,
  testID,
}) => {
  const danger = useThemeColor('danger');
  return (
    <PressableFeedback
      animation={false}
      testID={testID}
      // `accessible` is explicit rather than gated on `testID`: RN's Pressable
      // already defaults it to true, so the gate never did anything — stating
      // it keeps the "one actionable outer row" invariant visible.
      accessible
      // Keep semantics independent of instrumentation. When the explicit label
      // is absent, RN synthesizes the same "title, description" string.
      accessibilityRole="button"
      accessibilityLabel={testID ? `${title}${description ? `, ${description}` : ''}` : undefined}
      onPress={onPress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>
              {isDanger ? <Text color={danger}>{title}</Text> : title}
            </ListGroup.ItemTitle>
            {description ? (
              <ListGroup.ItemDescription numberOfLines={descriptionNumberOfLines}>
                {description}
              </ListGroup.ItemDescription>
            ) : null}
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
};

export const SettingsListLinkItem: React.FC<
  Omit<SettingsListActionItemProps, 'onPress'> & { href: Href }
> = ({ href, ...item }) => (
  <SettingsListActionItem {...item} onPress={() => router.navigate(href)} />
);

type SettingsToggleItemProps = {
  title: string;
  description?: string;
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
  testID?: string;
  /** Drawn at the row's leading edge, e.g. a health dot. */
  prefix?: React.ReactNode;
  /** Drawn beside the title, e.g. a health badge. */
  status?: React.ReactNode;
  /** Read in place of the title, when the title alone is ambiguous. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Visible but dimmed; a tap does nothing. Say why with `disabledReason`. */
  disabled?: boolean;
  /** Shown under the title while `disabled`, in place of the description. */
  disabledReason?: string;
};

export const SettingsToggleItem: React.FC<SettingsToggleItemProps> = ({
  title,
  description,
  isSelected,
  onSelectedChange,
  testID,
  prefix,
  status,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  disabledReason,
}) => {
  const shownDescription = disabled && disabledReason ? disabledReason : description;
  return (
    <PressableFeedback
      animation={false}
      onPress={disabled ? undefined : () => onSelectedChange(!isSelected)}
      isDisabled={disabled}
      testID={testID}
      accessible
      // Role and checked-state are unconditional — without them a screen reader
      // cannot tell a toggle from static text, nor read whether it is on. They
      // must not depend on whether the row is instrumented.
      // `accessibilityValue` is dropped: RN derives the iOS 1/0 value from the
      // switch role plus `checked`, and Android exposes the checked state.
      accessibilityRole="switch"
      accessibilityState={disabled ? { checked: isSelected, disabled } : { checked: isSelected }}
      accessibilityLabel={accessibilityLabel ?? (testID ? title : undefined)}
      accessibilityHint={accessibilityHint}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled className={disabled ? 'opacity-50' : undefined}>
          {prefix ? <ListGroup.ItemPrefix>{prefix}</ListGroup.ItemPrefix> : null}
          <ListGroup.ItemContent>
            {status ? (
              <View className="flex-row items-center gap-2">
                <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
                {status}
              </View>
            ) : (
              <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
            )}
            {shownDescription ? (
              <ListGroup.ItemDescription>{shownDescription}</ListGroup.ItemDescription>
            ) : null}
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            {/* Drawn only: the row is the control, so the switch takes no touches
                and is not a second element for a screen reader. */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Switch isSelected={isSelected} isDisabled={disabled} />
            </View>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
};
