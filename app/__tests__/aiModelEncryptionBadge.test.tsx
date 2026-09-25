/**
 * @jest-environment node
 */

/**
 * The padlock belongs to a MODEL, not to a provider.
 *
 * A node badged end-to-end encrypted serves 9 sealed models out of 582, and 8
 * of those 9 have a plaintext twin in the same catalog under an identical
 * display name at an identical price — `glm-5-3` sits beside
 * `tinfoil-glm-5-3`. Sealing is request routing to an enclave, decided by the
 * `tinfoil-` id prefix and nothing else, so a lock drawn from the provider
 * would tell someone their `glm-5-3` turn is encrypted when the encrypted one
 * is the row immediately next to it — a privacy claim the app cannot keep.
 *
 * These tests pin the distinction where the twins make it invisible: the
 * sealed row carries the badge, the identically-named plaintext row does not,
 * and the badge says what it is out loud rather than showing a padlock a
 * screen reader can only call "locked".
 *
 * Switching to the encrypted vendor's tab is how a user reaches those rows, so
 * the same drive exercises the picker's vendor tabs — until now the only
 * surface in the sheet with no automated coverage at all.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { RoutstrModel } from '@/shared/lib/routstr/api';

import { ModelChip } from '@/features/ai/components/ModelChip';
import { E2EE_BADGE_LABEL } from '@/features/ai/lib/format';
import { ModelPickerContent } from '@/shared/lib/popup/popups/modelPicker';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/apiClient', () => ({ getAiLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0, profiles: [{ accountIndex: 0 }] }),
  },
}));
jest.mock('@/shared/lib/routstr/api', () => ({
  setRoutstrNodeBaseUrl: jest.fn(),
  ROUTSTR_MAX_COMPLETION_TOKENS: 4096,
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: entry,
    aiLog: entry,
    storeLog: entry,
    log: { ...entry, child: () => entry },
    useMountLog: () => {},
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});
jest.mock('@/shared/lib/http/requestSignal', () => ({ buildAbortSignal: () => undefined }));

// Render-side stand-ins. The sheet chrome is not what is under test — which
// rows carry the padlock is.
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(name, props, children);
  const text = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Text', null, children);
  const Menu = Object.assign(host('Menu'), {
    Item: host('MenuItem'),
    ItemTitle: text,
    ItemDescription: text,
  });
  return { Menu, BottomSheet: { Title: text } };
});
// The glyph itself proves nothing — the badge is identified by its testID and
// spoken by its accessible label, both of which live on the wrapper.
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => {
  const { INVARIANT_BLACK } = jest.requireActual<typeof import('@/shared/lib/brandColors')>(
    '@/shared/lib/brandColors'
  );
  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => INVARIANT_BLACK) : INVARIANT_BLACK,
  };
});
jest.mock('@/shared/stores/runtime/popupStore', () => ({
  usePopupStore: (selector: (s: unknown) => unknown) => selector({ openSeq: 1 }),
}));
jest.mock('@/shared/lib/popup/popups/bridge', () => ({ showActionSheet: jest.fn() }));
jest.mock('@/shared/lib/popup/popups', () => ({ paramPopup: jest.fn() }));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({
  E2EActionMenuRenderMarker: () => null,
}));

// ModelChip-only stand-ins.
jest.mock('@/shared/lib/popup', () => ({ modelPickerPopup: jest.fn() }));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({ refreshRoutstrLineup: jest.fn() }));
jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: () => {},
}));
jest.mock('@/features/ai/hooks/useModelCatalog', () => ({ useModelCatalog: () => [] }));
jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({
  useRoutstrFunds: () => ({ balanceSats: 10_000 }),
}));
jest.mock('@/shared/ui/primitives/Button', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Button: ({ text, icon, ...props }: { text?: React.ReactNode; icon?: React.ReactNode }) =>
      ReactActual.createElement('Button', props, icon, text),
  };
});

const NOW = 1_800_000_000_000;
const CREATED = 1_795_000_000;

/** A catalog row the lineup accepts. `rate` orders the tier ladder. */
const row = (
  id: string,
  name: string,
  slug: string | null,
  rate: number,
  upstream: string
): RoutstrModel =>
  ({
    id,
    name,
    canonical_slug: slug,
    enabled: true,
    context_length: 128_000,
    created: CREATED,
    upstream_provider_id: upstream,
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    sats_pricing: {
      prompt: rate,
      completion: rate * 4,
      request: 0,
      image: 0,
      max_cost: 40,
    },
  }) as unknown as RoutstrModel;

