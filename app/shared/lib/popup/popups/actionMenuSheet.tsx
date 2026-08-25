/**
 * Generic action-menu custom sheet — a "pick one of N" list routed through
 * `PopupHost`'s FullWindowOverlay-backed `<BottomSheet>` so it stacks ABOVE
 * iOS/Android route modals.
 *
 * Why this exists: `actionMenuPopup` → `<ActionMenuHost>` renders with
 * `disableFullWindowOverlay` (heroui `<Menu presentation="bottom-sheet">`
 * silently fails to mount under FWO). That's fine for menus opened from
 * regular screens, but the send-flow amount screen is itself an iOS route
 * modal — a menu-lane sheet paints in the root window, *below* the modal, and
 * is invisible. `ActionMenuButton presentation="bottom-sheet"` dispatches here
 * instead so the chooser (e.g. "as Lightning" / "as Ecash") appears on top.
 * Same lane, same reason as `paymentOptionsSheet`.
 *
 * Renders plain `ActionMenuItem`s (no inputs / sections — those stay in the
 * `actionMenuPopup` lane). Each item's `onPress` receives the sheet `close`.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { BottomSheet, Menu } from 'heroui-native';

import Icon from 'assets/icons';
import { SheetMenuRowContent } from './sheetMenuRow';
import { log } from '@/shared/lib/logger';
import { E2EActionMenuRenderMarker, E2EActionMenuTargetMarker } from '../E2EActionMenuProbe';

import { showActionSheet } from './bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

interface ActionMenuSheetContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['action-menu'];
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
      {title ? (
        <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
          {title}
        </BottomSheet.Title>
      ) : null}
      {/* A bare `<Menu>` gives `Menu.Item` the contexts it reads via
          `useMenu()` — no Trigger/Portal/Content needed; Menu.Root is just a
          context Provider. Same trick as `paymentOptionsSheet` / `modelPicker`. */}
      <Menu>
        {buttons.map((button, index) => {
          const disabled = button.disabled === true || button.isFailed === true;
          const description = button.disabled
            ? (button.reason ?? button.description)
            : button.description;
          const isDanger = button.isFailed === true || button.variant === 'dangerous';
          return (
            <Menu.Item
              key={button.testID ?? `${button.text}-${index}`}
              testID={button.testID}
              accessibilityLabel={button.accessibilityLabel}
              accessibilityHint={button.accessibilityHint}
              isDisabled={disabled}
              variant={isDanger ? 'danger' : 'default'}
              onPress={() => {
                if (disabled) return;
                pickedRef.current = true;
                void (async () => {
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
                })();
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
            </Menu.Item>
          );
        })}
      </Menu>
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
