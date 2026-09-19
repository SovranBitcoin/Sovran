/**
 * @fileoverview Shared signer-UI display helpers
 *
 * Identity-row primitives reused by the approval sheet, the connect sheet, and
 * the app-detail screen so the same app-identity slot renders identically
 * everywhere (one hostname parser, one segmented-copy renderer). A pubkey
 * shown in place of a name is always the full value in a one-line text with
 * `ellipsizeMode="middle"` — never a sliced copy. App-supplied strings
 * reaching these are untrusted — bound them at the catalog choke point before
 * passing them in, and never log the value.
 */

import React from 'react';

import type { CopySegment } from '@/features/nostrSigner/components/permissionCatalog';
import { Text } from '@/shared/ui/primitives/Text';

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
