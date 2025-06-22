import { useDispatch, useSelector } from 'react-redux';
import { setLanguage, setTheme, setDisplayBitcoin, setPasscode } from './actions';
import {
  selectTheme,
  selectLanguage,
  selectDisplayBitcoin,
  selectPasscode,
  memoizedGetSettings,
} from './selectors';

export const useSettings = () => {
  const dispatch = useDispatch();
  const settings = useSelector(memoizedGetSettings);
  const theme = useSelector(selectTheme);
  const lang = useSelector(selectLanguage);
  const displayBtc = useSelector(selectDisplayBitcoin);
  const passcode = useSelector(selectPasscode);

  return {
    settings,
    theme,
    lang,
    displayBtc,
    passcode,
    setTheme: (theme: string) => dispatch(setTheme(theme)),
    setLanguage: (lang: string) => dispatch(setLanguage(lang)),
    setDisplayBitcoin: (display: number) => dispatch(setDisplayBitcoin(display)),
    setPasscode: (code: string) => dispatch(setPasscode(code)),
  };
};
