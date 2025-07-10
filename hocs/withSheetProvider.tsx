import React from 'react';
import { SheetProvider } from 'react-native-actions-sheet';

export const withSheetProvider = <P extends object>(
  Wrapped: React.ComponentType<P>
): React.ComponentType<P> => {
  const Component = (props: P) => (
    <SheetProvider>
      <Wrapped {...props} />
    </SheetProvider>
  );

  Component.displayName = `withSheetProvider(${
    Wrapped.displayName || Wrapped.name || 'Component'
  })`;

  return Component;
};
