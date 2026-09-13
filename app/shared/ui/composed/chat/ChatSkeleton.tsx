import { View } from 'react-native';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { cn } from '@/shared/lib/classNames';
import { MESSAGE_ROW_STYLE } from './chatLayout';

const ROWS = [
  { width: '62%', height: 40, own: false },
  { width: '44%', height: 40, own: false },
  { width: '71%', height: 60, own: true },
  { width: '38%', height: 40, own: true },
  { width: '55%', height: 40, own: false },
  { width: '48%', height: 60, own: true },
] as const;

export function ChatSkeleton({ bottomPadding = 0 }: { bottomPadding?: number }) {
  const containerStyle = { paddingBottom: bottomPadding };
  return (
    <View
      testID="chat-skeleton"
      className="flex-1 justify-end"
      style={containerStyle}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {ROWS.map((row, index) => {
        const first = ROWS[index - 1]?.own !== row.own;
        const last = ROWS[index + 1]?.own !== row.own;
        const bubbleStyle = { width: row.width, height: row.height };
        return (
          <View
            key={index}
            style={MESSAGE_ROW_STYLE}
            className={cn(
              'flex-row items-end gap-2',
              row.own && 'justify-end',
              last ? 'mb-4' : 'mb-0.5'
            )}>
            {!row.own &&
              (last ? <Skeleton className="size-8 rounded-full" /> : <View className="size-8" />)}
            <Skeleton
              style={bubbleStyle}
              className={cn(
                'rounded-[18px]',
                !first && (row.own ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]'),
                !last && (row.own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]')
              )}
            />
          </View>
        );
      })}
    </View>
  );
}
