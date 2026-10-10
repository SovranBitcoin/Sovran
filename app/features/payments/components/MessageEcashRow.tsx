import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { formatAmount } from '@/shared/lib/currency';
import { getMintDisplayName } from '@/shared/lib/url';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

interface MessageEcashRowProps {
  testID: string;
  mintUrl: string;
  /** False for a mint the wallet does not trust: its picture is not fetched. */
  showPicture: boolean;
  amount: number;
  unit: string;
  title: string;
  /** The quiet line under the title. */
  detail: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * Ecash waiting to be received, drawn as a payment: the same measures as a
 * `Transaction` row, with the mint's picture where a payment has its arrow and
 * the amount as money coming in.
 *
 * An unknown mint gets the plain mint mark, not its picture. The sender chose
 * that mint, and fetching a picture it controls would tell it this wallet is
 * here before the person has decided anything.
 */
export function MessageEcashRow({
  testID,
  mintUrl,
  showPicture,
  amount,
  unit,
  title,
  detail,
  accessibilityLabel,
  onPress,
}: MessageEcashRowProps) {
  const [foreground, success] = useThemeColor(['foreground', 'success'] as const);
  const metadata = useCachedMintMetadata(mintUrl);
  const quiet = withAlpha(foreground, 0.8);
  return (
    <Pressable
      testID={testID}
      className="flex-row items-center justify-between px-4 py-5"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}>
      <View className="flex-1 flex-row items-center gap-3">
        <View className="mt-1.5 h-7 w-7 shrink-0 items-center justify-center">
          <MintIcon
            iconUrl={showPicture ? metadata?.iconUrl : undefined}
            name={metadata?.displayName ?? getMintDisplayName(mintUrl)}
            size={28}
          />
        </View>
        <View className="flex-1">
          <View className="flex-row items-end justify-between">
            <UntranslatedText color={foreground} bold size={14}>
              {title}
            </UntranslatedText>
            <AmountFormatter
              amount={amount}
              unit={unit}
              size={16}
              weight="heavy"
              color={success}
              sign="+"
            />
          </View>
          <View className="flex-row items-center justify-between gap-2">
            <UntranslatedText size={10} color={quiet} numberOfLines={1} className="shrink">
              {detail}
            </UntranslatedText>
            <UntranslatedText overpass bold size={10} color={quiet} className="self-end text-right">
              {formatAmount({ amount, unit }, { displayAs: 'usd' })}
            </UntranslatedText>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
