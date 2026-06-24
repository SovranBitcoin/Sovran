/**
 * @fileoverview Composer capability + block model types.
 *
 * A `RailCapability` declares what one posting rail supports (char budget,
 * media count, optional controls). The composer reads a single merged
 * `ComposeConfig` to drive its toolbar and enforce limits. Today only the Nostr
 * rail exists, but the descriptor + `merge()` are built for cross-posting: a
 * second rail drops in and the merge tightens every limit automatically.
 *
 * The block model is an ordered list of text/media blocks the user arranges
 * inline; it serializes to kind:1 content (media urls inline at their position)
 * plus `imeta` tags — round-tripping with the feed's positional parser.
 */
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

export type RailId = 'nostr';

export type OptionalCapability = 'media' | 'poll' | 'altText' | 'sensitive';

export interface RailCapability {
  id: RailId;
  label: string;
  /** Hard text limit (chars). */
  charBudget: number;
  /** Max media attachments (0 disables the media button). */
  maxMedia: number;
  allowAltText: boolean;
  allowSensitive: boolean;
  allowPoll: boolean;
  /** Why a capability is unavailable, surfaced as the toolbar button's hint. */
  reasons?: Partial<Record<OptionalCapability, string>>;
}

export interface ComposeConfig {
  rails: RailId[];
  charBudget: number;
  maxMedia: number;
  allowAltText: boolean;
  allowSensitive: boolean;
  allowPoll: boolean;
  reasons: Partial<Record<OptionalCapability, string>>;
}

export type ComposerBlock =
  | { id: string; kind: 'text'; text: string }
  | {
      id: string;
      kind: 'media';
      mediaKind: 'image' | 'video';
      localUri?: string;
      descriptor?: MediaDescriptor;
      alt?: string;
      sensitive?: boolean;
      /** 0..1 while uploading; undefined once done or before start. */
      uploadProgress?: number;
    };

export interface PollDraft {
  options: { id: string; label: string }[];
  type: 'singlechoice' | 'multiplechoice';
  /** Unix seconds; undefined = no expiry. */
  endsAt?: number;
}
