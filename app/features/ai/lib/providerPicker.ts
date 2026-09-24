import { actionMenuPopup, paramPopup } from '@/shared/lib/popup';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import { aiLog } from '@/shared/lib/logger';
import {
  fetchProviderDirectory,
  normalizeNodeUrl,
  type RoutstrProvider,
} from '@/shared/lib/routstr/providers';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { AUTO_ICON } from './format';

/**
 * Pick which Routstr provider to pay.
 *
 * A heroui Menu, per the repo's pick-one-of-N convention — the same lane the
 * conversation list uses, and the reason `MintSelectFlowScreen` is legacy.
 *
 * Choosing here PINS the provider: nagg moves its own pick when a node's
 * catalog looks unhealthy, and the app follows, which is right as a default
 * and wrong once the user has expressed a preference. "Automatic" gives that
 * back. Switching costs nothing now that requests are paid per call — there is
 * no balance left behind on the node you leave.
 */
export async function openProviderPicker(): Promise<void> {
  const state = useRoutstrStore.getState();
  const active = normalizeNodeUrl(state.userNodeBaseUrl ?? state.nodeBaseUrl ?? '');
  const naggPick = normalizeNodeUrl(state.nodeBaseUrl ?? '');
  const pinned = state.userNodeBaseUrl != null;

  // Everything the app already knows, so the menu is useful before — and
  // without — a directory fetch: the node in use, and any node this profile
  // has held a credential on.
  const known = new Map<string, RoutstrProvider>();
  const remember = (baseUrl: string, name?: string) => {
    const url = normalizeNodeUrl(baseUrl);
    if (!url.startsWith('https://') || known.has(url)) return;
    known.set(url, { baseUrl: url, name: name ?? url.replace(/^https:\/\//, '') });
  };
  if (state.nodeBaseUrl) remember(state.nodeBaseUrl);
  for (const nodeUrl of Object.keys(state.legacyAccounts)) remember(nodeUrl);

  const discovered = state.nodeBaseUrl ? await fetchProviderDirectory(state.nodeBaseUrl) : [];
  for (const provider of discovered) remember(provider.baseUrl, provider.name);

  const rows = [...known.values()].sort((a, b) => a.name.localeCompare(b.name));
  aiLog.info('ai.provider_picker.opened', { rows: rows.length, pinned });

  actionMenuPopup({
    title: 'AI provider',
    buttons: [
      {
        text: 'Automatic',
        description: naggPick
          ? `Follow the recommended provider — currently ${naggPick.replace(/^https:\/\//, '')}.`
          : 'Follow the recommended provider.',
        icon: AUTO_ICON,
        selected: !pinned,
        testID: 'ai-provider-auto',
        onPress: (close: () => void) => {
          useRoutstrStore.getState().setUserNode(null);
          close();
        },
      },
      ...rows.map((provider) => ({
        text: provider.name,
        description: provider.description ?? provider.baseUrl.replace(/^https:\/\//, ''),
        icon: 'humbleicons:url',
        selected: pinned && provider.baseUrl === active,
        testID: `ai-provider-row:${provider.baseUrl}`,
        onPress: (close: () => void) => {
          useRoutstrStore.getState().setUserNode(provider.baseUrl);
          paramPopup('ai-provider-switched', { providerName: provider.name });
          close();
        },
      })),
    ],
    footerButtons: active
      ? [
          {
            text: 'Provider details',
            icon: 'mdi:information',
            testID: 'ai-provider-details',
            onPress: (close: () => void) => {
              close();
              router.navigate(buildProviderInfoHref(active, { seedName: known.get(active)?.name }));
            },
          },
        ]
      : [],
  });
}
