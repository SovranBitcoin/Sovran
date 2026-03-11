import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { BottomSheetFooter } from '@gorhom/bottom-sheet';
import { BottomSheet, Button, useToast } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import {
  usePopupStore,
  isCustomSheetPayload,
  type StandardSheetPayload,
  type CustomSheetPayload,
} from '@/shared/stores/runtime/popupStore';
import { blendColors, sanitizeColor } from '@/shared/lib/colorExtraction';
import {
  registerToast,
  resolvePopupIcon,
  isAmountSegment,
  type PopupTextSegment,
  type ActionSheetPayloads,
} from '@/shared/lib/popup';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  Easing,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  ButtonHandlerContent,
  EmojiPickerContent,
  OfflineSendSuggestionsContent,
  PaymentOptionsContent,
  ProfileSwitcherContent,
} from '@/shared/lib/popup/sheets';
import { IMPORT_NSEC_LABEL } from '@/shared/lib/popup/sheets/profile-switcher/constants';
import { SHEET_LAYOUT_CONFIG } from '@/shared/lib/popup/sheets/sheetLayoutConfig';
import type {
  CustomSheetFooterConfig,
  CustomSheetPage,
  CustomSheetNavDirection,
} from '@/shared/lib/popup/sheets/types';

type ProfileRoute = 'profile-list' | 'import-nsec';
type ProfileNavDirection = 'forward' | 'back';
type ImportFooterState = {
  onImport: () => void;
  isDisabled: boolean;
  isImporting: boolean;
};

function getStickyFooterClass(mode?: 'contentHeight' | 'snapPoints'): string {
  const px = mode === 'contentHeight' ? 'px-0' : 'px-4';
  const pb = mode === 'contentHeight' ? 'pb-4' : 'pb-safe-offset-4';
  return `bg-surface pt-4 ${pb} ${px}`;
}

function getSheetButtonClassName(variant: 'primary' | 'tertiary'): string | undefined {
  return variant === 'primary' ? 'bg-foreground' : undefined;
}

function getSheetButtonLabelClassName(variant: 'primary' | 'tertiary'): string | undefined {
  return variant === 'primary' ? 'text-background' : undefined;
}

function ToastRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    registerToast(toast);
  }, [toast]);

  return null;
}

function DurationBar({ duration }: { duration: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration,
      easing: Easing.linear,
    });

    return () => cancelAnimation(progress);
  }, [duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View className="bg-foreground/10 mt-3 h-1 w-8 self-center overflow-hidden rounded-full">
      <Animated.View className="bg-foreground/40 h-full rounded-full" style={animatedStyle} />
    </View>
  );
}

type ConfirmedAnimation = {
  progress: SharedValue<number>;
  colorFrom: string;
  colorTo: string;
};

/** Sanitize a RN style object, stripping spurious "px" units from string values. */
function sanitizeStyle(style: Record<string, unknown>): ViewStyle {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    result[key] = typeof value === 'string' && value.includes('px') ? sanitizeColor(value) : value;
  }
  return result as ViewStyle;
}

function LiveSheetBackground({
  style,
  pointerEvents,
  animatedStyle,
}: {
  style?: ViewStyle;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  animatedIndex?: unknown;
  animatedPosition?: unknown;
  animatedStyle: ViewStyle;
}) {
  const sanitized = style
    ? sanitizeStyle(StyleSheet.flatten(style) as Record<string, unknown>)
    : {};
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Bottom Sheet"
      style={[sanitized as ViewStyle, animatedStyle]}
    />
  );
}

function LiveSheetHandle({
  style,
  indicatorStyle,
  animatedStyle,
}: {
  style?: ViewStyle;
  indicatorStyle?: ViewStyle;
  animatedStyle: ViewStyle;
}) {
  return (
    <View style={[style, { padding: 10 }]}>
      <Animated.View
        style={[
          { alignSelf: 'center', width: 36, height: 4, borderRadius: 4 } as ViewStyle,
          indicatorStyle,
          animatedStyle,
        ]}
      />
    </View>
  );
}

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
    return <BottomSheet.Description className="text-center">{submessage}</BottomSheet.Description>;
  }

  if (Array.isArray(submessage)) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
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