/**
 * The shape the live node actually serves: two sealed enclave rows (no slug,
 * no vendor prefix in the name — the only signal is the id) and, under the
 * vendor that trained them, the SAME three models unsealed, one of which
 * carries a byte-identical display name and the same price as its sealed
 * twin.
 */
const TWIN_NAME = 'Private (E2EE) GLM 5.3';
const CATALOG: RoutstrModel[] = [
  // Sealed — routed to the enclave. `tinfoil-` is the whole of the evidence.
  row('tinfoil-glm-5-3', TWIN_NAME, null, 0.0002, 'tinfoil'),
  row('tinfoil-kimi-k3', 'Private (E2EE) Kimi K3', null, 0.00002, 'tinfoil'),
  // Plaintext, same vendor lineage, one of them the twin of the sealed row.
  row('glm-5-3', TWIN_NAME, 'z-ai/glm-5-3', 0.0002, 'openrouter'),
  row('glm-4-6', 'Z-AI: GLM 4.6', 'z-ai/glm-4-6', 0.00005, 'openrouter'),
  row('glm-4-5-air', 'Z-AI: GLM 4.5 Air', 'z-ai/glm-4-5-air', 0.00001, 'openrouter'),
  // The boot-default vendor, so the picker opens somewhere neutral.
  row('gpt-5-mini', 'OpenAI: GPT-5 mini', 'openai/gpt-5-mini', 0.00001, 'openrouter'),
  row('gpt-5', 'OpenAI: GPT-5', 'openai/gpt-5', 0.0001, 'openrouter'),
];

type Renderer = TestRenderer.ReactTestRenderer;

function openPicker(): Renderer {
  let tree!: Renderer;
  act(() => {
    tree = TestRenderer.create(
      <ModelPickerContent
        payload={{}}
        balanceSats={10_000}
        close={() => {}}
        pushCustomPage={() => {}}
        popCustomPage={() => {}}
        canPop={false}
        setFooterConfig={() => {}}
      />
    );
  });
  return tree;
}

/** Press the tap surface behind a testID. The shared `Pressable` primitive
 *  and the RN `Pressable` it wraps both carry the id, and the handler comes
 *  back single-flight-wrapped (so it resolves a promise) — hence the first
 *  match and the discarded return. */
function press(tree: Renderer, testID: string): void {
  const [target] = tree.root.findAll(
    (node) => node.props.testID === testID && typeof node.props.onPress === 'function'
  );
  expect(target).toBeDefined();
  act(() => {
    void target.props.onPress();
  });
}

const has = (tree: Renderer, testID: string): boolean =>
  tree.root.findAll((node) => node.props.testID === testID).length > 0;

const rendered = (tree: Renderer): string => JSON.stringify(tree.toJSON());

