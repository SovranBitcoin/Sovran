import {
  createContext,
  FC,
  PropsWithChildren,
  RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { Dimensions, TextInput } from 'react-native';
import { SharedValue, useSharedValue, withTiming } from 'react-native-reanimated';

// Core sizing constants for search bar and transitions
export const SEARCHBAR_HEIGHT = 48;
export const CANCEL_CONTAINER_WIDTH = 75;
const LEFT_PADDING = 16;

// Search field width differs between views
export const SEARCHBAR_DEFAULT_WIDTH = Dimensions.get('window').width - LEFT_PADDING * 2;
export const SEARCHBAR_SEARCH_WIDTH =
  Dimensions.get('window').width - CANCEL_CONTAINER_WIDTH - LEFT_PADDING;

// Drag distances for pull-to-search
export const TRIGGER_DRAG_DISTANCE = -100;
export const FULL_DRAG_DISTANCE = -200;

type ScreenView = 'contacts' | 'search';

type ContextValue = {
  inputRef: RefObject<TextInput | null>;
  screenView: SharedValue<ScreenView>;
  isListDragging: SharedValue<boolean>;
  offsetY: SharedValue<number>;
  blurIntensity: SharedValue<number>;
  searchQuery: string;
  onGoToSearch: () => void;
  onGoToContacts: () => void;
  onSearchQueryChange: (query: string) => void;
};

const PaymentsAnimationContext = createContext<ContextValue>({} as ContextValue);

export const PaymentsAnimationProvider: FC<PropsWithChildren> = ({ children }) => {
  const inputRef = useRef<TextInput>(null);

  // Shared values for animation state
  const screenView = useSharedValue<ScreenView>('contacts');
  const offsetY = useSharedValue(0);
  const isListDragging = useSharedValue(false);
  const blurIntensity = useSharedValue(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Transition to search mode
  const onGoToSearch = useCallback(() => {
    screenView.value = 'search';
    blurIntensity.value = withTiming(100);
    // Make TextInput editable and focus it
    if (inputRef.current) {
      inputRef.current.setNativeProps({ editable: true, pointerEvents: 'auto' });
      inputRef.current.focus();
    }
  }, []);

  // Return to contacts mode
  const onGoToContacts = useCallback(() => {
    screenView.value = 'contacts';
    blurIntensity.value = withTiming(0);
    setSearchQuery('');
    // Make TextInput non-editable again
    if (inputRef.current) {
      inputRef.current.setNativeProps({ editable: false, pointerEvents: 'none' });
      inputRef.current.blur();
    }
  }, []);

  // Update search query
  const onSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const value = {
    inputRef,
    screenView,
    isListDragging,
    offsetY,
    blurIntensity,
    searchQuery,
    onGoToSearch,
    onGoToContacts,
    onSearchQueryChange,
  };

  return (
    <PaymentsAnimationContext.Provider value={value}>{children}</PaymentsAnimationContext.Provider>
  );
};

export const usePaymentsAnimation = () => {
  const context = useContext(PaymentsAnimationContext);

  if (!context) {
    throw new Error('usePaymentsAnimation must be used within a PaymentsAnimationProvider');
  }

  return context;
};
