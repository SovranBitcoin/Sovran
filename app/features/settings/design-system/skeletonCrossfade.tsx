/* eslint-disable @typescript-eslint/no-require-imports -- catalog metadata must stay import-side-effect free; native preview dependencies load only when rendered. */

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import type { DesignSystemScenario } from './types';

const CROSSFADE_SOURCE = 'shared/ui/composed/SkeletonContentCrossfade.tsx';
const SHIMMER_SOURCE = 'shared/ui/composed/SkeletonExitShimmer.tsx';
const AVATAR_SOURCE = 'shared/ui/primitives/Avatar.tsx';
const TEXT_SOURCE = 'shared/ui/primitives/Text.tsx';
const HSTACK_SOURCE = 'shared/ui/primitives/View/HStack.tsx';
const VSTACK_SOURCE = 'shared/ui/primitives/View/VStack.tsx';

const FIXED_AVATAR_URL = 'https://images.example/sovran-design-system-avatar.png';

/** Shared profile-row chrome for both branches. Keeping this one component is
 * the parity contract: loading changes only the leaves, never row geometry. */
export function DesignSystemProfileRow({
  loading,
  pictureUrl,
}: {
  loading: boolean;
  pictureUrl?: string;
}) {
  // Keep the catalog itself metadata-only: Avatar's third-party fallback is
  // loaded only when this preview renders, not when inventory tooling imports
  // every catalog entry.
  const { Avatar } =
    require('@/shared/ui/primitives/Avatar') as typeof import('@/shared/ui/primitives/Avatar');

  return (
    <HStack align="center" gap={12}>
      <Avatar
        state={loading ? 'loading' : pictureUrl ? 'image' : 'fallback'}
        size={44}
        picture={pictureUrl}
        name="Sovran"
        visualDisabled
      />
      <VStack gap={4} className="flex-1">
        <Text loading={loading} placeholder="Display Name" bold size={15} visualDisabled>
          Satoshi Nakamoto
        </Text>
        <Text loading={loading} placeholder="@handle@relay.example" size={13} visualDisabled>
          @satoshi@sovran.money
        </Text>
      </VStack>
    </HStack>
  );
}

const renderProfileSkeleton = () => <DesignSystemProfileRow loading />;
const renderProfileFallback = () => <DesignSystemProfileRow loading={false} />;
const renderInlineSkeleton = () => (
  <Text loading placeholder="1,000 sats" bold size={20} visualDisabled />
);
const renderInlineContent = () => (
  <Text bold size={20} className="text-foreground">
    21,000 sats
  </Text>
);

function ProfileCrossfadePreview({ loading }: { loading: boolean }) {
  const surfaceSecondary = useThemeColor('surface-secondary');
  const { SkeletonContentCrossfade } =
    require('@/shared/ui/composed/SkeletonContentCrossfade') as typeof import('@/shared/ui/composed/SkeletonContentCrossfade');

  return (
    <SkeletonContentCrossfade
      loading={loading}
      wave="region"
      surfaceColor={surfaceSecondary}
      renderSkeleton={renderProfileSkeleton}
      renderContent={renderProfileFallback}
      visualKey={loading ? 'catalog-profile-loading' : 'catalog-profile-content'}
      visualDisabled
    />
  );
}

function InlineCrossfadePreview({ loading }: { loading: boolean }) {
  const { SkeletonContentCrossfade } =
    require('@/shared/ui/composed/SkeletonContentCrossfade') as typeof import('@/shared/ui/composed/SkeletonContentCrossfade');

  return (
    <SkeletonContentCrossfade
      loading={loading}
      wave="none"
      renderSkeleton={renderInlineSkeleton}
      renderContent={renderInlineContent}
      visualKey={loading ? 'catalog-inline-loading' : 'catalog-inline-content'}
      visualDisabled
    />
  );
}

export const SKELETON_CROSSFADE_SCENARIOS = [
  {
    id: 'profile-skeleton-region',
    title: 'Profile row · Skeleton + region wave',
    covers: [
      CROSSFADE_SOURCE,
      SHIMMER_SOURCE,
      AVATAR_SOURCE,
      TEXT_SOURCE,
      HSTACK_SOURCE,
      VSTACK_SOURCE,
    ],
    render: () => <ProfileCrossfadePreview loading />,
  },
  {
    id: 'profile-content-parity',
    title: 'Profile row · Content parity',
    covers: [CROSSFADE_SOURCE, AVATAR_SOURCE, TEXT_SOURCE, HSTACK_SOURCE, VSTACK_SOURCE],
    render: () => <ProfileCrossfadePreview loading={false} />,
  },
  {
    id: 'inline-skeleton',
    title: 'Inline · Skeleton without wave',
    covers: [CROSSFADE_SOURCE, TEXT_SOURCE],
    render: () => <InlineCrossfadePreview loading />,
  },
  {
    id: 'inline-content',
    title: 'Inline · Content',
    covers: [CROSSFADE_SOURCE, TEXT_SOURCE],
    render: () => <InlineCrossfadePreview loading={false} />,
  },
  {
    id: 'avatar-image-pending',
    title: 'Independent image · Pending decode',
    covers: [AVATAR_SOURCE, TEXT_SOURCE, HSTACK_SOURCE, VSTACK_SOURCE],
    render: () => <DesignSystemProfileRow loading={false} pictureUrl={FIXED_AVATAR_URL} />,
  },
  {
    id: 'avatar-fallback',
    title: 'Independent image · Fallback',
    covers: [AVATAR_SOURCE, TEXT_SOURCE, HSTACK_SOURCE, VSTACK_SOURCE],
    render: () => <DesignSystemProfileRow loading={false} />,
  },
] satisfies readonly DesignSystemScenario[];
