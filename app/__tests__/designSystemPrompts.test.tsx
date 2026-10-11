/**
 * @jest-environment node
 */

import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  CTA_SAMPLES,
  PROMPT_ENTRIES,
  PROMPT_GROUPS,
  findPromptEntry,
  type PromptEntry,
} from '@/features/settings/design-system/prompts';
import {
  SettingsDesignSystemCtaSampleScreen,
  SettingsDesignSystemPromptPreviewScreen,
} from '@/features/settings/screens/SettingsDesignSystemPromptPreviewScreen';
import { SettingsDesignSystemPromptsScreen } from '@/features/settings/screens/SettingsDesignSystemPromptsScreen';
import { discoverMints } from '@/shared/lib/apiClient';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import { dismissIntegrityFailure } from '@/shared/lib/nostr/accountIntegrity';
import { retrieveMnemonic, storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import {
  dismissActionMenuPopup,
  getActionMenuSnapshot,
  type ActionMenuItem,
} from '@/shared/lib/popup/popups/actionMenu';
import { restartApp } from '@/shared/lib/profile/appRestart';
import {
  deleteAllProfiles,
  recoverMnemonicSession,
  switchToExistingProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { openExternalUrl } from '@/shared/lib/url';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useLegacyEcashStore } from '@/shared/stores/global/legacyEcashStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Navigation: the only thing a preview may do besides draw ────
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => true,
  },
}));
jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

// ── Everything a preview must never reach ───────────────────────
jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  deleteAllProfiles: jest.fn(async () => true),
  recoverMnemonicSession: jest.fn(async () => true),
  switchToExistingProfile: jest.fn(async () => true),
}));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn(() => true) }));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(async () => null),
  storeImportedNsec: jest.fn(async () => true),
}));
jest.mock('@/shared/lib/nostr/accountIntegrity', () => ({ dismissIntegrityFailure: jest.fn() }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/shared/lib/apiClient', () => ({ discoverMints: jest.fn() }));
jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: { getInstance: jest.fn() } }));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  deleteMintOperation: jest.fn(),
  restoreKeysetForMint: jest.fn(),
  probeMintForHistory: jest.fn(),
}));
jest.mock('@/shared/lib/cashu/recoverySuppression', () => ({
  beginRecoverySuppression: jest.fn(),
  endRecoverySuppression: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ purgeLegacyMockData: jest.fn() }));

// The wallet's own mints, which the restore preview must not show.
jest.mock('@/features/mint', () => {
  const wallet = {
    mints: [{ mintUrl: 'https://real.mint.invalid', mintInfo: { name: 'Real wallet mint' } }],
    loadMints: jest.fn(),
  };
  return { useMintManagement: () => wallet };
});
jest.mock('@cashu/coco-react', () => ({ useBalanceContext: () => ({ balances: { byMint: {} } }) }));

// Only `CtaScreen`, which the samples never mount, reads this. Mocked the way
// ctaScreen.test.tsx mocks it: in one Jest process the resolver remembers how
// `wallet/react` was first resolved from CtaScreen.tsx, so loading the real
// module here would undo that suite's mock when it runs after this one.
jest.mock('wallet/react', () => ({ useColadaBalance: () => ({ total: 0 }) }), { virtual: true });

