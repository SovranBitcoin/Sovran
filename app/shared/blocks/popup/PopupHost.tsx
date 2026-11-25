import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Log, log } from '@/shared/lib/logger';
import { TouchIndicatorLayer } from '@/shared/ui/composed/TouchIndicator';
import { Keyboard, Text as RNText, View } from 'react-native';
import { Button } from '@/shared/ui/primitives/Button';
import { PillButton } from '@/shared/ui/primitives/PillButton';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Sheet } from '@/shared/ui/composed/Sheet';
import { ToastHost } from '@/shared/ui/composed/ToastHost';
import {
  usePopupStore,
  isCustomSheetPayload,
  type StandardSheetPayload,
} from '@/shared/stores/runtime/popupStore';
import { blend, sanitize } from '@/shared/lib/color';
import {
  resolvePopupIcon,
  isAmountSegment,
  type PopupTextSegment,
  type ActionSheetPayloads,
} from '@/shared/lib/popup';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha } from '@/shared/styles/tokens';
import { ActionMenuSheetContent } from '@/shared/lib/popup/popups/actionMenuSheet';
import { markE2EActionMenuPresented } from '@/shared/lib/popup/E2EActionMenuProbe';
import { E2EStaticToastRenderMarker } from '@/shared/lib/popup/E2EToastProbe';
import { NfcTapContent } from '@/shared/lib/popup/popups/nfcTapSheet';
import { SendMemoContent } from '@/shared/lib/popup/popups/sendMemoSheet';
import type {
  CustomSheetFooterConfig,
  CustomSheetSharedProps,
} from '@/shared/lib/popup/sheets/types';

function DurationBar({ durationMs }: { durationMs: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: durationMs,
      easing: Easing.linear,
    });

    return () => cancelAnimation(progress);
  }, [durationMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View className="bg-foreground/10 mt-3 h-1 w-8 self-center overflow-hidden rounded-full">
      <Animated.View
        className="bg-foreground/40 absolute bottom-0 left-0 top-0 rounded-full"
        style={animatedStyle}
      />
    </View>
  );
}

type ConfirmedAnimation = {
  progress: SharedValue<number>;
  colorFrom: string;
  colorTo: string;
};

function AnimatedSubmessage({
  submessage,
  animation,
}: {
  submessage: string;
  animation: ConfirmedAnimation;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      animation.progress.get(),
      [0, 1],
      [animation.colorFrom, animation.colorTo]
    ),
  }));

  return (
    <Animated.Text style={[{ textAlign: 'center' }, animatedStyle]} className="text-sm">
      {submessage}
    </Animated.Text>
  );
}

function SubmessageRenderer({
  submessage,
  animation,
}: {
  submessage: StandardSheetPayload['submessage'];
  animation?: ConfirmedAnimation;
}) {
  if (!submessage) return null;

  if (typeof submessage === 'string') {
    if (animation) {
      return <AnimatedSubmessage submessage={submessage} animation={animation} />;
    }
    return <RNText className="text-muted text-center text-base">{submessage}</RNText>;
  }

  if (Array.isArray(submessage)) {
    return (
      <View className="flex-row items-center justify-center">
        {(submessage as PopupTextSegment[]).map((segment, i) =>
          isAmountSegment(segment) ? (
            <AmountFormatter
              key={i}
              size={12}
              weight="heavy"
              amount={segment.amount}
              unit={segment.unit}
            />
          ) : (
            <Text key={i} size={12} weight="heavy">
              {segment}
            </Text>
          )
        )}
      </View>
    );
  }

  return <>{submessage}</>;
}

type CustomSheetRenderer = React.ComponentType<CustomSheetSharedProps & { payload: unknown }>;

// Custom-sheet registry: surfaces that need their own body inside the popup
// lane's sheet. For a plain pick-one-of-N list prefer `actionMenuPopup`.
const CUSTOM_SHEET_CONTENT: Record<keyof ActionSheetPayloads, CustomSheetRenderer> = {
  'action-menu': ActionMenuSheetContent as CustomSheetRenderer,
  'send-memo': SendMemoContent as CustomSheetRenderer,
  'nfc-tap': NfcTapContent as CustomSheetRenderer,
};

