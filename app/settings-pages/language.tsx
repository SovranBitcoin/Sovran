import React, { useState } from 'react';
import { useNavigation } from 'expo-router';
import { useSelector } from 'react-redux';

import { FlagIcon } from 'assets/icons';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { SearchableList } from 'components/ui/SearchableList';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useTypedRoute } from 'helper/navigation';

// Maps for language handling
const isoToLanguageMap: Record<string, string> = {
  US: 'English',
  GB: 'English',
  FR: 'French',
  DE: 'German',
  ES: 'Spanish',
  PT: 'Portuguese',
  CN: 'Chinese',
  JP: 'Japanese',
  KR: 'Korean',
  IT: 'Italian',
  RU: 'Russian',
  IN: 'Hindi',
  BR: 'Portuguese',
  CA: 'English',
  AU: 'English',
  SE: 'Swedish',
  NO: 'Norwegian',
  DK: 'Danish',
  NL: 'Dutch',
  GR: 'Greek',
  TR: 'Turkish',
  AR: 'Arabic',
  PL: 'Polish',
  RO: 'Romanian',
};

const countryCodeToLangMap: Record<string, string> = {
  US: 'en',
  GB: 'en',
  FR: 'fr',
  DE: 'de',
  ES: 'es',
  PT: 'pt',
  CN: 'zh',
  JP: 'ja',
  KR: 'ko',
  IT: 'it',
  RU: 'ru',
  IN: 'hi',
  BR: 'pt',
  CA: 'en',
  AU: 'en',
  SE: 'sv',
  NO: 'no',
  DK: 'da',
  NL: 'nl',
  GR: 'el',
  TR: 'tr',
  AR: 'ar',
  PL: 'pl',
  RO: 'ro',
};

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const params = useTypedRoute<'settings-pages/language'>();
  const [searchText, setSearchText] = useState('');
  const { setLanguage } = useSettings();

  const getLanguage = (iso: string) => isoToLanguageMap[iso] || 'Unknown Language';

  const filteredLanguages = (params.countries || [])
    .filter((iso) => getLanguage(iso).toLowerCase().includes(searchText.toLowerCase()))
    .map((iso) => ({ iso, language: getLanguage(iso) }))
    .sort((a, b) => a.language.localeCompare(b.language))
    .map((c) => c.iso);

  const handleLanguagePress = (lang: string) => {
    const langCode = countryCodeToLangMap[lang.toUpperCase()];
    if (langCode) {
      setLanguage(langCode);
      navigation.goBack();
    }
  };

  const renderLanguageIcon = (lang: string) => (
    <FlagIcon width={32} height={32} country={lang.toUpperCase()} />
  );

  return (
    <Container>
      <SearchableList<string>
        searchText={searchText}
        onSearchChange={setSearchText}
        data={filteredLanguages}
        renderIcon={renderLanguageIcon}
        getLabel={(lang) => getLanguage(lang.toUpperCase())}
        onItemPress={handleLanguagePress}
        searchPlaceholder="Search for language"
        theme={theme}
      />
    </Container>
  );
}

export default withSheetProvider(ModalScreen);
