/**
 * @fileoverview Media descriptor types for the Nostr posting pipeline.
 *
 * A `MediaDescriptor` is the result of uploading one image/video to a Blossom
 * server: the public url + the metadata needed to build a NIP-92 `imeta` tag
 * (mime, dimensions, sha256, alt text, sensitivity).
 */

/** Blossom blob descriptor (BUD-02 upload response). */
export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type?: string;
  uploaded?: number;
}

/** A piece of uploaded media, ready to serialize into kind:1 content + imeta. */
export interface MediaDescriptor {
  url: string;
  /** sha256 hex of the blob — Blossom's content address, the imeta `x` field. */
  sha256: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  /** Accessibility description (imeta `alt`). */
  alt?: string;
  /** NIP-36 sensitive-media flag (drives a content-warning on the post). */
  sensitive?: boolean;
  blurhash?: string;
}
