import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';

describe('buildProviderInfoHref', () => {
  it('carries what the row already knows under seed keys, dropping what it does not', () => {
    const href = buildProviderInfoHref('https://ai.example', {
      seedName: 'redsh1ft',
      seedDescription: 'A node',
      seedPubkey: 'ab'.repeat(32),
      seedMints: ['https://mint.example'],
      seedFollowers: undefined,
    });
    expect(href.pathname).toBe('/(ai-flow)/provider');
    expect(JSON.parse(href.params.providerInfoEntry)).toEqual({
      nodeBaseUrl: 'https://ai.example',
      seedName: 'redsh1ft',
      seedDescription: 'A node',
      seedPubkey: 'ab'.repeat(32),
      seedMints: ['https://mint.example'],
    });
  });

  it('a caller with nothing to offer produces the bare entry', () => {
    expect(
      JSON.parse(buildProviderInfoHref('https://ai.example').params.providerInfoEntry)
    ).toEqual({ nodeBaseUrl: 'https://ai.example' });
  });
});