// ── Inert stand-ins for the drawing layer ───────────────────────
jest.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
// The preset compiles `react-native` imports to these paths.
jest.mock('react-native-web/dist/exports/BackHandler', () => ({
  __esModule: true,
  default: { addEventListener: () => ({ remove: () => {} }) },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const shared = <T,>(initial: T) => {
    let current = initial;
    return { get: () => current, set: (next: T) => void (current = next) };
  };
  return {
    __esModule: true,
    default: { View: 'AnimatedView' },
    Extrapolation: { CLAMP: 'clamp' },
    Easing: new Proxy({}, { get: () => () => (value: number) => value }),
    interpolate: () => 0,
    useAnimatedScrollHandler: () => () => {},
    useAnimatedStyle: () => ({}),
    useSharedValue: <T,>(initial: T) => ReactActual.useRef(shared(initial)).current,
    withSpring: <T,>(value: T) => value,
    withTiming: <T,>(value: T) => value,
  };
});
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {};
  for (const step of ['maxDuration', 'onStart', 'onBegin', 'onUpdate', 'onEnd'])
    chain[step] = () => chain;
  return {
    Gesture: { Tap: () => chain, Pan: () => chain, Race: () => chain },
    GestureDetector: ({ children }: React.PropsWithChildren) => children,
  };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host = (name: string) =>
    function MockHost(props: Record<string, unknown>) {
      return ReactActual.createElement(name, props);
    };
  return {
    Button: Object.assign(host('HeroButton'), { Label: 'Label' }),
    ControlField: Object.assign(host('Checkbox'), { Indicator: 'Indicator' }),
    Label: Object.assign(host('Label'), { Text: 'LabelText' }),
    PressableFeedback: Object.assign(host('PressableFeedback'), { Highlight: 'Highlight' }),
  };
});
jest.mock('assets/icons', () => 'Icon');
jest.mock('@/assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? 'white' : tokens.map(() => 'white'),
}));
jest.mock('@/shared/styles/appStyle', () => ({
  useStylePaint: () => ({
    style: { space: { pad: 16, related: 8, group: 24, gutter: 16, item: 12 } },
    text: { primary: 'white', secondary: 'grey' },
  }),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/logger', () => {
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = () => logger;
  return {
    log: logger,
    cashuLog: logger,
    nostrLog: logger,
    storeLog: logger,
    Log: ({ children }: React.PropsWithChildren) => children,
    initLog: jest.fn(),
    useInitMount: jest.fn(),
    useLifecycleLogger: jest.fn(),
    mintUrlLogFields: () => ({}),
    redactError: () => 'redacted',
  };
});
jest.mock('@/shared/lib/popup', () => ({
  // The menu queue is plain module state, and it is what the menu tests read.
  ...jest.requireActual<typeof import('@/shared/lib/popup/popups/actionMenu')>(
    '@/shared/lib/popup/popups/actionMenu'
  ),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: 'Probe' }));
jest.mock('@/navigation/headerItems', () => ({ clearGlassHeaderLeftItems: () => ({}) }));
jest.mock('@/shared/blocks/popup/ActionMenuHost', () => ({ ActionMenuHost: 'ActionMenuHost' }));
jest.mock('@/shared/blocks/status', () => ({
  LoadingIndicator: 'LoadingIndicator',
  mapCheckpointStatusToIndicator: jest.fn(),
}));
jest.mock('@/features/settings/screens/SettingsProfileRecoveryScreen', () => ({
  SettingsProfileRecoveryScreen: 'RecoveryInformation',
}));
jest.mock('@/features/onboarding/components/OnboardingInnerCarousel', () => 'Carousel');
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer?: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({ ScreenScrollView: 'ScrollView' }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'Footer' }));
jest.mock('@/shared/ui/composed/Surface', () => ({
  Surface: 'Surface',
  useSurfaceInset: () => 16,
}));
jest.mock('@/shared/ui/composed/SectionHeading', () => ({ SectionHeading: 'SectionHeading' }));
jest.mock('@/shared/ui/composed/ListRow', () => ({ ListRow: 'ListRow' }));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: 'HeaderAction',
}));
jest.mock('@/shared/ui/composed/SlideToConfirm', () => ({ SlideToConfirm: 'SlideToConfirm' }));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: 'MintIcon' }));
jest.mock('@/shared/ui/composed/ElapsedSeconds', () => ({ ElapsedSeconds: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Switch', () => ({ Switch: 'Switch' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: 'View' }));

// ── What must stay untouched ────────────────────────────────────

const STORES = {
  cta: useCtaStore,
  legacyEcash: useLegacyEcashStore,
  profile: useProfileStore,
  settings: useSettingsStore,
  walletLifecycle: useWalletLifecycleStore,
};

const FORBIDDEN = {
  deleteAllProfiles,
  recoverMnemonicSession,
  switchToExistingProfile,
  restartApp,
  retrieveMnemonic,
  storeImportedNsec,
  dismissIntegrityFailure,
  openExternalUrl,
  discoverMints,
  'CocoManager.getInstance': CocoManager.getInstance,
  'Clipboard.setStringAsync': Clipboard.setStringAsync,
  'SecureStore.getItemAsync': SecureStore.getItemAsync,
  'SecureStore.setItemAsync': SecureStore.setItemAsync,
  'SecureStore.deleteItemAsync': SecureStore.deleteItemAsync,
  'AsyncStorage.setItem': AsyncStorage.setItem,
  'AsyncStorage.removeItem': AsyncStorage.removeItem,
};

let storeWrites: string[] = [];
let unsubscribe: (() => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  storeWrites = [];
  // Every setter ends in `set`, and `set` tells subscribers.
  unsubscribe = Object.entries(STORES).map(([name, store]) =>
    store.subscribe(() => storeWrites.push(name))
  );
});
afterEach(() => {
  unsubscribe.forEach((stop) => stop());
  dismissActionMenuPopup();
});

function expectNothingTouched(): void {
  expect(storeWrites).toEqual([]);
  for (const [name, action] of Object.entries(FORBIDDEN)) {
    expect({ name, calls: jest.mocked(action).mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

const HANDLERS = ['onPress', 'onConfirm', 'onSelectedChange', 'onTabChange'] as const;

/**
 * Operates every control on show, over and over: a pass can reveal more (a
 * ticked box enables Continue, Continue shows the next step).
 */
async function operateEverything(view: TestRenderer.ReactTestRenderer): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    // Handlers, not nodes: a press can unmount the control after it.
    const handlers = view.root
      .findAll((node) => typeof node.type === 'string')
      .flatMap((node) => HANDLERS.map((name) => node.props[name]))
      .filter((handler) => typeof handler === 'function');
    for (const handler of handlers) {
      await act(async () => {
        await handler(true);
      });
    }
  }
}

const VALID_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Presses every button of the open menu, and of each menu that replaces it. */
async function operateMenus(): Promise<void> {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6; depth += 1) {
    const payload = getActionMenuSnapshot().payload;
    if (!payload || seen.has(payload)) return;
    seen.add(payload);
    const buttons: ActionMenuItem[] = [
      ...(payload.buttons ?? []),
      ...(payload.footerButtons ?? []),
    ];
    const close = (afterClose?: () => void) => afterClose?.();
    // The destructive button first, so the walk goes down the confirming path.
    for (const button of buttons) await button.onPress?.(close);
    await payload.primaryAction?.onPress(
      { 'recovery-phrase': VALID_PHRASE, 'recovery-nsec': 'not-a-key' },
      { setError: () => {}, close: () => {} }
    );
  }
}

const ctaEntries = PROMPT_ENTRIES.filter((entry) => entry.kind === 'cta');
const screenEntries = PROMPT_ENTRIES.filter((entry) => entry.kind === 'screen');
const menuEntries = PROMPT_ENTRIES.filter((entry) => entry.kind === 'menu');

function preview(entry: PromptEntry): TestRenderer.ReactTestRenderer {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      entry.kind === 'cta' ? (
        <SettingsDesignSystemCtaSampleScreen entry={entry} />
      ) : entry.kind === 'screen' ? (
        <SettingsDesignSystemPromptPreviewScreen entry={entry} />
      ) : (
        <></>
      )
    );
  });
  return view!;
}

