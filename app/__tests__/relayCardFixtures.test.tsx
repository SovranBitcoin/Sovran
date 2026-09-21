import { render } from '@testing-library/react-native';

import { RelayCard } from '@/features/feed/components/nostr/RelayCard';
import { RelayCardFixturesContext } from '@/features/feed/components/nostr/relayCardFixtures';
import { fetchRelayInformation } from '@/shared/lib/nostr/nip11';
import { useRelayMetadataStore } from '@/shared/stores/global/relayMetadataStore';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : `theme-${String(tokens)}`,
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: () => 'transparent',
}));
jest.mock('@/shared/lib/imageCache', () => ({ prefetchImage: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn() }));
jest.mock('@/shared/lib/nostr/nip11', () => ({
  ...jest.requireActual('@/shared/lib/nostr/nip11'),
  fetchRelayInformation: jest.fn(),
}));

const FIXTURES = new Map([
  ['wss://buzz.team.example', { name: 'Buzz Relay' }],
  ['wss://dead.team.example', null],
]);

describe('RelayCard fixtures', () => {
  it('renders fixture documents without touching the persisted cache or the network', () => {
    const view = render(
      <RelayCardFixturesContext.Provider value={FIXTURES}>
        <RelayCard url="wss://Buzz.team.example/" />
        <RelayCard url="wss://dead.team.example" />
      </RelayCardFixturesContext.Provider>
    );

    const tree = JSON.stringify(view.toJSON());
    expect(tree).toContain('Buzz Relay');
    expect(tree).toContain('Join dead.team.example');
    expect(useRelayMetadataStore.getState().byRelayUrl).toEqual({});
    expect(fetchRelayInformation).not.toHaveBeenCalled();
  });
});
