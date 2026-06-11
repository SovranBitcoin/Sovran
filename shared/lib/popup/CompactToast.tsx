import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import opacity from 'hex-color-opacity';

import { resolvePopupIcon, type PopupIcon } from './icons';
import { useToastSurface } from './useToastSurface';
import { ToastSlab, TINT_ALPHA, useToastFrosted } from './ToastSlab';

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

/**
 * Compact toast layout for normal toasts. The frosted-glass slab structure
 * (Toast root, BlurView, tint layer, content row) lives in `<ToastSlab>` so
 * this component only owns its row content. The tint hex comes from
 * `useToastSurface` so it follows the active theme; on non-frosted
 * platforms (Android) the opaque surface bg keeps the toast from looking
 * ghosted — expo-blur there is a weak tint, not real blur.
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
  // Opaque surface bg on non-frosted platforms so the toast doesn't look
  // ghosted (the slab renders no BlurView there).
  const frosted = useToastFrosted();
  const tintColor = frosted ? opacity(bg, TINT_ALPHA) : bg;

  const handleActionPress = () => {
    if (onActionPress && hide) {
      onActionPress({ hide });
    }
  };

  return (
    <ToastSlab
      toastProps={toastProps}
      variant={variant}
      tint={<View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} />}>
      {resolvedIcon ? <View>{resolvedIcon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Toast.Title className="text-[15px] font-semibold" style={{ color: fg }} numberOfLines={1}>
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
    </ToastSlab>
  );
}
