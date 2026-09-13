/**
 * @jest-environment node
 *
 * The QR placeholder's junk frames: same length ⇒ same module density as the
 * real payload (that is the whole point of the length hint), every frame
 * distinct so the cycle visibly animates, path geometry identical to the
 * live react-native-qrcode-svg stroke.
 */

import { create as createQrCode } from 'qrcode';

import {
  qrJunkPayload,
  qrMatrixPath,
  qrPlaceholderFrames,
  resetQrPlaceholderFrameCache,
  QR_PLACEHOLDER_FRAME_COUNT,
} from '@/shared/lib/qrPlaceholderFrames';
import {
  estimateBip321Length,
  expectedQrPayloadLength,
  rememberQrPayloadLength,
  resetQrPayloadLengths,
} from '@/shared/lib/qr';

const SAMPLE_UNIFIED_URI =
  'bitcoin:bc1pxyzabc0defghijklmnopqrstuvwxyz0123456789abcdefghijklmnop?lno=' +
  'lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqyq7yjp' +
  'yyvzq9sy6w2gw3jc4yjf4nvytrqmajv6xrp6hkjfyrq9ydjxx4pm3k5a4ha2jyk5d5q' +
  '&creq=creqAo2F0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OXJ4dW1uOGdoajd1bjlkM3NoanRud3ZzZXp1bW44Z2hqN3VuOWQzc2hqdG55djlraDJ1ZXdkOWhzejlyeHVtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OXJ4dW1uOGdoajd1bjlkM3NoanRueXY5a2gydWV3ZDlocw';

describe('qrJunkPayload', () => {
  it('is deterministic per seed, byte-mode text of the requested length', () => {
    expect(qrJunkPayload(3, 40)).toBe(qrJunkPayload(3, 40));
    expect(qrJunkPayload(3, 40)).not.toBe(qrJunkPayload(4, 40));
    expect(qrJunkPayload(0, 120)).toHaveLength(120);
    expect(qrJunkPayload(0, 120)).toMatch(/^[a-z0-9]+$/);
    // Must contain letters: digit-only junk would encode in numeric mode and
    // render a far sparser code than the payload it mimics.
    expect(qrJunkPayload(0, 120)).toMatch(/[a-z]/);
  });
});

describe('qrPlaceholderFrames', () => {
  beforeEach(() => resetQrPlaceholderFrameCache());

  it('matches the module density of a real payload of the same length', () => {
    const real = createQrCode(SAMPLE_UNIFIED_URI, { errorCorrectionLevel: 'M' });
    const frames = qrPlaceholderFrames(SAMPLE_UNIFIED_URI.length, 300);
    expect(frames).toHaveLength(QR_PLACEHOLDER_FRAME_COUNT);
    for (const frame of frames) expect(frame.modules).toBe(real.modules.size);
  });

  it('scales density with the length hint', () => {
    const [address] = qrPlaceholderFrames(62, 300);
    const [unified] = qrPlaceholderFrames(420, 300);
    expect(address.modules).toBeLessThan(unified.modules);
    expect(address.cellSize).toBeCloseTo(300 / address.modules);
  });

  it('yields distinct frames so the cycle visibly animates, and caches them', () => {
    const frames = qrPlaceholderFrames(200, 300);
    expect(new Set(frames.map((frame) => frame.d)).size).toBe(frames.length);
    expect(qrPlaceholderFrames(200, 300)).toBe(frames);
  });

  it('clamps absurd hints into the encodable range', () => {
    expect(qrPlaceholderFrames(0, 300)[0].modules).toBe(21);
    expect(() => qrPlaceholderFrames(50_000, 300)).not.toThrow();
  });
});

describe('qrMatrixPath', () => {
  it('draws one horizontal stroke per run of dark modules, like react-native-qrcode-svg', () => {
    // 3×3: row 0 = ■■□, row 1 = □□□, row 2 = ■□■
    const data = [1, 1, 0, 0, 0, 0, 1, 0, 1];
    const { d, cellSize } = qrMatrixPath(data, 3, 30);
    expect(cellSize).toBe(10);
    expect(d).toBe('M0 5 L20 5 M0 25 L10 25 M20 25 L30 25 ');
  });
});

describe('expectedQrPayloadLength', () => {
  beforeEach(() => resetQrPayloadLengths());

  it('prefers the last rendered length, then the caller fallback, then the estimate', () => {
    expect(expectedQrPayloadLength('address')).toBe(62);
    expect(expectedQrPayloadLength('address', 70)).toBe(70);
    rememberQrPayloadLength('address', 55);
    expect(expectedQrPayloadLength('address', 70)).toBe(55);
    rememberQrPayloadLength('address', 0);
    expect(expectedQrPayloadLength('address')).toBe(55);
  });

  it('composes the unified estimate from the included rails', () => {
    const all = estimateBip321Length([
      { id: 'onchain', state: 'included' },
      { id: 'bolt12', state: 'included' },
      { id: 'creq', state: 'included' },
    ]);
    const onchainOnly = estimateBip321Length([
      { id: 'onchain', state: 'included' },
      { id: 'bolt12', state: 'excluded' },
      { id: 'creq', state: 'unsupported' },
    ]);
    expect(onchainOnly).toBe('bitcoin:'.length + 62);
    expect(all).toBe(onchainOnly + '?lno='.length + 140 + '&creq='.length + 200);
  });
});
