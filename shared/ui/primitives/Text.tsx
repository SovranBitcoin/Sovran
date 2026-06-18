import React from 'react';
import {
  Text as DefaultText,
  TextStyle,
  ColorValue,
  View,
  type StyleProp,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import opacity from 'hex-color-opacity';

import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';

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

interface CustomTextProps extends TextProps {
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
  /** Invisible text rendered to size the loading bar when children is nullish. */
  placeholder?: string;
  /** Rendered when not loading and children is nullish. Styled identically to
   *  children so swapping to real content produces no visual jump. */
  fallback?: React.ReactNode;
  color?: string;
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
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
 * State resolution (three states, no flash-through):
 * - `loading === true`                → loading bar (50% foreground fill)
 * - `!loading` && children != null    → content (children)
 * - `!loading` && children == null && fallback != null → fallback (styled as content)
 * - `!loading` && both nullish        → empty (NBSP for layout stability)
 *
 * Pass `placeholder` to size the loading bar when children / fallback are
 * unavailable (e.g. `placeholder="Username"` ≈ name-length bar).
 */
export function Text({ loading, size = 14, italic = false, ...props }: CustomTextProps) {
  const {
    children,
    placeholder,
    fallback,
    visualScope,
    visualKey,
    visualSurface,
    visualComponent,
    visualPhase,
    visualExtra,
    visualDisabled,
    ...otherProps
  } = props;
  const foreground = useThemeColor('foreground');
  // Skeleton fill — kept low-opacity so a list of placeholders reads as
  // ambient "stuff is loading" rather than a row of bold rectangles. The
  // foreground color (theme-aware) ensures it remains visible on any
  // background tint.
  const loadingColor = opacity(foreground, 0.07);

  if (loading) {
    return (
      <TextLoadingPlaceholder
        size={size}
        italic={italic}
        placeholder={placeholder}
        fallback={fallback}
        visualScope={visualScope}
        visualKey={visualKey}
        visualSurface={visualSurface}
        visualComponent={visualComponent}
        visualPhase={visualPhase}
        visualExtra={visualExtra}
        visualDisabled={visualDisabled}
        loadingColor={loadingColor}
        textProps={otherProps}>
        {children}
      </TextLoadingPlaceholder>
    );
  }

  if (children == null && fallback != null) {
    // Fallback rendered as a child of UntranslatedText so it inherits the
    // same font family / size / weight / color as content would have.
    return (
      <UntranslatedText size={size} italic={italic} {...otherProps}>
        {fallback}
      </UntranslatedText>
    );
  }

  return (
    <UntranslatedText size={size} italic={italic} {...otherProps}>
      {children}
    </UntranslatedText>
  );
}

type TextLoadingPlaceholderProps = {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  italic: boolean;
  loadingColor: string;
  placeholder?: string;
  size: number;
  textProps: Omit<
    CustomTextProps,
    | 'children'
    | 'fallback'
    | 'italic'
    | 'loading'
    | 'placeholder'
    | 'size'
    | 'visualComponent'
    | 'visualDisabled'
    | 'visualExtra'
    | 'visualKey'
    | 'visualPhase'
    | 'visualScope'
    | 'visualSurface'
  >;
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

let textLoadingVisualInstance = 0;

function TextLoadingPlaceholder({
  children,
  fallback,
  italic,
  loadingColor,
  placeholder,
  size,
  textProps,
  visualScope = 'loading.text',
  visualKey,
  visualSurface = 'shared',
  visualComponent = 'TextLoading',
  visualPhase = 'loading',
  visualExtra,
  visualDisabled,
}: TextLoadingPlaceholderProps): React.ReactElement {
  const instanceKeyRef = React.useRef<string | null>(null);
  if (instanceKeyRef.current === null) {
    textLoadingVisualInstance += 1;
    instanceKeyRef.current = `text-loading:${textLoadingVisualInstance}`;
  }
  const placeholderText =
    placeholder ?? children ?? (typeof fallback === 'string' ? fallback : '\u00A0');
  const layout = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : instanceKeyRef.current,
    itemType: 'text-loading',
    phase: visualPhase,
    extra: () => ({
      size,
      placeholderLength: typeof placeholderText === 'string' ? placeholderText.length : null,
      hasFallback: fallback != null,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
  const handleLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      layout.onLayout(event);
    },
    [layout]
  );
  const loadingBarStyle = React.useMemo<StyleProp<ViewStyle>>(
    () => [loadingInsetStyle, { borderRadius: 4, backgroundColor: loadingColor }],
    [loadingColor]
  );
  const hiddenTextCompositeStyle = React.useMemo(
    () => [textProps.style, hiddenTextStyle],
    [textProps.style]
  );

  return (
    <View
      ref={layout.ref}
      collapsable={false}
      pointerEvents="none"
      style={loadingWrapperStyle}
      onLayout={handleLayout}>
      <View style={loadingBarStyle} />
      <UntranslatedText size={size} italic={italic} {...textProps} style={hiddenTextCompositeStyle}>
        {placeholderText}
      </UntranslatedText>
    </View>
  );
}

const loadingWrapperStyle = {
  position: 'relative' as const,
  overflow: 'hidden' as const,
  alignSelf: 'flex-start' as const,
};
const hiddenTextStyle = { opacity: 0 };

/** Inset the loading bar to ~90% height, vertically centered, to account for glyph padding. */
const LOADING_INSET = '5%' as unknown as number;
const loadingInsetStyle = {
  position: 'absolute' as const,
  top: LOADING_INSET,
  bottom: LOADING_INSET,
  left: 0,
  right: 0,
};
