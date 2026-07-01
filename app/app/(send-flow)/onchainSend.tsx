/**
 * @fileoverview Send-flow Onchain send route.
 */

import { OnchainSendRoute } from '@/features/send';

export default function OnchainSendRouteWrapper() {
  return <OnchainSendRoute where="send-flow.onchainSend" />;
}
