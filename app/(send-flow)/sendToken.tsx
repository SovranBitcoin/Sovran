/**
 * @fileoverview Send-flow sendToken route — final screen of the active
 * send flow. The route body and zod schema live on `SendTokenRoute`.
 * `Stack.Screen` title comes from `(send-flow)/_layout.tsx`.
 */

import { SendTokenRoute } from '@/features/send';

export default function ModalScreen() {
  return <SendTokenRoute where="send-flow.sendToken" />;
}
