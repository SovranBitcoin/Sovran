/**
 * @fileoverview Standalone Onchain send route.
 */

import { OnchainSendRoute } from '@/features/send';
import { railHeaderTitle } from 'wallet';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function OnchainSendStandaloneRoute() {
  return (
    <FormSheetChrome title={railHeaderTitle('onchainSend')}>
      <OnchainSendRoute where="app.onchainSend" />
    </FormSheetChrome>
  );
}
