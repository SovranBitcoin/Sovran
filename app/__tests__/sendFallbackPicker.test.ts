/**
 * @jest-environment node
 *
 * "Send another way" in the picker sheet: the failed way stays listed but
 * cannot be picked, an alternative retries once the sheet has gone, and
 * pulling the sheet down backs out of the retry.
 */

import type { StepDataMap } from 'wallet';

import { chooseSendFallback } from '@/features/send/lib/sendFallbackPicker';
import type { PickerRequest, PickerResult } from '@/shared/lib/picker/types';

type Session = {
  request: PickerRequest;
  answer: (result: PickerResult) => void;
  close: () => void;
};
const sessions: Session[] = [];
jest.mock('@/shared/lib/picker/openPicker', () => ({
  openPicker: (request: PickerRequest) => {
    let answer!: (result: PickerResult) => void;
    let close!: () => void;
    const result = new Promise<PickerResult>((resolve) => (answer = resolve));
    const closed = new Promise<void>((resolve) => (close = resolve));
    sessions.push({ request, answer, close });
    return { result, closed, update: jest.fn() };
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/errors', () => ({
  describeWalletFailure: ({ message }: { message: string }) => `described: ${message}`,
}));

const step: StepDataMap['chooseSendFallback'] = {
  amount: 10,
  unit: 'sat',
  failed: { label: 'Locked ecash', message: 'Mint refused the lock' },
  alternatives: [
    {
      id: 'ecash',
      label: 'Plain ecash',
      description: 'Anyone holding it can claim it',
      isCaution: true,
    },
    { id: 'lightning-npc', label: 'Their Lightning address', description: 'Via npub.cash' },
  ],
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sessions.length = 0;
});

it('lists the failed way first, dimmed, then each alternative', () => {
  const machine = { chooseSendFallback: jest.fn() };
  chooseSendFallback(step, machine as never);
  const { request } = sessions[0]!;
  expect(request.title).toBe('Payment failed — send another way');
  expect(request.options!.map((row) => row.testID)).toEqual([
    'send-fallback-failed',
    'send-fallback-ecash',
    'send-fallback-lightning-npc',
  ]);
  expect(request.options![0]).toMatchObject({
    disabled: true,
    isCaution: true,
    reason: 'described: Mint refused the lock',
  });
  expect(request.options![1]).toMatchObject({ isCaution: true });
  expect(request.options![2]).toMatchObject({ isCaution: false });
});

it('retries with the picked alternative once the sheet has gone', async () => {
  const machine = { chooseSendFallback: jest.fn(async () => {}) };
  chooseSendFallback(step, machine as never);
  const session = sessions[0]!;
  session.answer({ kind: 'option', id: 'lightning-npc' });
  await flush();
  expect(machine.chooseSendFallback).not.toHaveBeenCalled();
  session.close();
  await flush();
  expect(machine.chooseSendFallback).toHaveBeenCalledWith('lightning-npc');
});

it('backs out of the retry when the sheet goes without a pick', async () => {
  const machine = { chooseSendFallback: jest.fn(async () => {}) };
  chooseSendFallback(step, machine as never);
  sessions[0]!.answer({ kind: 'dismissed' });
  await flush();
  expect(machine.chooseSendFallback).toHaveBeenCalledWith(null);
});
