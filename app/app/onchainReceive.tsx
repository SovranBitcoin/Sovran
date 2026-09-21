/**
 * @fileoverview Standalone Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';
import { railHeaderTitle } from 'wallet';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function OnchainReceiveStandaloneRoute() {
  return (
    <FormSheetChrome title={railHeaderTitle('onchainReceive')}>
      <OnchainReceiveRoute where="app.onchainReceive" />
    </FormSheetChrome>
  );
}
