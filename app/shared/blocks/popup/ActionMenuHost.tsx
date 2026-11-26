/**
 * Mounts a single action-menu sheet driven by the imperative
 * `actionMenuPopup()` helper. Place once in the app root tree next to
 * `<PopupHost />` so any code path (hooks, callbacks, deep navigation) can
 * open an action menu without needing a local trigger in scope.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';
import { alpha } from '@/shared/styles/tokens';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Sheet, SheetScrollView } from '@/shared/ui/composed/Sheet';
import {
  dismissActionMenuPopup,
  getActionMenuSnapshot,
  type ActionMenuPayload,
  useActionMenuPayload,
  type ActionMenuItem,
  type ActionMenuInput,
  type ActionMenuPrimaryAction,
} from '@/shared/lib/popup/popups/actionMenu';
import Icon from 'assets/icons';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { markE2EHerouiMenu } from '@/shared/lib/popup/E2EActionMenuProbe';
import {
  MenuItem,
  MenuRowTint,
  MenuTitle,
  SheetMenuRowContent,
} from '@/shared/lib/popup/popups/sheetMenuRow';

const hostLog = log.child({ module: 'actionMenuHost' });

function buildInitialValues(inputs: ActionMenuInput[] | undefined): Record<string, string> {
  if (!inputs) return {};
  const result: Record<string, string> = {};
  for (const input of inputs) {
    result[input.id] = input.initialValue ?? '';
  }
  return result;
}

async function runPrimaryAction(
  action: ActionMenuPrimaryAction,
  ctx: {
    inputValues: Record<string, string>;
    isSubmitting: boolean;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
    selectedRef: React.MutableRefObject<boolean>;
    close: (afterClose?: () => void) => void;
  }
): Promise<void> {
  const { inputValues, isSubmitting, setError, setIsSubmitting, selectedRef, close } = ctx;
  if (isSubmitting) return;
  setError(null);
  setIsSubmitting(true);
  try {
    await action.onPress(inputValues, {
      setError,
      close: (afterClose) => {
        selectedRef.current = true;
        close(afterClose);
      },
    });
  } finally {
    setIsSubmitting(false);
  }
}

/** A menu form input: 1.5pt border, accent when focused, danger when invalid. */
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

  const borderColor = isInvalid ? dangerBorder : isFocused ? accentBorder : defaultBorder;

  return (
    <View>
      {input.description ? (
        <Text className="text-foreground/70 mb-2 text-sm">{input.description}</Text>
      ) : null}
      {input.label ? (
        <Text className="text-foreground mb-1 text-sm font-medium">{input.label}</Text>
      ) : null}
      <TextInput
        testID={`action-menu-input-${input.id}`}
        accessibilityLabel={
          input.accessibilityLabel ?? input.label ?? input.placeholder ?? input.id
        }
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={input.placeholder}
        placeholderTextColor={placeholder}
        autoCapitalize={input.autoCapitalize}
        autoCorrect={input.autoCorrect}
        keyboardType={input.keyboardType}
        secureTextEntry={input.secureTextEntry}
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
  const { payload, seq } = useActionMenuPayload();
  // A fresh instance (form, selection) for every request, even mid-close.
  return <ActionMenuInstance key={seq} currentPayload={payload} seq={seq} />;
}

