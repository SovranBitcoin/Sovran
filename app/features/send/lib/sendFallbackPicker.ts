/**
 * @fileoverview "Send another way": the machine's `chooseSendFallback` step,
 * in the picker sheet.
 *
 * A send picked from the amount screen failed, and a different way to pay
 * the same person can still work. The failed way stays at the top, dimmed in
 * the danger colour with its reason; each alternative is one tap, drawn as a
 * caution when it carries a caveat. The retry starts once the sheet has gone,
 * since it shows the sending toast. Pulling the sheet down backs out of the
 * retry, exactly as the old sheet did when it unmounted without a pick.
 */

import type { PaymentMachine, StepDataMap } from 'wallet';

import { describeWalletFailure } from '@/shared/lib/errors';
import { cashuLog } from '@/shared/lib/logger';
import { openPicker } from '@/shared/lib/picker/openPicker';

const ICONS: Record<string, string> = {
  ecash: 'ph:coins',
  'lightning-npc': 'mingcute:lightning-fill',
};

export function chooseSendFallback(
  stepData: StepDataMap['chooseSendFallback'],
  machine: PaymentMachine
): void {
  const { failed, alternatives } = stepData;
  cashuLog.info('payment.send_fallback.popup', {
    alternatives: alternatives.map((alternative) => alternative.id),
  });
  const picker = openPicker({
    title: 'Payment failed — send another way',
    testID: 'send-fallback',
    options: [
      {
        id: 'failed',
        title: failed.label,
        leading: { icon: { name: 'mdi:alert-circle-outline' } },
        reason: describeWalletFailure(failed),
        disabled: true,
        isCaution: true,
        testID: 'send-fallback-failed',
      },
      ...alternatives.map((alternative) => ({
        id: alternative.id,
        title: alternative.label,
        leading: { icon: { name: ICONS[alternative.id] ?? 'ph:coins' } },
        description: alternative.description,
        isCaution: alternative.isCaution === true,
        testID: `send-fallback-${alternative.id}`,
      })),
    ],
  });
  void picker.result.then(async (result) => {
    const chosen =
      result.kind === 'option'
        ? alternatives.find((alternative) => alternative.id === result.id)
        : undefined;
    if (!chosen) {
      cashuLog.info('payment.send_fallback.dismissed');
      void machine.chooseSendFallback(null);
      return;
    }
    cashuLog.info('payment.send_fallback.choice', { id: chosen.id });
    // The retry shows the sending toast, which would sit beneath a closing sheet.
    await picker.closed;
    void machine.chooseSendFallback(chosen.id);
  });
}
