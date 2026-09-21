/**
 * @fileoverview Send-flow Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';
import { useSendFlowMintListRequest } from '@/features/send/hooks/useSendFlowMintListRequest';

export default function LightningSendRouteWrapper() {
  const handleRequestMintList = useSendFlowMintListRequest();

  return (
    <LightningSendRoute where="send-flow.lightningSend" onRequestMintList={handleRequestMintList} />
  );
}
