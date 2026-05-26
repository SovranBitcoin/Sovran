/**
 * @fileoverview Standalone Onchain send route.
 */

import { OnchainSendRoute } from '@/features/send';

export default function OnchainSendStandaloneRoute() {
  return <OnchainSendRoute where="app.onchainSend" />;
}
