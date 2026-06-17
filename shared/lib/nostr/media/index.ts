export type {
  BlobDescriptor,
  MediaDescriptor,
  UploadProgress,
} from '@/shared/lib/nostr/media/types';
export { buildImetaTag, buildImetaTags } from '@/shared/lib/nostr/media/imeta';
export {
  BLOSSOM_AUTH_KIND,
  buildBlossomAuthEvent,
  encodeAuthHeader,
  sha256Hex,
  type BlossomAction,
} from '@/shared/lib/nostr/media/blossomAuth';
export {
  uploadToBlossom,
  type BlossomError,
  type UploadOptions,
} from '@/shared/lib/nostr/media/blossomClient';
export {
  useMediaServerStore,
  getMediaServer,
  DEFAULT_BLOSSOM_SERVER,
} from '@/shared/lib/nostr/media/mediaServerStore';
export {
  uploadMedia,
  type PickedAsset,
  type UploadMediaOptions,
} from '@/shared/lib/nostr/media/mediaUpload';
