import React, { useRef } from 'react';
import { Image, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { greys, shades, Theme } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import Icon from 'assets/icons';
import { ActionSheetRef, registerSheet } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { addMints, useGetMintInfo } from 'helper/redux/cashu';
import { Sheet } from 'components/blocks/sheets/mints/sheet';
import { MintSelect } from 'components/blocks/sheets/mints/MintSelect';
import { store } from 'helper/redux/store';
import MintDetailPage from './MintDetailsPage';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { memoizedGetTheme } from 'helper/redux/settings';
import { MintAddMore } from './MintAddMore';
import MintDeleteConfirmRoute from './routes/MintDeleteConfirmRoute';

interface SelectedMintDisplayProps {
  onPress?: () => void;
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  onMintQuoteUpdate?: (meltQuote: string) => void;
  pr?: string;
  unit?: string;
  onUnitUpdate?: (unit: string) => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  actionSheetRef?: React.RefObject<ActionSheetRef | null>;
}

export function MintIcon({ mintInfo, size = 32 }: { mintInfo: any; size?: number }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View
      style={{
        width: size,
        marginRight: 8,
      }}>
      {mintInfo?.icon_url ? (
        <Image
          source={{ uri: mintInfo?.icon_url }}
          style={[
            styles.icon,
            {
              width: size,
              height: size,
              borderRadius: size / 3,
            },
          ]}
        />
      ) : (
        <View
          style={[
            styles.placeholderIcon,
            {
              width: size,
              height: size,
              borderRadius: size / 3,
            },
          ]}
        />
      )}
    </View>
  );
}

type MintSelectorButtonProps = {
  onPress?: () => void;
  unit?: string;
  actionSheetRef: React.RefObject<ActionSheetRef | null>;
  style?: StyleProp<ViewStyle>;
};

const MintSelectorButton: React.FC<MintSelectorButtonProps> = ({
  onPress,
  unit,
  actionSheetRef,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMint || '' });

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
    actionSheetRef?.current?.show();
  };

  const balance = useSelector(memoizedGetBalance(unit || 'sat', selectedMint || ''));

  return (
    <TouchableOpacity onPress={handlePress} onPressIn={() => {}} onPressOut={() => {}}>
      <HStack
        style={[
          sovran(theme).listItem,
          { alignSelf: 'center' },
          style,
          {
            backgroundColor: theme.greys[800],
          },
        ]}
        blur
        justify="space-between">
        <HStack>
          <MintIcon mintInfo={mintInfo} />
          <VStack
            align="flex-start"
            style={{
              marginRight: 10,
            }}>
            <Text style={styles.name}>
              {mintInfo?.name || selectedMint?.replace('https://', '')?.split('/')?.[0]}
            </Text>
            {/* <Text style={styles.balance}>
          {formatCurrency(
            {
              currency: currencyValue,
              value: balance || 0,
              denomination: denominationValue,
            },
            {
              locale: 'en-US',
              precision,
              currencyDisplay,
              denomination: denominationValue,
            }
          )}
        </Text> */}
            <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit || 'sat'} />
          </VStack>
        </HStack>
        <HStack justify="flex-end" style={styles.chevronContainer}>
          <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[0]} />
        </HStack>
        {/* <Text style={styles.dot}>•</Text> */}
      </HStack>
    </TouchableOpacity>
  );
};

// Helper function for opacity
const opacity = (color: string, alpha: number) => {
  // Extract color components and apply opacity
  return (
    color.slice(0, 7) +
    Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')
  );
};

// Base styles that can be composed together
const baseStyles = (theme: Theme) => ({
  // Base container styles
  container: {
    padding: 8,
    // backgroundColor: greys(theme)[800],
    borderColor: greys(theme)[600],
    borderWidth: 0.2,
    borderRadius: 8,
  } as ViewStyle,

  spacingTight: {
    padding: 4,
    margin: 4,
  } as ViewStyle,

  spacingRegular: {
    padding: 8,
    margin: 8,
  } as ViewStyle,

  spacingWide: {
    padding: 12,
    margin: 12,
  } as ViewStyle,

  // Spacing variations
  paddingTight: {
    padding: 4,
  } as ViewStyle,

  paddingRegular: {
    padding: 8,
  } as ViewStyle,

  paddingWide: {
    padding: 12,
  } as ViewStyle,

  marginTight: {
    margin: 4,
  } as ViewStyle,

  marginRegular: {
    margin: 8,
  } as ViewStyle,

  marginWide: {
    margin: 12,
  } as ViewStyle,

  // Directional spacing - Horizontal (left/right)
  paddingHorizontalTight: {
    paddingHorizontal: 4,
  } as ViewStyle,

  paddingHorizontalRegular: {
    paddingHorizontal: 8,
  } as ViewStyle,

  paddingHorizontalWide: {
    paddingHorizontal: 12,
  } as ViewStyle,

  marginHorizontalTight: {
    marginHorizontal: 4,
  } as ViewStyle,

  marginHorizontalRegular: {
    marginHorizontal: 8,
  } as ViewStyle,

  marginHorizontalWide: {
    marginHorizontal: 12,
  } as ViewStyle,

  // Directional spacing - Vertical (top/bottom)
  paddingVerticalTight: {
    paddingVertical: 4,
  } as ViewStyle,

  paddingVerticalRegular: {
    paddingVertical: 8,
  } as ViewStyle,

  paddingVerticalWide: {
    paddingVertical: 12,
  } as ViewStyle,

  marginVerticalTight: {
    marginVertical: 4,
  } as ViewStyle,

  marginVerticalRegular: {
    marginVertical: 8,
  } as ViewStyle,

  marginVerticalWide: {
    marginVertical: 12,
  } as ViewStyle,

  // Shape variations
  roundedSmall: {
    borderRadius: 8,
  } as ViewStyle,

  roundedMedium: {
    borderRadius: 16,
  } as ViewStyle,

  roundedLarge: {
    borderRadius: 24,
  } as ViewStyle,

  roundedPill: {
    borderTopRightRadius: 1000,
    borderBottomRightRadius: 1000,
  } as ViewStyle,

  roundedPillFull: {
    borderRadius: 1000,
  } as ViewStyle,

  // Border variations
  borderSubtle: {
    borderWidth: 0.2,
    borderColor: greys(theme)[600],
  } as ViewStyle,

  borderMedium: {
    borderWidth: 0.5,
    borderColor: greys(theme)[600],
  } as ViewStyle,

  borderProminent: {
    borderWidth: 1,
    borderColor: greys(theme)[700],
  } as ViewStyle,

  // Utility styles
  overflowHidden: {
    overflow: 'hidden',
  } as ViewStyle,
});

