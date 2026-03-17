import type { Detectors, WalletContext } from '../coco-payment-ux/src/types';
import { transition } from '../coco-payment-ux/src/machine/transitions';
import type { FlowContext } from '../coco-payment-ux/src/machine/types';

const CASHU_PAYMENT_REQUEST_NUT18 =
  'creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF4Imh0dHBzOi8vbm9mZWVzLnRlc3RudXQuY2FzaHUuc3BhY2U=';

function createWalletContext(proofAmounts: number[] = [2, 8]): WalletContext {
  return {
    trustedMintUrls: ['https://mint.test'],
    mintBalances: { 'https://mint.test': 1_000 },
    preferredMintUrl: 'https://mint.test',
    proofAmounts: { 'https://mint.test': proofAmounts },
  };
}

const testDetectors: Detectors = {
  isValidEcashToken: () => false,
  isPaymentRequest: (value) => value.startsWith('creq'),
  isLightningInvoice: () => false,
  isLightningAddress: () => false,
  isLnurlp: () => false,
  getLightningAmount: () => null,
  getPaymentRequestInfo: (value) =>
    value.startsWith('creq')
      ? {
          mints: ['https://mint.test'],
          amount: undefined,
          unit: 'sat',
          transports: [],
        }
      : null,
  parseNpub: () => null,
};

describe('payment flow transitions', () => {
  it('keeps payment-request context when entering an amount on the same destination', () => {
    const walletContext = createWalletContext();
    const executeResult = transition(
      'idle',
      { unit: 'sat' },
      { type: 'EXECUTE', input: CASHU_PAYMENT_REQUEST_NUT18 },
      testDetectors,
      walletContext,
      'sat'
    );

    expect(executeResult.step).toBe('enterAmount');

    const amountResult = transition(
      executeResult.step,
      executeResult.context,
      {
        type: 'AMOUNT_ENTERED',
        amount: 10,
        mintUrl: 'https://mint.test',
        destination: 'paymentRequest',
      },
      testDetectors,
      walletContext,
      'sat'
    );

    expect(amountResult.step).toBe('navigateToPaymentRequest');
    expect(amountResult.context.paymentRequest).toBe(CASHU_PAYMENT_REQUEST_NUT18);
    expect(amountResult.data).toMatchObject({
      mintUrl: 'https://mint.test',
      paymentRequest: CASHU_PAYMENT_REQUEST_NUT18,
      amount: 10,
      unit: 'sat',
    });
  });

  it('does not force proof selection for an exact offline-sendable amount', () => {
    const walletContext = createWalletContext([2, 8]);
    const currentContext: FlowContext = {
      unit: 'sat',
      destination: 'sendEcash',
      mintUrl: 'https://mint.test',
    };

    const result = transition(
      'enterAmount',
      currentContext,
      {
        type: 'AMOUNT_ENTERED',
        amount: 10,
        mintUrl: 'https://mint.test',
        destination: 'sendEcash',
        offline: true,
      },
      testDetectors,
      walletContext,
      'sat'
    );

    expect(result.step).toBe('confirmSend');
    expect(result.data).toMatchObject({ mintUrl: 'https://mint.test', amount: 10 });
  });

  it('routes proof selection back to the payment-request preview', () => {
    const walletContext = createWalletContext();
    const currentContext: FlowContext = {
      unit: 'sat',
      destination: 'paymentRequest',
      mintUrl: 'https://mint.test',
      paymentRequest: CASHU_PAYMENT_REQUEST_NUT18,
    };

    const result = transition(
      'chooseProofs',
      currentContext,
      { type: 'PROOFS_CHOSEN', amount: 10 },
      testDetectors,
      walletContext,
      'sat'
    );

    expect(result.step).toBe('navigateToPaymentRequest');
    expect(result.data).toMatchObject({
      mintUrl: 'https://mint.test',
      paymentRequest: CASHU_PAYMENT_REQUEST_NUT18,
      amount: 10,
    });
  });

  it('routes proof selection back to the melt preview', () => {
    const walletContext = createWalletContext();
    const currentContext: FlowContext = {
      unit: 'sat',
      destination: 'meltQuote',
      mintUrl: 'https://mint.test',
      meltTarget: 'lnbc10u1p3example',
    };

    const result = transition(
      'chooseProofs',
      currentContext,
      { type: 'PROOFS_CHOSEN', amount: 10 },
      testDetectors,
      walletContext,
      'sat'
    );

    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.data).toMatchObject({
      mintUrl: 'https://mint.test',
      meltTarget: 'lnbc10u1p3example',
      amount: 10,
    });
  });
});
