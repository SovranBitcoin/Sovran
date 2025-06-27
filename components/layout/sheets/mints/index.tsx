import React, { useRef } from 'react';
import { Image, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import Icon from 'assets/icons';
import { ActionSheetRef, registerSheet } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { Text } from 'components/common/Text';
import { addMints, useGetMintInfo } from 'helper/redux/cashu';
import { Sheet } from 'components/layout/sheets/mints/sheet';
import { MintSelect } from 'components/layout/sheets/mints/MintSelect';
import { store } from 'helper/redux/store';
import MintDetailPage from './MintDetailsPage';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { memoizedGetTheme } from 'helper/redux/settings';
import { MintAddMore } from './MintAddMore';
import { View } from 'components/common/View';

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
}

export function MintIcon({ mintInfo, size = 32 }) {
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

const MintSelectorButton: React.FC<SelectedMintDisplayProps> = ({
  onPress,
  unit,
  actionSheetRef,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMint });

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
    actionSheetRef.current?.show();
  };

  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  return (
    <TouchableOpacity onPress={handlePress} onPressIn={() => {}} onPressOut={() => {}}>
      <View
        style={[
          sovran(theme).listItem,
          { alignSelf: 'center' },
          style,
          {
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
        ]}
        blur>
        <View
          style={{
            flexDirection: 'row',
          }}>
          <MintIcon mintInfo={mintInfo} />
          <View
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
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
            <AmountFormatter size={12} weight="heavy" amount={balance} unit={unit} />
          </View>
        </View>
        <View style={styles.chevronContainer}>
          <Icon name="fluent:chevron-down-12-filled" size={12} color={theme.greys[700]} />
        </View>
        {/* <Text style={styles.dot}>•</Text> */}
      </View>
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
const baseStyles = (theme: any) => ({
  // Base container styles
  container: {
    padding: 8,
    // backgroundColor: theme.greys[1800],
    borderColor: theme.greys[1300],
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
    borderColor: theme.greys[1300],
  } as ViewStyle,

  borderMedium: {
    borderWidth: 0.5,
    borderColor: theme.greys[1400],
  } as ViewStyle,

  borderProminent: {
    borderWidth: 1,
    borderColor: theme.greys[1500],
  } as ViewStyle,

  // Layout variations
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,

  column: {
    flexDirection: 'column',
  } as ViewStyle,

  // Utility styles
  overflowHidden: {
    overflow: 'hidden',
  } as ViewStyle,
});

// Pre-composed style combinations
const sovran = (theme: any) => ({
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
    ...baseStyles(theme).row,
    ...baseStyles(theme).roundedMedium,
    ...baseStyles(theme).borderSubtle,
    ...baseStyles(theme).marginVerticalTight,
  } as ViewStyle,

  section: {
    ...baseStyles(theme).container,
    ...baseStyles(theme).column,
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
    borderColor: shades[100],
  } as ViewStyle,

  selectionControlInactive: {
    backgroundColor: theme.greys[1400],
    borderColor: theme.greys[1000],
  } as ViewStyle,

  // Background variations
  backgroundSubtle: {
    backgroundColor: opacity(theme.greys[1800], 0.75),
  } as ViewStyle,

  backgroundSolid: {
    backgroundColor: theme.greys[1800],
  } as ViewStyle,
});

export { sovran };

registerSheet('mint', MintSheet);

const SelectedMintDisplay = ({
  onMintSelected,
  onMintQuoteUpdate,
  onUnitUpdate,
  pr,
  unit,
  loading,
  style,
}: SelectedMintDisplayProps) => {
  const actionSheetRef = useRef<ActionSheetRef>(null);

  return (
    <>
      <MintSelectorButton style={style} unit={unit} actionSheetRef={actionSheetRef} />

      <MintSheet
        actionSheetRef={actionSheetRef}
        onMintSelected={onMintSelected}
        onMintQuoteUpdate={onMintQuoteUpdate}
        onUnitUpdate={onUnitUpdate}
        pr={pr}
        unit={unit}
        loading={loading}
      />
    </>
  );
};

const MintSheet = ({
  actionSheetRef,
  onMintSelected,
  onMintQuoteUpdate,
  onUnitUpdate,
  pr,
  unit,
  loading,
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
              pr={pr}
              loading={loading}
              onUnitUpdate={onUnitUpdate}
              onMintQuoteUpdate={onMintQuoteUpdate}></MintSelect>
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
            />
          ),
        },
        {
          name: 'mintDetailsPage',
          component: () => <MintDetailPage />,
        },
      ]}
      initialRoute={'mintSelect'}></Sheet>
  );
};

export const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: 100000,
      backgroundColor: theme.greys[1800],
      marginBottom: 8,
    },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 12,
    },
    placeholderIcon: {
      width: 32,
      height: 32,
      borderRadius: 12,
      backgroundColor: theme.greys[1000],
    },
    name: {
      color: theme.greys[100],
      fontSize: 12,
      fontFamily: 'OverpassBold',
      marginLeft: -2,
    },
    dot: {
      color: theme.greys[700],
      fontSize: 16,
      marginHorizontal: 8,
    },
    balance: {
      color: theme.greys[200],
      fontSize: 12,
      fontFamily: 'OverpassBold',
    },
    chevronContainer: {
      alignSelf: 'center',
      justifyContent: 'flex-end',

      padding: 4,
    },
    chevron: {
      marginRight: 0,
    },
    actionSheetContainer: {
      height: '100%',
      backgroundColor: theme.greys[2300],
    },
    scrollContainer: {
      padding: 16,
      height: '100%',
    },
    buttonContainer: {
      padding: 16,
      backgroundColor: theme.greys[2300],
    },
    sectionHeader: {
      color: theme.greys[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    currencyScroll: {
      flexGrow: 1,
    },
    currencyButton: {
      marginRight: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: theme.greys[1800],
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: theme.greys[1500],
    },
    currencyText: {
      color: theme.greys[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
    mintScroll: {
      maxHeight: 300,
    },
    mintItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      backgroundColor: theme.greys[1800],
      marginBottom: 8,
    },
    selectedMintItem: {
      backgroundColor: theme.greys[1500],
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: theme.greys[400],
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: theme.greys[0],
      fontSize: 16,
    },
    mintBalance: {
      color: theme.greys[400],
      fontSize: 14,
    },
    button: {
      padding: 16,
      backgroundColor: theme.greys[1800],
      borderRadius: 8,
      marginTop: 16,
      alignItems: 'center',
    },
    buttonText: {
      color: theme.greys[0],
      fontSize: 16,
    },
    checkIconContainer: {
      backgroundColor: 'transparent',
      marginLeft: 8,
    },
    loadingMintItem: {
      opacity: 0.7,
    },
    loadingContainer: {
      backgroundColor: 'transparent',
      marginLeft: 8,
      width: 24,
      height: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    disabledButtonText: {
      opacity: 0.5,
    },
    disabledMintItem: {
      opacity: 0.5,
    },
    disabledImage: {
      opacity: 0.5,
    },
    disabledText: {
      opacity: 0.5,
    },
  });

export default SelectedMintDisplay;
