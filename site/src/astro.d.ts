/// <reference types="astro/client" />

declare module 'virtual:sovran-website-captures' {
  const captures: Record<string, {
    image: import('astro').ImageMetadata & { fsPath: string };
    sha256: string;
    alt: string;
    freshness: string;
  }>;
  export default captures;
}
