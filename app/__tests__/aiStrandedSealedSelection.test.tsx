/**
 * @jest-environment node
 */

/**
 * A sealed selection the current node cannot serve must be visible, and it
 * must have a way out that the user takes deliberately.
 *
 * `reselectProviderForLineup` refuses to move a selection off
 * `E2EE_PROVIDER_ID`, and that rule is right: `@routstr/sdk` seals on the
 * `tinfoil-` id prefix and nothing else, so re-pointing a sealed selection at
 * a plaintext vendor sends the next prompt in the clear under a badge that
 * still says end-to-end encrypted (`aiE2eeCandidateChain` pins that at the
 * chain, this pins it at the store). But the user CHANGED NODE, and the rule
 * on its own leaves them pinned to a vendor the new node does not serve.
 *
 * From `app/log.txt`, session `mugrnynz-60abf2`:
 *
 *   09:38:02  store.routstr.user_node_set     {"pinned": true}
 *   09:38:04  ai.tier.affordability_snapshot  selectedProvider=tinfoil,
 *                                             lineupSource=live, catalogSize=572,
 *                                             every cell providerId ∈
 *                                             {openai, claude, google, grok, qwen, …}
 *   09:38:07  ai.send.no_lineup               {"selectedProvider":"tinfoil",
 *                                              "sealedSelection":true,
 *                                              "hasLineup":true,
 *                                              "errorId":"routstr.e2ee_unavailable"}
 *
 * The snapshot is the bug in one line: the chip rendered a selection naming a
 * vendor that appears in none of the cells it was drawn from. What it drew was
 * `"Auto · Auto"` — `resolveSelectedEntry` returns `null` for a sealed pick on
 * a node with no sealed model, and the label fell back to repeating the tier.
 * So the one surface that says what a turn will be sent to said nothing at
 * all, and the first sign of trouble was a failed send.
 *
 * "Never downgrade silently" must not become "leave them stuck with no way
 * forward". These cases pin the honest middle: the store holds the promise,
 * the chip states plainly that this node does not serve it, and the picker
 * opens on a vendor that exists so the swap is one deliberate tap away.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { RoutstrModel } from '@/shared/lib/routstr/api';

import { ModelChip } from '@/features/ai/components/ModelChip';
import { E2EE_BADGE_LABEL, UNSERVED_SELECTION_LABEL } from '@/features/ai/lib/format';
import { chatErrorActions } from '@/features/ai/lib/chatErrorActions';
import { ModelPickerContent } from '@/shared/lib/popup/popups/modelPicker';
import { E2EE_PROVIDER_ID } from '@/shared/lib/routstr/lineup';
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

// Render-side stand-ins. The sheet chrome is not what is under test — what the
// chip says and which tab the picker opens on is.
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

const row = (id: string, name: string, slug: string | null, rate: number): RoutstrModel =>
  ({
    id,
    name,
    canonical_slug: slug,
    enabled: true,
    context_length: 128_000,
    created: CREATED,
    upstream_provider_id: 'openrouter',
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    sats_pricing: { prompt: rate, completion: rate * 4, request: 0, image: 0, max_cost: 40 },
  }) as unknown as RoutstrModel;

/** The node the user moved TO: a full plaintext catalogue and not one sealed
 *  row in it. This is the 572-model read in the log above, in miniature. */
const PLAINTEXT_NODE: RoutstrModel[] = [
  row('gpt-5-mini', 'OpenAI: GPT-5 mini', 'openai/gpt-5-mini', 0.00001),
  row('gpt-5', 'OpenAI: GPT-5', 'openai/gpt-5', 0.0001),
  row('gpt-4.1', 'OpenAI: GPT-4.1', 'openai/gpt-4.1', 0.00005),
  row('claude-haiku-4-5', 'Anthropic: Claude Haiku 4.5', 'anthropic/claude-haiku-4-5', 0.00002),
  row('claude-sonnet-4-5', 'Anthropic: Claude Sonnet 4.5', 'anthropic/claude-sonnet-4-5', 0.0002),
  row('claude-opus-4-5', 'Anthropic: Claude Opus 4.5', 'anthropic/claude-opus-4-5', 0.0009),
];

type Renderer = TestRenderer.ReactTestRenderer;

