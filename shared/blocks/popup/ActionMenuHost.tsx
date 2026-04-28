/**
 * Mounts a single controlled heroui-native Menu driven by the imperative
 * `actionMenuPopup()` helper. Place once in the app root tree next to
 * `<PopupHost />` so any code path (hooks, callbacks, deep navigation) can
 * open an action menu without needing a local Trigger in scope.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Menu } from 'heroui-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  dismissActionMenuPopup,
  useActionMenuPayload,
  type ActionMenuButton,
  type ActionMenuInput,
  type ActionMenuPrimaryAction,
} from '@/shared/lib/popup/popups/actionMenu';
import Icon from 'assets/icons';

function buildInitialValues(inputs: ActionMenuInput[] | undefined): Record<string, string> {
  if (!inputs) return {};
  const result: Record<string, string> = {};
  for (const input of inputs) {
    result[input.id] = input.initialValue ?? '';
  }
  return result;
}

/**
 * Why `BottomSheetTextInput` instead of heroui's `<Input>`:
 *
 * Gorhom's keyboard avoidance is a pull system, not a push system. It only
 * lifts the sheet when a TextInput it knows about is focused. Registration
 * happens in `BottomSheetTextInput` (gorhom): on mount it adds the input's
 * node handle to `textInputNodesRef` (from `useBottomSheetInternal`); on focus
 * it sets `animatedKeyboardState.target = nativeEvent.target`. Without that
 * target, gorhom's keyboard listener (`useAnimatedKeyboard.ts`) caches the
 * keyboard event and bails — so even with `keyboardBehavior` set, the sheet
 * never moves.
 *
 * Heroui's `<Input>` is a plain RN `<TextInput>` that doesn't touch any of
 * those refs. A wrapper that mimics the registration in JS is fragile because
 * `findNodeHandle` semantics differ between RN's TextInput and gesture-
 * handler's wrapped TextInput (which is what `BottomSheetTextInput` renders),
 * and the Fabric / new-architecture node-handle resolution doesn't always
 * line up. Using `BottomSheetTextInput` directly is the pattern gorhom
 * documents and the only reliable way to get the sheet to lift.
 *
 * Heroui's secondary-variant input styling is reproduced inline below so the
 * input looks the same as anywhere else in the app.
 */
function MenuInputField({
  input,
  value,
  isInvalid,
  onChangeText,
}: {
  input: ActionMenuInput;
  value: string;
  isInvalid: boolean;
  onChangeText: (next: string) => void;
}) {
  const [foreground, defaultBg, defaultBorder, dangerBorder, accentBorder, placeholder] =
    useThemeColor([
      'foreground',
      'default',
      'default',
      'danger',
      'accent',
      'field-placeholder',
    ] as const);
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = isInvalid
    ? dangerBorder
    : isFocused
      ? accentBorder
      : defaultBorder;

  return (
    <View>
      {input.description ? (
        <Text className="text-foreground/70 text-sm mb-2">{input.description}</Text>
      ) : null}
      {input.label ? (
        <Text className="text-foreground text-sm font-medium mb-1">{input.label}</Text>
      ) : null}
      <BottomSheetTextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={input.placeholder}
        placeholderTextColor={placeholder}
        autoCapitalize={input.autoCapitalize}
        autoCorrect={input.autoCorrect}
        secureTextEntry={input.secureTextEntry}
        // Mirror heroui Input's secondary variant: py-3.5 px-3 rounded-2xl
        // border-[1.5px] bg-default border-default focus:border-accent.
        style={{
          paddingVertical: 14,
          paddingHorizontal: 12,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor,
          backgroundColor: defaultBg,
          color: foreground,
          fontSize: 16,
          borderCurve: 'continuous',
        }}
      />
    </View>
  );
}

