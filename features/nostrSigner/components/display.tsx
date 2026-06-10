/**
 * @fileoverview Shared signer-UI display helpers
 *
 * Identity-row primitives reused by the approval sheet, the connect sheet, and
 * the app-detail screen so the same app-identity slot renders identically
 * everywhere (one truncation format, one hostname parser, one segmented-copy
 * renderer). App-supplied strings reaching these are untrusted — bound them at
 * the catalog choke point before passing them in, and never log the value.
 */

import React from 'react';
import { Result } from 'neverthrow';

import type { CopySegment } from '@/features/nostrSigner/components/permissionCatalog';
import { Text } from '@/shared/ui/primitives/Text';

/** Hostname of a (https) url, or an error sentinel — the url may embed a secret. */
export const safeHostname = Result.fromThrowable(
  (url: string) => new URL(url).hostname,
  () => 'invalid_url' as const
);

/** First-8 … last-4 pubkey fallback for the app-identity subtitle. */
export function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** Renders catalog `CopySegment[]` runs, bolding `bold` segments (app names). */
export function SegmentedText({
  segments,
  size,
  color,
}: {
  segments: CopySegment[];
  size: number;
  color?: string;
}): React.ReactElement {
  return (
    <Text size={size} {...(color !== undefined && { color })} style={{ lineHeight: size * 1.45 }}>
      {segments.map((segment, index) => (
        <Text key={index} size={size} bold={segment.bold} {...(color !== undefined && { color })}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}
