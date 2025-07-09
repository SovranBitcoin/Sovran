import { barcodeHandler } from '../helper/payment-handler/handlers';
import { URDecoder } from '@gandlaf21/bc-ur';

jest.mock('../components/cashu', () => ({
  getLightningAmount: jest.fn(() => 11),
  getMeltQuote: jest.fn(async () => ({ fee_reserve: 1 })),
  isValidEcashToken: jest.fn(() => false),
}));

jest.mock('../helper/redux/cashu', () => ({
  memoizedGetBalance: jest.fn(() => () => 100),
}));

jest.mock('../helper/redux/store', () => ({
  store: { getState: jest.fn(() => ({ nostr: { currentProfile: { id: '1' } } })) },
}));

describe('barcodeHandler', () => {
  it('handles lightning invoice', async () => {
    const navigation = { isFocused: () => true, navigate: jest.fn() } as any;
    const result = await barcodeHandler({
      scanning: { data: 'lnbc110n1p5xuthlpp5evnghfka2kp2f7v0y3f6n8gpfdrjmcx3ldt965507hf36ge7y8rqhp5zujzdtkdqzav44eqv382fwgk88v06uydkwphqy7vkepmx5ew3g6qcqzzsxqzpmsp5vpean930jgmamnka05wf8x452lms4zkm0ygut72y23n4vlkhelms9qxpqysgqhzwz8a9zvrc3vnzem5rnqm0pyf0kr790rqv4fgjqr0s0tw6g2j33r5g06l4c9ep3a4sk8c32cqznnq5w88aq4576sqjlpp07x9qt9kqqzeaafp' },
      navigation,
      urDecoder: new URDecoder(),
      unit: 'sat',
      selectedMint: 'https://mint.example.com',
      setLoading: () => {},
    });
    expect(result.isOk()).toBe(true);
    expect(navigation.navigate).toHaveBeenCalledWith(
      'lightningSendConfirmation',
      expect.any(Object),
      { closeCurrentAndParent: true }
    );
  });
});
