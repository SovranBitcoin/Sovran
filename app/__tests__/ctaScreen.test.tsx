import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import { okAsync } from 'neverthrow';
import { CtaScreen } from '@/shared/blocks/CtaScreen';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { openExternalUrl } from '@/shared/lib/url';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSetOptions = jest.fn();
const mockPreventRemove = jest.fn();
const mockAddListener = jest.fn((_event: string, _listener: () => void) => jest.fn());
const mockNavigation = { setOptions: mockSetOptions, addListener: mockAddListener };
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    canGoBack: () => true,
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (blocked: boolean) => mockPreventRemove(blocked),
}));
jest.mock('react-native', () => ({
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@/assets/icons', () => 'Icon');
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({ ScreenScrollView: 'ScrollView' }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'Footer' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/SelectableCheck', () => ({ SelectableCheck: 'Check' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'foreground' }));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: 'Probe' }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
let view: TestRenderer.ReactTestRenderer;
beforeEach(async () => {
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await useCtaStore.persist.rehydrate();
  useCtaStore.setState({
    dismissed: {},
    activeId: null,
    previewOverride: null,
    closingId: null,
    backupStartedAt: null,
  });
  jest.clearAllMocks();
  jest.mocked(openExternalUrl).mockReturnValue(okAsync(undefined));
});
afterEach(() => {
  act(() => view?.unmount());
});
function mount(id: 'update-required' | 'backup-recovery-phrase') {
  act(() => {
    view = TestRenderer.create(<CtaScreen id={id} />);
  });
}
async function press(id: string) {
  await act(async () => view.root.findByProps({ testID: id }).props.onPress());
}
it('blocks gesture, navigation removal and Android back, including after opening Update', async () => {
  mount('update-required');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
  const back = jest.mocked(BackHandler.addEventListener).mock.calls.at(-1)![1];
  expect(back()).toBe(true);
  expect(view.root.findAllByProps({ testID: 'cta-secondary' })).toHaveLength(0);
  expect(view.root.findAllByProps({ testID: 'cta-preview-close' })).toHaveLength(0);
  await press('cta-primary');
  expect(openExternalUrl).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
});
it('permits explicit End preview while continuing to block ordinary back', async () => {
  useCtaStore.getState().preview('update-required');
  mount('update-required');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
  await press('cta-preview-close');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('persists do-not-ask and otherwise snoozes for later', async () => {
  mount('backup-recovery-phrase');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  await press('cta-dont-ask');
  await press('cta-secondary');
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase']).toBeDefined();
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('Back up now opens profile without snoozing, even when removal follows', async () => {
  mount('backup-recovery-phrase');
  await press('cta-primary');
  act(() => mockAddListener.mock.calls.at(-1)![1]());
  expect(useCtaStore.getState().dismissed).toEqual({});
  expect(mockReplace).toHaveBeenCalledWith('/(settings-flow)/profile');
});

it('honors Do not ask me again when the user leaves by swipe or back', async () => {
  mount('backup-recovery-phrase');
  await press('cta-dont-ask');
  const calls = mockAddListener.mock.calls;
  act(() => calls.at(-1)![1]());
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase']).toBeDefined();
});

it('Not now records the three-day snooze', async () => {
  mount('backup-recovery-phrase');
  await press('cta-secondary');
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase:snooze']).toBeDefined();
});
