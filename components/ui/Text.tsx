import React from 'react';
import { Text as DefaultText, TextStyle, ColorValue } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { Skeleton } from 'react-native-skeleton-component';
import capsize from 'react-native-capsize';
import { getFontMetrics } from 'helper/fontMetrics';

interface GradientTextProps extends TextProps {
  children: React.ReactNode;
  style?: TextStyle;
  gradientColors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
}

const GradientText = ({ children, style, gradientColors, ...rest }: GradientTextProps) => {
  const { getShadeColor } = useTheme();

  return (
    <MaskedView
      maskElement={
        <Text style={style} {...rest}>
          {children}
        </Text>
      }>
      <LinearGradient
        colors={
          (gradientColors || [getShadeColor('200'), getShadeColor('300')]) as readonly [
            ColorValue,
            ColorValue,
            ...ColorValue[],
          ]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}>
        <Text style={[style, { opacity: 0 }]} {...rest}>
          {children}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
};

interface StyledTextProps extends CustomTextProps {
  primary?: boolean;
  secondary?: boolean;
  negative?: boolean;
  colors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
  custom?: boolean;
}

export const StyledText = ({
  primary,
  secondary,
  negative,
  custom,
  colors = ['#4c669f', '#3b5998', '#192f6a'],
  style,
  children,
  ...props
}: StyledTextProps) => {
  const { getPrimaryColor, getShadeColor } = useTheme();

  if (primary) {
    return (
      <GradientText style={style} {...props}>
        {children}
      </GradientText>
    );
  } else if (secondary) {
    return (
      <GradientText gradientColors={[getPrimaryColor('400'), getPrimaryColor('500')]} style={style}>
        {children}
      </GradientText>
    );
  } else if (negative) {
    return (
      <GradientText gradientColors={[getShadeColor('300'), getShadeColor('300')]} style={style}>
        {children}
      </GradientText>
    );
  } else if (custom) {
    return (
      <GradientText gradientColors={colors} style={style}>
        {children}
      </GradientText>
    );
  }

  return (
    <Text style={style} {...props}>
      {children}
    </Text>
  );
};

type TextProps = DefaultText['props'] & { id?: string };

export interface CustomTextProps extends TextProps {
  // Weight props
  thin?: boolean;
  extralight?: boolean;
  light?: boolean;
  regular?: boolean;
  medium?: boolean;
  semibold?: boolean;
  bold?: boolean;
  extrabold?: boolean;
  heavy?: boolean;
  black?: boolean;
  mono?: boolean;
  weight?: string;

  // Font family props
  overpass?: boolean;
  lexend?: boolean;

  // Style props
  italic?: boolean;
  size?: number;
  capHeight?: number;
  lineGap?: number;
  style?: object;
  lightColor?: string;
  darkColor?: string;
  id?: string;
  children?: React.ReactNode;
  className?: string;
  testID?: string;
  loading?: boolean;
  color?: string;
}

function getWeightFromProps(props: CustomTextProps): string {
  if (props.weight) return props.weight;
  if (props.thin) return 'thin';
  if (props.extralight) return 'extralight';
  if (props.light) return 'light';
  if (props.medium) return 'medium';
  if (props.semibold) return 'semibold';
  if (props.bold) return 'bold';
  if (props.extrabold) return 'extrabold';
  if (props.heavy) return 'heavy';
  if (props.black) return 'black';
  if (props.mono) return 'mono';
  return 'regular'; // default
}

function getFamilyFromProps(props: CustomTextProps): string {
  if (props.lexend) return 'lexend';
  return 'overpass'; // default
}

export function UntranslatedText({
  size = 14,
  italic = false,
  capHeight,
  lineGap = 0,
  ...props
}: CustomTextProps) {
  const { getPrimaryColor } = useTheme();
  const { style, children, ...otherProps } = props;

  const weight = getWeightFromProps(props);
  const family = getFamilyFromProps(props);

  let fontFamily;

  if (weight === 'mono') {
    fontFamily = `${family.charAt(0).toUpperCase() + family.slice(1)}Mono`;
  } else {
    // Handle different weight mappings for each font family
    let weightSuffix;

    if (family === 'overpass') {
      switch (weight) {
        case 'thin':
          weightSuffix = 'Thin';
          break;
        case 'extralight':
          weightSuffix = 'Extralight';
          break;
        case 'light':
          weightSuffix = 'Light';
          break;
        case 'regular':
          weightSuffix = 'Regular';
          break;
        case 'medium':
          weightSuffix = 'Semibold'; // Overpass doesn't have Medium, map to Semibold
          break;
        case 'semibold':
          weightSuffix = 'Semibold';
          break;
        case 'bold':
          weightSuffix = 'Bold';
          break;
        case 'extrabold':
          weightSuffix = 'Extrabold';
          break;
        case 'heavy':
          weightSuffix = 'Heavy';
          break;
        case 'black':
          weightSuffix = 'Heavy'; // Overpass doesn't have Black, map to Heavy
          break;
        default:
          weightSuffix = 'Regular';
      }
    } else {
      // lexend
      switch (weight) {
        case 'thin':
          weightSuffix = 'Thin';
          break;
        case 'extralight':
          weightSuffix = 'ExtraLight';
          break;
        case 'light':
          weightSuffix = 'Light';
          break;
        case 'regular':
          weightSuffix = 'Regular';
          break;
        case 'medium':
          weightSuffix = 'Medium';
          break;
        case 'semibold':
          weightSuffix = 'SemiBold';
          break;
        case 'bold':
          weightSuffix = 'Bold';
          break;
        case 'extrabold':
          weightSuffix = 'ExtraBold';
          break;
        case 'heavy':
          weightSuffix = 'Black'; // Lexend doesn't have Heavy, map to Black
          break;
        case 'black':
          weightSuffix = 'Black';
          break;
        default:
          weightSuffix = 'Regular';
      }
    }

    // Add italic suffix for Overpass (Lexend doesn't seem to have italic variants in your list)
    const italicSuffix = italic && family === 'overpass' ? 'Italic' : '';

    // Handle special case for Overpass regular italic
    if (family === 'overpass' && weight === 'regular' && italic) {
      fontFamily = 'OverpassItalic';
    } else {
      fontFamily = `${family.charAt(0).toUpperCase() + family.slice(1)}${weightSuffix}${italicSuffix}`;
    }
  }

  // Apply capsize if capHeight is provided and font metrics are available
  const fontMetrics = getFontMetrics(family as 'overpass' | 'lexend', weight, italic);
  const shouldUseCapsize = capHeight !== undefined && fontMetrics !== null;

  // Build base style
  const baseStyle: TextStyle = {
    color: getPrimaryColor('0'),
    fontFamily: fontFamily,
  };

  // Apply capsize styles if capHeight is provided
  if (shouldUseCapsize) {
    const capsizedStyles = capsize({
      fontMetrics: fontMetrics!,
      capHeight: capHeight!,
      lineGap: lineGap,
    });
    Object.assign(baseStyle, capsizedStyles);
  } else {
    // Fall back to standard fontSize when capHeight is not provided
    baseStyle.fontSize = size;
  }

  return (
    <DefaultText
      testID={props.testID}
      style={[baseStyle, style, ...(props?.color ? [{ color: props?.color }] : [])]}
      {...otherProps}>
      {children}
    </DefaultText>
  );
}

export function Text({
  loading = false,
  size = 14,
  italic = false,
  capHeight,
  lineGap,
  ...props
}: CustomTextProps) {
  const { children, ...otherProps } = props;

  // Use capHeight for skeleton height if provided, otherwise use size
  const skeletonHeight = capHeight !== undefined ? capHeight + 2 : size + 2;

  if (loading) {
    return (
      <Skeleton
        style={{
          width: 120,
          height: skeletonHeight,
          marginBottom: 2,
          borderRadius: 2,
        }}></Skeleton>
    );
  }

  return (
    <UntranslatedText
      testID={props.testID}
      size={size}
      italic={italic}
      capHeight={capHeight}
      lineGap={lineGap}
      {...otherProps}>
      {children}
    </UntranslatedText>
  );
}
