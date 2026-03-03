import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet, Button, useToast } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { usePopupStore, type SheetPayload } from '@/shared/stores/runtime/popupStore';
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

function SubmessageRenderer({ submessage }: { submessage: SheetPayload['submessage'] }) {
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

function SheetPopup() {
  const insets = useSafeAreaInsets();
  const current = usePopupStore((s) => s.current);
  const isOpen = usePopupStore((s) => s.isOpen);
  const close = usePopupStore((s) => s.close);

  const lastPayloadRef = useRef<SheetPayload | null>(null);
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
    if (!current?.duration || !isOpen) {
      return;
    }

    const timer = setTimeout(() => {
      usePopupStore.getState().close();
    }, current.duration);

    return () => clearTimeout(timer);
  }, [current, isOpen]);

  const payload = current ?? lastPayloadRef.current;
  const dismissable = payload?.dismissable ?? true;
  const showDuration = isOpen && current?.duration != null && current.duration > 0;

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isOpen) {
          close();
        }
      }}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay isCloseOnPress={dismissable} />
        <BottomSheet.Content
          detached
          bottomInset={insets.bottom}
          className="mx-4"
          backgroundClassName="rounded-[32px]">
          <View className="items-center gap-2 px-1 pb-1">
            <View key={`sheet-icon-${openCycle}`}>{resolvePopupIcon(payload?.icon, 88)}</View>
            <BottomSheet.Title className="text-center">{payload?.message || ''}</BottomSheet.Title>
            <SubmessageRenderer submessage={payload?.submessage} />
          </View>

          {(payload?.buttons?.length ?? 0) > 0 ? (
            <View className="mt-4 gap-2">
              {payload?.buttons?.map((button, index) => (
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

          {showDuration ? <DurationBar duration={current!.duration!} /> : null}
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
