import type { ReactNode } from 'react';
import React from 'react';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';

export type PopupIcon = `emoji:${string}` | `icon:${string}` | `custom:${string}` | ReactNode;

const CUSTOM_ICONS: Record<string, React.FC<{ size: number }>> = {};

/**
 * Resolves a declarative PopupIcon value to renderable JSX.
 *
 * - `emoji:🎉` renders the emoji in a Text node
 * - `icon:mdi:check-circle` renders via Monicon
 * - `custom:X` looks up a registered animated component in CUSTOM_ICONS
 * - ReactNode passes through as-is
 * - undefined falls back to a default lightbulb emoji
 */
export function resolvePopupIcon(icon: PopupIcon | undefined, size: number): ReactNode {
  if (icon == null) {
    return <Text size={30}>💡</Text>;
  }

  if (typeof icon !== 'string') {
    return icon;
  }

  if (icon.startsWith('emoji:')) {
    return <Text size={30}>{icon.slice(6)}</Text>;
  }

  if (icon.startsWith('icon:')) {
    return <Icon name={icon.slice(5)} size={size} />;
  }

  if (icon.startsWith('custom:')) {
    const key = icon.slice(7);
    const Component = CUSTOM_ICONS[key];
    if (Component) {
      return <Component size={size} />;
    }
    console.warn(`[popup/icons] Unknown custom icon: "${key}"`);
    return <Text size={30}>💡</Text>;
  }

  return <Text size={30}>{icon}</Text>;
}
