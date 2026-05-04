import { inferMediaType } from '@/features/feed/components/nostr/image-overlay/provider';

describe('inferMediaType (audit 58.json F-007)', () => {
  it.each(['mp4', 'webm', 'mov', 'm4v', 'avi'])('classifies a .%s url as video', (ext) => {
    expect(inferMediaType(`https://example.com/clip.${ext}`)).toBe('video');
  });

  it.each(['MP4', 'Mov', 'WEBM'])('is case-insensitive on the extension (%s)', (ext) => {
    expect(inferMediaType(`https://example.com/clip.${ext}`)).toBe('video');
  });

  it('treats a video url with a query string as video', () => {
    expect(inferMediaType('https://cdn.example.com/clip.mp4?t=42&token=abc')).toBe('video');
  });

  it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'])('classifies a .%s url as image', (ext) => {
    expect(inferMediaType(`https://example.com/pic.${ext}`)).toBe('image');
  });

  it('classifies an extensionless url as image', () => {
    expect(inferMediaType('https://example.com/asset')).toBe('image');
  });

  it('does not match a video extension that appears mid-path (only matches end)', () => {
    expect(inferMediaType('https://example.com/mp4-thumbnails/poster.jpg')).toBe('image');
  });
});
