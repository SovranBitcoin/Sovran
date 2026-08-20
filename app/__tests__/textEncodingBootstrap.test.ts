/**
 * @jest-environment node
 */

import '@bacons/text-decoder/install';

describe('UTF-8 runtime bootstrap', () => {
  it('encodes and decodes Unicode with the runtime globals', () => {
    const encoded = new TextEncoder().encode('Sovran 🔐');
    expect(new TextDecoder().decode(encoded)).toBe('Sovran 🔐');
  });

  it('preserves streaming decode across a split multibyte sequence', () => {
    const decoder = new TextDecoder('utf-8');
    expect(decoder.decode(new Uint8Array([0xe2, 0x82]), { stream: true })).toBe('');
    expect(decoder.decode(new Uint8Array([0xac]))).toBe('€');
  });

  it('decodes only the selected typed-array view', () => {
    const backing = new Uint8Array([0xff, 0x53, 0x6f, 0x76, 0xff]);
    expect(new TextDecoder().decode(backing.subarray(1, 4))).toBe('Sov');
  });

  it('flushes a truncated stream according to replacement or fatal mode', () => {
    const replacing = new TextDecoder();
    expect(replacing.decode(new Uint8Array([0xe2]), { stream: true })).toBe('');
    expect(replacing.decode()).toBe('�');

    const fatal = new TextDecoder('utf-8', { fatal: true });
    expect(fatal.decode(new Uint8Array([0xe2]), { stream: true })).toBe('');
    expect(() => fatal.decode()).toThrow();
  });

  it('supports replacement and fatal handling for malformed UTF-8', () => {
    const malformed = new Uint8Array([0xc3, 0x28]);
    expect(new TextDecoder().decode(malformed)).toBe('�(');
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(malformed)).toThrow();
  });

  it('handles the UTF-8 byte-order mark according to ignoreBOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(new TextDecoder('utf-8').decode(withBom)).toBe('a');
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(withBom)).toBe('\ufeffa');
  });
});
