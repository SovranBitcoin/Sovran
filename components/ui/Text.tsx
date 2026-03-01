import React from 'react';
import { Text as DefaultText, TextStyle, ColorValue, View } from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

import { Skeleton } from 'heroui-native/skeleton';

import { useThemeColor } from 'hooks/useThemeColor';

interface GradientTextProps extends TextProps {
  children: React.ReactNode;
  style?: TextStyle;
  gradientColors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
}

const GradientText = ({ children, style, gradientColors, ...rest }: GradientTextProps) => {
  const [shade200, shade300] = useThemeColor(['shade-200', 'shade-300'] as const);
  return (
    <MaskedView
      maskElement={
        <Text style={style} {...rest}>
          {children}
        </Text>
      }>
      <LinearGradient
        colors={
          (gradientColors || [shade200, shade300]) as readonly [
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
  const [muted, accent, danger] = useThemeColor(['muted', 'accent', 'danger'] as const);

  if (primary) {
    return (
      <GradientText style={style} {...props}>
        {children}
      </GradientText>
    );
  } else if (secondary) {
    return (
      <GradientText gradientColors={[muted, accent]} style={style}>
        {children}
      </GradientText>
    );
  } else if (negative) {
    return (
      <GradientText gradientColors={[danger, danger]} style={style}>
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
  thin?: boolean;
  extralight?: boolean;
  light?: boolean;
  medium?: boolean;
  semibold?: boolean;
  bold?: boolean;
  extrabold?: boolean;
  heavy?: boolean;
  black?: boolean;
  weight?: string;

  /** Use the Overpass font family instead of the default Oxygen. */
  overpass?: boolean;

  italic?: boolean;
  size?: number;
  style?: object;
  lightColor?: string;
  darkColor?: string;
  id?: string;
  children?: React.ReactNode;
  className?: string;
  testID?: string;
  loading?: boolean;
  /** Invisible text rendered to size the skeleton when children is nullish. */
  placeholder?: string;
  color?: string;
}

/**
 * Resolve weight props to one of the three Oxygen font families.
 * Oxygen only ships Light, Regular, and Bold.
 */
function getOxygenFamily(props: CustomTextProps): string {
  if (props.weight) {
    const w = props.weight;
    if (w === 'thin' || w === 'extralight' || w === 'light') return 'OxygenLight';
    if (w === 'regular') return 'OxygenRegular';
    return 'OxygenBold';
  }
  if (props.thin || props.extralight || props.light) return 'OxygenLight';
  if (props.bold || props.semibold || props.medium || props.extrabold || props.heavy || props.black)
    return 'OxygenBold';
  return 'OxygenRegular';
}

/**
 * Resolve weight props to Overpass font families.
 * Used for balance / amount / monetary value displays.
 */
function getOverpassFamily(props: CustomTextProps): string {
  const WEIGHT_MAP: Record<string, string> = {
    thin: 'OverpassLight',
    extralight: 'OverpassLight',
    light: 'OverpassLight',
    regular: 'OverpassRegular',
    medium: 'OverpassSemibold',
    semibold: 'OverpassSemibold',
    bold: 'OverpassBold',
    extrabold: 'OverpassExtrabold',
    heavy: 'OverpassHeavy',
    black: 'OverpassHeavy',
  };

  if (props.weight && WEIGHT_MAP[props.weight]) return WEIGHT_MAP[props.weight];

  for (const key of Object.keys(WEIGHT_MAP)) {
    if ((props as Record<string, unknown>)[key]) return WEIGHT_MAP[key];
  }
  return 'OverpassRegular';
}

export function UntranslatedText({ size = 14, italic = false, ...props }: CustomTextProps) {
  const foreground = useThemeColor('foreground');
  const { style, children, ...otherProps } = props;

  const fontFamily = props.overpass ? getOverpassFamily(props) : getOxygenFamily(props);

  const baseStyle: TextStyle = {
    color: foreground,
    fontFamily,
    fontSize: size,
    ...(italic ? { fontStyle: 'italic' } : undefined),
  };

  return (
    <DefaultText
      testID={props.testID}
      style={[baseStyle, style, ...(props?.color ? [{ color: props?.color }] : [])]}
      {...otherProps}>
      {children}
    </DefaultText>
  );
}

/**
 * Primary text component. Defaults to Oxygen (Light / Regular / Bold).
 * Pass `overpass` for balance / amount / monetary displays.
 *
 * Skeleton behaviour:
 * - `loading={true}`  → always show skeleton (use when data exists but is stale)
 * - `loading={false}` → never show skeleton (explicit opt-out)
 * - `loading` omitted  → auto-skeleton when `children` is null / undefined
 *
 * Pass `placeholder` to control the skeleton width when children is nullish.
 * The placeholder string is rendered invisibly so its text metrics size the
 * skeleton naturally (e.g. `placeholder="Username"` ≈ name-length skeleton).
 */
export function Text({ loading, size = 14, italic = false, ...props }: CustomTextProps) {
  const { children, placeholder, ...otherProps } = props;

  const showSkeleton = loading ?? children == null;

  if (showSkeleton) {
    return (
      <View style={skeletonWrapperStyle}>
        <Skeleton isLoading className="rounded-sm" style={skeletonInsetStyle} />
        <UntranslatedText
          size={size}
          italic={italic}
          {...otherProps}
          style={[otherProps.style, hiddenTextStyle]}>
          {placeholder ?? children ?? '\u00A0'}
        </UntranslatedText>
      </View>
    );
  }

  return (
    <UntranslatedText size={size} italic={italic} {...otherProps}>
      {children}
    </UntranslatedText>
  );
}

const skeletonWrapperStyle = { position: 'relative' as const, overflow: 'hidden' as const };
const hiddenTextStyle = { opacity: 0 };

/** Inset the skeleton to ~90% height, vertically centered, to account for glyph padding. */
const SKELETON_INSET = '5%' as unknown as number;
const skeletonInsetStyle = {
  position: 'absolute' as const,
  top: SKELETON_INSET,
  bottom: SKELETON_INSET,
  left: 0,
  right: 0,
};
