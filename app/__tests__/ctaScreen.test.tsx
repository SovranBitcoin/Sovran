import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import { okAsync } from 'neverthrow';
import { BACKUP_HANDOFF_MS, CtaScreen } from '@/shared/blocks/CtaScreen';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { openExternalUrl } from '@/shared/lib/url';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockBack = jest.fn();
const mockPush = jest.fn();
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
    raw: { push: (...args: unknown[]) => mockPush(...args) },
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (blocked: boolean) => mockPreventRemove(blocked),
}));
jest.mock('react-native', () => ({
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('wallet/react', () => ({ useColadaBalance: () => ({ total: 1 }) }), { virtual: true });
jest.mock('@/shared/ui/composed/SheetGrabber', () => ({ SheetGrabber: 'Grabber' }));
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
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ purgeLegacyMockData: jest.fn() }));
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
  useSettingsStore.setState({ lastKnownAppVersion: { version: '2.0.0', fetchedAt: Date.now() } });
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
it('allows gesture, Android back and close after opening the optional Update action', async () => {
  mount('update-required');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  expect(view.root.findAllByProps({ testID: 'cta-secondary' })).toHaveLength(1);
  expect(view.root.findAllByProps({ testID: 'cta-close' })).toHaveLength(1);
  await press('cta-primary');
  expect(openExternalUrl).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
  await press('cta-close');
  expect(useCtaStore.getState().dismissed['update-required:snooze']).toMatchObject({
    version: '2.0.0',
  });
  act(() => {
    useCtaStore.getState().closeActive();
  });
  act(() => mockAddListener.mock.calls.at(-1)![1]());
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('records the trigger version when leaving by swipe or Android back', () => {
  mount('update-required');
  act(() => mockAddListener.mock.calls.at(-1)![1]());
  expect(useCtaStore.getState().dismissed['update-required:snooze']).toMatchObject({
    version: '2.0.0',
  });
});
it('supports an explicitly forced definition and End preview escape', async () => {
  const definition = CTA_DEFINITIONS[0];
  const presentation = definition.presentation;
  const policy = definition.dismissPolicy;
  definition.presentation = 'blocking-modal';
  definition.dismissPolicy = 'never';
  try {
    useCtaStore.getState().preview('update-required');
    mount('update-required');
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    expect(jest.mocked(BackHandler.addEventListener).mock.calls.at(-1)![1]()).toBe(true);
    expect(view.root.findAllByProps({ testID: 'cta-close' })).toHaveLength(0);
    await press('cta-preview-close');
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
    expect(mockBack).toHaveBeenCalledTimes(1);
  } finally {
    definition.presentation = presentation;
    definition.dismissPolicy = policy;
  }
});
it('leaves an optional preview without persisting a dismissal', async () => {
  useCtaStore.getState().preview('update-required');
  mount('update-required');
  await press('cta-close');
  act(() => mockAddListener.mock.calls.at(-1)![1]());
  expect(useCtaStore.getState().dismissed).toEqual({});
});
it('persists do-not-ask and otherwise snoozes for later', async () => {
  mount('backup-recovery-phrase');
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  await press('cta-dont-ask');
  await press('cta-secondary');
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase']).toBeDefined();
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('Back up now dismisses the prompt and presents the backup flow after the handoff', async () => {
  jest.useFakeTimers();
  try {
    mount('backup-recovery-phrase');
    await press('cta-primary');
    act(() => mockAddListener.mock.calls.at(-1)![1]());
    expect(useCtaStore.getState().dismissed).toEqual({});
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(BACKUP_HANDOFF_MS));
    expect(mockPush).toHaveBeenCalledWith('/(backup-flow)/intro');
    expect(useCtaStore.getState().backupStartedAt).not.toBeNull();
    expect(useCtaStore.getState().activeId).toBeNull();
  } finally {
    jest.useRealTimers();
  }
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
