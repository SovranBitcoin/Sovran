export const shades = {
  100: '#FF5841',
  200: '#FF353C',
  300: '#ED0C46',
  400: '#CF014E',
  500: '#BF004E',
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
  switch (t) {
    case 'neon-dream': {
      return {
        2300: '#0B0033',
        2100: '#0C0044',
        2000: '#0D0055',
        1900: '#0E0066',
        1800: '#110066',
        1500: '#220099',
        1400: '#3300CC',
        1300: '#4400FF',
        1200: '#7744FF',
        1000: '#9966FF',
        700: '#CC99FF',
        600: '#E5CCFF',
        400: '#F0E6FF',
        200: '#F9F4FF',
        100: '#FCF9FF',
        0: '#FFFFFF',
      };
    }
    case 'cosmic-ember': {
      return {
        2300: '#1A001A',
        2100: '#260026',
        2000: '#330033',
        1900: '#400040',
        1800: '#330033',
        1500: '#520052',
        1400: '#800080',
        1300: '#990099',
        1200: '#B300B3',
        1000: '#CC00CC',
        700: '#E066E0',
        600: '#EE99EE',
        400: '#F5CCF5',
        200: '#F9E6F9',
        100: '#FDF4FD',
        0: '#FFFFFF',
      };
    }

    case 'digital-oasis': {
      return {
        2300: '#002B1F',
        2100: '#00392A',
        2000: '#004735',
        1900: '#005540',
        1800: '#004D33',
        1500: '#007351',
        1400: '#009966',
        1300: '#00B37F',
        1200: '#00CC99',
        1000: '#00E6B3',
        700: '#33FFC1',
        600: '#66FFD9',
        400: '#99FFE6',
        200: '#CCFFF2',
        100: '#E6FFFA',
        0: '#FFFFFF',
      };
    }
    case 'celestial-aura': {
      return {
        2300: '#001F3F',
        2100: '#002A54',
        2000: '#003569',
        1900: '#00407E',
        1800: '#003366',
        1500: '#004C99',
        1400: '#0066CC',
        1300: '#007FFF',
        1200: '#3399FF',
        1000: '#66B2FF',
        700: '#99CCFF',
        600: '#CCE5FF',
        400: '#E6F2FF',
        200: '#F0F8FF',
        100: '#F8FBFF',
        0: '#FFFFFF',
      };
    }
    case 'urban-concrete': {
      return {
        2300: '#1C1C1C',
        2100: '#262626',
        2000: '#303030',
        1900: '#3A3A3A',
        1800: '#333333',
        1500: '#4D4D4D',
        1400: '#666666',
        1300: '#808080',
        1200: '#999999',
        1000: '#B3B3B3',
        700: '#CCCCCC',
        600: '#E0E0E0',
        400: '#E8E8E8',
        200: '#F2F2F2',
        100: '#F9F9F9',
        0: '#FFFFFF',
      };
    }

    case 'volcanic-crimson': {
      return {
        2300: '#2A0000',
        2100: '#360000',
        2000: '#420000',
        1900: '#4E0000',
        1800: '#440000',
        1500: '#5E0000',
        1400: '#780000',
        1300: '#9B0000',
        1200: '#B40000',
        1000: '#D80000',
        700: '#FF4040',
        600: '#FF7373',
        400: '#FFADAD',
        200: '#FFD6D6',
        100: '#FFEBEB',
        0: '#FFFFFF',
      };
    }
    case 'crimson-night': {
      return {
        2300: '#2B0000',
        2100: '#370000',
        2000: '#430000',
        1900: '#4F0000',
        1800: '#400000',
        1500: '#600000',
        1400: '#800000',
        1300: '#9A0000',
        1200: '#B20000',
        1000: '#D00000',
        700: '#E54D4D',
        600: '#F27979',
        400: '#F7B0B0',
        200: '#FCD5D5',
        100: '#FEEBEB',
        0: '#FFFFFF',
      };
    }
    case 'velvet-emerald': {
      return {
        2300: '#002010',
        2100: '#00301A',
        2000: '#004024',
        1900: '#00502E',
        1800: '#00351B',
        1500: '#004F2A',
        1400: '#00693C',
        1300: '#008055',
        1200: '#009668',
        1000: '#00B37A',
        700: '#33CC96',
        600: '#66E0AD',
        400: '#99F2C3',
        200: '#CCF7D9',
        100: '#E6FAEB',
        0: '#FFFFFF',
      };
    }

    case 'twilight-amber': {
      return {
        2300: '#331C00', // Very dark amber
        2100: '#3C2409', // Slightly lighter very dark amber
        2000: '#442C12', // Intermediate very dark amber
        1900: '#4C341B', // Intermediate very dark amber
        1800: '#4A2900', // Deep amber
        1500: '#663A00', // Dark orange-brown
        1400: '#804B00', // Rich amber
        1300: '#995C00', // Bright amber
        1200: '#B27200', // Vibrant amber
        1000: '#CC8800', // Bright orange-amber
        700: '#E0A333', // Soft amber
        600: '#F2BE66', // Light amber
        400: '#F7D299', // Very light amber
        200: '#FCE6CC', // Almost white amber
        100: '#FEF1E6', // Very pale amber
        0: '#FFFFFF', // White
      };
    }
    case 'retro-outrun': {
      return {
        2300: '#21094E', // Very dark purple
        2100: '#331268', // Slightly lighter very dark purple
        2000: '#441B82', // Intermediate very dark purple
        1900: '#55249C', // Intermediate very dark purple
        1800: '#511281', // Deep violet
        1500: '#6C1D93', // Dark magenta
        1400: '#8B2D9F', // Bright purple
        1300: '#C724B1', // Vivid magenta
        1200: '#E6409E', // Bright pink
        1000: '#FF616D', // Neon pink
        700: '#FF9292', // Soft neon pink
        600: '#FFB7B2', // Light neon pink
        400: '#FFD5D5', // Very light pink
        200: '#FFE6E6', // Almost white pink
        100: '#FFF1F1', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'light-beige': {
      return {
        2300: '#E3DFD1', // Very light muted beige
        2100: '#D6D5C7', // Slightly darker very light beige
        2000: '#C9CCBD', // Intermediate light beige
        1900: '#BCC2B3', // Intermediate light beige
        1800: '#D6D2C3', // Light muted beige
        1500: '#C7C0A6', // Soft muted beige
        1400: '#B1A88C', // Medium muted beige
        1300: '#9C9073', // Muted beige
        1200: '#85795B', // Dark muted beige
        1000: '#6D6148', // Deeper muted beige
        700: '#4F4736', // Dark muted brown
        600: '#3C352A', // Very dark muted brown
        400: '#2A261E', // Deep muted brown
        200: '#1A1813', // Almost black beige
        100: '#12100B', // Very deep beige
        0: '#000000', // Black
      };
    }
    case 'beige': {
      return {
        2300: '#2C2A24', // Very dark beige
        2100: '#3A3830', // Slightly lighter very dark beige
        2000: '#48463C', // Intermediate very dark beige
        1900: '#565248', // Intermediate very dark beige
        1800: '#4A4536', // Dark beige
        1500: '#6B6448', // Medium dark beige
        1400: '#8A8057', // Medium beige
        1300: '#A39A6A', // Slightly lighter beige
        1200: '#BCAA7A', // Warm beige
        1000: '#D7C59A', // Light beige
        700: '#E4D4B2', // Lighter beige
        600: '#ECE0C6', // Pale beige
        400: '#F4EBDA', // Very light beige
        200: '#FAF4E9', // Almost white beige
        100: '#FCF9F2', // Very pale beige
        0: '#FFFFFF', // White
      };
    }
    case 'middle-beige': {
      return {
        2300: '#20201C', // Very dark middle beige
        2100: '#2D2D29', // Slightly lighter very dark middle beige
        2000: '#3A3A36', // Intermediate very dark middle beige
        1900: '#474743', // Intermediate very dark middle beige
        1800: '#383329', // Dark middle beige
        1500: '#555141', // Medium dark middle beige
        1400: '#726C55', // Medium middle beige
        1300: '#8C8367', // Slightly lighter middle beige
        1200: '#A39677', // Warm middle beige
        1000: '#BEAE8D', // Light middle beige
        700: '#D0C5A5', // Lighter middle beige
        600: '#DAD2B5', // Pale middle beige
        400: '#E5DCC6', // Very light middle beige
        200: '#EFE6D9', // Almost white middle beige
        100: '#F5F1E7', // Very pale middle beige
        0: '#FFFFFF', // White
      };
    }
    case 'light': {
      return {
        2300: '#FFFFFF',
        2100: '#F2F2F2',
        2000: '#E6E6E6',
        1900: '#DADADA',
        1800: '#E8EAED',
        1500: '#DADADA',
        1400: '#EFEFEF',
        1300: '#787878',
        1200: '#525252',
        1000: '#393939',
        700: '#202020',
        600: '#232323',
        400: '#1C1C1C',
        200: '#181818',
        100: '#101010',
        0: '#000000',
      };
    }
    case 'navy': {
      return {
        2300: '#0A1A33',
        2100: '#0A223D',
        2000: '#0B2746',
        1900: '#0B2A4B',
        1800: '#0B2C50',
        1500: '#0D3E66',
        1400: '#0F507C',
        1300: '#106393',
        1200: '#1477A9',
        1000: '#1890BF',
        700: '#3CADD5',
        600: '#67C7E4',
        400: '#8EDDF1',
        200: '#BAF0FC',
        100: '#D6FAFF',
        0: '#FFFFFF',
      };
    }
    case 'forest': {
      return {
        2300: '#0B3D0D', // Very dark green
        2100: '#0E4610', // Darker green (between 2300 and 2000)
        2000: '#115014', // Dark green
        1900: '#125718', // Slightly lighter dark green
        1800: '#145A16', // Dark forest green
        1500: '#1E7521', // Medium dark green
        1400: '#2B8F2C', // Medium green
        1300: '#3CA43B', // Slightly lighter green
        1200: '#4CBD49', // Bright green
        1000: '#6EDC67', // Light green
        700: '#8DEA85', // Lighter green
        600: '#A4F1A0', // Pale green
        400: '#C1F7BD', // Very light green
        200: '#DCFAD8', // Almost white green
        100: '#F0FAEC', // Very pale green
        0: '#FFFFFF', // White
      };
    }

    case 'sunset': {
      return {
        2300: '#330D1F', // Very dark reddish-brown
        2100: '#3E1128', // Darker burgundy
        2000: '#46152D', // Deep wine
        1900: '#511A35', // Dark plum
        1800: '#4B162F', // Dark burgundy
        1500: '#6A1F40', // Deep plum
        1400: '#8A274F', // Rich mauve
        1300: '#A33860', // Medium rose
        1200: '#C04A75', // Lighter rose
        1000: '#DC6A8C', // Pinkish-red
        700: '#E898A4', // Soft coral
        600: '#F1B4B9', // Pale pink
        400: '#F7D1D5', // Very light pink
        200: '#FCE7E9', // Almost white pink
        100: '#FFF4F6', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'ocean': {
      return {
        2300: '#002E42', // Very dark blue-green
        2100: '#003847', // Darker blue-green
        2000: '#004254', // Deep blue-green
        1900: '#004E5C', // Dark teal-blue
        1800: '#004B64', // Dark teal
        1500: '#006F87', // Deep teal
        1400: '#008CAA', // Strong teal
        1300: '#00A8CE', // Bright cyan
        1200: '#00C3E5', // Lighter cyan
        1000: '#00DBFF', // Light cyan
        700: '#40E6FF', // Soft cyan
        600: '#7BEFFF', // Pale cyan
        400: '#B2F6FF', // Very light cyan
        200: '#DFFBFF', // Almost white cyan
        100: '#F0FDFF', // Very pale cyan
        0: '#FFFFFF', // White
      };
    }

    case 'dark-grey': {
      return {
        0: '#F5F5F5', // Light grey
        100: '#E0E0E0', // Pale grey
        200: '#CCCCCC', // Very light grey
        400: '#B3B3B3', // Light grey
        600: '#999999', // Medium grey
        700: '#808080', // Grey
        1000: '#666666', // Dark grey
        1200: '#4D4D4D', // Very dark grey
        1300: '#333333', // Charcoal
        1400: '#1A1A1A', // Almost black
        1500: '#0D0D0D', // Blackish
        1800: '#080808', // Near black
        1900: '#050505', // Deep black
        2000: '#030303', // Ultra black
        2100: '#010101', // Near absolute black
        2300: '#000000', // Black
      };
    }

    case 'slate-shadow': {
      return {
        0: '#F2F2F2', // Very light slate
        100: '#D9D9D9', // Light slate grey
        200: '#BFBFBF', // Pale slate grey
        400: '#A6A6A6', // Slate grey
        600: '#8C8C8C', // Medium slate grey
        700: '#737373', // Dark slate grey
        1000: '#595959', // Deep slate
        1200: '#404040', // Charcoal slate
        1300: '#333333', // Dark charcoal
        1400: '#262626', // Shadowy slate
        1500: '#1A1A1A', // Slate shadow
        1800: '#0D0D0D', // Deep shadow
        1900: '#080808', // Darker shadow
        2000: '#050505', // Almost black
        2100: '#020202', // Near pitch black
        2300: '#000000', // Black
      };
    }
    case 'mystic-fog': {
      return {
        0: '#F7F7F7', // Misty white
        100: '#E3E3E3', // Pale mist
        200: '#CCCCCC', // Soft grey mist
        400: '#B2B2B2', // Foggy grey
        600: '#999999', // Mystic grey
        700: '#7F7F7F', // Deep mist grey
        1000: '#666666', // Shadowy mist
        1200: '#4C4C4C', // Dark fog
        1300: '#333333', // Mystic shadow
        1400: '#1F1F1F', // Foggy shadow
        1500: '#0F0F0F', // Deep mystic
        1800: '#080808', // Dark mystic
        1900: '#060606', // Deeper mystic
        2000: '#040404', // Almost black mist
        2100: '#020202', // Near pitch black mist
        2300: '#000000', // Black
      };
    }

    case 'eclipse-steel': {
      return {
        0: '#F4F4F4', // Soft steel
        100: '#DFDFDF', // Light steel grey
        200: '#C9C9C9', // Pale steel grey
        400: '#AFAFAF', // Steel grey
        600: '#959595', // Dark steel grey
        700: '#7C7C7C', // Deep steel
        1000: '#626262', // Eclipse shadow
        1200: '#494949', // Eclipse steel
        1300: '#363636', // Shadowed steel
        1400: '#292929', // Eclipse depth
        1500: '#1C1C1C', // Deep eclipse
        1800: '#101010', // Eclipse black
        1900: '#0C0C0C', // Darker eclipse
        2000: '#080808', // Almost black steel
        2100: '#040404', // Near pitch black steel
        2300: '#000000', // Total eclipse
      };
    }

    case 'aurora-twilight': {
      return {
        0: '#F0F8FF', // Pale aurora blue
        100: '#E6E6FA', // Soft lavender mist
        200: '#D8BFD8', // Twilight mauve
        400: '#DA70D6', // Aurora pink
        600: '#9932CC', // Deep twilight violet
        700: '#8A2BE2', // Electric purple
        1000: '#4B0082', // Indigo dusk
        1200: '#483D8B', // Dark slate blue
        1300: '#2E0854', // Midnight violet
        1400: '#191970', // Midnight blue
        1500: '#0D1B2A', // Twilight shadow
        1800: '#000080', // Navy night
        1900: '#000070', // Dark navy
        2000: '#000060', // Deeper navy
        2100: '#000050', // Deepest navy
        2300: '#000000', // Cosmic black
      };
    }

    case 'rose': {
      return {
        2300: '#4C1C24', // Very dark maroon
        2100: '#5A1F28', // Deep maroon
        2000: '#68222D', // Dark maroon
        1900: '#752532', // Rich dark rose
        1800: '#732536', // Dark rose
        1500: '#993147', // Deep rose
        1400: '#B7415E', // Rich rose
        1300: '#D85C78', // Medium rose
        1200: '#E7748D', // Bright rose
        1000: '#F68CA3', // Light rose
        700: '#FAB3C2', // Soft pink
        600: '#FCC9D3', // Pale pink
        400: '#FDDDE5', // Very light pink
        200: '#FEEEED', // Almost white pink
        100: '#FFF7F8', // Very pale pink
        0: '#FFFFFF', // White
      };
    }
    case 'autumn': {
      return {
        2300: '#4D1F00', // Very dark brownish-orange
        2100: '#602600', // Deeper burnt orange
        2000: '#732D00', // Darker burnt orange
        1900: '#853400', // Rich burnt orange
        1800: '#803300', // Dark burnt orange
        1500: '#A64100', // Deep orange
        1400: '#BF5700', // Strong orange
        1300: '#D97300', // Bright orange
        1200: '#F08B00', // Lighter orange
        1000: '#FFA000', // Golden orange
        700: '#FFB34D', // Soft golden yellow
        600: '#FFC16A', // Light golden yellow
        400: '#FFD699', // Very light golden yellow
        200: '#FFEAC2', // Pale yellow
        100: '#FFF5E0', // Almost white yellow
        0: '#FFFFFF', // White
      };
    }

    case 'coral-sunrise': {
      return {
        2300: '#ffb7b0',
        2100: '#ffaba3',
        2000: '#ff9f96',
        1900: '#ff9388',
        1800: '#ffaba3',
        1500: '#ff9f96',
        1400: '#ff9388',
        1300: '#ff877b',
        1200: '#ff7b6e',
        1000: '#ff6f61',
        700: '#d95e52',
        600: '#b24e44',
        400: '#8c3d35',
        200: '#662c27',
        100: '#401c18',
        0: '#1a0b0a',
      };
    }
    case 'ice-queen': {
      return {
        2300: '#ccecf3',
        2100: '#c9ebf3',
        2000: '#c6eaf2',
        1900: '#c3e9f2',
        1800: '#c3e8f2',
        1500: '#bae5f0',
        1400: '#b2e2ee',
        1300: '#a9deec',
        1200: '#a1dbea',
        1000: '#98d8e8',
        700: '#81b8c5',
        600: '#6a97a2',
        400: '#547780',
        200: '#3d565d',
        100: '#26363a',
        0: '#0f1617',
      };
    }
    case 'tropical-forest': {
      return {
        2300: '#90c590',
        2100: '#88c088',
        2000: '#80bb80',
        1900: '#78b678',
        1800: '#7ebb7e',
        1500: '#6cb26c',
        1400: '#59a859',
        1300: '#479e47',
        1200: '#349534',
        1000: '#228b22',
        700: '#1d761d',
        600: '#186118',
        400: '#134c13',
        200: '#0e380e',
        100: '#082308',
        0: '#030e03',
      };
    }
    case 'desert-dune': {
      return {
        2300: '#f6e4d7',
        2100: '#f5e2d3',
        2000: '#f5e0cf',
        1900: '#f4ddcb',
        1800: '#f4e0d0',
        1500: '#f3dbca',
        1400: '#f2d6c3',
        1300: '#f0d2bc',
        1200: '#eeceb6',
        1000: '#edc9af',
        700: '#c9ab95',
        600: '#a68d7b',
        400: '#826f60',
        200: '#5f5046',
        100: '#3b322c',
        0: '#181412',
      };
    }
    case 'misty-morning': {
      return {
        2300: '#e0e0e0',
        2100: '#dddddd',
        2000: '#d9d9d9',
        1900: '#d6d6d6',
        1800: '#dadada',
        1500: '#d5d5d5',
        1400: '#d0d0d0',
        1300: '#cacaca',
        1200: '#c5c5c5',
        1000: '#c0c0c0',
        700: '#a3a3a3',
        600: '#868686',
        400: '#6a6a6a',
        200: '#4d4d4d',
        100: '#303030',
        0: '#131313',
      };
    }

    case 'light': {
      return {
        2300: '#f3f3f3', // done
        2100: '#e7e7e7',
        2000: '#dbdbdb',
        1900: '#cfcfcf',
        1800: '#ffffff', // done
        1500: '#cccccc',
        1400: '#b0b0b0',
        1300: '#969696',
        1200: '#7a7a7a',
        1000: '#606060',
        700: '#484848',
        600: '#383838',
        400: '#2f2f2f',
        200: '#292929', // done
        100: '#191919', // done
        0: '#141414', // done
      };
    }

    case 'dark':
    default: {
      return {
        0: '#FFFFFF',
        100: '#E8EAED',
        200: '#C7C7C7',
        400: '#A8A8A8',
        600: '#787878',
        700: '#525252',
        1000: '#393939',
        1200: '#2C2C2C',
        1300: '#202020',
        1400: '#232323',
        1500: '#1C1C1C',
        1800: '#181818',
        1900: '#101010',
        2000: '#121212',
        2100: '#0C0C0C',
        2300: '#080808',
      };
    }
  }
};

export const background = '#FFFFFF';

export const white = '#FFFFFF';

export const black = '#181412'; // off black
