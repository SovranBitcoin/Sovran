import { cn } from '@/shared/lib/utils';
import { View } from 'react-native';

function Skeleton({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('bg-skeleton animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
