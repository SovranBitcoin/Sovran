/**
 * @fileoverview Transactions-flow sendToken route — re-entry from the
 * transactions list. The route body and zod schema live on
 * `SendTokenRoute`. `Stack.Screen` title comes from
 * `(transactions-flow)/_layout.tsx`.
 */

import { SendTokenRoute } from '@/features/send';

export default function ModalScreen() {
  return <SendTokenRoute where="transactions-flow.sendToken" />;
}
