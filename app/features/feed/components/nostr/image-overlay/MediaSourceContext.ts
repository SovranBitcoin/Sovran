import { createContext, useContext } from 'react';

/** Optional local presentation source. The signed event and original URL stay intact. */
export const MediaSourceContext = createContext<{
  sources: Readonly<Record<string, number>>;
  onLoad?: (originalUrl: string) => void;
} | null>(null);

export const useMediaSource = () => useContext(MediaSourceContext);
