import React from 'react';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * Placeholder body for the AI tab when the active session has no messages.
 * The pattern background carries the visual interest now — the empty state
 * is just a flex spacer so the composer's tap-to-dismiss wrapper still
 * fills the viewport.
 */
export function AiEmptyState() {
  return <View style={{ flex: 1 }} />;
}
