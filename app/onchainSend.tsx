/**
 * @fileoverview Standalone Onchain send route.
 */

import { OnchainSendRoute } from '@/features/send';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function OnchainSendStandaloneRoute() {
  return (
    <FormSheetChrome title="Send Onchain">
      <OnchainSendRoute where="app.onchainSend" />
    </FormSheetChrome>
  );
}