export function ActionMenuHost() {
  const payload = useActionMenuPayload();
  const isOpen = payload !== null;

  // Track whether the current open cycle received a selection so we can
  // distinguish user-pick (skip onDismiss) from overlay-tap / swipe-close (fire it).
  const selectedRef = useRef(false);
  const activeDismissRef = useRef<(() => void) | null>(null);
  // Set when an item with `keepOpen` is tapped — tells handleOpenChange to
  // ignore heroui's "close after item press" call so the chained payload
  // (set synchronously by onPress) stays visible instead of being dismissed.
  const stayOpenRef = useRef(false);

  const [inputValues, setInputValues] = useState<Record<string, string>>(() =>
    buildInitialValues(payload?.inputs)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (payload) {
      selectedRef.current = false;
      activeDismissRef.current = payload.onDismiss ?? null;
      setInputValues(buildInitialValues(payload.inputs));
      setError(null);
      setIsSubmitting(false);
    }
  }, [payload]);

  const handleOpenChange = useCallback((open: boolean): void => {
    if (open) {
      stayOpenRef.current = false;
      return;
    }
    if (stayOpenRef.current) {
      stayOpenRef.current = false;
      return;
    }
    const picked = selectedRef.current;
    const onDismiss = activeDismissRef.current;
    activeDismissRef.current = null;
    dismissActionMenuPopup();
    if (!picked && onDismiss) onDismiss();
  }, []);

  const handleItemPress = useCallback((button: ActionMenuButton): void => {
    if (button.disabled || button.isFailed) return;
    selectedRef.current = true;
    if (button.keepOpen) {
      stayOpenRef.current = true;
    } else {
      dismissActionMenuPopup();
    }
    void button.onPress?.(() => dismissActionMenuPopup());
  }, []);

  const handlePrimaryPress = useCallback(
    async (action: ActionMenuPrimaryAction): Promise<void> => {
      if (isSubmitting) return;
      setError(null);
      setIsSubmitting(true);
      try {
        await action.onPress(inputValues, {
          setError,
          close: () => {
            selectedRef.current = true;
            dismissActionMenuPopup();
          },
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [inputValues, isSubmitting]
  );

  const primaryDisabled =
    payload?.primaryAction?.isDisabled?.(inputValues) === true || isSubmitting;

  return (
    <Menu presentation="bottom-sheet" isOpen={isOpen} onOpenChange={handleOpenChange}>
      {/*
       * Bottom-sheet presentation ignores Trigger position, but heroui still
       * requires a Trigger in the tree. A zero-size, offscreen Pressable
       * satisfies the API without visually affecting anything.
       */}
      <Menu.Trigger style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
        <View style={{ width: 1, height: 1 }} />
      </Menu.Trigger>
      {/*
       * disableFullWindowOverlay: by default Menu.Portal wraps content in
       * react-native-screens' FullWindowOverlay on iOS (a separate UIWindow
       * above the RN root). @gorhom/bottom-sheet's keyboard avoidance can't
       * lift content rendered in that window — the input would stay pinned
       * behind the keyboard. Rendering in the normal React tree fixes it.
       * Tradeoff: the menu won't appear above native modals (we don't open
       * any from inside the menu).
       */}
      <Menu.Portal disableFullWindowOverlay>
        <Menu.Overlay />
        <Menu.Content
          presentation="bottom-sheet"
          // `interactive` lifts the sheet by the keyboard height — works with
          // dynamic sizing because position becomes (highestDetent − keyboardHeight),
          // which is strictly higher than the natural content-fit position.
          // `extend` would snap to highestDetentPosition, which equals the
          // current position under enableDynamicSizing → no-op.
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize">
          {payload?.title ? (
            <Menu.Label className="text-foreground mb-2 ml-3 -mt-2 text-lg font-bold">
              {payload.title}
            </Menu.Label>
          ) : null}
          {payload?.header ? <View className="mb-2">{payload.header}</View> : null}
          {payload?.buttons?.map((button, i) => {
            const isDisabled = button.disabled === true || button.isFailed === true;
            const isDanger = button.variant === 'dangerous' || button.isFailed === true;
            const descriptionText = button.isFailed
              ? (button.reason ?? 'Failed')
              : isDisabled
                ? button.reason
                : button.description;
            return (
              <React.Fragment key={i}>
                {button.separator ? (
                  <View className="bg-foreground/10 mx-3 my-1 h-px" />
                ) : null}
                <Menu.Item
                  testID={button.testID}
                  isDisabled={isDisabled}
                  variant={isDanger ? 'danger' : 'default'}
                  onPress={() => handleItemPress(button)}>
                  <HStack align="center" gap={10} style={{ flex: 1 }}>
                    {button.icon ? <Icon name={button.icon} size={20} /> : null}
                    <View style={{ flex: 1 }}>
                      <Menu.ItemTitle>{button.text}</Menu.ItemTitle>
                      {descriptionText ? (
                        <Menu.ItemDescription>{descriptionText}</Menu.ItemDescription>
                      ) : null}
                    </View>
                    {button.suffix ? <View>{button.suffix}</View> : null}
                  </HStack>
                </Menu.Item>
              </React.Fragment>
            );
          })}
          {payload?.inputs && payload.inputs.length > 0 ? (
            <View className="px-3 pb-3 pt-1">
              <VStack spacing={16}>
                {payload.inputs.map((input) => (
                  <MenuInputField
                    key={input.id}
                    input={input}
                    value={inputValues[input.id] ?? ''}
                    isInvalid={!!error}
                    onChangeText={(next) =>
                      setInputValues((prev) => ({ ...prev, [input.id]: next }))
                    }
                  />
                ))}
                {error ? <Text className="text-danger text-sm">{error}</Text> : null}
              </VStack>
            </View>
          ) : null}
          {payload?.primaryAction ? (
            <>
              <View className="bg-foreground/10 mx-3 my-1 h-px" />
              <Menu.Item
                testID={payload.primaryAction.testID}
                isDisabled={primaryDisabled}
                onPress={() => {
                  void handlePrimaryPress(payload.primaryAction!);
                }}>
                <HStack align="center" gap={10} style={{ flex: 1 }}>
                  {payload.primaryAction.icon ? (
                    <Icon name={payload.primaryAction.icon} size={20} />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Menu.ItemTitle>
                      {isSubmitting
                        ? (payload.primaryAction.loadingText ?? payload.primaryAction.text)
                        : payload.primaryAction.text}
                    </Menu.ItemTitle>
                  </View>
                </HStack>
              </Menu.Item>
            </>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