function StandardContent({
  payload,
  close,
  openSeq,
  confirmedAnimation,
}: {
  payload: StandardSheetPayload;
  close: () => void;
  openSeq: number;
  confirmedAnimation?: ConfirmedAnimation;
}) {
  const showDuration = payload.durationMs != null && payload.durationMs > 0;
  const hasLiveStatus = payload.status != null;
  const titleAnimatedStyle = useAnimatedStyle(() =>
    confirmedAnimation
      ? {
          color: interpolateColor(
            confirmedAnimation.progress.get(),
            [0, 1],
            [confirmedAnimation.colorFrom, confirmedAnimation.colorTo]
          ),
        }
      : {}
  );

  return (
    <View className="items-center gap-2 px-1 pb-1">
      {/* Same DEV-only probe seam as buttonless toast popups: mirror the
          popup KEY into the toast-probe store so simulator plans can observe
          buttoned (sheet-variant) popups too. */}
      <E2EStaticToastRenderMarker probeKey={payload.e2eProbeKey} />
      <View key={`sheet-icon-${openSeq}`}>{resolvePopupIcon(payload.icon, 88)}</View>
      {hasLiveStatus ? (
        <Animated.Text
          style={[{ textAlign: 'center', fontSize: 18, fontWeight: '600' }, titleAnimatedStyle]}>
          {payload.message || ''}
        </Animated.Text>
      ) : (
        <RNText className="text-foreground text-center text-lg font-medium">
          {payload.message || ''}
        </RNText>
      )}
      <SubmessageRenderer submessage={payload.submessage} animation={confirmedAnimation} />

      {(payload.buttons?.length ?? 0) > 0 ? (
        <View
          className={payload.buttonLayout === 'row' ? 'mt-4 w-full flex-row gap-2' : 'mt-4 gap-2'}>
          {payload.buttons?.map((button, index) => (
            <SheetActionButton
              key={`${button.text}-${index}`}
              button={button}
              variant={index === 0 ? 'primary' : 'tertiary'}
              feedbackVariant={hasLiveStatus ? 'scale' : undefined}
              row={payload.buttonLayout === 'row'}
              close={close}
            />
          ))}
        </View>
      ) : null}

      {showDuration ? <DurationBar durationMs={payload.durationMs!} /> : null}
    </View>
  );
}

// Each sheet button owns a single-flight slot (a component, for the hook): a
// fast double-tap would otherwise navigate twice and double-stack the route.
type SheetActionButtonProps = {
  button: { text: string; onPress?: () => void | Promise<void>; testID?: string };
  variant: 'primary' | 'tertiary';
  feedbackVariant: 'scale' | undefined;
  /** In a row layout each button takes an equal share of the width. */
  row?: boolean;
  close: () => void;
};

function SheetActionButton({
  button,
  variant,
  feedbackVariant,
  row,
  close,
}: SheetActionButtonProps) {
  const handlePress = useSingleFlight(async () => {
    if (button.onPress) await button.onPress();
    close();
  });

  return (
    <PillButton
      testID={button.testID}
      variant={variant}
      className={[variant === 'primary' ? 'bg-foreground' : '', row ? 'flex-1' : '']
        .join(' ')
        .trim()}
      feedbackVariant={feedbackVariant}
      onPress={handlePress}>
      <PillButton.Label className={variant === 'primary' ? 'text-background' : undefined}>
        {button.text}
      </PillButton.Label>
    </PillButton>
  );
}

function FooterButtons({ config }: { config: CustomSheetFooterConfig }) {
  return (
    <View className="bg-surface pb-4 pt-4">
      <View className="gap-2.5">
        {config.buttons.map((button, index) => {
          const variant = button.variant ?? (index === 0 ? 'primary' : 'tertiary');
          return (
            <Button
              key={`${button.label}-${index}`}
              testID={button.testID}
              variant={variant === 'primary' ? 'primary' : 'secondary'}
              text={button.label}
              onPress={button.onPress}
              disabled={button.isDisabled}
            />
          );
        })}
      </View>
    </View>
  );
}

const popupHostLog = log.child({ module: 'popupHost' });