/** Every string on show, in order. */
function textOf(view: TestRenderer.ReactTestRenderer): string {
  return view.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('\n');
}

// ── Completeness ────────────────────────────────────────────────

describe('what the Prompts page lists', () => {
  it('has sample data and a row for every prompt in CTA_DEFINITIONS', () => {
    const defined = CTA_DEFINITIONS.map((cta) => cta.id).sort();
    expect(Object.keys(CTA_SAMPLES).sort()).toEqual(defined);
    for (const id of defined) {
      expect({ id, samples: CTA_SAMPLES[id].length > 0 }).toEqual({ id, samples: true });
      const rows = ctaEntries.filter((entry) => entry.cta.id === id);
      expect({ id, rows: rows.length }).toEqual({ id, rows: CTA_SAMPLES[id].length });
    }
  });

  it('lists every blocking screen, first-launch screen and confirmation', () => {
    expect(PROMPT_ENTRIES.filter((entry) => entry.kind !== 'cta').map((entry) => entry.id)).toEqual(
      [
        'startup-storage-failed',
        'startup-wallet-failed',
        'keys-locked',
        'keys-missing-derived',
        'keys-missing-imported',
        'account-mismatch-stopped-derived',
        'account-mismatch-stopped-imported',
        'account-mismatch-other-account',
        'restore-welcome-back',
        'legal-first',
        'legal-updated',
        'legal-settings-error',
        'onboarding-carousel',
        'enter-recovery-phrase',
        'reimport-nostr-key',
        'delete-account',
        'start-fresh',
        'remove-profile-derived',
        'remove-profile-imported',
        'profile-not-removed',
      ]
    );
  });

  it('gives every row an id that is unique and safe in a testID and a route param', () => {
    const ids = PROMPT_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(findPromptEntry(id)?.id).toBe(id);
    }
  });

  it('accounts for every screen in shared/blocks', () => {
    // A screen added to shared/blocks is a prompt to list, or is named here with the reason.
    const NOT_LISTED: Record<string, string> = {
      'CtaScreen.tsx': 'drawn through CtaView by the preview screen',
      'LegalDocumentScreen.tsx': 'drawn inside TermsAndConditionsScreen',
      'NotFoundScreen.tsx': 'an unknown route, not a prompt or a blocking screen',
    };
    const source = fs.readFileSync(
      path.join(process.cwd(), 'features/settings/design-system/prompts.tsx'),
      'utf8'
    );
    const screens = fs
      .readdirSync(path.join(process.cwd(), 'shared/blocks'))
      .filter((file) => file.endsWith('Screen.tsx'));
    const missing = screens.filter(
      (file) =>
        !(file in NOT_LISTED) && !source.includes(`@/shared/blocks/${file.replace('.tsx', '')}'`)
    );
    expect(missing).toEqual([]);
    expect(Object.keys(NOT_LISTED).filter((file) => !screens.includes(file))).toEqual([]);
  });
});

