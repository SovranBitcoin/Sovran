import { useCallback } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';

/**
 * CircleActionRow — a row of CircleActionButtons that self-manages overflow.
 *
 * Give it the full action list in priority order and it decides what to
 * render: while the list fits within `maxVisible` slots every action gets its
 * own circle button; past that, the tail collapses into a trailing "More"
 * button that opens the app-wide action-menu sheet (<ActionMenuHost />).
 * "More" occupies the last visible slot, so the overflow menu always holds at
 * least two actions — a one-item menu can never occur. With the default cap
 * of 3: two actions render as two buttons, three as three, and a fourth flips
 * the row to two buttons + More.
 */

export interface CircleRowAction {
  /** Monicon name (Android + pre-liquid-glass iOS fallback). */
  icon: string;
  /** SF Symbol name for the SwiftUI glass path (iOS 26+). */
  systemIcon?: string;
  /** Caption under the circle; also the menu row label unless `menuText` is set. */
  label: string;
  /** Longer label for the overflow menu row (e.g. "Balance split" vs "Split"). */
  menuText?: string;
  /** Secondary caption on the overflow menu row. Not shown on the circle. */
  description?: string;
  testID?: string;
  disabled?: boolean;
  onPress: () => void;
}

interface CircleActionRowProps {
  /** Actions in priority order — the head of the list keeps the direct slots. */
  actions: CircleRowAction[];
  /** Max visible circle buttons, counting "More" when it appears. */
  maxVisible?: number;
  /** Sheet title for the overflow menu. */
  moreTitle?: string;
  moreTestID?: string;
  style?: StyleProp<ViewStyle>;
}

export function CircleActionRow({
  actions,
  maxVisible = 3,
  moreTitle = 'Select option',
  moreTestID = 'circle-action-more',
  style,
}: CircleActionRowProps) {
  const direct = actions.length <= maxVisible ? actions : actions.slice(0, maxVisible - 1);
  const overflow = actions.slice(direct.length);

  const handleMore = useCallback(() => {
    actionMenuPopup({
      title: moreTitle,
      buttons: overflow.map((action) => ({
        text: action.menuText ?? action.label,
        icon: action.icon,
        description: action.description,
        testID: action.testID,
        disabled: action.disabled,
        onPress: () => action.onPress(),
      })),
    });
  }, [moreTitle, overflow]);

  return (
    <HStack justify="space-around" style={style}>
      {direct.map((action) => (
        <CircleActionButton
          key={action.testID ?? action.label}
          icon={action.icon}
          systemIcon={action.systemIcon}
          label={action.label}
          testID={action.testID}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ))}
      {overflow.length > 0 ? (
        <CircleActionButton
          icon="tabler:dots"
          systemIcon="ellipsis"
          label="More"
          testID={moreTestID}
          onPress={handleMore}
        />
      ) : null}
    </HStack>
  );
}
