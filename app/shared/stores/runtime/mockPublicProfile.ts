import { Asset } from 'expo-asset';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';
import snapshot from './fixtures/publicDemoSnapshot.json';

/** Public, reviewed snapshot. This identity is display-only, never a signer. */
export const DEMO_VIEWER_PUBKEY = snapshot.viewerPubkey;
export const DEMO_VIEWER_STATS = snapshot.profileStats;

// Original public image bytes, bundled so screenshot runs do not depend on hosts.
const pictures: Record<string, number> = {
  '06b7819d7f1c7f5472118266ed7bca8785dceae09e36ea3a4af665c6d1d8327c': require('../../../assets/demo/06b7819d7f1c7f5472118266ed7bca8785dceae09e36ea3a4af665c6d1d8327c/image.png'),
  '2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331': require('../../../assets/demo/2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331/image.png'),
  c7fe92f80c516c0c54b15e8d256ac07281036d934ea1ff39fb0cd8a0fd677736: require('../../../assets/demo/c7fe92f80c516c0c54b15e8d256ac07281036d934ea1ff39fb0cd8a0fd677736/image.png'),
  e3fc673fc5f99cc554d0ff47756795647d25cb6e6658f912d114ae6429d35d35: require('../../../assets/demo/e3fc673fc5f99cc554d0ff47756795647d25cb6e6658f912d114ae6429d35d35/image.png'),
  c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81: require('../../../assets/demo/c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81/image.png'),
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d': require('../../../assets/demo/3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d/image.png'),
  c8383d81dd24406745b68409be40d6721c301029464067fcc50a25ddf9139549: require('../../../assets/demo/c8383d81dd24406745b68409be40d6721c301029464067fcc50a25ddf9139549/image.png'),
  '9cdb46b00b3bcda4220e256c55f7b630a9a3392e7b6b331a33a36b3dbe6bacff': require('../../../assets/demo/9cdb46b00b3bcda4220e256c55f7b630a9a3392e7b6b331a33a36b3dbe6bacff/image.png'),
  efcaeffafd9c673bd44cf1c1b50cffbf2291ec900c0b53e166688564897c7eaf: require('../../../assets/demo/efcaeffafd9c673bd44cf1c1b50cffbf2291ec900c0b53e166688564897c7eaf/image.png'),
  d679b0f4c94843077301c920480c9d2f2d12c9fa6d10352e134eb1c08229ac9a: require('../../../assets/demo/d679b0f4c94843077301c920480c9d2f2d12c9fa6d10352e134eb1c08229ac9a/image.png'),
  '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63': require('../../../assets/demo/50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63/image.png'),
  '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2': require('../../../assets/demo/1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2/image.png'),
  '43baaf0c28e6cfb195b17ee083e19eb3a4afdfac54d9b6baf170270ed193e34c': require('../../../assets/demo/43baaf0c28e6cfb195b17ee083e19eb3a4afdfac54d9b6baf170270ed193e34c/image.png'),
  '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2': require('../../../assets/demo/82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2/image.png'),
  '1b7fce2b8c700773f89fa0c3f5a5921b5e3610e1c80c059dc3bd086420dd5114': require('../../../assets/demo/1b7fce2b8c700773f89fa0c3f5a5921b5e3610e1c80c059dc3bd086420dd5114/image.png'),
};

export const PUBLIC_DEMO_METADATA = new Map<string, NostrProfileMetadata>(
  snapshot.profiles.map((event) => {
    const value = JSON.parse(event.content);
    const bundled = pictures[event.pubkey];
    return [
      event.pubkey,
      {
        name: value.name,
        displayName: value.display_name,
        picture: bundled ? Asset.fromModule(bundled).uri : undefined,
        banner: value.banner,
        about: value.about,
        website: value.website,
        nip05: value.nip05,
        lud16: value.lud16,
        fetchedAt: Date.parse(snapshot.capturedAt),
      },
    ];
  })
);

/** Public identities shown as recent searches, never fabricated message authors. */
export const DEMO_RECENT_PUBKEYS = [
  'c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81',
  '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63',
  '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
  '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
] as const;
