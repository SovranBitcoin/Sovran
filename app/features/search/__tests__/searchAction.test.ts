/**
 * Search's paste-to-pay: what a query is decides the action card, and whether
 * it may reach the remote people search or recent searches at all.
 */
import { defaultDetectors } from 'wallet';

import { INPUTS, WALLETS } from '../../../../wallet/__tests__/_harness/fixtures';
import { isSensitiveScanInput } from '@/shared/stores/profile/scanHistoryStore';
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

describe('classifySearchQuery: payment strings inside words', () => {
  const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
  it.each([
    ['a labelled ecash token', `pay ${INPUTS.cashuTokenV3}`],
    ['a labelled V4 token', 'here is cashuBo2FteBtodHRwczovL21pbnQuZXhhbXBsZS5jb20'],
    ['a labelled invoice', `invoice: ${INPUTS.bolt11WithAmount}`],
    ['a quoted invoice', `"${INPUTS.bolt11WithAmount}"`],
    ['a labelled payment request', `request ${INPUTS.paymentRequestBasic}`],
    ['a parenthesised token', `(${INPUTS.cashuTokenV3})`],
    [
      'a labelled offer',
      'offer lno1qcp4256ypqpq86q2pucnq42ngssx2an9wfujqerp0y2pqun4wd68jtn00fkxzcnn9ehhyec6qgqsz',
    ],
    [
      'a labelled LNURL',
      'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns',
    ],
    ['a parenthesised private key', `(${NSEC})`],
    ['a parenthesised bunker link', '(bunker://abc?secret=s)'],
    ['a parenthesised nostrconnect link', '(nostrconnect://abc?secret=s)'],
    ['a labelled private key', `my key: ${NSEC}`],
  ])('never sends %s to the remote search or recent searches', (_name, input) => {
    const result = classify(input);
    expect(remoteSearchText(result, allOn)).toBe('');
    expect(isRecordableSearch(result)).toBe(false);
  });

  it.each([
    ['a percent-encoded labelled token', `pay%20${INPUTS.cashuTokenV3}`],
    ['a doubly encoded labelled token', `pay%2520${INPUTS.cashuTokenV3}`],
    ['an encoded quoted invoice', `%22${INPUTS.bolt11WithAmount}%22`],
    ['a labelled regtest invoice', 'invoice: lnbcrt10u1pjqxyzpp5qqqsyqcyq5rqwzqfqypqhp58yjmdan'],
    ['an encoded regtest invoice', 'invoice%3A%20lnbcrt10u1pjqxyzpp5qqqsyqcyq5rqwzqfqypq'],
    [
      'an encoded private key',
      'key%3A%20nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5',
    ],
  ])('never sends %s to the remote search or recent searches', (_name, input) => {
    const result = classify(input);
    expect(result.kind).toBe('sensitive');
    expect(remoteSearchText(result, allOn)).toBe('');
    expect(isRecordableSearch(result)).toBe(false);
  });

  it('still searches words with an ordinary percent sign', () => {
    for (const words of ['100% sats', 'lnbc 50%']) {
      expect(remoteSearchText(classify(words), allOn)).toBe(words);
    }
  });

  it('still searches words that only start like a payment string', () => {
    for (const words of ['lnbc meetup', 'cashu wallets', 'bunker hill', 'creq']) {
      expect(remoteSearchText(classify(words), allOn)).toBe(words);
    }
  });
});

describe('isSensitiveScanInput: secrets behind punctuation', () => {
  const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
  it.each([
    `(${NSEC})`,
    `[${NSEC}]`,
    `"${NSEC}"`,
    `key:${NSEC}`,
    '(bunker://abc?secret=s)',
    '"nostrconnect://abc?secret=s"',
    '<bunker://abc?secret=s>',
  ])('keeps %s out of scan history', (input) => {
    expect(isSensitiveScanInput(input)).toBe(true);
  });

  it('does not match a key name inside a longer word', () => {
    expect(isSensitiveScanInput('xnsec1abc')).toBe(false);
    expect(isSensitiveScanInput('notbunker://x')).toBe(false);
  });
});

describe('remoteSearchText: build modules', () => {
  it('sends nothing when the build ships no people search', () => {
    expect(remoteSearchText(classify('alice'), (feature) => feature !== 'nostrSearch')).toBe('');
  });
});
