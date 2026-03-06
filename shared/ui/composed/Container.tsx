import React from 'react';
import { SafeAreaView } from 'react-native';

import { cn } from '@/shared/lib/utils';

const Container: React.FC<{
  children: React.ReactNode;
  style?: any;
  className?: string;
}> = ({ children, style, className }) => {
  return (
    <SafeAreaView style={style} className={cn('bg-primary-950 flex-1', className)}>
      {children}
    </SafeAreaView>
  );
};

export default Container;
