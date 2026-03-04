/**
 * @fileoverview ButtonHandlerContent - Dynamic button action interface
 *
 * @description
 * Displays dynamic button actions with processing states and custom styling.
 * Supports async operations, button reordering (Next buttons last), and
 * disabled states during processing.
 *
 * **Flow:** Display buttons → user selects → execute action → close
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import opacity from 'hex-color-opacity';
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SheetContent } from '../SheetContent';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';

const STICKY_FOOTER_SAFE_PADDING_BOTTOM = 16;

interface ButtonHandlerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['button-handler'];
}

export function ButtonHandlerContent({
  payload,
  close,
  pushCustomPage,
  canPop,
  setFooterConfig,
}: ButtonHandlerContentProps) {
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);
  const [processingButtonIndex, setProcessingButtonIndex] = useState<number>();

  const reorderedButtons = useMemo(
    () => [
      ...payload.buttons.filter((button) => button.text !== 'Next'),
      ...payload.buttons.filter((button) => button.text === 'Next'),
    ],
    [payload.buttons]
  );

  const handleButtonPress = useCallback(
    (index: number) => {
      const button = reorderedButtons[index];
      if (!button) return;
      setProcessingButtonIndex(index);

      if (button.pushSheet) {
        pushCustomPage(button.pushSheet.sheetId, button.pushSheet.payload);
        setProcessingButtonIndex(undefined);
        return;
      }

      const result = button.onPress?.(() => {
        close();
      });

      if (result && typeof result.then === 'function') {
        result.finally(() => {
          setProcessingButtonIndex(undefined);
        });
      } else {
        setProcessingButtonIndex(undefined);
        close();
      }
    },
    [close, pushCustomPage, reorderedButtons]
  );

  useEffect(() => {
    if (!canPop) {
      setFooterConfig(null);
      return;
    }

    setFooterConfig({
      buttons: reorderedButtons.map((button, index) => {
        const isProcessing = processingButtonIndex !== undefined;
        const isDisabled = button.disabled || (isProcessing && processingButtonIndex !== index);

        return {
          label: processingButtonIndex === index ? `${button.text}...` : button.text,
          variant: index === 0 ? 'primary' : 'tertiary',
          isDisabled,
          onPress: () => handleButtonPress(index),
        };
      }),
    });

    return () => setFooterConfig(null);
  }, [canPop, setFooterConfig, reorderedButtons, processingButtonIndex, handleButtonPress]);

  return (
    <SheetContent
      title={payload.title || 'Select action'}
      description={payload.description}
      scrollProps={{
        contentContainerStyle: { paddingBottom: canPop ? STICKY_FOOTER_SAFE_PADDING_BOTTOM : 12 },
        enableFooterMarginAdjustment: canPop,
      }}>
      <ListGroup variant="secondary">
        {reorderedButtons.map((button, i) => {
          const isDangerous = button.variant === 'dangerous';

          return (
            <PressableFeedback
              key={i}
              animation={false}
              onPress={() => handleButtonPress(i)}
              isDisabled={processingButtonIndex !== undefined}>
              <PressableFeedback.Scale>
                <ListGroup.Item testID={button.testID} disabled>
                  <ListGroup.ItemPrefix>
                    <View
                      className="rounded-full p-1"
                      style={{ backgroundColor: opacity(muted, 0.25) }}>
                      {button.icon ? (
                        <Icon
                          color={isDangerous ? danger : foreground}
                          name={button.icon}
                          size={24}
                        />
                      ) : (
                        <Icon
                          color={isDangerous ? danger : foreground}
                          name="mdi:gesture-tap-button"
                          size={24}
                        />
                      )}
                    </View>
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>
                      {processingButtonIndex === i ? `${button.text}...` : button.text}
                    </ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          );
        })}
      </ListGroup>
    </SheetContent>
  );
}
