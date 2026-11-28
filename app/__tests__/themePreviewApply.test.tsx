/**
 * @jest-environment node
 *
 * Apply closes the theme editor in the same tick as the tap; the draft
 * commit (which waits for the primary wallpaper download) finishes after.
 */
const mockBack = jest.fn();
const mockCommit = jest.fn(() => new Promise<boolean>(() => {}));
const mockButtons: { current: { testID: string; onPress: () => unknown }[] } = { current: [] };

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: () => mockBack(), push: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  // eslint-disable-next-line no-restricted-syntax -- fixture colours must parse as hex
  useThemeColor: (tokens: string[]) => tokens.map(() => '#000000'),
}));
jest.mock('@/shared/lib/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    log: logger,
    storeLog: logger,
    redactError: (error: unknown) => error,
    useLifecycleLogger: jest.fn(),
  };
});
jest.mock('@/features/theme/lib/themeDraft', () => {
  const state = {
    active: true,
    activeAlbumSlug: null,
    beginDraft: jest.fn(),
    discard: jest.fn(),
    commit: () => mockCommit(),
    isDirty: () => true,
    resolveUnitTheme: () => 'default',
  };
  return { useThemeDraft: (select: (s: typeof state) => unknown) => select(state) };
});
jest.mock('@/features/theme/lib/useAlbumList', () => ({
  useAlbumList: () => ({ getAlbum: () => undefined }),
}));
jest.mock('@/features/theme/components/UnitPreviewCard', () => ({ UnitPreviewCard: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ footer }: { footer: React.ReactNode }) => footer,
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: ({ buttons }: { buttons: { testID: string; onPress: () => unknown }[] }) => {
    mockButtons.current = buttons;
    return null;
  },
}));
jest.mock('@/shared/ui/primitives/PressableFeedback', () => ({
  PressableFeedback: Object.assign(() => null, { Scale: () => null }),
}));
jest.mock('assets/icons', () => () => null);

/* eslint-disable import/first */
import TestRenderer, { act } from 'react-test-renderer';

import { ThemePreviewScreen } from '@/features/theme/screens/ThemePreviewScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('closes the editor before the wallpaper download finishes, and still commits', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ThemePreviewScreen />);
  });
  const apply = mockButtons.current.find((button) => button.testID === 'theme-apply')!;
  act(() => {
    void apply.onPress();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockCommit).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