const has = (tree: Renderer, testID: string): boolean =>
  tree.root.findAll((node) => node.props.testID === testID).length > 0;

const rendered = (tree: Renderer): string => JSON.stringify(tree.toJSON());

function renderChip(): Renderer {
  let tree!: Renderer;
  act(() => {
    tree = TestRenderer.create(<ModelChip />);
  });
  return tree;
}

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

const chipLabel = (tree: Renderer): string =>
  String(tree.root.find((node) => node.props.testID === 'ai-model-chip').props.accessibilityLabel);

describe('a sealed selection on a node that serves nothing sealed', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      nodeBaseUrl: 'https://plaintext.example',
      userNodeBaseUrl: 'https://plaintext.example',
      selectedProvider: E2EE_PROVIDER_ID,
      selectedTier: 'auto',
    });
    // The node swap: a fresh catalogue with no `tinfoil-` row in it.
    act(() => {
      useRoutstrStore.getState().setCachedModels(PLAINTEXT_NODE);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps the promise the user made — the store does not move them', () => {
    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe(E2EE_PROVIDER_ID);
    // And the node really cannot answer it, so this is the stranded state and
    // not a lineup that happens to still carry the vendor.
    expect(state.lineup?.[E2EE_PROVIDER_ID]?.auto ?? null).toBeNull();
    expect(state.lineup?.openai?.auto).not.toBeNull();
  });

  it('says on the chip that this node does not serve the selection', () => {
    const tree = renderChip();
    // It used to repeat the tier — "Auto · Auto" — which reads as a working
    // selection and is the one surface that should have caught this.
    expect(chipLabel(tree)).toContain(UNSERVED_SELECTION_LABEL);
    expect(chipLabel(tree)).toContain('Private (E2EE)');
    act(() => tree.unmount());
  });

  it('draws no padlock over a model it cannot name', () => {
    const tree = renderChip();
    // Nothing resolved, so there is no sealed model to badge — a lock here
    // would promise an encryption this node has no way to deliver.
    expect(has(tree, 'ai-model-chip-e2ee')).toBe(false);
    expect(chipLabel(tree)).not.toContain(E2EE_BADGE_LABEL);
    act(() => tree.unmount());
  });

  it('names no plaintext model on the chip either', () => {
    // The other half of the same rule: the chip must not quietly start
    // reading like an ordinary working selection on some other vendor.
    const tree = renderChip();
    expect(chipLabel(tree)).not.toContain('GPT-5');
    expect(chipLabel(tree)).not.toContain('Claude');
    act(() => tree.unmount());
  });

  it('opens the picker on a vendor that exists, and highlights that one', () => {
    const tree = openPicker();
    const pill = (id: string) =>
      tree.root.find(
        (node) => node.props.testID === `model-tab-${id}` && node.props.accessibilityRole === 'tab'
      ).props;

    // The stranded vendor has no tab at all — it is not in this lineup.
    expect(has(tree, `model-tab-${E2EE_PROVIDER_ID}`)).toBe(false);
    // The rows on screen belong to a real vendor...
    expect(rendered(tree)).toContain('GPT-5 mini');
    // ...and the tab strip says so. It used to stay pointed at the stranded
    // vendor, so every pill read unselected while another vendor's rows were
    // the ones actually offered.
    expect(pill('openai').accessibilityState).toEqual({ selected: true });
    act(() => tree.unmount());
  });

  it('moves off the sealed vendor only when the user says so', () => {
    const tree = openPicker();
    const [target] = tree.root.findAll(
      (node) =>
        node.props.testID === 'ai-model-openai-auto' && typeof node.props.onPress === 'function'
    );
    expect(target).toBeDefined();
    act(() => {
      void target.props.onPress();
    });
    // A downgrade the user chose, in the surface whose whole job is choosing.
    expect(useRoutstrStore.getState().selectedProvider).toBe('openai');
    act(() => tree.unmount());
  });

  it('offers both ways forward on the failed turn itself', () => {
    // The send path raises this id for exactly this state (`ai.send.no_lineup`
    // with `sealedSelection: true` and `hasLineup: true`), and the pill it
    // renders carries the same two escapes the chip and picker provide.
    expect(chatErrorActions('routstr.e2ee_unavailable')).toEqual([
      'change-provider',
      'change-model',
    ]);
  });
});
