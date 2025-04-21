import React, { useRef } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import Icon from 'assets/icons';
import { ActionSheetRef, registerSheet } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { formatCurrency } from 'helper/currency';
import { Text } from 'components/common/Themed';
import { useGetMintInfo } from 'helper/redux/cashu';
import { Sheet } from 'components/layout/sheets/mints/sheet';
import { MintSelect } from 'components/layout/sheets/mints/MintSelect';
import MintAddMore from 'components/layout/sheets/mints/MintAddMore';

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
}

interface Mint {
  id: string;
  name: string;
  logo?: string;
  supportedUnits: string[];
}

interface MintInfo {
  icon_url: string;
  nuts?: {
    methods?: Array<{ unit: string }>;
  }[];
}

interface ProcessedMintData {
  info: MintInfo;
  supportedUnits: string[];
  isLoading: boolean;
}

const MintSelectorButton: React.FC<SelectedMintDisplayProps> = ({
  onPress,
  unit,
  actionSheetRef,
}) => {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const mintInfo = useGetMintInfo({ mintUrl: selectedMint });

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
    actionSheetRef.current?.show();
  };

  // Safely extract and process unit string
  const mintUnitLower = unit ? unit.toLowerCase() : '';
  const mintUnitUpper = unit ? unit.toUpperCase() : '';
  const currencyValue = mintUnitLower === 'sat' ? 'BTC' : (mintUnitUpper as 'USD' | 'EUR' | 'GBP');
  const denominationValue =
    mintUnitLower === 'sat' ? 'sats' : (mintUnitLower as 'usd' | 'eur' | 'gbp');
  const precision = mintUnitUpper === 'SAT' ? 0 : 2;
  const currencyDisplay = mintUnitUpper === 'SAT' ? 'name' : 'symbol';

  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  return (
    <TouchableOpacity
      style={[sovran.listItem, { alignSelf: 'center' }]}
      onPress={handlePress}
      onPressIn={() => {}}
      onPressOut={() => {}}>
      {mintInfo?.data?.icon_url ? (
        <Image source={{ uri: mintInfo?.data?.icon_url }} style={styles.icon} />
      ) : (
        <View style={styles.placeholderIcon} />
      )}
      <Text style={styles.name}>{selectedMint?.replace('https://', '')?.split('/')?.[0]}</Text>
      <Text style={styles.dot}>•</Text>
      <Text style={styles.balance}>
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
      </Text>
      <View style={styles.chevronContainer}>
        <Icon name="fluent:chevron-down-12-filled" size={12} color={greys(theme)[700]} />
      </View>
    </TouchableOpacity>
  );
};

import { ViewStyle } from 'react-native';
import MintDetailPage from './MintDetailsPage';

// Theme type definition
interface Theme {
  isDark: boolean;
}

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

// Current theme (would be dynamic in a real app)
const currentTheme: Theme = 'dark';

// Base styles that can be composed together
const baseStyles = {
  // Base container styles
  container: {
    padding: 8,
    backgroundColor: greys(currentTheme)[1800],
    borderColor: greys(currentTheme)[1300],
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
    borderColor: greys(currentTheme)[1300],
  } as ViewStyle,

  borderMedium: {
    borderWidth: 0.5,
    borderColor: greys(currentTheme)[1400],
  } as ViewStyle,

  borderProminent: {
    borderWidth: 1,
    borderColor: greys(currentTheme)[1500],
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
};

// Pre-composed style combinations
const sovran = {
  // Base styles
  ...baseStyles,

  // Composed styles for common use cases
  card: {
    ...baseStyles.container,
    ...baseStyles.roundedMedium,
    ...baseStyles.borderSubtle,
    ...baseStyles.spacingRegular,
  } as ViewStyle,

  pill: {
    ...baseStyles.container,
    ...baseStyles.roundedPillFull,
    ...baseStyles.borderMedium,
    ...baseStyles.spacingTight,
  } as ViewStyle,

  semiPill: {
    ...baseStyles.container,
    ...baseStyles.roundedPill,
    ...baseStyles.borderMedium,
    ...baseStyles.spacingTight,
  } as ViewStyle,

  listItem: {
    ...baseStyles.container,
    ...baseStyles.row,
    ...baseStyles.roundedMedium,
    ...baseStyles.borderSubtle,
    ...baseStyles.marginVerticalTight,
  } as ViewStyle,

  section: {
    ...baseStyles.container,
    ...baseStyles.column,
    ...baseStyles.roundedSmall,
    ...baseStyles.borderSubtle,
    ...baseStyles.spacingRegular,
  } as ViewStyle,

  input: {
    ...baseStyles.container,
    ...baseStyles.roundedSmall,
    ...baseStyles.borderMedium,
    ...baseStyles.spacingTight,
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
    backgroundColor: greys(currentTheme)[1400],
    borderColor: greys(currentTheme)[1000],
  } as ViewStyle,

  // Background variations
  backgroundSubtle: {
    backgroundColor: opacity(greys(currentTheme)[1800], 0.75),
  } as ViewStyle,

  backgroundSolid: {
    backgroundColor: greys(currentTheme)[1800],
  } as ViewStyle,
};

// Function to update theme
const updateTheme = (isDark: boolean) => {
  currentTheme.isDark = isDark;
  // In a real implementation, you'd recompute all the styles here
};

export { sovran, updateTheme };

registerSheet('mint', MintSheet);

const SelectedMintDisplay: React.FC<SelectedMintDisplayProps> = ({
  onMintSelected,
  onMintQuoteUpdate,
  onUnitUpdate,
  pr,
  unit,
  loading,
}) => {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const actionSheetRef = useRef<ActionSheetRef>(null);

  return (
    <>
      <MintSelectorButton unit={unit} actionSheetRef={actionSheetRef} />

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
          component: () => <MintAddMore />,
        },
        {
          name: 'mintDetailsPage',
          component: () => <MintDetailPage />,
        },
      ]}
      initialRoute={'mintSelect'}></Sheet>
  );
};

export const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: 100000,
      backgroundColor: greys(theme)[1800],
      marginBottom: 8,
    },
    icon: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    placeholderIcon: {
      width: 24,
      height: 24,
      borderRadius: 32,
      backgroundColor: greys(theme)[400],
    },
    name: {
      color: greys(theme)[100],
      fontSize: 14,
      marginLeft: 8,
      fontFamily: 'OverpassRegular',
    },
    dot: {
      color: greys(theme)[700],
      fontSize: 16,
      marginHorizontal: 8,
    },
    balance: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
    chevronContainer: {
      padding: 4,
    },
    chevron: {
      marginRight: 0,
    },
    actionSheetContainer: {
      height: '100%',
      backgroundColor: greys(theme)[2300],
    },
    scrollContainer: {
      padding: 16,
      height: '100%',
    },
    buttonContainer: {
      padding: 16,
      backgroundColor: greys(theme)[2300],
    },
    sectionHeader: {
      color: greys(theme)[0],
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
      backgroundColor: greys(theme)[1800],
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
    },
    currencyText: {
      color: greys(theme)[0],
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
      backgroundColor: greys(theme)[1800],
      marginBottom: 8,
    },
    selectedMintItem: {
      backgroundColor: greys(theme)[1500],
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: greys(theme)[400],
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    mintBalance: {
      color: greys(theme)[400],
      fontSize: 14,
    },
    button: {
      padding: 16,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      marginTop: 16,
      alignItems: 'center',
    },
    buttonText: {
      color: greys(theme)[0],
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
