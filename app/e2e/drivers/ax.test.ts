import { describe, expect, it } from 'bun:test';
import {
  classifyObservedState,
  elementTapCenter,
  normalizeWs,
  selectorMatches,
  findElement,
  parseSseData,
  parseBalanceSat,
  toAxNode,
  type AxSnapshot,
  type AxElement,
} from './ax';

const el = (o: Partial<AxElement>): AxElement => ({
  frame: { x: 100, y: 200, width: 50, height: 20 },
  ...o,
});
const snap = (elements: AxElement[]): AxSnapshot => ({
  screen: { width: 400, height: 800 },
  elements,
});

describe('selectorMatches', () => {
  it('matches exact id, id prefix, and whitespace-normalized label', () => {
    expect(selectorMatches(el({ id: 'send-paste' }), { id: 'send-paste' })).toBe(true);
    expect(selectorMatches(el({ id: 'send-token-id-abc' }), { idPrefix: 'send-token-id-' })).toBe(
      true
    );
    expect(selectorMatches(el({ id: 'other' }), { id: 'send-paste' })).toBe(false);
    // the app renders a thin space in "₿ 100"
    expect(selectorMatches(el({ label: '₿ 100' }), { label: '₿ 100' })).toBe(true);
  });
});

describe('findElement', () => {
  it('ignores off-screen elements', () => {
    const offscreen = el({ label: 'Ghost', frame: { x: -500, y: -500, width: 10, height: 10 } });
    expect(findElement(snap([offscreen]), { label: 'Ghost' })).toBeNull();
  });
  it('finds an on-screen match', () => {
    const node = findElement(snap([el({ label: 'Next' })]), { label: 'Next' });
    expect(node?.label).toBe('Next');
  });
  it('rejects ambiguous dynamic-id capture matches', () => {
    expect(() =>
      findElement(snap([el({ id: 'send-token-id-abc' }), el({ id: 'send-token-id-def' })]), {
        idPrefix: 'send-token-id-',
        captureSuffixAs: 'sendTx',
      })
    ).toThrow(/ambiguous.*send-token-id-/i);
  });
  it('selects indexed visible prefix matches in visual order and folds duplicate ids', () => {
    const top = el({
      id: 'contact-row:mint:https://top.example',
      frame: { x: 20, y: 100, width: 300, height: 60 },
    });
    const bottom = el({
      id: 'contact-row:mint:https://bottom.example',
      frame: { x: 20, y: 300, width: 300, height: 60 },
    });
    const duplicateTop = el({
      id: top.id,
      frame: { x: 20, y: 101, width: 300, height: 60 },
    });
    const snapshot = snap([bottom, duplicateTop, top]);

    expect(
      findElement(snapshot, {
        idPrefix: 'contact-row:mint:',
        matchIndex: 0,
        captureSuffixAs: 'mintOneUrl',
      })?.id
    ).toBe(top.id);
    expect(
      findElement(snapshot, {
        idPrefix: 'contact-row:mint:',
        matchIndex: 1,
        captureSuffixAs: 'mintTwoUrl',
      })?.id
    ).toBe(bottom.id);
    expect(findElement(snapshot, { idPrefix: 'contact-row:mint:', matchIndex: 2 })).toBeNull();
  });
});

