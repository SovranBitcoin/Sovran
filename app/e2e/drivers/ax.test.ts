import { describe, expect, it } from 'bun:test';
import {
  classifyObservedState,
  normalizeWs,
  selectorMatches,
  findElement,
  parseSseData,
  parseBalanceSat,
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
});

describe('parseSseData', () => {
  it('parses a data line and ignores keep-alives', () => {
    expect(parseSseData('data: {"screen":{"width":1,"height":1},"elements":[]}')).not.toBeNull();
    expect(parseSseData(':keep-alive')).toBeNull();
    expect(parseSseData('data: ')).toBeNull();
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