const CUSTOM_SHEET_CONTENT: Record<
  Exclude<keyof ActionSheetPayloads, 'profile-switcher'>,
  React.ComponentType<{
    payload: unknown;
    close: () => void;
    pushCustomPage: <K extends keyof ActionSheetPayloads>(
      sheetId: K,
      payload: ActionSheetPayloads[K]
    ) => void;
    popCustomPage: () => void;
    canPop: boolean;
    setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
  }>
> = {
  'emoji-picker': EmojiPickerContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
    pushCustomPage: <K extends keyof ActionSheetPayloads>(
      sheetId: K,
      payload: ActionSheetPayloads[K]
    ) => void;
    popCustomPage: () => void;
    canPop: boolean;
    setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
  }>,
  'offline-send-suggestions': OfflineSendSuggestionsContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
    pushCustomPage: <K extends keyof ActionSheetPayloads>(
      sheetId: K,
      payload: ActionSheetPayloads[K]
    ) => void;
    popCustomPage: () => void;
    canPop: boolean;
    setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
  }>,
  'button-handler': ButtonHandlerContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
    pushCustomPage: <K extends keyof ActionSheetPayloads>(
      sheetId: K,
      payload: ActionSheetPayloads[K]
    ) => void;
    popCustomPage: () => void;
    canPop: boolean;
    setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
  }>,
  'payment-options': PaymentOptionsContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
    pushCustomPage: <K extends keyof ActionSheetPayloads>(
      sheetId: K,
      payload: ActionSheetPayloads[K]
    ) => void;
    popCustomPage: () => void;
    canPop: boolean;
    setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
  }>,
};

function SheetContent({
  payload,
  activeCustomPage,
  close,
  openCycle,
  confirmedAnimation,
  profileRoute,
  profileNavDirection,
  customNavDirection,
  isContentHeight,
  onProfileBack,
  onImportFooterStateChange,
  pushCustomPage,
  popCustomPage,
  canPopCustomPage,
  onCustomFooterConfigChange,
}: {
  payload: ReturnType<typeof usePopupStore.getState>['current'];
  activeCustomPage: CustomSheetPage | null;
  close: () => void;
  openCycle: number;
  confirmedAnimation?: ConfirmedAnimation;
  profileRoute: ProfileRoute;
  profileNavDirection: ProfileNavDirection;
  customNavDirection: CustomSheetNavDirection;
  isContentHeight: boolean;
  onProfileBack: () => void;
  onImportFooterStateChange: (state: ImportFooterState) => void;
  pushCustomPage: <K extends keyof ActionSheetPayloads>(
    sheetId: K,
    payload: ActionSheetPayloads[K]
  ) => void;
  popCustomPage: () => void;
  canPopCustomPage: boolean;
  onCustomFooterConfigChange: (config: CustomSheetFooterConfig | null) => void;
}) {
  const isCustom = isCustomSheetPayload(payload);
  const standardPayload = !isCustom ? (payload as StandardSheetPayload | null) : null;
  const showDuration = standardPayload?.duration != null && standardPayload.duration > 0;
  const hasLiveStatus = standardPayload?.status != null;

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

  if (!payload) return <View />;

  if (isCustom) {
    if (!activeCustomPage) return <View />;

    if (activeCustomPage.sheetId === 'profile-switcher') {
      return (
        <ProfileSwitcherContent
          payload={activeCustomPage.payload as ActionSheetPayloads['profile-switcher']}
          close={close}
          route={profileRoute}
          navDirection={profileNavDirection}
          onBack={onProfileBack}
          onImportFooterStateChange={onImportFooterStateChange}
        />
      );
    }
    const nonProfileSheetId = activeCustomPage.sheetId as Exclude<
      keyof ActionSheetPayloads,
      'profile-switcher'
    >;
    const ContentComponent = CUSTOM_SHEET_CONTENT[nonProfileSheetId];
    if (!ContentComponent) return <View />;
    const entering =
      customNavDirection === 'forward' ? SlideInRight.duration(220) : SlideInLeft.duration(220);
    const exiting =
      customNavDirection === 'forward' ? SlideOutLeft.duration(220) : SlideOutRight.duration(220);
    return (
      <Animated.View
        key={`${activeCustomPage.sheetId}-${canPopCustomPage ? 'stacked' : 'root'}`}
        style={isContentHeight ? undefined : { flex: 1 }}
        entering={entering}
        exiting={exiting}>
        <ContentComponent
          payload={activeCustomPage.payload}
          close={close}
          pushCustomPage={pushCustomPage}
          popCustomPage={popCustomPage}
          canPop={canPopCustomPage}
          setFooterConfig={onCustomFooterConfigChange}
        />
      </Animated.View>
    );
  }

  return (
    <View className="items-center gap-2 px-1 pb-1">
      <View key={`sheet-icon-${openCycle}`}>{resolvePopupIcon(standardPayload?.icon, 88)}</View>
      {hasLiveStatus ? (
        <Animated.Text
          style={[{ textAlign: 'center', fontSize: 18, fontWeight: '600' }, titleAnimatedStyle]}>
          {standardPayload?.message || ''}
        </Animated.Text>
      ) : (
        <BottomSheet.Title className="text-center">
          {standardPayload?.message || ''}
        </BottomSheet.Title>
      )}
      <SubmessageRenderer submessage={standardPayload?.submessage} animation={confirmedAnimation} />

      {(standardPayload?.buttons?.length ?? 0) > 0 ? (
        <View className="mt-4 gap-2">
          {standardPayload?.buttons?.map((button, index) => {
            const variant = index === 0 ? 'primary' : 'tertiary';
            const className = getSheetButtonClassName(variant);
            const labelClassName = getSheetButtonLabelClassName(variant);

            return (
              <Button
                key={`${button.text}-${index}`}
                variant={variant}
                className={className}
                feedbackVariant={hasLiveStatus ? 'scale' : undefined}
                onPress={async () => {
                  if (button.onPress) {
                    await button.onPress();
                  } else if (button.page) {
                    router.navigate(`/${button.page}` as any);
                  }
                  close();
                }}>
                <Button.Label className={labelClassName}>{button.text}</Button.Label>
              </Button>
            );
          })}
        </View>
      ) : null}

      {showDuration ? <DurationBar duration={standardPayload!.duration!} /> : null}
    </View>
  );
}

