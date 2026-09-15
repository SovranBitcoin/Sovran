import fs from 'node:fs';
import path from 'node:path';

// The press image-viewer capture opens the viewer from the demo thread and waits
// for the full-size image. These selectors are its contract with the app.
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('demo media capture selectors', () => {
  const demo = read('features/feed/components/DemoThreadView.tsx');
  const overlay = read('features/feed/components/nostr/image-overlay/AnimatedImageOverlay.tsx');
  const pager = read('features/feed/components/nostr/image-overlay/MediaPagerPage.tsx');

  it('keeps the demo card inert and opens the viewer from a separate control', () => {
    expect(demo).toContain('<View pointerEvents="none">');
    expect(demo).toContain('testID="demo-thread-open-image"');
    expect(demo).toContain('getThumbnailLayout(');
    // No post payload: the viewer must not show a reply bar or engagement panel.
    expect(demo).not.toMatch(/overlay\.open\(\{[^}]*post:/);
  });

  it('only reports the viewer ready once the active full-size image has loaded', () => {
    expect(overlay).toContain('testID="image-overlay-image-loaded"');
    expect(overlay).toContain('loadedUrl === activeUrl');
    expect(overlay).toContain('onImageLoad={setLoadedUrl}');
    expect(pager).toContain('onLoad={() => onImageLoad?.(url)}');
  });

  it('carries local demo media into the viewer on both platforms', () => {
    expect(overlay).toContain('<MediaSourceContext.Provider value={ctx.mediaSource}>');
    expect(pager).toContain('localSource ??');
  });

  it('keeps the story readiness probe outside the accessible story Pressable', () => {
    const stories = read('features/feed/components/nostr/StoriesCarousel.tsx');
    const pressableEnd = stories.indexOf('</Pressable>', stories.indexOf('testID="story-video"'));
    expect(pressableEnd).toBeGreaterThan(0);
    expect(stories.indexOf('testID="story-video-ready"')).toBeGreaterThan(pressableEnd);
  });
});
