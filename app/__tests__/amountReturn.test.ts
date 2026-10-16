import { isMintPickerOverAmount } from '@/features/send/lib/amountReturn';

const flow = (group: string, names: string[], index = names.length - 1) => ({
  name: group,
  state: { index, routes: names.map((name) => ({ name })) },
});
const root = (...routes: { name: string; state?: unknown }[]) => ({
  index: routes.length - 1,
  routes,
});

describe('isMintPickerOverAmount', () => {
  it('is true only when the amount screen is directly beneath the current picker', () => {
    expect(
      isMintPickerOverAmount(
        root({ name: '(drawer)' }, flow('(send-flow)', ['send', 'amount', 'mintSelect'])) as never,
        '(send-flow)'
      )
    ).toBe(true);
  });

  it('is false when the picker is the first screen of the flow', () => {
    expect(
      isMintPickerOverAmount(
        root({ name: '(drawer)' }, flow('(receive-flow)', ['mintSelect'])) as never,
        '(receive-flow)'
      )
    ).toBe(false);
  });

  it('is false when something else sits between, or the picker is not on top', () => {
    expect(
      isMintPickerOverAmount(
        root(flow('(send-flow)', ['amount', 'mintInfo', 'mintSelect'])) as never,
        '(send-flow)'
      )
    ).toBe(false);
    expect(
      isMintPickerOverAmount(root(flow('(send-flow)', ['amount'])) as never, '(send-flow)')
    ).toBe(false);
  });

  it('does not read another flow, and survives a navigator that is not ready', () => {
    expect(
      isMintPickerOverAmount(
        root(flow('(send-flow)', ['amount', 'mintSelect'])) as never,
        '(receive-flow)'
      )
    ).toBe(false);
    expect(isMintPickerOverAmount(undefined, '(send-flow)')).toBe(false);
  });
});
