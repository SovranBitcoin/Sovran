import { buildStoryCaption } from '@/features/feed/lib/storyCaption';

const videoUrl = 'https://example.com/story.mp4';

describe('buildStoryCaption', () => {
  it('removes every occurrence of the current video URL', () => {
    expect(buildStoryCaption(`${videoUrl}\nAn afternoon by the sea\n${videoUrl}`, videoUrl)).toBe(
      'An afternoon by the sea'
    );
  });

  it.each(['', ' \n\t ', videoUrl, ` \n${videoUrl}\n${videoUrl}\t`])(
    'returns null for an empty or media-only caption',
    (content) => expect(buildStoryCaption(content, videoUrl)).toBeNull()
  );

  it('trims trailing whitespace while preserving paragraphs and interior spacing', () => {
    expect(buildStoryCaption(`  First  line  \n\nSecond line\t\n${videoUrl}\n  `, videoUrl)).toBe(
      'First  line\n\nSecond line'
    );
  });

  it('retains other links and videos, including URLs with the same prefix', () => {
    const text = `${videoUrl}?version=2 https://example.com/other.mp4 https://example.com/article`;
    expect(buildStoryCaption(`${text}\n${videoUrl}`, videoUrl)).toBe(text);
  });

  it('handles extensionless and query-bearing video URLs literally', () => {
    const url = 'https://example.com/blob?x=a+b&version=2';
    expect(buildStoryCaption(`Today\n${url}`, url)).toBe('Today');
  });

  it('keeps punctuation adjacent to the media URL', () => {
    expect(buildStoryCaption(`Watch (${videoUrl}).`, videoUrl)).toBe('Watch ().');
    expect(buildStoryCaption(`Watch ${videoUrl}!`, videoUrl)).toBe('Watch !');
  });

  it('preserves text when there is no media URL to strip', () => {
    expect(buildStoryCaption('A caption https://example.com', '')).toBe(
      'A caption https://example.com'
    );
  });
});
