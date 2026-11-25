/**
 * Generic action-menu custom sheet — a "pick one of N" list routed through
 * `PopupHost`'s sheet, so it shares the popup lane's open/close sequencing
 * (a follow-on sheet opened from an item replaces this one). The send-flow
 * amount screen's "as Lightning" / "as Ecash" chooser opens here through
 * `ActionMenuButton presentation="bottom-sheet"`.
 *
 * Renders plain `ActionMenuItem`s (no inputs / sections — those stay in the
 * `actionMenuPopup` lane). Each item's `onPress` receives the sheet `close`.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import Icon from 'assets/icons';
import { MenuItem, MenuRowTint, MenuTitle, SheetMenuRowContent } from './sheetMenuRow';
import { log } from '@/shared/lib/logger';
import { E2EActionMenuRenderMarker, E2EActionMenuTargetMarker } from '../E2EActionMenuProbe';

import { showActionSheet } from './bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

interface ActionMenuSheetContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['action-menu'];
}

type ActionMenuSheetButton = ActionSheetPayloads['action-menu']['buttons'][number];

async function runSheetAction(button: ActionMenuSheetButton, close: () => void): Promise<void> {
  try {
    await button.onPress?.(close);
  } catch (error) {
    log.error('ui.action_menu.sheet.action_failed', {
      testID: button.testID,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Mirror the menu-lane host: auto-dismiss unless the item
    // deliberately keeps the surface open to swap content.
    if (button.keepOpen !== true) close();
  }
}

export function ActionMenuSheetContent({ payload, close }: ActionMenuSheetContentProps) {
  const { title, buttons, onDismiss } = payload;

  useEffect(() => {
    log.info('ui.action_menu.sheet.presented', {
      title,
      buttonCount: buttons.length,
    });
  }, [title, buttons.length]);

  // Distinguish a button pick from a swipe/overlay dismiss so an awaiting caller
  // (e.g. the onchain fee picker) can resolve as cancelled on genuine dismiss.
  const pickedRef = useRef(false);
  useEffect(
    () => () => {
      if (!pickedRef.current) onDismiss?.();
    },
    [onDismiss]
  );

  return (
    <View>
      <E2EActionMenuRenderMarker presentationKey={payload} />
      {title ? <MenuTitle>{title}</MenuTitle> : null}
      {buttons.map((button) => {
        const disabled = button.disabled === true || button.isFailed === true;
        const description = button.disabled
          ? (button.reason ?? button.description)
          : button.description;
        const isDanger = button.isFailed === true || button.variant === 'dangerous';
        return (
          <MenuRowTint
            key={button.testID}
            tone={button.isFailed ? 'failed' : button.isCaution ? 'caution' : undefined}
            disabled={button.disabled === true}>
            <MenuItem
              testID={button.testID}
              accessibilityLabel={button.accessibilityLabel}
              accessibilityHint={button.accessibilityHint}
              isDisabled={disabled}
              isSelected={button.selected}
              variant={isDanger ? 'danger' : 'default'}
              onPress={() => {
                if (disabled) return;
                pickedRef.current = true;
                void runSheetAction(button, close);
              }}>
              <E2EActionMenuTargetMarker actionId={button.testID} disabled={disabled} />
              <SheetMenuRowContent
                icon={
                  button.iconNode ?? (button.icon ? <Icon name={button.icon} size={20} /> : null)
                }
                title={button.text}
                description={description || null}
                trailing={button.suffix ? <View>{button.suffix}</View> : null}
              />
            </MenuItem>
          </MenuRowTint>
        );
      })}
    </View>
  );
}

export function actionMenuSheet(payload: ActionSheetPayloads['action-menu']): void {
  log.info('ui.action_menu.sheet.dispatch', {
    title: payload.title,
    buttonCount: payload.buttons.length,
  });
  showActionSheet('action-menu', payload);
}
