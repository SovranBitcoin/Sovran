import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';

interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
  size?: number;
}

export function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
  size = 48,
}: FiatAmountDisplayProps) {
  const hasDecimal = rawInput.includes('.');
  const [wholePart = '', decimalPart = ''] = rawInput.split('.');

  const parsed = parseInt(wholePart, 10);
  const formattedWhole = !isNaN(parsed) ? parsed.toLocaleString('en-US') : '0';

  const showDecimals = hasDecimal || wholePart === '0';
  const placeholderDigits = showDecimals ? '0'.repeat(Math.max(0, 2 - decimalPart.length)) : '';

  return (
    <HStack align="baseline" justify="center">
      <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
        {symbol}
        {formattedWhole}
      </Text>
      {showDecimals && (
        <>
          <Text
            overpass
            size={size}
            weight="heavy"
            style={{ color: hasDecimal ? activeColor : placeholderColor }}>
            .
          </Text>
          {decimalPart && (
            <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
              {decimalPart}
            </Text>
          )}
          {placeholderDigits && (
            <Text overpass size={size} weight="heavy" style={{ color: placeholderColor }}>
              {placeholderDigits}
            </Text>
          )}
        </>
      )}
    </HStack>
  );
}
