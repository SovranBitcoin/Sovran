/**
 * @fileoverview Receive-flow receiveToken route — final screen of the
 * active receive flow. The route body and zod schema live on
 * `ReceiveTokenRoute`. `Stack.Screen` title comes from
 * `(receive-flow)/_layout.tsx`.
 */

import { ReceiveTokenRoute } from '@/features/receive';

export default function ModalScreen() {
  return <ReceiveTokenRoute where="receive-flow.receiveToken" />;
}