function ActionMenuInstance({
  currentPayload,
  seq,
}: {
  currentPayload: ActionMenuPayload | null;
  seq: number;
}) {
  // Keep the last content while the sheet animates away.
  const [payload, setPayload] = useState(currentPayload);
  if (currentPayload && currentPayload !== payload) setPayload(currentPayload);
  const isOpen = currentPayload !== null;
  const [closed, setClosed] = useState(!isOpen);
  const [presented, setPresented] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);
  // Preserve the existing handlers' identity while binding their async
  // callbacks to this request generation.
  const isCurrent = useCallback(
    () => liveRef.current && getActionMenuSnapshot().seq === seq,
    [seq]
  );

  // Content padding stops at the sheet edge (`pb-0`); layouts add the inset back.
  const insets = useSafeAreaInsets();
  // The footer gradient tapers to the sheet surface (`bg-overlay`).
  const [overlay] = useThemeColor(['overlay'] as const);
  const scrimColor =
    useColorScheme() === 'light'
      ? `rgba(255,255,255,${alpha.strong})`
      : `rgba(0,0,0,${alpha.strong})`;

  // A pick skips onDismiss; a scrim tap or swipe fires it.
  const selectedRef = useRef(false);
  const activeDismissRef = useRef<(() => void) | null>(null);
  // A successor waits for this sheet to finish closing.
  const afterCloseRef = useRef<(() => void) | null>(null);

  const [inputValues, setInputValues] = useState<Record<string, string>>(() =>
    buildInitialValues(payload?.inputs)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    hostLog.info('actionMenuHost.payload', {
      open: payload !== null,
      buttons: payload?.buttons?.length ?? 0,
      footerButtons: payload?.footerButtons?.length ?? 0,
      snapPoint: payload?.snapPoint,
    });
    if (payload) {
      selectedRef.current = false;
      activeDismissRef.current = payload.onDismiss ?? null;
      setInputValues(buildInitialValues(payload.inputs));
      setError(null);
      setIsSubmitting(false);
    }
  }, [payload]);

  // Mirror the live request into the existing non-secret accessibility probe.
  useEffect(() => {
    markE2EHerouiMenu(isOpen ? (payload?.title ?? '') : null);
    return () => markE2EHerouiMenu(null);
  }, [isOpen, payload?.title]);

  const close = useCallback(
    (afterClose?: () => void) => {
      if (!isCurrent()) return;
      if (afterCloseRef.current == null) afterCloseRef.current = afterClose ?? null;
      dismissActionMenuPopup();
    },
    [isCurrent]
  );

  // A swipe down or a scrim tap.
  const handleDismissRequest = useCallback(() => {
    if (!isCurrent()) return;
    hostLog.info('actionMenuHost.openChange', { open: false, selected: selectedRef.current });
    const picked = selectedRef.current;
    const onDismiss = activeDismissRef.current;
    activeDismissRef.current = null;
    dismissActionMenuPopup();
    if (!picked && onDismiss) onDismiss();
  }, [isCurrent]);

  const handleItemPress = useCallback(
    (button: ActionMenuItem): void => {
      if (!isCurrent() || !getActionMenuSnapshot().payload || button.disabled || button.isFailed)
        return;
      selectedRef.current = true;
      // `keepOpen` items swap the content in place (their onPress sets the
      // chained payload synchronously); everything else closes on press.
      if (!button.keepOpen) dismissActionMenuPopup();
      void button.onPress?.(close);
    },
    [isCurrent, close]
  );

  const handlePrimaryPressInner = useCallback(
    (action: ActionMenuPrimaryAction) => {
      if (!isCurrent() || !getActionMenuSnapshot().payload) return Promise.resolve();
      return runPrimaryAction(action, {
        inputValues,
        isSubmitting,
        setError,
        setIsSubmitting,
        selectedRef,
        close,
      });
    },
    [inputValues, isSubmitting, close, isCurrent]
  );

  // `isSubmitting` is state, so a fast double-tap (Import-Nsec, Claim Username)
  // would run `action.onPress` twice; the synchronous guard drops the second.
  const handlePrimaryPress = useSingleFlight(handlePrimaryPressInner);

  // Defaults-merged input values — when a chained payload introduces
  // new input keys (e.g. profile-switcher → "Import Nostr" with `nsec`),
  // `inputValues` still holds the *previous* payload's keys for one
  // render before the `useEffect` above resets it. Without this merge,
  // `isDisabled({})` dereferences `v.nsec.trim()` and throws.
  const safeInputValues = payload?.inputs
    ? { ...buildInitialValues(payload.inputs), ...inputValues }
    : inputValues;

  const primaryDisabled =
    payload?.primaryAction?.isDisabled?.(safeInputValues) === true || isSubmitting;

  // `hasFooter` pins `<BottomButtons>` over the sheet's bottom edge (above the
  // keyboard). `useScrollBody`: a long list at a fixed height with sticky
  // footer rows (AI conversations); input forms only have `primaryAction`.
  const hasFooter = !!payload?.footerButtons?.length || !!payload?.primaryAction;
  const useScrollBody = !!payload?.footerButtons?.length;

  // Measured footer height, so the last row clears the pinned footer.
  const [footerHeight, setFooterHeight] = useState(0);
  const contentBottomInset = hasFooter
    ? footerHeight > 0
      ? footerHeight + 16
      : insets.bottom + 2 * 56
    : 24;
  const handleFooterLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setFooterHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  useEffect(() => {
    if (!hasFooter) setFooterHeight(0);
  }, [hasFooter]);

  // Explicit height wins; footer lists 60%, input forms 40%, pickers fit content.
  const snapPoint =
    payload?.snapPoint ?? (payload?.footerButtons?.length ? '60%' : hasFooter ? '40%' : undefined);

  const renderActionButton = (button: ActionMenuItem, key: React.Key): React.ReactNode => {
    const isDisabled = button.disabled === true || button.isFailed === true;
    const isDanger = button.variant === 'dangerous' || button.isFailed === true;
    const descriptionText = button.isFailed
      ? (button.reason ?? 'Failed')
      : isDisabled
        ? button.reason
        : button.description;
    return (
      <React.Fragment key={key}>
        {button.separator ? <View className="bg-foreground/10 mx-3 my-1 h-px" /> : null}
        {/* `variant="danger"` only tints the title/description text; a
            failed payment row needs the whole row red so it reads "tried,
            broke" at a glance instead of competing visually with neighbouring
            "Recommended" items. The description prefix ("Failed: ...") stays
            for screen readers — colour alone is not an accessibility signal. */}
        <MenuRowTint
          tone={button.isFailed ? 'failed' : button.isCaution ? 'caution' : undefined}
          disabled={button.disabled === true}>
          <MenuItem
            testID={button.testID}
            accessibilityLabel={button.accessibilityLabel}
            accessibilityHint={button.accessibilityHint}
            isDisabled={isDisabled}
            isSelected={button.selected}
            variant={isDanger ? 'danger' : 'default'}
            onPress={() => handleItemPress(button)}>
            <SheetMenuRowContent
              singleLineTitle={false}
              icon={button.iconNode ?? (button.icon ? <Icon name={button.icon} size={20} /> : null)}
              title={button.text}
              description={descriptionText || undefined}
              trailing={button.suffix ? <View>{button.suffix}</View> : undefined}
            />
          </MenuItem>
        </MenuRowTint>
      </React.Fragment>
    );
  };

  const labelNode = payload?.title ? <MenuTitle>{payload.title}</MenuTitle> : null;

  const headerNode = payload?.header ? <View className="mb-2">{payload.header}</View> : null;

  const buttonsNode = payload?.buttons?.length
    ? payload.buttons.map((b) => renderActionButton(b, `b-${b.testID}`))
    : null;

  const inputsNode =
    payload?.inputs && payload.inputs.length > 0 ? (
      <View className="px-3 pb-3 pt-1">
        <VStack gap={16}>
          {payload.inputs.map((input) => (
            <MenuInputField
              key={input.id}
              input={input}
              value={inputValues[input.id] ?? ''}
              isInvalid={!!error}
              onChangeText={(next) => setInputValues((prev) => ({ ...prev, [input.id]: next }))}
            />
          ))}
          {error ? <Text className="text-danger text-sm">{error}</Text> : null}
        </VStack>
      </View>
    ) : null;

  const footerButtonsNode = payload?.footerButtons?.length
    ? payload.footerButtons.map((b) => renderActionButton(b, `fb-${b.testID}`))
    : null;

  const primaryActionNode = payload?.primaryAction ? (
    <>
      <View className="bg-foreground/10 mx-3 my-1 h-px" />
      <MenuItem
        testID={payload.primaryAction.testID ?? 'action-menu-submit'}
        isDisabled={primaryDisabled}
        accessibilityState={{ disabled: primaryDisabled, busy: isSubmitting }}
        onPress={() => {
          void handlePrimaryPress(payload.primaryAction!);
        }}>
        <SheetMenuRowContent
          singleLineTitle={false}
          icon={
            payload.primaryAction.icon ? <Icon name={payload.primaryAction.icon} size={20} /> : null
          }
          title={
            isSubmitting
              ? (payload.primaryAction.loadingText ?? payload.primaryAction.text)
              : payload.primaryAction.text
          }
        />
      </MenuItem>
    </>
  ) : null;

  // `<BottomButtons>`' gradient/blur recipe (as on Receive), laid out in flow.
  const footer = hasFooter ? (
    <BottomButtons
      gradientColor={String(overlay)}
      style={{
        position: 'relative',
        bottom: undefined,
        left: undefined,
        right: undefined,
        width: undefined,
        // Match the list's `paddingHorizontal: 12` so the footer rows
        // left-align with the rows above (and with the title's `ml-3`).
        paddingHorizontal: 12,
      }}
      onLayout={handleFooterLayout}>
      {footerButtonsNode}
      {primaryActionNode}
    </BottomButtons>
  ) : undefined;

  const handleClosed = useCallback(() => {
    if (!liveRef.current) return;
    // A request still showing here was closed some other way; clear it so
    // imperative state cannot remain orphaned.
    const onDismiss = activeDismissRef.current;
    activeDismissRef.current = null;
    if (isCurrent() && getActionMenuSnapshot().payload !== null) {
      dismissActionMenuPopup();
      if (!selectedRef.current) onDismiss?.();
    }
    setClosed(true);
    const afterClose = afterCloseRef.current;
    afterCloseRef.current = null;
    afterClose?.();
  }, [isCurrent]);

  if (closed || !payload) return null;

  return (
    <Sheet
      open={isOpen}
      onDismissRequest={handleDismissRequest}
      onPresented={() => setPresented(true)}
      onClosed={handleClosed}
      height={snapPoint as `${number}%` | undefined}
      footer={footer}
      scrimColor={scrimColor}
      scrimTestID="action-menu-dismiss"
      scrimLabel="Dismiss menu"
      contentClassName={useScrollBody ? 'flex-1 px-0 pt-0 pb-0' : 'px-3 pt-2 pb-0'}>
      {__DEV__ && presented && isOpen ? (
        <E2EAccessibilityProbe
          testID="action-menu-presented"
          accessibilityLabel="Action menu presented"
        />
      ) : null}
      {useScrollBody ? (
        <>
          {/* Sticky title — outside the scroll viewport so it isn't clipped
              as the list scrolls. `paddingHorizontal: 12` matches the list
              so the title's `ml-3` aligns with the rows. */}
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            {labelNode}
            {headerNode}
          </View>
          <SheetScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 12,
              // Pad past the measured footer so the last row clears it.
              paddingBottom: contentBottomInset,
            }}
            showsVerticalScrollIndicator={false}>
            {buttonsNode}
            {inputsNode}
          </SheetScrollView>
        </>
      ) : (
        // Pad by the pinned footer's height, or clear the home indicator.
        <View
          style={{
            paddingBottom: hasFooter ? contentBottomInset : insets.bottom + 20,
          }}>
          {labelNode}
          {headerNode}
          {buttonsNode}
          {inputsNode}
          {!hasFooter ? primaryActionNode : null}
        </View>
      )}
    </Sheet>
  );
}
