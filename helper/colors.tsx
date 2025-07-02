import { BACKGROUND_IMAGE_ATTRIBUTES } from './backgroundImages';

export const shades = {
  100: '#FF5841',
  200: '#FF353C',
  300: '#ED0C46',
  400: '#CF014E',
  500: '#BF004E',
};

type ShadeKey = 100 | 200 | 300 | 400 | 500;

/**
 * Convert a hex string to an RGB object.
 */
export const hexToRgb = (hex: string) => {
  const clean = hex.replace('#', '');
  const bigint = parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean,
    16
  );
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

/**
 * Convert an RGB tuple to HSL.
 */
export const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

/**
 * Convert an HSL tuple to RGB.
 */
export const hslToRgb = (h: number, s: number, l: number) => {
  h /= 360;
  s /= 100;
  l /= 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);

  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((x) => {
      const hex = x.toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join('')}`;

interface ShadeDelta {
  h: number;
  s: number;
  l: number;
}

const BASE_SHADE_DELTAS: Record<Exclude<ShadeKey, 300>, ShadeDelta> = {
  100: { h: -337.2701754385965, s: 9.638554216867476, l: 13.921568627450974 },
  200: { h: 13.387458745874653, s: 9.638554216867476, l: 11.568627450980387 },
  400: { h: -6.960517799352772, s: 8.677015755329023, l: -8.039215686274517 },
  500: { h: -9.035951134380412, s: 9.638554216867476, l: -11.372549019607845 },
};

export const computeShades = (base300: string) => {
  const baseHsl = rgbToHsl(...Object.values(hexToRgb(base300)));
  const result: Record<ShadeKey, string> = { 300: base300 } as Record<ShadeKey, string>;

  (Object.keys(BASE_SHADE_DELTAS) as Exclude<ShadeKey, 300>[]).forEach((key) => {
    const delta = BASE_SHADE_DELTAS[key];
    const h = (baseHsl.h + delta.h + 360) % 360;
    const s = Math.max(0, Math.min(100, baseHsl.s + delta.s));
    const l = Math.max(0, Math.min(100, baseHsl.l + delta.l));
    const { r, g, b } = hslToRgb(h, s, l);
    result[key] = rgbToHex(r, g, b);
  });

  return result;
};

export const reds = {
  300: shades[300],
};

export const greens = {
  100: '#E0F8E0',
  200: '#A3E4A3',
  300: '#0CED3E',
  400: '#0ABF35',
  500: '#089A2C',
};

export const purples = {
  100: '#E0E0F8',
  200: '#A3A3E4',
  300: '#8A2BE2',
  400: '#6A0DAD',
  500: '#4B0082',
};

export const indigos = {
  100: '#E0E0F8',
  200: '#A3A3E4',
  300: '#8A2BE2',
  400: '#6A0DAD',
  500: '#4B0082',
};

export const blues = {
  300: '#0CED3E',
};

export const greys = (t = 'dark') => {
  const name = t?.id || t;
  if (BACKGROUND_IMAGE_ATTRIBUTES?.[name]) {
    return BACKGROUND_IMAGE_ATTRIBUTES[name].greys;
  }

  switch (name) {
    case 'neon-dream': {
      return {
        950: '#0B0033',
        900: '#0D0055',
        800: '#110066',
        700: '#220099',
        600: '#4400FF',
        500: '#7744FF',
        400: '#CC99FF',
        300: '#E5CCFF',
        200: '#F0E6FF',
        100: '#F9F4FF',
        50: '#FCF9FF',
        0: '#FFFFFF',
      };
    }
    case 'cosmic-ember': {
      return {
        950: '#1A001A',
        900: '#330033',
        800: '#330033',
        700: '#520052',
        600: '#990099',
        500: '#B300B3',
        400: '#E066E0',
        300: '#EE99EE',
        200: '#F5CCF5',
        100: '#F9E6F9',
        50: '#FDF4FD',
        0: '#FFFFFF',
      };
    }
    case 'digital-oasis': {
      return {
        950: '#002B1F',
        900: '#004735',
        800: '#004D33',
        700: '#007351',
        600: '#00B37F',
        500: '#00CC99',
        400: '#33FFC1',
        300: '#66FFD9',
        200: '#99FFE6',
        100: '#CCFFF2',
        50: '#E6FFFA',
        0: '#FFFFFF',
      };
    }
    case 'celestial-aura': {
      return {
        950: '#001F3F',
        900: '#003569',
        800: '#003366',
        700: '#004C99',
        600: '#007FFF',
        500: '#3399FF',
        400: '#99CCFF',
        300: '#CCE5FF',
        200: '#E6F2FF',
        100: '#F0F8FF',
        50: '#F8FBFF',
        0: '#FFFFFF',
      };
    }
    case 'urban-concrete': {
      return {
        950: '#1C1C1C',
        900: '#303030',
        800: '#333333',
        700: '#4D4D4D',
        600: '#808080',
        500: '#999999',
        400: '#CCCCCC',
        300: '#E0E0E0',
        200: '#E8E8E8',
        100: '#F2F2F2',
        50: '#F9F9F9',
        0: '#FFFFFF',
      };
    }
    case 'volcanic-crimson': {
      return {
        950: '#2A0000',
        900: '#420000',
        800: '#440000',
        700: '#5E0000',
        600: '#9B0000',
        500: '#B40000',
        400: '#FF4040',
        300: '#FF7373',
        200: '#FFADAD',
        100: '#FFD6D6',
        50: '#FFEBEB',
        0: '#FFFFFF',
      };
    }
    case 'crimson-night': {
      return {
        950: '#2B0000',
        900: '#430000',
        800: '#400000',
        700: '#600000',
        600: '#9A0000',
        500: '#B20000',
        400: '#E54D4D',
        300: '#F27979',
        200: '#F7B0B0',
        100: '#FCD5D5',
        50: '#FEEBEB',
        0: '#FFFFFF',
      };
    }
    case 'velvet-emerald': {
      return {
        950: '#002010',
        900: '#004024',
        800: '#00351B',
        700: '#004F2A',
        600: '#008055',
        500: '#009668',
        400: '#33CC96',
        300: '#66E0AD',
        200: '#99F2C3',
        100: '#CCF7D9',
        50: '#E6FAEB',
        0: '#FFFFFF',
      };
    }
    case 'twilight-amber': {
      return {
        950: '#331C00', // Very dark amber
        900: '#442C12', // Intermediate very dark amber
        800: '#4A2900', // Deep amber
        700: '#663A00', // Dark orange-brown
        600: '#995C00', // Bright amber
        500: '#B27200', // Vibrant amber
        400: '#E0A333', // Soft amber
        300: '#F2BE66', // Light amber
        200: '#F7D299', // Very light amber
        100: '#FCE6CC', // Almost white amber
        50: '#FEF1E6', // Very pale amber
        0: '#FFFFFF', // White
      };
    }
    case 'retro-outrun': {
      return {
        950: '#21094E', // Very dark purple
        900: '#441B82', // Intermediate very dark purple
        800: '#511281', // Deep violet
        700: '#6C1D93', // Dark magenta
        600: '#C724B1', // Vivid magenta
        500: '#E6409E', // Bright pink
        400: '#FF9292', // Soft neon pink
        300: '#FFB7B2', // Light neon pink
        200: '#FFD5D5', // Very light pink
        100: '#FFE6E6', // Almost white pink
        50: '#FFF1F1', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'light-beige': {
      return {
        950: '#E3DFD1', // Very light muted beige
        900: '#C9CCBD', // Intermediate light beige
        800: '#D6D2C3', // Light muted beige
        700: '#C7C0A6', // Soft muted beige
        600: '#9C9073', // Muted beige
        500: '#85795B', // Dark muted beige
        400: '#4F4736', // Dark muted brown
        300: '#3C352A', // Very dark muted brown
        200: '#2A261E', // Deep muted brown
        100: '#1A1813', // Almost black beige
        50: '#12100B', // Very deep beige
        0: '#000000', // Black
      };
    }
    case 'beige': {
      return {
        950: '#2C2A24', // Very dark beige
        900: '#48463C', // Intermediate very dark beige
        800: '#4A4536', // Dark beige
        700: '#6B6448', // Medium dark beige
        600: '#A39A6A', // Slightly lighter beige
        500: '#BCAA7A', // Warm beige
        400: '#E4D4B2', // Lighter beige
        300: '#ECE0C6', // Pale beige
        200: '#F4EBDA', // Very light beige
        100: '#FAF4E9', // Almost white beige
        50: '#FCF9F2', // Very pale beige
        0: '#FFFFFF', // White
      };
    }
    case 'middle-beige': {
      return {
        950: '#20201C', // Very dark middle beige
        900: '#3A3A36', // Intermediate very dark middle beige
        800: '#383329', // Dark middle beige
        700: '#555141', // Medium dark middle beige
        600: '#8C8367', // Slightly lighter middle beige
        500: '#A39677', // Warm middle beige
        400: '#D0C5A5', // Lighter middle beige
        300: '#DAD2B5', // Pale middle beige
        200: '#E5DCC6', // Very light middle beige
        100: '#EFE6D9', // Almost white middle beige
        50: '#F5F1E7', // Very pale middle beige
        0: '#FFFFFF', // White
      };
    }
    case 'light': {
      return {
        950: '#FFFFFF',
        900: '#E6E6E6',
        800: '#E8EAED',
        700: '#DADADA',
        600: '#787878',
        500: '#525252',
        400: '#202020',
        300: '#232323',
        200: '#1C1C1C',
        100: '#181818',
        50: '#101010',
        0: '#000000',
      };
    }
    case 'navy': {
      return {
        950: '#0A1A33',
        900: '#0B2746',
        800: '#0B2C50',
        700: '#0D3E66',
        600: '#106393',
        500: '#1477A9',
        400: '#3CADD5',
        300: '#67C7E4',
        200: '#8EDDF1',
        100: '#BAF0FC',
        50: '#D6FAFF',
        0: '#FFFFFF',
      };
    }
    case 'forest': {
      return {
        950: '#0B3D0D', // Very dark green
        900: '#115014', // Dark green
        800: '#145A16', // Dark forest green
        700: '#1E7521', // Medium dark green
        600: '#3CA43B', // Slightly lighter green
        500: '#4CBD49', // Bright green
        400: '#8DEA85', // Lighter green
        300: '#A4F1A0', // Pale green
        200: '#C1F7BD', // Very light green
        100: '#DCFAD8', // Almost white green
        50: '#F0FAEC', // Very pale green
        0: '#FFFFFF', // White
      };
    }

    case 'sunset': {
      return {
        950: '#330D1F', // Very dark reddish-brown
        900: '#46152D', // Deep wine
        800: '#4B162F', // Dark burgundy
        700: '#6A1F40', // Deep plum
        600: '#A33860', // Medium rose
        500: '#C04A75', // Lighter rose
        400: '#E898A4', // Soft coral
        300: '#F1B4B9', // Pale pink
        200: '#F7D1D5', // Very light pink
        100: '#FCE7E9', // Almost white pink
        50: '#FFF4F6', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'ocean': {
      return {
        950: '#002E42', // Very dark blue-green
        900: '#004254', // Deep blue-green
        800: '#004B64', // Dark teal
        700: '#006F87', // Deep teal
        600: '#00A8CE', // Bright cyan
        500: '#00C3E5', // Lighter cyan
        400: '#40E6FF', // Soft cyan
        300: '#7BEFFF', // Pale cyan
        200: '#B2F6FF', // Very light cyan
        100: '#DFFBFF', // Almost white cyan
        50: '#F0FDFF', // Very pale cyan
        0: '#FFFFFF', // White
      };
    }

    case 'dark-grey': {
      return {
        0: '#F5F5F5', // Light grey
        50: '#E0E0E0', // Pale grey
        100: '#CCCCCC', // Very light grey
        200: '#B3B3B3', // Light grey
        300: '#999999', // Medium grey
        400: '#808080', // Grey
        500: '#4D4D4D', // Very dark grey
        600: '#333333', // Charcoal
        700: '#0D0D0D', // Blackish
        800: '#080808', // Near black
        900: '#030303', // Ultra black
        950: '#000000', // Black
      };
    }

    case 'slate-shadow': {
      return {
        0: '#F2F2F2', // Very light slate
        50: '#D9D9D9', // Light slate grey
        100: '#BFBFBF', // Pale slate grey
        200: '#A6A6A6', // Slate grey
        300: '#8C8C8C', // Medium slate grey
        400: '#737373', // Dark slate grey
        500: '#404040', // Charcoal slate
        600: '#333333', // Dark charcoal
        700: '#1A1A1A', // Slate shadow
        800: '#0D0D0D', // Deep shadow
        900: '#050505', // Almost black
        950: '#000000', // Black
      };
    }
    case 'mystic-fog': {
      return {
        0: '#F7F7F7', // Misty white
        50: '#E3E3E3', // Pale mist
        100: '#CCCCCC', // Soft grey mist
        200: '#B2B2B2', // Foggy grey
        300: '#999999', // Mystic grey
        400: '#7F7F7F', // Deep mist grey
        500: '#4C4C4C', // Dark fog
        600: '#333333', // Mystic shadow
        700: '#0F0F0F', // Deep mystic
        800: '#080808', // Dark mystic
        900: '#040404', // Almost black mist
        950: '#000000', // Black
      };
    }

    case 'eclipse-steel': {
      return {
        0: '#F4F4F4', // Soft steel
        50: '#DFDFDF', // Light steel grey
        100: '#C9C9C9', // Pale steel grey
        200: '#AFAFAF', // Steel grey
        300: '#959595', // Dark steel grey
        400: '#7C7C7C', // Deep steel
        500: '#494949', // Eclipse steel
        600: '#363636', // Shadowed steel
        700: '#1C1C1C', // Deep eclipse
        800: '#101010', // Eclipse black
        900: '#080808', // Almost black steel
        950: '#000000', // Total eclipse
      };
    }

    case 'aurora-twilight': {
      return {
        0: '#F0F8FF', // Pale aurora blue
        50: '#E6E6FA', // Soft lavender mist
        100: '#D8BFD8', // Twilight mauve
        200: '#DA70D6', // Aurora pink
        300: '#9932CC', // Deep twilight violet
        400: '#8A2BE2', // Electric purple
        500: '#483D8B', // Dark slate blue
        600: '#2E0854', // Midnight violet
        700: '#0D1B2A', // Twilight shadow
        800: '#000080', // Navy night
        900: '#000060', // Deeper navy
        950: '#000000', // Cosmic black
      };
    }

    case 'rose': {
      return {
        950: '#4C1C24', // Very dark maroon
        900: '#68222D', // Dark maroon
        800: '#732536', // Dark rose
        700: '#993147', // Deep rose
        600: '#D85C78', // Medium rose
        500: '#E7748D', // Bright rose
        400: '#FAB3C2', // Soft pink
        300: '#FCC9D3', // Pale pink
        200: '#FDDDE5', // Very light pink
        100: '#FEEEED', // Almost white pink
        50: '#FFF7F8', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'autumn': {
      return {
        950: '#4D1F00', // Very dark brownish-orange
        900: '#732D00', // Darker burnt orange
        800: '#803300', // Dark burnt orange
        700: '#A64100', // Deep orange
        600: '#D97300', // Bright orange
        500: '#F08B00', // Lighter orange
        400: '#FFB34D', // Soft golden yellow
        300: '#FFC16A', // Light golden yellow
        200: '#FFD699', // Very light golden yellow
        100: '#FFEAC2', // Pale yellow
        50: '#FFF5E0', // Almost white yellow
        0: '#FFFFFF', // White
      };
    }

    case 'coral-sunrise': {
      return {
        950: '#ffb7b0',
        900: '#ff9f96',
        800: '#ffaba3',
        700: '#ff9f96',
        600: '#ff877b',
        500: '#ff7b6e',
        400: '#d95e52',
        300: '#b24e44',
        200: '#8c3d35',
        100: '#662c27',
        50: '#401c18',
        0: '#1a0b0a',
      };
    }
    case 'ice-queen': {
      return {
        950: '#ccecf3',
        900: '#c6eaf2',
        800: '#c3e8f2',
        700: '#bae5f0',
        600: '#a9deec',
        500: '#a1dbea',
        400: '#81b8c5',
        300: '#6a97a2',
        200: '#547780',
        100: '#3d565d',
        50: '#26363a',
        0: '#0f1617',
      };
    }
    case 'tropical-forest': {
      return {
        950: '#90c590',
        900: '#80bb80',
        800: '#7ebb7e',
        700: '#6cb26c',
        600: '#479e47',
        500: '#349534',
        400: '#1d761d',
        300: '#186118',
        200: '#134c13',
        100: '#0e380e',
        50: '#082308',
        0: '#030e03',
      };
    }
    case 'desert-dune': {
      return {
        950: '#f6e4d7',
        900: '#f5e0cf',
        800: '#f4e0d0',
        700: '#f3dbca',
        600: '#f0d2bc',
        500: '#eeceb6',
        400: '#c9ab95',
        300: '#a68d7b',
        200: '#826f60',
        100: '#5f5046',
        50: '#3b322c',
        0: '#181412',
      };
    }
    case 'misty-morning': {
      return {
        950: '#e0e0e0',
        900: '#d9d9d9',
        800: '#dadada',
        700: '#d5d5d5',
        600: '#cacaca',
        500: '#c5c5c5',
        400: '#a3a3a3',
        300: '#868686',
        200: '#6a6a6a',
        100: '#4d4d4d',
        50: '#303030',
        0: '#131313',
      };
    }

    case 'dark':
    default: {
      return {
        0: '#FFFFFF',
        50: '#E8EAED', // 50
        100: '#C7C7C7', // 100
        200: '#A8A8A8', // 200
        300: '#787878', // 300
        400: '#525252', // 400
        500: '#2C2C2C', // 500
        600: '#202020', // 600
        700: '#1C1C1C', // 700
        800: '#181818', // 800
        900: '#121212', // 900
        950: '#080808', // 950
      };
    }
  }
};

export const background = '#FFFFFF';

export const white = '#FFFFFF';

export const black = '#181412'; // off black

export function computeGreys(
  theme: string,
  primaryColor = '#FF0000',
  maxSaturation = 25,
  minLightness = 12
) {
  return greys(theme);
  const baseLightnessMap: Record<string, number> = {};
  for (const [key, hex] of Object.entries(baseGreys)) {
    baseLightnessMap[key] = rgbToHsl(...Object.values(hexToRgb(hex))).l;
  }

  const originalL2300 = baseLightnessMap[950];
  const {
    h: primaryHue,
    s: baseS,
    l: primaryLightness,
  } = rgbToHsl(...Object.values(hexToRgb(primaryColor)));

  const lightnessValues = Object.values(baseLightnessMap);
  const minL = Math.min(...lightnessValues);
  const maxL = Math.max(...lightnessValues);

  const scaleLightness = (l: number) =>
    originalL2300 + ((l - minL) / (maxL - minL)) * (100 - originalL2300);

  const scaleSaturation = (l: number) =>
    Math.min(
      maxSaturation,
      maxSaturation * ((l - minL) / (maxL - minL)) ** 1.2 // curved scale to boost higher L
    );

  const tinted: Record<string, string> = {};
  for (const [key, origL] of Object.entries(baseLightnessMap)) {
    const newL = Math.max(scaleLightness(origL), minLightness);
    const newS = scaleSaturation(origL);
    const { r, g, b } = hslToRgb(primaryHue, newS, newL);
    tinted[key] = rgbToHex(r, g, b);
  }

  return tinted;
}
