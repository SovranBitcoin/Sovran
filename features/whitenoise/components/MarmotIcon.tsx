import React from 'react';
import { Text } from '@/shared/ui/primitives/Text';

/**
 * Brand glyph for Marmot Protocol / White Noise. The protocol's mascot is
 * a marmot — the closest Unicode emoji is U+1F43F 🐿️ (chipmunk), rendered
 * via the OS emoji font so the brand never depends on a network fetch.
 * Single source of truth so a future swap to a custom asset only changes here.
 */
export function MarmotIcon({ size = 20 }: { size?: number }) {
  return <Text style={{ fontSize: size, lineHeight: size * 1.2 }}>🐿️</Text>;
}