// ── The list page ───────────────────────────────────────────────

describe('the Prompts page', () => {
  it('draws one row per entry and opens each without touching app state', async () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<SettingsDesignSystemPromptsScreen />);
    });
    expect(view!.root.findAllByType('Surface' as never)).toHaveLength(PROMPT_GROUPS.length);
    for (const entry of PROMPT_ENTRIES) {
      const row = view!.root.findByProps({ testID: `ds-prompt-${entry.id}` });
      expect(row.props.title).toBe(entry.title);
      expect(row.props.accessibilityLabel).toBe(`${entry.title}. ${entry.detail}`);
      mockNavigate.mockClear();
      dismissActionMenuPopup();
      await act(async () => row.props.onPress());
      if (entry.kind === 'menu') {
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(getActionMenuSnapshot().payload).not.toBeNull();
      } else {
        expect(mockNavigate).toHaveBeenCalledWith({
          pathname:
            entry.kind === 'cta'
              ? '/(prompt-flow)/cta-sample'
              : '/(settings-flow)/design-system-prompt',
          params: { id: entry.id },
        });
        expect(getActionMenuSnapshot().payload).toBeNull();
      }
    }
    expectNothingTouched();
    act(() => view!.unmount());
  });
});

// ── Each entry, opened and operated ─────────────────────────────