// Pre-composed style combinations
const sovran = (theme: Theme) => ({
  // Base styles
  ...baseStyles(theme),

  // Composed styles for common use cases
  card: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedMedium,
    ...baseStyles(theme).borderSubtle,
    ...baseStyles(theme).spacingRegular,
  } as ViewStyle,

  pill: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedPillFull,
    ...baseStyles(theme).borderMedium,
    ...baseStyles(theme).spacingTight,
  } as ViewStyle,

  semiPill: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedPill,
    ...baseStyles(theme).borderMedium,
    ...baseStyles(theme).spacingTight,
  } as ViewStyle,

  listItem: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedMedium,
    ...baseStyles(theme).borderSubtle,
    ...baseStyles(theme).marginVerticalTight,
  } as ViewStyle,

  section: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedSmall,
    ...baseStyles(theme).borderSubtle,
    ...baseStyles(theme).spacingRegular,
  } as ViewStyle,

  input: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).roundedSmall,
    ...baseStyles(theme).borderMedium,
    ...baseStyles(theme).spacingTight,
    padding: 12,
  } as ViewStyle,

  // Selection controls
  selectionControl: {
    width: 16,
    height: 16,
    borderRadius: 16,
    borderWidth: 0.5,
  } as ViewStyle,

  selectionControlActive: {
    backgroundColor: shades[200],
    borderColor: shades[200],
  } as ViewStyle,

  selectionControlInactive: {
    backgroundColor: greys(theme)[600],
    borderColor: greys(theme)[500],
  } as ViewStyle,

  // Background variations
  backgroundSubtle: {
    backgroundColor: opacity(greys(theme)[800], 0.75),
  } as ViewStyle,

  backgroundSolid: {
    backgroundColor: greys(theme)[800],
  } as ViewStyle,
});

export { sovran };

const SelectedMintDisplay = ({
  onMintSelected,
  onMintQuoteUpdate: _onMintQuoteUpdate,
  onUnitUpdate: _onUnitUpdate,
  unit,
  loading: _loading,
  style,
}: SelectedMintDisplayProps) => {
  const actionSheetRef = useRef<ActionSheetRef>(null);

  return (
    <>
      <MintSelectorButton style={style} unit={unit} actionSheetRef={actionSheetRef} />

      <MintSheet
        actionSheetRef={actionSheetRef}
        onMintSelected={onMintSelected}
        onMintQuoteUpdate={_onMintQuoteUpdate}
        onUnitUpdate={_onUnitUpdate}
        unit={unit}
        loading={_loading}
      />
    </>
  );
};

const MintSheet = ({
  actionSheetRef,
  onMintSelected,
  onMintQuoteUpdate: _onMintQuoteUpdate2,
  onUnitUpdate: _onUnitUpdate2,
  unit,
  loading: _loading2,
}: {
  actionSheetRef: React.RefObject<ActionSheetRef | null>;
  onMintSelected?: SelectedMintDisplayProps['onMintSelected'];
  onMintQuoteUpdate?: SelectedMintDisplayProps['onMintQuoteUpdate'];
  onUnitUpdate?: SelectedMintDisplayProps['onUnitUpdate'];
  unit?: string;
  loading?: boolean;
}) => {
  return (
    <Sheet
      actionSheetRef={actionSheetRef}
      routes={[
        {
          name: 'mintSelect',
          component: () => (
            <MintSelect
              onMintSelected={onMintSelected}
              unit={unit}
              startInEditing={false}
              onCancel={() => {}}
              onSaved={() => {}}
            />
          ),
        },
        {
          name: 'mintAddMore',
          component: () => (
            <MintAddMore
              onClose={(data) => {
                store.dispatch(
                  addMints({
                    profileId: memoizedGetCurrentProfile(store.getState()).id,
                    mints: data.mints,
                  })
                );
              }}
              payload={{ currencies: ['SAT', 'USD', 'EUR', 'GBP'] }}
            />
          ),
        },
        {
          name: 'mintDetailsPage',
          component: () => <MintDetailPage />,
        },
        {
          name: 'mintDeleteConfirm',
          component: () => <MintDeleteConfirmRoute />,
        },
      ]}
      initialRoute={'mintSelect'}></Sheet>
  );
};

registerSheet('mint', MintSheet);

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    icon: {
      width: 32,
      height: 32,
      borderRadius: 12,
    },
    placeholderIcon: {
      width: 32,
      height: 32,
      borderRadius: 12,
      backgroundColor: greys(theme)[500],
    },
    name: {
      color: greys(theme)[50],
      fontSize: 12,
      fontFamily: 'OverpassBold',
      marginLeft: -2,
    },
    chevronContainer: {
      alignSelf: 'center',
      padding: 4,
    },
  });

export default SelectedMintDisplay;
