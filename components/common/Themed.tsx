import { Text as DefaultText, View as DefaultView, Pressable } from 'react-native';
// import Colors from "helper/constants/Colors";
import translations from 'helper/translations';
import { useSelector } from 'react-redux';
import { BlurView } from 'expo-blur';
import { greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import React from 'react';

import { TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { greens } from 'helper/colors';
import { Skeleton } from 'react-native-skeleton-component';

interface GradientTextProps extends TextProps {
  children: React.ReactNode;
  style?: TextStyle;
}

const GradientText = ({
  children,
  style,
  gradientColors = [shades[200], shades[500]],
  ...rest
}: GradientTextProps) => {
  return (
    <MaskedView
      maskElement={
        <Text style={style} {...rest}>
          {children}
        </Text>
      }>
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
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
  colors?: string[];
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
  const theme = useSelector(memoizedGetTheme);

  if (primary) {
    return (
      <GradientText style={style} {...props}>
        {children}
      </GradientText>
    );
  } else if (secondary) {
    return (
      <GradientText gradientColors={[greys(theme)[700], greys(theme)[1000]]} style={style}>
        {children}
      </GradientText>
    );
  } else if (negative) {
    return (
      <GradientText gradientColors={[greens[300], greens[300]]} style={style}>
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

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText['props'] & { id?: string };
export type ViewProps = ThemeProps & DefaultView['props'];

// Function to fetch the translated text by id
function getTranslation(id: string, lang: string = 'de'): string | null {
  const translation = translations[lang][id];
  return translation || null;
}

// Reverse mapping for translations to ids
function createReverseTranslationMap(): Record<string, string> {
  const reverseMap: Record<string, string> = {};
  for (const [id, text] of Object.entries(translations['en'])) {
    reverseMap[text] = id;
  }
  return reverseMap;
}

// export function useThemeColor(
//   props: { light?: string; dark?: string },
//   colorName: keyof typeof Colors.light & keyof typeof Colors.dark
// ) {
//   const theme = useColorScheme() ?? "light";
//   const colorFromProps = props[theme];

//   if (colorFromProps) {
//     return colorFromProps;
//   } else {
//     return Colors[theme][colorName];
//   }
// }

export function translateText({ id, children, lang }) {
  // Reverse translation map for English to ID mapping
  const reverseTranslationMap = createReverseTranslationMap();

  // Create a flat string representation of children for matching purposes
  const flatChildrenText = Array.isArray(children)
    ? children
        .map((child: any) =>
          typeof child === 'string' ? child : '{' + Object.keys(child)[0] + '}'
        )
        .join('')
    : children;

  // Check if there's a matching ID for the flatChildrenText
  const matchingId = reverseTranslationMap[flatChildrenText];

  // Use provided id or the matching id found from flatChildrenText
  const finalId = id || matchingId;
  let finalTranslation = finalId ? getTranslation(finalId, lang) : null;

  // If there's a translation, replace placeholders with actual values
  if (finalTranslation && Array.isArray(children)) {
    children.forEach((child: any) => {
      if (typeof child === 'object') {
        const key = Object.keys(child)[0];
        const value = child[key];
        finalTranslation = finalTranslation.replace(`{${key}}`, value);
      }
    });
  }

  // Log untranslated text if necessary
  if (typeof flatChildrenText === 'string' && !matchingId && !finalTranslation) {
    //
  }

  // Display translated or original text
  const displayText = finalTranslation !== null ? finalTranslation : children;

  return displayText;
}

type CustomTextProps = {
  weight?: 'regular' | 'bold' | 'heavy' | 'mono';
  size?: number;
  family?: 'Overpass' | 'Lexend';
  style?: object;
  lightColor?: string;
  darkColor?: string;
  id?: string;
  children?: React.ReactNode;
  className?: string;
};

export function UntranslatedText({
  weight = 'regular',
  size = 14,
  family = 'Overpass',
  ...props
}: CustomTextProps) {
  const theme = useSelector(memoizedGetTheme);
  const { style, lightColor, darkColor, children, ...otherProps } = props;

  let fontFamily;
  switch (weight) {
    case 'bold':
      fontFamily = `${family}Bold`;
      break;
    case 'heavy':
      fontFamily = `${family}Heavy`;
      break;
    case 'mono':
      fontFamily = `${family}Mono`;
      break;
    default:
      fontFamily = `${family}Regular`;
  }

  return (
    <DefaultText
      style={[
        {
          color: greys(theme)[0],
          fontFamily: fontFamily,
          fontSize: size,
        },
        style,
      ]}
      {...otherProps}>
      {children}
    </DefaultText>
  );
}

export function Text({
  loading = false,
  weight = 'regular',
  size = 14,
  family = 'Overpass',
  ...props
}: CustomTextProps) {
  const lang = useSelector((state) => state.settings?.settings?.lang);

  const { id, children, ...otherProps } = props;
  const displayText = translateText({ id, children, lang });

  // Translation debugging removed
  if (loading) {
    return (
      <Skeleton
        style={{
          width: 120,
          height: size + 2,
          marginBottom: 2,
          borderRadius: 2,
        }}></Skeleton>
    );
  }

  return (
    <UntranslatedText weight={weight} size={size} family={family} {...otherProps}>
      {displayText}
    </UntranslatedText>
  );
}

export const View = React.forwardRef((props: ViewProps, ref) => {
  const { style, lightColor, darkColor, ...otherProps } = props;
  // const backgroundColor = useThemeColor(
  //   { light: lightColor, dark: darkColor },
  //   "background"
  // );

  return (
    <DefaultView
      style={[
        // { backgroundColor },
        style,
      ]}
      ref={ref as React.LegacyRef<DefaultView>}
      {...otherProps}
    />
  );
});

export const GeneralizedBlurInput = ({
  onPress,
  placeholder,
  buttonText,
  onButtonPress,
  blurRadius = 86,
  margin = 16,
  height = 46,
  fontFamily = 'OverpassBold',
  fontSize = 14,
  borderWidth = 1,
  shadowOffset = { width: 1, height: 4 },
  shadowOpacity = 0.25,
  shadowRadius = 6,
  pointerEvents = 'none',
  buttonFontFamily = 'OverpassBold',
}) => {
  const theme = useSelector(memoizedGetTheme);

  const placeholderTextColor = greys(theme)[1000];
  const buttonColor = shades[100];
  const borderColor = greys(theme)[1300];
  const shadowColor = greys(theme)[2300];
  const backgroundColor = opacity(greys(theme)[1800], 0.75);
  const textColor = greys(theme)[1000];
  return (
    <View
      style={{
        margin: margin,
        marginTop: 8,
        backgroundColor: 'transparent',
      }}>
      <BlurView
        style={{
          borderRadius: blurRadius,
          height: height,
          overflow: 'hidden',

          backgroundColor: 'transparent',
        }}>
        <Pressable
          onPress={onPress}
          style={{
            backgroundColor: backgroundColor,
            borderWidth: borderWidth,
            borderColor: borderColor,
            shadowColor: shadowColor,
            shadowOffset: shadowOffset,
            shadowOpacity: shadowOpacity,
            shadowRadius: shadowRadius,
            fontFamily: fontFamily,
            padding: 8,
            paddingLeft: 16,
            width: '100%',
            height: '100%',
            borderRadius: blurRadius,
          }}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
        />
      </BlurView>
      <View
        style={{
          position: 'absolute',
          left: 16,
          pointerEvents: pointerEvents,
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'transparent',
        }}>
        <Text
          style={{
            fontSize: fontSize,
            fontFamily: fontFamily,
            color: placeholderTextColor,
          }}>
          {placeholder}
        </Text>
      </View>
      <Pressable
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          position: 'absolute',
          right: 16,
          height: '100%',
        }}
        onPress={onButtonPress}>
        <StyledText
          primary
          style={{
            color: shades[100],
            fontFamily: 'OverpassBold',
          }}>
          Paste
        </StyledText>
      </Pressable>
    </View>
  );
};
