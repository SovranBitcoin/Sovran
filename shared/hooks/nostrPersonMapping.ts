/**
 * @fileoverview Pure mapping: nagg profile → metadata-cache partial
 *
 * Kept free of React/NDK imports so the signer test suites can pin the
 * mapping without mocking the relay stack.
 */

interface NaggProfileFields {
  displayName?: string;
  name?: string;
  picture?: string;
  image?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  about?: string;
}

export interface PersonMetadataPartial {
  displayName?: string;
  name?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  about?: string;
}

/** nagg `/nostr/profile` fields → metadata-cache partial (picture ?? image). */
export function profileToMetadataPartial(profile: NaggProfileFields): PersonMetadataPartial {
  const picture = profile.picture ?? profile.image;
  return {
    ...(profile.displayName !== undefined && { displayName: profile.displayName }),
    ...(profile.name !== undefined && { name: profile.name }),
    ...(picture !== undefined && { picture }),
    ...(profile.banner !== undefined && { banner: profile.banner }),
    ...(profile.nip05 !== undefined && { nip05: profile.nip05 }),
    ...(profile.lud16 !== undefined && { lud16: profile.lud16 }),
    ...(profile.website !== undefined && { website: profile.website }),
    ...(profile.about !== undefined && { about: profile.about }),
  };
}