function SheetPopup() {
  const current = usePopupStore((s) => s.current);
  const isOpen = usePopupStore((s) => s.isOpen);
  const openSeq = usePopupStore((s) => s.openSeq);
  const destroyed = usePopupStore((s) => s.destroyed);
  const close = usePopupStore((s) => s.close);
  const update = usePopupStore((s) => s.update);

  // Unmounted at rest; each open() nonce mounts a fresh instance (keyed below).
  // `shown` is the request it draws, kept through the exit animation.
  const [shown, setShown] = useState<{ seq: number; payload: NonNullable<typeof current> } | null>(
    null
  );
  if (isOpen && current && (shown?.seq !== openSeq || !Object.is(shown.payload, current))) {
    setShown({ seq: openSeq, payload: current });
  }

  useEffect(() => {
    if (!isOpen || !current || isCustomSheetPayload(current) || !current.live) return;
    const { live } = current;
    const unsubscribe = live.subscribe(() => update(live.get()));
    return unsubscribe;
  }, [isOpen, current, update]);

  const payload = shown?.payload ?? null;
  const isCustom = isCustomSheetPayload(payload);
  const standardPayload = !isCustom ? (payload as StandardSheetPayload | null) : null;
  // Keyed by `shown.seq` so switching to a new sheet clears the previous sheet's
  // footer synchronously without a parent effect overwriting a child's mount effect
  // (e.g. NfcTapContent registering its Close button on mount).
  const [customFooterState, setCustomFooterState] = useState<{
    seq: number;
    config: CustomSheetFooterConfig | null;
  } | null>(null);
  const customFooterConfig =
    shown && customFooterState?.seq === shown.seq ? customFooterState.config : null;
  const shownSeq = shown?.seq;
  const setCustomFooterConfig = useCallback(
    (config: CustomSheetFooterConfig | null) => {
      if (shownSeq == null) return;
      setCustomFooterState({ seq: shownSeq, config });
    },
    [shownSeq]
  );
  // Close bound to this instance's request: a button that opens a follow-on
  // sheet (the onchain chooser → "Network fee") still closes after onPress,
  // and that stale close must not tear the new sheet down. Memoized on
  // `shownSeq` so custom bodies (e.g. NfcTapContent) that depend on `close`
  // in their footer effect never re-fire in a loop.
  const scopedClose = useCallback(() => {
    if (shownSeq != null) close(shownSeq);
  }, [close, shownSeq]);

  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = () => setIsKeyboardVisible(true);
    const hide = () => setIsKeyboardVisible(false);
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', show),
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardWillHide', hide),
      Keyboard.addListener('keyboardDidHide', hide),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  const hasLiveStatus = standardPayload?.status != null;
  const [foreground, overlay, success] = useThemeColor([
    'foreground',
    'overlay',
    'success',
  ] as const);
  const confirmedProgress = useSharedValue(standardPayload?.status === 'confirmed' ? 1 : 0);

  // Opaque muted green: blend overlay (card bg) with success. success-soft is transparent; we need solid.
  const overlayColor = useMemo(() => sanitize(String(overlay)), [overlay]);
  const successMutedColor = useMemo(() => blend(overlay, success, 0.15), [overlay, success]);

  useEffect(() => {
    if (standardPayload?.status === 'confirmed') {
      confirmedProgress.set(withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }));
    } else if (hasLiveStatus) {
      confirmedProgress.set(0);
    }
  }, [standardPayload?.status, hasLiveStatus, confirmedProgress]);

  const confirmedAnimation: ConfirmedAnimation | undefined = hasLiveStatus
    ? { progress: confirmedProgress, colorFrom: foreground, colorTo: success }
    : undefined;

  const liveBackgroundStyle = useAnimatedStyle(
    () =>
      hasLiveStatus
        ? {
            backgroundColor: interpolateColor(
              confirmedProgress.get(),
              [0, 1],
              [overlayColor, successMutedColor]
            ),
          }
        : {},
    [hasLiveStatus, overlayColor, successMutedColor]
  );

  useEffect(() => {
    const standard = !isCustom ? (current as StandardSheetPayload) : null;
    if (!standard?.durationMs || !isOpen) return;
    const timer = setTimeout(() => usePopupStore.getState().close(), standard.durationMs);
    return () => clearTimeout(timer);
  }, [current, isOpen, isCustom]);

  if (destroyed || !shown || !payload) return null;

  const sheetId = isCustomSheetPayload(payload) ? payload.sheetId : 'standard';
  const ContentComponent = isCustomSheetPayload(payload)
    ? CUSTOM_SHEET_CONTENT[payload.sheetId]
    : null;
  const instanceOpen = isOpen && shown.seq === openSeq;

  return (
    <Sheet
      key={shown.seq}
      open={instanceOpen}
      dismissable={standardPayload?.dismissable ?? true}
      onDismissRequest={() => {
        Keyboard.dismiss();
        scopedClose();
      }}
      onPresented={() => {
        popupHostLog.info('popupHost.presented', { openSeq: shown.seq, sheetId });
        if (sheetId === 'action-menu') markE2EActionMenuPresented(shown.seq);
      }}
      onClosed={() => setShown((value) => (value?.seq === shown.seq ? null : value))}
      detached={!isCustom}
      scrimColor={`rgba(0,0,0,${alpha.strong})`}
      scrimTestID="popup-sheet-overlay"
      backgroundClassName={isCustom ? 'bg-overlay' : 'bg-surface'}
      surfaceStyle={hasLiveStatus ? liveBackgroundStyle : undefined}
      handle={!hasLiveStatus}
      contentClassName={
        !isCustom
          ? undefined
          : // With the memo input focused the sheet already rides above the
            // keyboard; drop the safe-area bottom padding so `Skip` doesn't
            // float over an empty band.
            sheetId === 'send-memo' && isKeyboardVisible
            ? 'px-3 pb-0'
            : 'px-3'
      }>
      <>
        {ContentComponent && isCustomSheetPayload(payload) ? (
          // A sheet draws in its own overlay window, so it carries its own
          // layer for the "Show taps" recording setting.
          <TouchIndicatorLayer fill={false}>
            <ContentComponent
              payload={payload.payload}
              close={scopedClose}
              setFooterConfig={setCustomFooterConfig}
            />
            {customFooterConfig && customFooterConfig.buttons.length > 0 ? (
              <FooterButtons config={customFooterConfig} />
            ) : null}
          </TouchIndicatorLayer>
        ) : standardPayload ? (
          <StandardContent
            payload={standardPayload}
            close={scopedClose}
            openSeq={shown.seq}
            confirmedAnimation={confirmedAnimation}
          />
        ) : null}
      </>
    </Sheet>
  );
}

export default function PopupHost() {
  return (
    <Log name="PopupHost">
      <SheetPopup />
      <ToastHost />
    </Log>
  );
}