function SheetPopup() {
  const insets = useSafeAreaInsets();
  const current = usePopupStore((s) => s.current);
  const isOpen = usePopupStore((s) => s.isOpen);
  const destroyed = usePopupStore((s) => s.destroyed);
  const close = usePopupStore((s) => s.close);
  const update = usePopupStore((s) => s.update);

  const lastPayloadRef = useRef<typeof current>(null);
  const wasOpenRef = useRef(false);
  const [openCycle, setOpenCycle] = useState(0);
  if (current) {
    lastPayloadRef.current = current;
  }

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setOpenCycle((value) => value + 1);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !current || isCustomSheetPayload(current) || !current.live) return;
    const { live } = current;
    const unsubscribe = live.subscribe(() => update(live.get()));
    return unsubscribe;
  }, [isOpen, current, update]);

  const payload = current ?? lastPayloadRef.current;
  const isCustom = isCustomSheetPayload(payload);
  const [customStack, setCustomStack] = useState<CustomSheetPage[]>([]);
  const [customNavDirection, setCustomNavDirection] = useState<CustomSheetNavDirection>('forward');
  const [customFooterConfig, setCustomFooterConfig] = useState<CustomSheetFooterConfig | null>(
    null
  );

  const pushCustomPage = useCallback(
    <K extends keyof ActionSheetPayloads>(sheetId: K, pagePayload: ActionSheetPayloads[K]) => {
      setCustomNavDirection('forward');
      setCustomStack((prev) => [...prev, { sheetId, payload: pagePayload }]);
    },
    []
  );

  const popCustomPage = useCallback(() => {
    setCustomNavDirection('back');
    setCustomStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const activeCustomPage = useMemo(() => {
    if (!isCustom || !payload) return null;
    if (customStack.length > 0) return customStack[customStack.length - 1];
    return { sheetId: payload.sheetId, payload: payload.payload } as CustomSheetPage;
  }, [customStack, isCustom, payload]);

  const canPopCustomPage = customStack.length > 1;

  useEffect(() => {
    if (!isOpen || !current || !isCustomSheetPayload(current)) {
      setCustomStack([]);
      setCustomNavDirection('forward');
      setCustomFooterConfig(null);
      return;
    }

    setCustomStack([{ sheetId: current.sheetId, payload: current.payload } as CustomSheetPage]);
    setCustomNavDirection('forward');
    setCustomFooterConfig(null);
  }, [isOpen, current]);

  const customRootSheetId =
    customStack[0]?.sheetId ?? (isCustom && payload ? payload.sheetId : undefined);
  const layoutConfig =
    isCustom && customRootSheetId ? SHEET_LAYOUT_CONFIG[customRootSheetId] : undefined;
  const isProfileSwitcher = activeCustomPage?.sheetId === 'profile-switcher';
  const standardPayload = !isCustom ? (payload as StandardSheetPayload | null) : null;
  const hasLiveStatus = standardPayload?.status != null;
  const [foreground, overlay, success] = useThemeColor([
    'foreground',
    'overlay',
    'success',
  ] as const);
  const confirmedProgress = useSharedValue(standardPayload?.status === 'confirmed' ? 1 : 0);

  // Opaque muted green: blend overlay (card bg) with success. success-soft is transparent; we need solid.
  const overlayColor = useMemo(() => sanitizeColor(String(overlay)), [overlay]);
  const successMutedColor = useMemo(() => blendColors(overlay, success, 0.15), [overlay, success]);

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

  const customSnapPoints = useMemo(
    () => (layoutConfig?.mode === 'snapPoints' ? [...layoutConfig.snapPoints] : undefined),
    [layoutConfig]
  );

  const [profileStack, setProfileStack] = useState<ProfileRoute[]>(['profile-list']);
  const [profileNavDirection, setProfileNavDirection] = useState<ProfileNavDirection>('forward');
  const [importFooterState, setImportFooterState] = useState<ImportFooterState>({
    onImport: () => {},
    isDisabled: true,
    isImporting: false,
  });
  const profileRoute = profileStack[profileStack.length - 1] ?? 'profile-list';

  const resetProfileStack = useCallback(() => {
    setProfileNavDirection('forward');
    setProfileStack(['profile-list']);
  }, []);

  const pushProfileRoute = useCallback((route: ProfileRoute) => {
    setProfileNavDirection('forward');
    setProfileStack((prev) => {
      const currentRoute = prev[prev.length - 1];
      if (currentRoute === route) return prev;
      return [...prev, route];
    });
  }, []);

  const popProfileRoute = useCallback(() => {
    setProfileNavDirection('back');
    setProfileStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  useEffect(() => {
    if (!isOpen) resetProfileStack();
  }, [isOpen, resetProfileStack]);

  useEffect(() => {
    if (profileRoute !== 'import-nsec') {
      setImportFooterState({
        onImport: () => {},
        isDisabled: true,
        isImporting: false,
      });
    }
  }, [profileRoute]);

  useEffect(() => {
    const standard = !isCustom ? (current as StandardSheetPayload) : null;
    if (!standard?.duration || !isOpen) {
      return;
    }

    const timer = setTimeout(() => {
      usePopupStore.getState().close();
    }, standard.duration);

    return () => clearTimeout(timer);
  }, [current, isOpen, isCustom]);

  const handleOpenChange = (open: boolean) => {
    if (!open && isOpen) close();
  };

  const switcherPayload = isProfileSwitcher
    ? (activeCustomPage?.payload as CustomSheetPayload<'profile-switcher'>['payload'])
    : null;

  const renderCustomFooter = useCallback(
    (props: { animatedFooterPosition: any }) => {
      if (!isCustom) return null;

      if (!isProfileSwitcher) {
        if (!customFooterConfig || customFooterConfig.buttons.length === 0) return null;
        return (
          <BottomSheetFooter {...props}>
            <View className={getStickyFooterClass(layoutConfig?.mode)}>
              <View
                className={customFooterConfig.layout === 'row' ? 'flex-row' : undefined}
                style={{ gap: 10 }}>
                {customFooterConfig.buttons.map((button, index) => {
                  const variant = button.variant ?? (index === 0 ? 'primary' : 'tertiary');
                  const buttonClassName = getSheetButtonClassName(variant);
                  const className =
                    customFooterConfig.layout === 'row'
                      ? [buttonClassName, 'flex-1'].filter(Boolean).join(' ')
                      : buttonClassName;

                  return (
                    <Button
                      key={`${button.label}-${index}`}
                      variant={variant}
                      onPress={button.onPress}
                      className={className}
                      isDisabled={button.isDisabled}>
                      <Button.Label className={getSheetButtonLabelClassName(variant)}>
                        {button.label}
                      </Button.Label>
                    </Button>
                  );
                })}
              </View>
            </View>
          </BottomSheetFooter>
        );
      }

      if (!switcherPayload) return null;
      return (
        <BottomSheetFooter {...props}>
          <View className={getStickyFooterClass(layoutConfig?.mode)}>
            <View style={{ gap: 10 }}>
              {profileRoute === 'profile-list' ? (
                <>
                  <Button
                    variant="primary"
                    className={getSheetButtonClassName('primary')}
                    onPress={() => {
                      switcherPayload.onRequestAction({ type: 'create' });
                      close();
                    }}>
                    <Button.Label className={getSheetButtonLabelClassName('primary')}>
                      Generate new account
                    </Button.Label>
                  </Button>
                  <Button variant="tertiary" onPress={() => pushProfileRoute('import-nsec')}>
                    <Button.Label>{IMPORT_NSEC_LABEL}</Button.Label>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    className={getSheetButtonClassName('primary')}
                    onPress={importFooterState.onImport}
                    isDisabled={importFooterState.isDisabled}>
                    <Button.Label className={getSheetButtonLabelClassName('primary')}>
                      {importFooterState.isImporting ? 'Importing...' : 'Import'}
                    </Button.Label>
                  </Button>
                  <Button variant="tertiary" onPress={popProfileRoute}>
                    <Button.Label>Back</Button.Label>
                  </Button>
                </>
              )}
            </View>
          </View>
        </BottomSheetFooter>
      );
    },
    [
      isCustom,
      isProfileSwitcher,
      customFooterConfig,
      layoutConfig?.mode,
      profileRoute,
      switcherPayload,
      close,
      pushProfileRoute,
      popProfileRoute,
      importFooterState,
    ]
  );

  if (destroyed) return null;

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay isCloseOnPress={standardPayload?.dismissable ?? true} />
        <BottomSheet.Content
          detached={!isCustom}
          bottomInset={isCustom ? undefined : insets.bottom}
          snapPoints={isCustom ? customSnapPoints : undefined}
          enableDynamicSizing={isCustom ? layoutConfig?.mode === 'contentHeight' : undefined}
          enableOverDrag={isCustom ? false : undefined}
          footerComponent={
            isCustom && layoutConfig?.mode !== 'contentHeight' ? renderCustomFooter : undefined
          }
          handleComponent={
            isCustom
              ? () => null
              : hasLiveStatus
                ? (props: any) => <LiveSheetHandle {...props} animatedStyle={liveBackgroundStyle} />
                : undefined
          }
          className={isCustom ? undefined : 'mx-4'}
          backgroundClassName={isCustom ? 'bg-surface' : 'bg-surface rounded-[32px]'}
          backgroundComponent={
            hasLiveStatus
              ? (props: any) => (
                  <LiveSheetBackground {...props} animatedStyle={liveBackgroundStyle} />
                )
              : undefined
          }
          contentContainerClassName={
            isCustom && layoutConfig?.mode === 'snapPoints' ? 'h-full pt-2' : undefined
          }>
          <SheetContent
            payload={payload}
            activeCustomPage={activeCustomPage}
            close={close}
            openCycle={openCycle}
            confirmedAnimation={confirmedAnimation}
            profileRoute={profileRoute}
            profileNavDirection={profileNavDirection}
            customNavDirection={customNavDirection}
            isContentHeight={layoutConfig?.mode === 'contentHeight'}
            onProfileBack={popProfileRoute}
            onImportFooterStateChange={setImportFooterState}
            pushCustomPage={pushCustomPage}
            popCustomPage={popCustomPage}
            canPopCustomPage={canPopCustomPage}
            onCustomFooterConfigChange={setCustomFooterConfig}
          />
          {isCustom &&
            layoutConfig?.mode === 'contentHeight' &&
            customFooterConfig &&
            customFooterConfig.buttons.length > 0 && (
              <View className={getStickyFooterClass(layoutConfig?.mode)}>
                <View style={{ gap: 10 }}>
                  {customFooterConfig.buttons.map((button, index) => {
                    const variant = button.variant ?? (index === 0 ? 'primary' : 'tertiary');

                    return (
                      <Button
                        key={`${button.label}-${index}`}
                        variant={variant}
                        className={getSheetButtonClassName(variant)}
                        onPress={button.onPress}
                        isDisabled={button.isDisabled}>
                        <Button.Label className={getSheetButtonLabelClassName(variant)}>
                          {button.label}
                        </Button.Label>
                      </Button>
                    );
                  })}
                </View>
              </View>
            )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

export default function PopupHost() {
  return (
    <>
      <ToastRegistrar />
      <SheetPopup />
    </>
  );
}
