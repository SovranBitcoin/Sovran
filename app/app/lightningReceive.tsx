/**
 * @fileoverview Standalone Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';
import { View } from '@/shared/ui/primitives/View/View';

const ROUTE_READY_PROBE_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
} as const;

export default function LightningReceiveStandaloneRoute() {
  return (
    <FormSheetChrome title="Receive Lightning">
      {__DEV__ ? (
        <View
          testID="lightning-receive-standalone-ready"
          accessible
          accessibilityRole="text"
          accessibilityLabel="Standalone Lightning receive ready"
          importantForAccessibility="yes"
          collapsable={false}
          pointerEvents="none"
          style={ROUTE_READY_PROBE_STYLE}
        />
      ) : null}
      <LightningReceiveRoute where="app.lightningReceive" />
    </FormSheetChrome>
  );
}
