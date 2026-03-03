import React from 'react';

/**
 * @deprecated Action sheets now use the popup system (PopupHost in _layout).
 * This HOC is a no-op — sheets work without it.
 */
export const withSheetProvider = <P extends object>(
  Wrapped: React.ComponentType<P>
): React.ComponentType<P> => Wrapped;
