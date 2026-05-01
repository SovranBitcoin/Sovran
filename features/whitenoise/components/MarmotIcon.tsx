import React from 'react';
import { AnimatedEmoji } from '@/shared/ui/primitives/AnimatedEmoji';

/**
 * Brand glyph for Marmot Protocol / White Noise. The protocol's mascot is
 * a marmot — the closest Unicode emoji is U+1F43F 🐿️ (chipmunk), rendered
 * via the app's existing animated-emoji component (Noto CDN). Single
 * source of truth so a future swap to a custom asset only changes here.
 */
export function MarmotIcon({ size = 20 }: { size?: number }) {
  return <AnimatedEmoji emoji="🐿️" size={size} />;
}
