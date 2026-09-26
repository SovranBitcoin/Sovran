/**
 * @jest-environment node
 *
 * The directory's wire contract, parsed in isolation. nagg made `followers`
 * nullable when it gained a real resolver — null means "we could not look",
 * which must not reach the sort as "nobody follows them".
 */
import { NaggAiProvidersSchema, serverProviders } from '@/shared/lib/routstr/providers';

describe('NaggAiProvidersSchema — an unresolved follower count', () => {
  const row = (over: Record<string, unknown>) => ({
    baseUrl: 'https://p.example',
    status: 'online' as const,
    ...over,
  });

  it('accepts null without discarding the rest of the row', () => {
    const parsed = NaggAiProvidersSchema.parse({
      providers: [row({ followers: null, encryptedModelCount: 9 })],
    });
    expect(parsed.providers[0]).toMatchObject({ followers: null, encryptedModelCount: 9 });
  });

  it('keeps a measured zero distinct from an unresolved count', () => {
    const parsed = NaggAiProvidersSchema.parse({
      providers: [row({ followers: 0, followersSource: 'relays' }), row({ followers: null })],
    });
    expect(parsed.providers[0].followers).toBe(0);
    expect(parsed.providers[1].followers).toBeNull();
  });

  it('carries the source, so a relay floor is not read as exact', () => {
    const parsed = NaggAiProvidersSchema.parse({
      providers: [row({ followers: 174, followersSource: 'relays' })],
    });
    expect(parsed.providers[0].followersSource).toBe('relays');
  });

  it('drops a source it does not recognise rather than the row', () => {
    const parsed = NaggAiProvidersSchema.parse({
      providers: [row({ followers: 5, followersSource: 'telepathy' })],
    });
    expect(parsed.providers[0]).toMatchObject({ followers: 5, followersSource: undefined });
  });
});

describe('NaggAiProvidersSchema — the cheapest message', () => {
  const row = (over: Record<string, unknown>) => ({
    baseUrl: 'https://p.example',
    status: 'online' as const,
    ...over,
  });

  it('carries it through serverProviders, and drops a nonsense value rather than the row', () => {
    const parsed = NaggAiProvidersSchema.parse({
      providers: [
        row({ minMessageSats: 94 }),
        row({ baseUrl: 'https://q.example', minMessageSats: -3 }),
      ],
    });
    const [priced, garbled] = serverProviders(parsed);
    expect(priced.minMessageSats).toBe(94);
    expect(garbled).toMatchObject({ baseUrl: 'https://q.example', minMessageSats: undefined });
  });
});
