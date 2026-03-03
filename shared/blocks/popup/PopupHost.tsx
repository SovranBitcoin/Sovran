import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet, Button, useToast } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import {
  usePopupStore,
  isCustomSheetPayload,
  type StandardSheetPayload,
} from '@/shared/stores/runtime/popupStore';
import {
  registerToast,
  resolvePopupIcon,
  isAmountSegment,
  type PopupTextSegment,
} from '@/shared/lib/popup';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { ButtonHandlerContent } from '@/sheets/buttonHandler';
import { EmojiPickerContent } from '@/sheets/emoji-picker';
import { ProfileSwitcherContent } from '@/sheets/profileSwitcher';

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

function SubmessageRenderer({ submessage }: { submessage: StandardSheetPayload['submessage'] }) {
  if (!submessage) return null;

  if (typeof submessage === 'string') {
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
  string,
  React.ComponentType<{ payload: unknown; close: () => void }>
> = {
  'profile-switcher': ProfileSwitcherContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
  }>,
  'emoji-picker': EmojiPickerContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
  }>,
  'button-handler': ButtonHandlerContent as React.ComponentType<{
    payload: unknown;
    close: () => void;
  }>,
};

function SheetPopup() {
  const insets = useSafeAreaInsets();
  const current = usePopupStore((s) => s.current);
  const isOpen = usePopupStore((s) => s.isOpen);
  const close = usePopupStore((s) => s.close);

  const lastPayloadRef = useRef<typeof current>(null);
  const wasOpenRef = useRef(false);
  const ignoreFirstCloseEventRef = useRef(false);
  const [openCycle, setOpenCycle] = useState(0);
  if (current) {
    lastPayloadRef.current = current;
  }

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setOpenCycle((value) => value + 1);
      ignoreFirstCloseEventRef.current = true;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const payload = current ?? lastPayloadRef.current;
  const isCustom = isCustomSheetPayload(payload);

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

  const dismissable = true;
  const standardPayload = !isCustom ? (payload as StandardSheetPayload) : null;
  const showDuration = isOpen && standardPayload?.duration != null && standardPayload.duration > 0;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      ignoreFirstCloseEventRef.current = false;
      return;
    }

    if (ignoreFirstCloseEventRef.current) {
      ignoreFirstCloseEventRef.current = false;
      return;
    }

    if (isOpen) {
      close();
    }
  };

  if (!payload) {
    return null;
  }

  if (isCustom) {
    const ContentComponent = CUSTOM_SHEET_CONTENT[payload.sheetId];
    if (!ContentComponent) {
      return null;
    }

    const isProfileSwitcher = payload.sheetId === 'profile-switcher';

    return (
      <BottomSheet
        isOpen={isOpen}
        onOpenChange={(open) => {
          handleOpenChange(open);
        }}>
        <BottomSheet.Portal disableFullWindowOverlay={__DEV__}>
          <BottomSheet.Overlay isCloseOnPress={dismissable} />
          {isProfileSwitcher ? (
            <BottomSheet.Content
              snapPoints={['25%', '50%', '90%']}
              detached
              bottomInset={insets.bottom}
              className="mx-4"
              backgroundClassName="rounded-[32px]">
              <ContentComponent payload={payload.payload} close={close} />
            </BottomSheet.Content>
          ) : (
            <BottomSheet.Content
              detached
              bottomInset={insets.bottom}
              className="mx-4"
              backgroundClassName="rounded-[32px]">
              <ContentComponent payload={payload.payload} close={close} />
            </BottomSheet.Content>
          )}
        </BottomSheet.Portal>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        handleOpenChange(open);
      }}>
      <BottomSheet.Portal disableFullWindowOverlay={__DEV__}>
        <BottomSheet.Overlay isCloseOnPress={standardPayload?.dismissable ?? dismissable} />
        <BottomSheet.Content
          detached
          bottomInset={insets.bottom}
          className="mx-4"
          backgroundClassName="rounded-[32px]">
          <View className="items-center gap-2 px-1 pb-1">
            <View key={`sheet-icon-${openCycle}`}>
              {resolvePopupIcon(standardPayload?.icon, 88)}
            </View>
            <BottomSheet.Title className="text-center">
              {standardPayload?.message || ''}
            </BottomSheet.Title>
            <SubmessageRenderer submessage={standardPayload?.submessage} />
          </View>

          {(standardPayload?.buttons?.length ?? 0) > 0 ? (
            <View className="mt-4 gap-2">
              {standardPayload?.buttons?.map((button, index) => (
                <Button
                  key={`${button.text}-${index}`}
                  variant={index === 0 ? 'primary' : 'tertiary'}
                  onPress={() => {
                    if (button.onPress) {
                      button.onPress();
                    } else if (button.page) {
                      router.navigate(`/${button.page}` as any);
                    }
                    close();
                  }}>
                  <Button.Label>{button.text}</Button.Label>
                </Button>
              ))}
            </View>
          ) : null}

          {showDuration ? <DurationBar duration={standardPayload!.duration!} /> : null}
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
