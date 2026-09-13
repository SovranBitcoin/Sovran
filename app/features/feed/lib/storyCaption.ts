import { URL_REGEX } from '@/features/feed/components/nostr/feedParse';

/** Remove every occurrence of this story's media, preserving other links and paragraphs. */
export function buildStoryCaption(content: string, videoUrl: string): string | null {
  const caption = content
    .replace(URL_REGEX, (url) => {
      if (url === videoUrl) return '';
      // Feed URL parsing includes terminal punctuation; retain it as authored text.
      const suffix = videoUrl && url.startsWith(videoUrl) ? url.slice(videoUrl.length) : '';
      return suffix && /^[.,!?;:]+$/.test(suffix) ? suffix : url;
    })
    .replace(/[\t ]+$/gm, '')
    .trim();
  return caption || null;
}