describe('a prompt on its sample', () => {
  it.each(ctaEntries.map((entry) => [entry.id, entry] as const))(
    '%s draws its sample and records nothing',
    async (_id, entry) => {
      const view = preview(entry);
      const text = textOf(view);
      expect(text).toContain(entry.cta.content.title);
      expect(text).not.toMatch(/undefined|null|NaN/);
      expect(view.root.findByProps({ testID: 'cta-primary' }).props.text).toBe(
        entry.cta.content.primary.label
      );
      expect(view.root.findByProps({ testID: 'ds-prompt-open' }).props.value).toBe(entry.id);
      // A real prompt is named by this probe; a sample must not claim to be one.
      expect(view.root.findAllByProps({ testID: 'cta-active' })).toHaveLength(0);
      await operateEverything(view);
      // Not now and the refusal leave the preview; the primary action goes nowhere.
      expect(mockBack).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expectNothingTouched();
      act(() => view.unmount());
    }
  );

  it('shows the old-ecash sample with its mint and amount', () => {
    const view = preview(findPromptEntry('cta-claim-old-ecash-sats')!);
    expect(textOf(view)).toContain(
      'Trust Minibits (mint.minibits.cash/Bitcoin) to claim 2,100 sats.'
    );
    act(() => view.unmount());
  });
});

describe('a blocking or first-launch screen on its sample', () => {
  it.each(screenEntries.map((entry) => [entry.id, entry] as const))(
    '%s draws and changes nothing when every control is used',
    async (_id, entry) => {
      const view = preview(entry);
      expect(view.root.findByProps({ testID: 'ds-prompt-open' }).props.value).toBe(entry.id);
      // A page under a navigation title has its back button; the rest get a close button.
      expect(view.root.findAllByProps({ testID: 'ds-prompt-close' })).toHaveLength(
        entry.header ? 0 : 1
      );
      // The running app already has a menu host; a second would draw every menu twice.
      expect(view.root.findAllByType('ActionMenuHost' as never)).toHaveLength(0);
      await operateEverything(view);
      await operateMenus();
      // The page that shows the real recovery phrase is never reached from a sample.
      expect(view.root.findAllByType('RecoveryInformation' as never)).toHaveLength(0);
      // Closing the preview is the only navigation a sample may cause.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expectNothingTouched();
      act(() => view.unmount());
    }
  );

  it('shows the mismatch sample with its account name and diagnostic code', () => {
    const view = preview(findPromptEntry('account-mismatch-stopped-derived')!);
    const text = textOf(view);
    expect(text).toContain('AM1-D1-RD+CR-1a2b3c4d-5c0de1e7');
    expect(text).toContain('Savings has a saved identity');
    expect(view.root.findAllByProps({ testID: 'account-mismatch-switch-0' })).toHaveLength(1);
    act(() => view.unmount());
  });

  it('shows the restore sample on sample mints, never the wallet’s own', () => {
    const view = preview(findPromptEntry('restore-welcome-back')!);
    const text = textOf(view);
    expect(text).toContain('Welcome back');
    expect(text).toContain('Minibits');
    expect(text).not.toContain('Real wallet mint');
    act(() => view.unmount());
  });

  it('shows the updated-documents step without reading what was accepted', () => {
    const view = preview(findPromptEntry('legal-updated')!);
    expect(textOf(view)).toContain('Updated documents · 1 of 2');
    act(() => view.unmount());
    const first = preview(findPromptEntry('legal-first')!);
    expect(textOf(first)).not.toContain('Updated documents');
    act(() => first.unmount());
  });
});

describe('a confirmation or form on its sample', () => {
  it.each(menuEntries.map((entry) => [entry.id, entry] as const))(
    '%s opens a menu, and confirming it changes nothing',
    async (_id, entry) => {
      act(() => entry.open());
      expect(getActionMenuSnapshot().payload?.title).toBeTruthy();
      await operateMenus();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
      expectNothingTouched();
    }
  );
});
