/**
 * @jest-environment node
 *
 * The map's camera (`useMapCamera`) and the merchant detail screen.
 *
 * Camera: what a programmatic move hands the native map view (per platform),
 * what the camera reads after the person pans, and when a pan reaches the
 * marker update: after 250 ms of quiet and the running interactions, and not
 * at all while the camera stays inside the last query's zoom bucket and a
 * small fraction of the view. Unmount cancels what is pending.
 *
 * Merchant detail: what is shown for a place (cached, fetched, failed and
 * retried, missing), which payment methods and contact rows it lists, and
 * which link each contact row opens.
 *
 * The real hook and screen run. The native map ref, `InteractionManager`, the
 * BTCMap store, the route params, link opening and leaf UI are replaced at
 * the app's own seams.
 */
import { InteractionManager, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { errAsync, okAsync } from 'neverthrow';
import React from 'react';
import TestRenderer from 'react-test-renderer';

import { useMapCamera } from '@/features/map/hooks/useMapCamera';
import { MerchantDetailScreen } from '@/features/map/screens/MerchantDetailScreen';
import type { BTCMapPlaceDetails } from '@/shared/stores/global/btcMapStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

const mockStore = {
  fetchPlaceDetails: jest.fn(),
  getCachedPlaceDetails: jest.fn((_id: number): BTCMapPlaceDetails | null => null),
};
jest.mock('@/shared/stores/global/btcMapStore', () => ({
  useBTCMapStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));
let mockParams: { placeId: string } | null = { placeId: '42' };
jest.mock('@/shared/lib/nav/useRouteParams', () => ({ useRouteParams: () => mockParams }));
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: mockSetOptions }) }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
const mockOpenExternalUrl = jest.fn();
jest.mock('@/shared/lib/url', () => ({
  openExternalUrl: (url: string) => mockOpenExternalUrl(url),
}));
const mockStaticPopup = jest.fn();
jest.mock('@/shared/lib/popup', () => ({
  staticPopup: (...args: unknown[]) => mockStaticPopup(...args),
}));
jest.mock('@/shared/lib/date', () => ({
  formatDate: (value: unknown, format: string) => `${String(value)}|${format}`,
}));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: mockHost('Screen') }));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({
  ScreenScrollView: mockHost('ScreenScrollView'),
}));
jest.mock('@/shared/ui/composed/Section', () => ({ Section: mockHost('Section') }));
jest.mock('@/shared/ui/composed/EmptyState', () => ({
  EmptyState: (props: { action?: React.ReactNode }) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement('EmptyState', props, props.action);
  },
}));
jest.mock('@/shared/ui/primitives/Badge', () => ({ Badge: mockHost('Badge') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: mockHost('VStack') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: mockHost('HStack') }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: mockHost('Spinner') }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: mockHost('Button') }));
jest.mock('assets/icons', () => mockHost('Icon'));
jest.mock('heroui-native', () => {
  const host = (name: string) => (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
  return {
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('ListGroup.Item'),
      ItemPrefix: host('ListGroup.ItemPrefix'),
      ItemContent: host('ListGroup.ItemContent'),
      ItemTitle: host('ListGroup.ItemTitle'),
      ItemSuffix: host('ListGroup.ItemSuffix'),
    }),
    PressableFeedback: Object.assign(host('PressableFeedback'), {
      Scale: host('PressableFeedback.Scale'),
      Ripple: host('PressableFeedback.Ripple'),
    }),
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (c: string) => c,
}));
jest.mock('@/shared/lib/logger', () => {
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    useLifecycleLogger: jest.fn(),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const interactionTasks: { run: () => void; cancel: jest.Mock }[] = [];
function runInteractions() {
  act(() => {
    for (const task of interactionTasks.splice(0)) task.run();
  });
}

function mountCamera(aspectRatio = 1) {
  const onCameraSettle = jest.fn();
  const setCameraPosition = jest.fn();
  const view = renderHook(() =>
    useMapCamera({ initial: { lat: 10, lon: 20, zoom: 5 }, aspectRatio, onCameraSettle })
  );
  view.result.current.mapRef.current = { setCameraPosition };
  const pan = (latitude: number | undefined, longitude: number | undefined, zoom: number) =>
    act(() =>
      view.result.current.handleCameraChange({ coordinates: { latitude, longitude }, zoom })
    );
  const settle = (ms = 250) => {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
    runInteractions();
  };
  return { ...view, onCameraSettle, setCameraPosition, pan, settle };
}

describe('the map camera', () => {
  const JEST_PLATFORM = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    interactionTasks.length = 0;
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
      const entry = {
        run: () => (typeof task === 'function' ? task() : undefined),
        cancel: jest.fn(),
      };
      interactionTasks.push(entry);
      return { cancel: entry.cancel } as unknown as ReturnType<
        typeof InteractionManager.runAfterInteractions
      >;
    });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: JEST_PLATFORM, configurable: true });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('a programmatic move goes to the map view without a duration on iOS, and is what the camera reads', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { result, setCameraPosition } = mountCamera();
    expect(result.current.getCamera()).toEqual({ lat: 10, lon: 20, zoom: 5 });

    act(() => result.current.setCamera({ lat: 1, lon: 2, zoom: 15 }));

    expect(setCameraPosition).toHaveBeenCalledWith({
      coordinates: { latitude: 1, longitude: 2 },
      zoom: 15,
    });
    expect(result.current.getCamera()).toEqual({ lat: 1, lon: 2, zoom: 15 });
  });

  it('on Android a programmatic move animates for 250 ms', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const { result, setCameraPosition } = mountCamera();

    act(() => result.current.setCamera({ lat: 1, lon: 2, zoom: 15 }));

    expect(setCameraPosition).toHaveBeenCalledWith({
      coordinates: { latitude: 1, longitude: 2 },
      zoom: 15,
      duration: 250,
    });
  });

  it('a move before the map view exists only updates the camera', () => {
    const { result } = mountCamera();
    result.current.mapRef.current = null;

    act(() => result.current.setCamera({ lat: 3, lon: 4, zoom: 9 }));

    expect(result.current.getCamera()).toEqual({ lat: 3, lon: 4, zoom: 9 });
  });

  it('a pan updates the camera at once, keeping the last coordinates the event leaves out', () => {
    const { result, pan } = mountCamera();

    pan(undefined, 25, 6);

    expect(result.current.getCamera()).toEqual({ lat: 10, lon: 25, zoom: 6 });
  });

  it('a pan reaches the marker update only after 250 ms of quiet and the running interactions', () => {
    const { pan, onCameraSettle } = mountCamera();

    pan(11, 21, 6);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    pan(12, 22, 6.5);
    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(interactionTasks).toHaveLength(0);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onCameraSettle).not.toHaveBeenCalled();
    runInteractions();

    expect(onCameraSettle.mock.calls).toEqual([[12, 22, 6.5]]);
  });

  it('stops following small pans within the last query’s zoom bucket, and follows a zoom change or a larger pan', () => {
    // At zoom 10.5 the span is 360/2^10.5 (about 0.249) degrees; a pan is
    // skipped under 12% of it in latitude and 12% times the aspect ratio in
    // longitude, measured from the last query in the same whole zoom level.
    const { pan, settle, onCameraSettle } = mountCamera(2);
    pan(10, 20, 10);
    settle();
    expect(onCameraSettle).toHaveBeenCalledTimes(1);

    pan(10.02, 20.05, 10.5);
    settle();
    expect(onCameraSettle).toHaveBeenCalledTimes(1);

    pan(10, 20, 11);
    settle();
    expect(onCameraSettle).toHaveBeenCalledTimes(2);

    pan(10.05, 20, 11.2);
    settle();
    expect(onCameraSettle.mock.calls.at(-1)).toEqual([10.05, 20, 11.2]);
  });

  it('a newer settle cancels the interaction task of the one before', () => {
    const { pan, onCameraSettle } = mountCamera();
    pan(11, 21, 6);
    act(() => {
      jest.advanceTimersByTime(250);
    });
    const first = interactionTasks[0]!;

    pan(30, 40, 8);
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(first.cancel).toHaveBeenCalledTimes(1);
    interactionTasks.splice(0, 1);
    runInteractions();
    expect(onCameraSettle.mock.calls).toEqual([[30, 40, 8]]);
  });

  it('unmount cancels a pending pan and a queued settle', () => {
    const queued = mountCamera();
    queued.pan(11, 21, 6);
    act(() => {
      jest.advanceTimersByTime(250);
    });
    queued.unmount();
    expect(interactionTasks[0]!.cancel).toHaveBeenCalledTimes(1);

    const pending = mountCamera();
    pending.pan(11, 21, 6);
    pending.unmount();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(interactionTasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Merchant detail
// ---------------------------------------------------------------------------

function place(over: Record<string, unknown> = {}): BTCMapPlaceDetails {
  const value = {
    id: 42,
    name: 'Corner Cafe',
    address: '1 Main St',
    icon: 'local_cafe',
    updated_at: '2026-10-01',
    ...over,
  };
  return value as unknown as BTCMapPlaceDetails;
}

let renderer: TestRenderer.ReactTestRenderer;
async function renderDetail() {
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<MerchantDetailScreen />);
  });
}
const texts = () =>
  renderer.root
    .findAll((n) => n.type === ('Text' as never) || n.type === ('ListGroup.ItemTitle' as never))
    .map((n) => [n.props.children].flat().join(''));
