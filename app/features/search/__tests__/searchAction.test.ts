/**
 * Search's paste-to-pay: what a query is decides the action card, and whether
 * it may reach the remote people search or recent searches at all.
 */
import { defaultDetectors } from 'wallet';

import { INPUTS, WALLETS } from '../../../../wallet/__tests__/_harness/fixtures';
import {
  classifySearchQuery,
  isRecordableSearch,
  remoteSearchText,
} from '@/features/search/lib/searchAction';

const classify = (query: string) => classifySearchQuery(query, defaultDetectors, WALLETS.default);
const allOn = () => true;

describe('classifySearchQuery: paste-to-pay', () => {
  it.each([
    ['a bolt11 invoice', INPUTS.bolt11WithAmount, 'lightningInvoice'],
    ['an ecash token', INPUTS.cashuTokenV3, 'ecash'],
    ['a payment request', INPUTS.paymentRequestBasic, 'paymentRequest'],
    ['a bitcoin: link', INPUTS.bip321OnchainWithAmount, 'onchain'],
    ['an npub', INPUTS.npub, 'person'],
    ['a Lightning address', INPUTS.lightningAddress, 'person'],
    ['a mint address', INPUTS.mintUrl, 'mint'],
  ])('offers an action for %s', (_name, input, kind) => {
    const result = classify(`  ${input}  `);
    expect(result.kind).toBe('payment');
    if (result.kind !== 'payment') return;
    expect(result.descriptor.kind).toBe(kind);
    expect(result.descriptor.raw).toBe(input);
  });

  it('never sends a payment string to the remote search or recent searches', () => {
    for (const input of [
      INPUTS.cashuTokenV3,
      INPUTS.bolt11WithAmount,
      INPUTS.paymentRequestBasic,
    ]) {
      const result = classify(input);
      expect(remoteSearchText(result, allOn)).toBe('');
      expect(isRecordableSearch(result)).toBe(false);
    }
  });

  it('treats names as words to search', () => {
    expect(classify('a')).toEqual({ kind: 'text', query: 'a' });
    expect(classify('alice')).toEqual({ kind: 'text', query: 'alice' });
    expect(classify('alice bob')).toEqual({ kind: 'text', query: 'alice bob' });
    expect(remoteSearchText(classify('alice'), allOn)).toBe('alice');
    expect(isRecordableSearch(classify('alice'))).toBe(true);
  });

  it('is empty for whitespace', () => {
    expect(classify('   ')).toEqual({ kind: 'empty' });
    expect(remoteSearchText(classify(''), allOn)).toBe('');
  });
});

describe('classifySearchQuery: secrets', () => {
  const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
  it.each([
    ['a nostrconnect:// pairing link', 'nostrconnect://abc?relay=wss%3A%2F%2Fr&secret=s3cret'],
    ['a bunker:// pairing link', 'bunker://ab12?relay=wss://relay.example&secret=s3cret'],
    ['a private key', NSEC],
    ['a percent-encoded private key', encodeURIComponent(`nostr:${NSEC}`)],
  ])('gives %s no action and keeps it on the phone', (_name, input) => {
    const result = classify(input);
    expect(result).toEqual({ kind: 'sensitive' });
    expect(remoteSearchText(result, allOn)).toBe('');
    expect(isRecordableSearch(result)).toBe(false);
  });
});

describe('remoteSearchText: build modules', () => {
  it('sends nothing when the build ships no people search', () => {
    expect(remoteSearchText(classify('alice'), (feature) => feature !== 'nostrSearch')).toBe('');
  });
});
