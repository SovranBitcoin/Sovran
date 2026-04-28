import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import opacity from 'hex-color-opacity';
import { BlurView } from '@/shared/ui/primitives/BlurView';
import { supportsBlur } from '@/shared/lib/version';
import { resolvePopupIcon, type PopupIcon } from './icons';
import { useToastSurface } from './useToastSurface';

type CompactToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type CompactToastProps = {
  variant?: CompactToastVariant;
  label: string;
  description?: string;
  icon?: PopupIcon;
  actionLabel?: string;
  onActionPress?: (args: { hide: (ids?: string | string[] | 'all') => void }) => void;
  hide?: (ids?: string | string[] | 'all') => void;
  [key: string]: unknown;
};

const BLUR_INTENSITY = 60;
// Semi-transparent tint over the BlurView gives the toast its theme-tinted
// hue without flattening the frosted-glass look. On platforms without blur
// support (Android < 12, iOS < 13) the BlurView wrapper renders null and
// we fall back to the opaque tint so the toast doesn't look ghosted.
const TINT_ALPHA = 0.3;

/**
 * Compact toast layout for normal toasts. Renders as a frosted-glass slab:
 * BlurView at the back, a semi-transparent theme-tinted overlay above it,
 * and the content on top. The tint hex comes from `useToastSurface` so it
 * follows the active theme.
 */
export function CompactToast({
  variant = 'default',
  label,
  description,
  icon,
  actionLabel,
  onActionPress,
  hide,
  ...toastProps
}: CompactToastProps) {
  const { bg, fg } = useToastSurface();
  const resolvedIcon = icon != null ? resolvePopupIcon(icon, 28, fg) : null;
  const blurSupported = supportsBlur();
  const tintColor = blurSupported ? opacity(bg, TINT_ALPHA) : bg;

  const handleActionPress = () => {
    if (onActionPress && hide) {
      onActionPress({ hide });
    }
  };

  return (
    <Toast
      placement="top"
      variant={variant}
      className="overflow-hidden p-0 bg-transparent"
      isAnimatedStyleActive={false}
      {...(toastProps as any)}>
      {blurSupported && (
        <BlurView intensity={BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
        }}>
        {resolvedIcon ? <View>{resolvedIcon}</View> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Toast.Title
            className="text-[15px] font-semibold"
            style={{ color: fg }}
            numberOfLines={1}>
            {label}
          </Toast.Title>
          {description ? (
            <Toast.Description className="text-[13px]" style={{ color: fg }} numberOfLines={1}>
              {description}
            </Toast.Description>
          ) : null}
        </View>
        {actionLabel ? (
          <Toast.Action style={{ backgroundColor: fg }} onPress={handleActionPress}>
            <Button.Label style={{ color: bg }}>{actionLabel}</Button.Label>
          </Toast.Action>
        ) : null}
      </View>
    </Toast>
  );
}