const sections = () => renderer.root.findAllByType('Section' as never).map((s) => s.props.title);
async function press(testID: string) {
  await TestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

describe('the merchant detail', () => {
  beforeEach(() => {
    mockParams = { placeId: '42' };
    mockStore.fetchPlaceDetails.mockReset();
    mockStore.getCachedPlaceDetails.mockReset();
    mockStore.getCachedPlaceDetails.mockReturnValue(null);
    mockSetOptions.mockReset();
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockReturnValue(okAsync(undefined));
    mockStaticPopup.mockReset();
  });

  afterEach(() => {
    TestRenderer.act(() => renderer?.unmount());
  });

  it('a cached place shows at once without a fetch and titles the screen', async () => {
    mockStore.getCachedPlaceDetails.mockReturnValue(place({ verified_at: '2026-09-01' }));

    await renderDetail();

    expect(mockStore.getCachedPlaceDetails).toHaveBeenCalledWith(42);
    expect(mockStore.fetchPlaceDetails).not.toHaveBeenCalled();
    expect(texts()).toEqual(
      expect.arrayContaining([
        'Corner Cafe',
        '1 Main St',
        'Data from BTCMap.org • Last updated 2026-10-01|short-date',
      ])
    );
    expect(renderer.root.findByType('Badge' as never).props.children).toEqual([
      'Verified ',
      '2026-09-01|short-date',
    ]);
    expect(mockSetOptions).toHaveBeenCalledWith({ title: 'Corner Cafe' });
  });

  it('otherwise shows loading, fetches the place by number with a signal, then shows it', async () => {
    let resolve!: (value: BTCMapPlaceDetails) => void;
    mockStore.fetchPlaceDetails.mockReturnValue(new Promise((r) => (resolve = r)));

    await renderDetail();
    expect(renderer.root.findAllByType('Spinner' as never)).toHaveLength(1);
    expect(mockStore.fetchPlaceDetails).toHaveBeenCalledWith(42, false, {
      signal: expect.any(AbortSignal),
    });

    await TestRenderer.act(async () => resolve(place({ name: undefined })));
    expect(texts()).toContain('Unknown Merchant');
    expect(mockSetOptions).not.toHaveBeenCalled();
  });

  it('a failed fetch offers a retry that fetches again and shows the place', async () => {
    mockStore.fetchPlaceDetails.mockRejectedValueOnce(new Error('offline'));
    await renderDetail();
    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe(
      "Couldn't load this merchant"
    );

    mockStore.fetchPlaceDetails.mockResolvedValueOnce(place());
    await press('merchant-detail-retry');

    expect(mockStore.fetchPlaceDetails).toHaveBeenCalledTimes(2);
    expect(texts()).toContain('Corner Cafe');
  });

  it('with no place id shows that there is no merchant data and fetches nothing', async () => {
    mockParams = null;

    await renderDetail();

    expect(mockStore.fetchPlaceDetails).not.toHaveBeenCalled();
    expect(texts()).toContain('No merchant data available');
  });

  it('leaving while the fetch runs aborts it', async () => {
    mockStore.fetchPlaceDetails.mockReturnValue(new Promise(() => undefined));
    await renderDetail();
    const { signal } = mockStore.fetchPlaceDetails.mock.calls[0]![2] as { signal: AbortSignal };

    TestRenderer.act(() => renderer.unmount());

    expect(signal.aborted).toBe(true);
  });

  it('lists the payment methods the place marks yes, in a fixed order', async () => {
    mockStore.getCachedPlaceDetails.mockReturnValue(
      place({
        'osm:payment:lightning_contactless': 'yes',
        'osm:payment:onchain': 'yes',
        'osm:payment:lightning': 'no',
      })
    );

    await renderDetail();

    const methods = renderer.root
      .findAllByType('Section' as never)
      .find((s) => s.props.title === 'Payment Methods')!
      .findAllByType('ListGroup.ItemTitle' as never)
      .map((t) => t.props.children);
    expect(methods).toEqual(['On-chain', 'Contactless']);
  });

  it('shows no payment, contact or text sections when the place has none', async () => {
    mockStore.getCachedPlaceDetails.mockReturnValue(place());

    await renderDetail();

    expect(sections()).toEqual([]);
  });

  it('each contact row opens its link, OSM contact tags winning over plain ones', async () => {
    mockStore.getCachedPlaceDetails.mockReturnValue(
      place({
        'osm:contact:phone': '+1 (555) 010-2000',
        phone: '999',
        website: 'cafe.example',
        email: '  hi@cafe.example ',
        instagram: 'cornercafe',
        'osm:contact:twitter': 'cafe_x',
        opening_hours: 'Mo-Fr 08:00-17:00',
        description: 'Coffee for sats',
      })
    );
    await renderDetail();
    expect(sections()).toEqual(['Contact', 'Opening Hours', 'About']);

    for (const method of ['phone', 'website', 'email', 'instagram', 'twitter']) {
      await press(`merchant-contact-${method}`);
    }

    expect(mockOpenExternalUrl.mock.calls.map(([url]) => url)).toEqual([
      'tel:+15550102000',
      'https://cafe.example',
      'mailto:hi@cafe.example',
      'https://instagram.com/cornercafe',
      'https://x.com/cafe_x',
    ]);
    expect(
      renderer.root
        .findAllByType('PressableFeedback' as never)
        .map((p) => p.props.accessibilityLabel)
    ).toEqual([
      'Call, +1 (555) 010-2000',
      'Open, Website',
      'Email,   hi@cafe.example ',
      'Instagram, @cornercafe',
      'X, @cafe_x',
    ]);
  });

  it('a link that will not open shows the open-link-failed notice', async () => {
    mockStore.getCachedPlaceDetails.mockReturnValue(place({ website: 'https://cafe.example' }));
    mockOpenExternalUrl.mockReturnValue(errAsync({ type: 'unsupported' }));
    await renderDetail();

    await press('merchant-contact-website');

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://cafe.example');
    expect(mockStaticPopup).toHaveBeenCalledWith('open-link-failed');
  });
});
