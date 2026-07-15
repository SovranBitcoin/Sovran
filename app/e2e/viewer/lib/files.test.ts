import { describe, expect, test } from 'bun:test';

import { parseByteRange } from './files';

// <video> playback depends on correct 206 semantics: Safari refuses to play
// without range support, Chrome needs it to seek. Bad parses must fall back to
// a full-body 200 (undefined), never a wrong slice.
describe('parseByteRange', () => {
  test('parses explicit, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=200-', 1000)).toEqual({ start: 200, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  test('clamps an end past the file size', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  test('falls back to full-body for multi-range, inverted, or malformed headers', () => {
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=500-100', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=-', 1000)).toBeUndefined();
    expect(parseByteRange('octets=0-1', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=2000-', 1000)).toBeUndefined();
  });
});
