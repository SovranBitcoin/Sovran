import React from 'react';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from './SheetHeader';

type BottomSheetScrollViewProps = React.ComponentProps<typeof BottomSheetScrollView>;

interface SheetContentProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  scrollProps?: Omit<BottomSheetScrollViewProps, 'children'>;
}

/**
 * Shared custom-sheet content shell.
 * Uses the profile-list layout pattern: header fixed, body scrollable.
 */
export function SheetContent({ title, description, children, scrollProps }: SheetContentProps) {
  const {
    style,
    contentContainerClassName,
    enableFooterMarginAdjustment,
    nestedScrollEnabled,
    keyboardShouldPersistTaps,
    showsVerticalScrollIndicator,
    ...restScrollProps
  } = scrollProps ?? {};

  return (
    <View style={{ flex: 1 }}>
      <SheetHeader title={title} description={description} />
      <BottomSheetScrollView
        style={[{ flex: 1, paddingTop: 16 }, style]}
        contentContainerClassName={contentContainerClassName ?? 'px-0 pb-safe-offset-4'}
        enableFooterMarginAdjustment={enableFooterMarginAdjustment ?? true}
        nestedScrollEnabled={nestedScrollEnabled ?? true}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator ?? false}
        {...restScrollProps}>
        {children}
      </BottomSheetScrollView>
    </View>
  );
}
