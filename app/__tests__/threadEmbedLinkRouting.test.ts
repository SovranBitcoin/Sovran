import { resolveEmbedTarget } from '@/features/feed/components/thread-embed/linkRouting';

describe('resolveEmbedTarget', () => {
  it('embeds http(s) pages, returning the normalized URL', () => {
    expect(resolveEmbedTarget('https://vercel.com/blog/eve')).toBe('https://vercel.com/blog/eve');
    expect(resolveEmbedTarget('http://example.com')).toBe('http://example.com/');
    expect(resolveEmbedTarget('https://x.com')).toBe('https://x.com/');
  });

  it('does not embed non-page schemes (falls back to OS opener via null)', () => {
    expect(resolveEmbedTarget('mailto:hi@sovran.money')).toBeNull();
    expect(resolveEmbedTarget('tel:+15551234567')).toBeNull();
    expect(resolveEmbedTarget('javascript:alert(1)')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(resolveEmbedTarget('not a url')).toBeNull();
    expect(resolveEmbedTarget('')).toBeNull();
  });
});
