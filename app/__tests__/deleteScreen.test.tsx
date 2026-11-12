/**
 * @jest-environment node
 *
 * Characterization of the Delete Account screen's handling of the deletion
 * result. The profile orchestrator that erases the device, the slider gesture,
 * the router and the UI kit are replaced; the screen's own handler runs as is.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DeleteScreen } from '@/features/settings/screens/DeleteScreen';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { log } from '@/shared/lib/logger';
import { deleteAllProfiles } from '@/shared/lib/profile/profileSessionOrchestrator';

jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  deleteAllProfiles: jest.fn(),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? 'white' : tokens.map(() => 'white'),
}));
jest.mock('@/shared/styles/appStyle', () => ({
  useStylePaint: () => ({
    style: { space: { pad: 16, related: 8 } },
    text: { primary: 'white', secondary: 'white' },
  }),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/ui/composed/SlideToConfirm', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    SlideToConfirm: (props: { onConfirm: () => unknown; testID?: string }) =>
      ReactActual.createElement('MockSlideToConfirm', props),
  };
});
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'MockButton' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({
  ScreenScrollView: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/composed/Surface', () => ({
  Surface: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'MockText' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'MockView' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'MockVStack' }));

const mockedDelete = jest.mocked(deleteAllProfiles);
const mockedLogInfo = jest.mocked(log.info);

let renderer: TestRenderer.ReactTestRenderer;

async function mount(): Promise<void> {
  await act(async () => {
    renderer = TestRenderer.create(<DeleteScreen />);
  });
}

function confirmSlide(): Promise<void> {
  const slider = renderer.root.find((n) => n.props.testID === 'settings-delete-slider');
  return slider.props.onConfirm() as Promise<void>;
}

function completeLogged(): boolean {
  return mockedLogInfo.mock.calls.some(([event]) => event === 'settings.delete.complete');
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('DeleteScreen', () => {
  it('erases every profile once per confirmed slide and logs completion', async () => {
    mockedDelete.mockResolvedValueOnce(true);
    await mount();

    await act(async () => confirmSlide());

    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(completeLogged()).toBe(true);
  });

  it('records the confirmation first and completion only once the deletion settles', async () => {
    let finish!: (value: boolean) => void;
    mockedDelete.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
    await mount();

    let pending!: Promise<void>;
    await act(async () => {
      pending = confirmSlide();
    });
    expect(log.warn).toHaveBeenCalledWith('settings.delete.confirmed', {
      reason: 'user_initiated_slide_to_delete',
    });
    expect(completeLogged()).toBe(false);

    await act(async () => {
      finish(true);
      await pending;
    });
    expect(completeLogged()).toBe(true);
  });

  it('treats a refused deletion as complete and shows nothing new', async () => {
    mockedDelete.mockResolvedValueOnce(false);
    await mount();
    const before = JSON.stringify(renderer.toJSON());

    await act(async () => confirmSlide());

    // QUIRK: `false` (another transition held the lock, or nothing was erased) is ignored:
    // the log says complete and the page shows no message, so the person thinks the account
    // is gone (settings-onboarding-routes D1). A fix that reports the refusal and re-arms
    // the slider should change this assertion on purpose.
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(completeLogged()).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toBe(before);
  });

  it('lets a failed deletion reject out of the slide handler without logging completion', async () => {
    mockedDelete.mockRejectedValueOnce(new Error('keychain unavailable'));
    await mount();

    await act(async () => {
      await expect(confirmSlide()).rejects.toThrow('keychain unavailable');
    });

    expect(completeLogged()).toBe(false);
  });

  it('goes back without deleting when Cancel is pressed', async () => {
    await mount();

    const cancel = renderer.root.find((n) => n.props.testID === 'settings-delete-cancel');
    await act(async () => {
      cancel.props.onPress();
    });

    expect(guardedRouter.back).toHaveBeenCalledTimes(1);
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
