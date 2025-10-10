import { cn } from '@/helper/utils';
import { View } from 'react-native';

function Skeleton({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />;
}

export { Skeleton };
