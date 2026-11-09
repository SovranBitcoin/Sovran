/**
 * @jest-environment node
 *
 * "Choose how to pay" in the picker sheet: the rows it asks for, and what a
 * pick or a pull-down tells the payment machine.
 */

import type { AnnotatedOption, StepDataMap } from 'wallet';

import {
  chooseFallbackPaymentOption,
  choosePaymentOption,
} from '@/features/send/lib/paymentOptionPicker';
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
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: 'AmountFormatter' }));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/errors', () => ({
  describeWalletFailure: ({ message }: { message: string }) => `described: ${message}`,
}));
jest.mock('wallet', () => ({
  decodeEcashTokenMetadata: () => ({ amount: 21 }),
  defaultDetectors: { getPaymentRequestInfo: () => null },
}));

const annotated = (
  option: AnnotatedOption['option'],
  status: AnnotatedOption['status'],
  reason: string | null = null
): AnnotatedOption => ({
  option,
  status,
  reason: reason === null ? null : { code: 'test', message: reason },
});
const lightning = annotated(
  { kind: 'lightningInvoice', value: 'lnbc1...', source: 'bip321', paramKey: 'lightning' },
  'recommended'
);
const onchain = annotated(
  { kind: 'onchainAddress', value: 'bc1q...', amount: 5000, source: 'bip321' },
  'available'
);
const token = annotated(
  { kind: 'ecashToken', value: 'cashuB...', source: 'standalone' },
  'disabled',
  'Mint not trusted'
);
/** Only the fields the picker reads; the machine is a mock. */
const step = (
  options: AnnotatedOption[],
  failed?: Partial<StepDataMap['chooseFallbackOption']>
) => {
  const data = { options, unit: 'sat', ...failed };
  return data as never;
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sessions.length = 0;
});

describe('choosing how to pay', () => {
  it('lists each method with its amount, keeping the bearer value out of the sheet', () => {
    const machine = { chooseOption: jest.fn() };
    choosePaymentOption(step([lightning, onchain, token]), machine as never);
    const { request } = sessions[0]!;
    expect(request.title).toBe('Choose how to pay');
    expect(request.options!.map((row) => [row.id, row.title, row.testID])).toEqual([
      ['0', 'Lightning', 'payment-option-lightningInvoice-lightning'],
      ['1', 'Onchain', 'payment-option-onchainAddress'],
      ['2', 'Cashu', 'payment-option-ecashToken'],
    ]);
    expect(request.options![0]).toMatchObject({ description: 'Recommended', disabled: false });
    expect(request.options![1]!.trailing).toBeDefined();
    expect(request.options![2]).toMatchObject({ disabled: true, reason: 'Mint not trusted' });
    expect(JSON.stringify(request)).not.toContain('cashuB');
  });

  it('hands the picked option to the machine once the sheet has gone', async () => {
    const machine = { chooseOption: jest.fn(async () => {}) };
    choosePaymentOption(step([lightning, onchain]), machine as never);
    const session = sessions[0]!;
    session.answer({ kind: 'option', id: '1' });
    await flush();
    expect(machine.chooseOption).not.toHaveBeenCalled();
    session.close();
    await flush();
    expect(machine.chooseOption).toHaveBeenCalledWith(onchain.option);
  });

  it('tells the opener when the sheet goes without a choice', async () => {
    const machine = { chooseOption: jest.fn() };
    const onDismiss = jest.fn();
    choosePaymentOption(step([lightning]), machine as never, onDismiss);
    sessions[0]!.answer({ kind: 'dismissed' });
    await flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(machine.chooseOption).not.toHaveBeenCalled();
  });
});

describe('trying another method after a failure', () => {
  it('dims the failed method in the danger colour with its reason', () => {
    const machine = { chooseOption: jest.fn() };
    chooseFallbackPaymentOption(
      step([lightning, onchain], {
        failedOptionValues: ['lnbc1...'],
        lastFailedMessage: 'Route not found',
      }),
      machine as never
    );
    const { request } = sessions[0]!;
    expect(request.title).toBe('Payment failed — try another method');
    expect(request.options![0]).toMatchObject({
      disabled: true,
      isCaution: true,
      reason: 'described: Route not found',
    });
    expect(request.options![1]).toMatchObject({ disabled: false, isCaution: false });
  });
});