describe('toAxNode checked-control values', () => {
  it.each([
    ['radio button, checked, 1', '1'],
    ['radio button, unchecked, 0', '0'],
    ['checkbox, checked, 1', '1'],
    ['checkbox, unchecked, 0', '0'],
    ['switch, checked, 1', '1'],
    ['switch, unchecked, 0', '0'],
  ])('normalizes the iOS composite %s to %s', (value, expected) => {
    expect(toAxNode(el({ value })).value).toBe(expected);
  });

  it.each([
    'button, checked, 1',
    'radio button, checked, 0',
    'checkbox, unchecked, 1',
    'switch, mixed, 1',
    'radio button, checked, 1, extra',
    '1',
  ])('preserves the nonmatching value %s', (value) => {
    expect(toAxNode(el({ value })).value).toBe(value);
  });

  it.each(['profile-secret-value-mnemonic', 'profile-secret-value-nsec'])(
    'redacts %s while preserving stable selector state',
    (id) => {
      const node = toAxNode(
        el({
          id,
          label: 'raw-private-label',
          value: 'raw-private-value',
          role: 'text',
          enabled: false,
          frame: { x: -500, y: -500, width: 10, height: 10 },
        })
      );

      expect(node).toEqual({
        id,
        label: '‹profile-secret:redacted›',
        value: '‹profile-secret:redacted›',
        role: 'text',
        state: { enabled: false },
      });
    }
  );
});

describe('elementTapCenter', () => {
  it('uses the ordinary accessibility frame for normal controls', () => {
    expect(elementTapCenter(el({}), snap([]).screen)).toEqual({ x: 0.3125, y: 0.2625 });
  });

  it('uses an app-measured FullWindowOverlay row target when present', () => {
    expect(
      elementTapCenter(el({ value: 'e2e-action-menu-target:200.000:720.000' }), snap([]).screen)
    ).toEqual({ x: 0.5, y: 0.9 });
  });

  it('rejects an app-measured target outside the current screen', () => {
    expect(
      elementTapCenter(el({ value: 'e2e-action-menu-target:200.000:900.000' }), snap([]).screen)
    ).toBeNull();
  });
});

describe('parseSseData', () => {
  it('parses a data line and ignores keep-alives', () => {
    expect(parseSseData('data: {"screen":{"width":1,"height":1},"elements":[]}')).not.toBeNull();
    expect(parseSseData(':keep-alive')).toBeNull();
    expect(parseSseData('data: ')).toBeNull();
  });

  it('redacts a retained secret-profile node before it can leave the SSE parser', () => {
    const parsed = parseSseData(
      `data: ${JSON.stringify({
        screen: { width: 400, height: 800 },
        elements: [
          {
            id: 'profile-secret-value-cashuMnemonic',
            label: 'raw-private-label',
            value: 'raw-private-value',
            frame: { x: -500, y: -500, width: 10, height: 10 },
          },
        ],
      })}`
    );

    expect(parsed?.elements[0]).toMatchObject({
      id: 'profile-secret-value-cashuMnemonic',
      label: '‹profile-secret:redacted›',
      value: '‹profile-secret:redacted›',
    });
  });
});

describe('parseBalanceSat', () => {
  it('extracts positive, negative, and thin-space balances', () => {
    expect(parseBalanceSat('₿ 100')).toBe(100);
    expect(parseBalanceSat('₿ 1,050')).toBe(1050);
    expect(parseBalanceSat('-₿40')).toBe(-40);
    expect(parseBalanceSat('No History')).toBeNull();
  });
});

describe('normalizeWs', () => {
  it('collapses whitespace', () => expect(normalizeWs('  a  b ')).toBe('a b'));
});

describe('classifyObservedState', () => {
  const walletElements = [el({ id: 'wallet-receive' }), el({ id: 'wallet-send' })];

  it('requires the dedicated pair of wallet controls', () => {
    expect(classifyObservedState(snap(walletElements))).toBe('wallet');
    expect(
      classifyObservedState(snap([el({ id: 'wallet-send' }), el({ label: 'No History' })]))
    ).toBe('unknown');
  });

  it('does not mistake background wallet controls for an active payment flow', () => {
    expect(
      classifyObservedState(snap([...walletElements, el({ id: 'send-destination-input' })]))
    ).toBe('unknown');
    expect(
      classifyObservedState(snap([...walletElements, el({ id: 'payment-info-address-data' })]))
    ).toBe('unknown');
  });

  it('recognizes onboarding before stale wallet controls', () => {
    expect(
      classifyObservedState(snap([...walletElements, el({ label: 'Welcome to Sovran' })]))
    ).toBe('onboarding');
  });
});
