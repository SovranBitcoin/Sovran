import React from 'react';
import { View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { sanitizeColor } from '@/shared/lib/colorExtraction';

type CompactToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type CompactToastProps = {
  variant?: CompactToastVariant;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onActionPress?: (args: { hide: (ids?: string | string[] | 'all') => void }) => void;
  hide?: (ids?: string | string[] | 'all') => void;
  [key: string]: unknown;
};

/**
 * Compact toast layout for normal toasts: surface background, horizontal row,
 * icon slot, title/subtitle, optional action. Variant affects text color only.
 * Custom toasts (e.g. PaymentStatusToast) use their own animated backgrounds.
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
  const [surface] = useThemeColor(['surface'] as const);
  const backgroundColor = sanitizeColor(String(surface));

  const handleActionPress = () => {
    if (onActionPress && hide) {
      onActionPress({ hide });
    }
  };

  return (
    <Toast
      placement="top"
      variant={variant}
      className="overflow-hidden p-0"
      isAnimatedStyleActive={false}
      {...(toastProps as any)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
          backgroundColor,
        }}>
        {icon && <View>{icon}</View>}
        <View style={{ flex: 1, gap: 2 }}>
          <Toast.Title className="text-[15px] font-semibold" numberOfLines={1}>
            {label}
          </Toast.Title>
          {description ? (
            <Toast.Description className="text-[13px]" numberOfLines={1}>
              {description}
            </Toast.Description>
          ) : null}
        </View>
        {actionLabel ? (
          <Toast.Action className="bg-foreground" onPress={handleActionPress}>
            <Button.Label className="text-overlay">{actionLabel}</Button.Label>
          </Toast.Action>
        ) : null}
      </View>
    </Toast>
  );
}
