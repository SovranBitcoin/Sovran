import { useDispatch, useSelector } from "react-redux";
import { setLanguage, setTheme, setDisplayBitcoin } from "./actions";
import { selectSettings, selectTheme, selectLanguage, selectDisplayBitcoin } from "./selectors";

export const useSettings = () => {
  const dispatch = useDispatch();
  const settings = useSelector(selectSettings);
  const theme = useSelector(selectTheme);
  const lang = useSelector(selectLanguage);
  const displayBtc = useSelector(selectDisplayBitcoin);

  return {
    settings,
    theme,
    lang,
    displayBtc,
    setTheme: (theme: string) => dispatch(setTheme(theme)),
    setLanguage: (lang: string) => dispatch(setLanguage(lang)),
    setDisplayBitcoin: (display: number) => dispatch(setDisplayBitcoin(display)),
  };
};