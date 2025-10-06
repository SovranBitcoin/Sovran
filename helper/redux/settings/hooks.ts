import { useDispatch, useSelector } from 'react-redux';
import {
  setLanguage,
  setTheme,
  setDisplayBitcoin,
  setPasscode,
  setBackgroundImage,
} from './actions';
import {
  selectLanguage,
  selectDisplayBitcoin,
  selectPasscode,
  selectBackgroundImage,
  memoizedGetSettings,
} from './selectors';
import { useTheme } from 'providers/ThemeProvider';

export const useSettings = () => {
  const dispatch = useDispatch();
  const settings = useSelector(memoizedGetSettings);
  const { currentTheme } = useTheme();
  const lang = useSelector(selectLanguage);
  const displayBtc = useSelector(selectDisplayBitcoin);
  const passcode = useSelector(selectPasscode);
  const backgroundImage = useSelector(selectBackgroundImage);

  return {
    settings,
    theme: currentTheme, // Return the current theme name as a string
    lang,
    displayBtc,
    passcode,
    backgroundImage,
    setTheme: (theme: string) => dispatch(setTheme(theme)),
    setLanguage: (lang: string) => dispatch(setLanguage(lang)),
    setDisplayBitcoin: (display: number) => dispatch(setDisplayBitcoin(display)),
    setPasscode: (code: string) => dispatch(setPasscode(code)),
    setBackgroundImage: (image: string) => dispatch(setBackgroundImage(image)),
  };
};
