import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { Card, Slider, Switch as HeroSwitch } from 'heroui-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import { bpToPercent } from '@/shared/stores/profile/mintDistributionStore';

interface MintDistributionCardsProps {
  /** Active mint URLs for the selected currency, in display order. */
  mintUrls: string[];
  /** Async-resolved mint metadata (name, icon) keyed by mint URL. */
  mintInfoMap: Record<string, GetInfoResponse | null | undefined>;
  /** Current target split in basis points, keyed by mint URL. */
  distribution: Record<string, number>;
  /** Read-only sliders (Split evenly mode) — mint switches stay live. */
  slidersDisabled?: boolean;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  /** Switch handler: on → give the mint a share, off → zero it out. */
  onToggleMint: (mintUrl: string, enabled: boolean) => void;
}

/**
 * The Balance-split body: one secondary Card per mint, mirroring the Swap
 * routing settings cards (label + value header row over a heroui Slider).
 * A mint at 0% reads as disabled — its switch is off and the slider collapses;
 * the switch is the enable/disable control.
 */
export function MintDistributionCards({
  mintUrls,
  mintInfoMap,
  distribution,
  slidersDisabled = false,
  onDistributionChange,
  onToggleMint,
}: MintDistributionCardsProps) {
  const activeCount = mintUrls.reduce((n, url) => n + ((distribution[url] || 0) > 0 ? 1 : 0), 0);

  return (
    <VStack gap={12} className="px-4 pt-1">
      {mintUrls.map((mintUrl) => (
        <MintDistributionCard
          key={mintUrl}
          mintUrl={mintUrl}
          mintInfo={mintInfoMap[mintUrl]}
          distributionBp={distribution[mintUrl] || 0}
          // The split must always sum to 100%, so the last active mint
          // cannot be switched off.
          isLastActive={activeCount === 1 && (distribution[mintUrl] || 0) > 0}
          sliderDisabled={slidersDisabled}
          onDistributionChange={onDistributionChange}
          onToggleMint={onToggleMint}
        />
      ))}
    </VStack>
  );
}

// A switched-off mint's identity fades back; the switch stays full-strength as
// the way back in.
const DISABLED_IDENTITY_STYLE = { opacity: 0.4 } as const;

interface MintDistributionCardProps {
  mintUrl: string;
  mintInfo: GetInfoResponse | null | undefined;
  distributionBp: number;
  isLastActive: boolean;
  sliderDisabled: boolean;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  onToggleMint: (mintUrl: string, enabled: boolean) => void;
}

function MintDistributionCard({
  mintUrl,
  mintInfo,
  distributionBp,
  isLastActive,
  sliderDisabled,
  onDistributionChange,
  onToggleMint,
}: MintDistributionCardProps) {
  const [muted] = useThemeColor(['muted'] as const);
  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';
  const enabled = distributionBp > 0;

  // During-drag preview so the % tracks the thumb; the store only sees the
  // committed value (onChangeEnd), same as the Swap routing sliders.
  const [previewPct, setPreviewPct] = useState<number | null>(null);
  const displayBp = previewPct !== null ? previewPct * 100 : distributionBp;

  const handleChange = useCallback((value: number | number[]) => {
    const pct = Array.isArray(value) ? (value[0] ?? 0) : value;
    setPreviewPct(pct);
  }, []);

  const handleChangeEnd = useCallback(
    (value: number | number[]) => {
      const pct = Array.isArray(value) ? (value[0] ?? 0) : value;
      setPreviewPct(null);
      onDistributionChange(mintUrl, Math.round(pct * 100));
    },
    [mintUrl, onDistributionChange]
  );

  const handleToggle = useCallback(
    (next: boolean) => {
      onToggleMint(mintUrl, next);
    },
    [mintUrl, onToggleMint]
  );

  return (
    <Card variant="secondary">
      <Card.Body className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <HStack
            align="center"
            gap={10}
            flex={1}
            style={enabled ? undefined : DISABLED_IDENTITY_STYLE}>
            <MintIcon
              iconUrl={mintInfo?.icon_url}
              size={28}
              name={displayName}
              alt={`${displayName} icon`}
            />
            <Text size={16} numberOfLines={1} className="flex-1">
              {displayName}
            </Text>
          </HStack>
          {enabled ? (
            <Text overpass heavy size={18}>
              {bpToPercent(displayBp)}%
            </Text>
          ) : (
            <Text size={14} style={{ color: muted, opacity: 0.6 }}>
              Off
            </Text>
          )}
          <HeroSwitch
            isSelected={enabled}
            isDisabled={isLastActive}
            onSelectedChange={handleToggle}
            aria-label={`${displayName} enabled`}
            testID={`mint-distribution-toggle:${mintUrl}`}
          />
        </View>
        {enabled ? (
          <Slider
            value={displayBp / 100}
            minValue={0}
            maxValue={100}
            step={1}
            isDisabled={sliderDisabled}
            aria-label={`${displayName} share`}
            onChange={handleChange}
            onChangeEnd={handleChangeEnd}>
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
        ) : null}
      </Card.Body>
    </Card>
  );
}
