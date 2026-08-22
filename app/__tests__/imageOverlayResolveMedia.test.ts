import { resolveOverlayMedia } from '@/features/feed/components/nostr/image-overlay/provider';

const SCREEN_W = 400;
const AVAILABLE_H = 800;

const resolve = (layout: Parameters<typeof resolveOverlayMedia>[0], fallbackAspectRatio = 2) =>
  resolveOverlayMedia(layout, SCREEN_W, AVAILABLE_H, fallbackAspectRatio);

describe('resolveOverlayMedia', () => {
  describe('pager contents', () => {
    it('wraps a solo url and ignores a single-entry urls array', () => {
      expect(resolve({ url: 'a.jpg' }).urls).toEqual(['a.jpg']);
      expect(resolve({ url: 'a.jpg', urls: ['b.jpg'] }).urls).toEqual(['a.jpg']);
    });

    it('keeps the urls array once it holds more than one item', () => {
      expect(resolve({ url: 'a.jpg', urls: ['a.jpg', 'b.jpg'] }).urls).toEqual(['a.jpg', 'b.jpg']);
    });

    it('uses supplied mediaTypes only when they match the url count', () => {
      expect(resolve({ url: 'a.jpg', mediaTypes: ['video'] }).mediaTypes).toEqual(['video']);
      expect(
        resolve({ url: 'a.jpg', urls: ['a.jpg', 'b.mp4'], mediaTypes: ['video'] }).mediaTypes
      ).toEqual(['image', 'video']);
    });

    it('infers media types from the url extension when none are supplied', () => {
      expect(resolve({ url: 'clip.mp4' }).mediaTypes).toEqual(['video']);
    });

    it('clamps initialIndex into the resolved url range', () => {
      expect(
        resolve({ url: 'a.jpg', urls: ['a.jpg', 'b.jpg'], initialIndex: 5 }).initialIndex
      ).toBe(1);
      expect(resolve({ url: 'a.jpg' }).initialIndex).toBe(0);
      expect(resolve({ url: 'a.jpg', urls: ['a.jpg', 'b.jpg'] }).initialIndex).toBe(0);
    });
  });

  describe('aspect ratio', () => {
    it('fills the viewport when the pager holds any video', () => {
      expect(resolve({ url: 'clip.mp4', aspectRatio: 3 }).aspectRatio).toBe(SCREEN_W / AVAILABLE_H);
    });

    it('fills the viewport when the pager holds more than one image', () => {
      expect(resolve({ url: 'a.jpg', urls: ['a.jpg', 'b.jpg'], aspectRatio: 3 }).aspectRatio).toBe(
        SCREEN_W / AVAILABLE_H
      );
    });

    it('keeps a solo image at its declared aspect ratio', () => {
      expect(resolve({ url: 'a.jpg', aspectRatio: 3 }).aspectRatio).toBe(3);
    });

    it('falls back to the caller-supplied ratio only for a solo image with none declared', () => {
      expect(resolve({ url: 'a.jpg' }, 1.5).aspectRatio).toBe(1.5);
      expect(resolve({ url: 'a.jpg', aspectRatio: 3 }, 1.5).aspectRatio).toBe(3);
      expect(resolve({ url: 'clip.mp4' }, 1.5).aspectRatio).toBe(SCREEN_W / AVAILABLE_H);
    });
  });

  describe('expanded rect', () => {
    it('matches computeExpandedSize for the resolved aspect ratio', () => {
      const r = resolve({ url: 'a.jpg', aspectRatio: 1 });
      expect({ width: r.expandedWidth, height: r.expandedHeight }).toEqual({
        width: 400,
        height: 400,
      });
    });

    it('survives a hostile aspect ratio from relay-supplied metadata', () => {
      const r = resolve({ url: 'a.jpg', aspectRatio: Number.NaN });
      expect(Number.isFinite(r.expandedWidth)).toBe(true);
      expect(Number.isFinite(r.expandedHeight)).toBe(true);
    });

    it('survives a degenerate fallback ratio from a zero-sized thumbnail rect', () => {
      const r = resolve({ url: 'a.jpg' }, 0 / 0);
      expect(Number.isFinite(r.expandedWidth)).toBe(true);
      expect(Number.isFinite(r.expandedHeight)).toBe(true);
    });
  });
});
