/**
 * Re-exports from the shared color extraction module.
 * Distribution components import from here for co-location convenience;
 * the canonical source is shared/lib/colorExtraction.ts.
 */
export {
  FALLBACK_COLORS,
  hexToRgb,
  getContrastColors,
  useExtractedColors,
  useDominantColor,
} from '@/shared/lib/colorExtraction';
