/**
 * Shared row body for `Menu.Item`s hosted inside our custom `<BottomSheet>`
 * lane (a bare `<Menu>` outside any `Menu.Content` host): leading icon,
 * collapse-proof title, optional description, optional trailing accessory.
 * Used by the action-menu / payment-options / proof-selector / model-picker
 * sheets so the heroui title defence lives in one place.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Menu } from 'heroui-native';

import { HStack } from '@/shared/ui/primitives/View/HStack';

/**
 * `flex: 0` + `numberOfLines={1}` neutralise heroui's baked-in `flex-1` on
 * `Menu.ItemTitle`, which collapses to zero height outside a `Menu.Content`
 * host (the surrounding column has no fixed height for `flex-grow` to claim):
 *   1. `style.flex: 0` — RN's `style` wins over className in the merge, so
 *      the tailwind `flex-1` is neutralised.
 *   2. `numberOfLines={1}` — forces RN to allocate at least one line of
 *      layout height regardless of flex math.
 * The rest of heroui's typography (`text-base font-medium text-foreground`)
 * is preserved.
 */
export function SheetItemTitle({ children }: { children: ReactNode }) {
  return (
    <Menu.ItemTitle className="flex-none" numberOfLines={1} style={{ flex: 0 }}>
      {children}
    </Menu.ItemTitle>
  );
}

interface SheetMenuRowContentProps {
  /** Leading icon node (already sized); `null` renders nothing. */
  icon: ReactNode;
  title: ReactNode;
  /** Rendered in a `Menu.ItemDescription` when non-null. */
  description?: ReactNode;
  /** Trailing accessory (amount, check, capability glyphs …). */
  trailing?: ReactNode;
}

export function SheetMenuRowContent({
  icon,
  title,
  description,
  trailing,
}: SheetMenuRowContentProps) {
  return (
    <HStack align="center" gap={10} style={{ flex: 1 }}>
      {icon}
      <View style={{ flex: 1 }}>
        <SheetItemTitle>{title}</SheetItemTitle>
        {description != null ? <Menu.ItemDescription>{description}</Menu.ItemDescription> : null}
      </View>
      {trailing}
    </HStack>
  );
}