describe('the encryption badge names the sealed model, not its provider', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      nodeBaseUrl: 'https://ai.example',
      userNodeBaseUrl: 'https://ai.example',
      selectedProvider: 'openai',
      selectedTier: 'auto',
    });
    useRoutstrStore.getState().setCachedModels(CATALOG);
  });
  afterEach(() => jest.restoreAllMocks());

  it('groups the sealed rows where the user can reach them', () => {
    const lineup = useRoutstrStore.getState().lineup;
    expect(lineup?.tinfoil?.max?.modelId).toBe('tinfoil-glm-5-3');
    // The twin is a separate, unsealed model under the vendor that trained it.
    expect(lineup?.['z-ai']?.max?.modelId).toBe('glm-5-3');
    expect(lineup?.['z-ai']?.max?.displayName).toBe(lineup?.tinfoil?.max?.displayName);

    const tree = openPicker();
    press(tree, 'model-tab-tinfoil');
    expect(has(tree, 'ai-model-tinfoil-max-e2ee')).toBe(true);
    act(() => tree.unmount());
  });

  it('withholds the badge from the identically-named plaintext twin', () => {
    const tree = openPicker();
    press(tree, 'model-tab-z-ai');
    // Same display name, same price, same row copy as the sealed one — the
    // whole reason a per-provider lock would be a lie.
    expect(rendered(tree)).toContain(TWIN_NAME);
    expect(has(tree, 'ai-model-z-ai-max-e2ee')).toBe(false);
    expect(rendered(tree)).not.toContain(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });

  it('says "end-to-end encrypted" rather than showing an unnamed padlock', () => {
    const tree = openPicker();
    press(tree, 'model-tab-tinfoil');
    const [badge] = tree.root.findAll(
      (node) => node.props.testID === 'ai-model-tinfoil-max-e2ee' && node.props.accessible === true
    );
    expect(badge?.props.accessibilityLabel).toBe(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });

  it('switches the offered rows when a vendor tab is pressed', () => {
    const tree = openPicker();
    // Opens on the selected vendor, so nothing sealed is on screen yet.
    expect(rendered(tree)).toContain('GPT-5 mini');
    expect(has(tree, 'ai-model-tinfoil-max-e2ee')).toBe(false);

    press(tree, 'model-tab-tinfoil');
    // Tabs FILTER: the previous vendor's rows are unmounted, not scrolled past.
    expect(rendered(tree)).not.toContain('GPT-5 mini');
    expect(has(tree, 'ai-model-tinfoil-max')).toBe(true);
    act(() => tree.unmount());
  });

  /**
   * Which tab is active is drawn as a background colour and nothing else, so
   * a screen reader and the native harness both had to guess — and a tab that
   * stops responding is invisible to every automated check there is. A device
   * capture of this sheet shows the pills with an empty role and no selected
   * state.
   */
  it('publishes which vendor tab is active', () => {
    const tree = openPicker();
    const pill = (id: string) =>
      tree.root.find(
        (node) => node.props.testID === `model-tab-${id}` && node.props.accessibilityRole === 'tab'
      ).props;

    expect(pill('openai').accessibilityState).toEqual({ selected: true });
    expect(pill('tinfoil').accessibilityLabel).toBe('Private (E2EE)');
    expect(pill('tinfoil').accessibilityState).toEqual({ selected: false });

    press(tree, 'model-tab-tinfoil');
    expect(pill('tinfoil').accessibilityState).toEqual({ selected: true });
    expect(pill('openai').accessibilityState).toEqual({ selected: false });
    act(() => tree.unmount());
  });
});

describe('the chip badges the model a turn would actually be sent to', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      nodeBaseUrl: 'https://ai.example',
      userNodeBaseUrl: 'https://ai.example',
      selectedProvider: 'openai',
      selectedTier: 'auto',
    });
    useRoutstrStore.getState().setCachedModels(CATALOG);
  });
  afterEach(() => jest.restoreAllMocks());

  function renderChip(): Renderer {
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(<ModelChip />);
    });
    return tree;
  }

  const chipLabel = (tree: Renderer): string =>
    String(
      tree.root.find((node) => node.props.testID === 'ai-model-chip').props.accessibilityLabel
    );

  it('is unbadged on a plaintext selection', () => {
    const tree = renderChip();
    expect(has(tree, 'ai-model-chip-e2ee')).toBe(false);
    expect(chipLabel(tree)).not.toContain(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });

  it('badges — and says so — once the selection resolves to a sealed model', () => {
    act(() => {
      useRoutstrStore.getState().setSelectedSlot({ provider: 'tinfoil', tier: 'max' });
    });
    const tree = renderChip();
    expect(has(tree, 'ai-model-chip-e2ee')).toBe(true);
    expect(chipLabel(tree)).toContain(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });

  it('drops the badge when the same name resolves to the plaintext twin', () => {
    act(() => {
      useRoutstrStore.getState().setSelectedSlot({ provider: 'z-ai', tier: 'max' });
    });
    const tree = renderChip();
    // Identical display name to the sealed selection above — only the id, and
    // therefore only the badge, tells the two apart.
    expect(chipLabel(tree)).toContain(TWIN_NAME);
    expect(has(tree, 'ai-model-chip-e2ee')).toBe(false);
    expect(chipLabel(tree)).not.toContain(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });
});
