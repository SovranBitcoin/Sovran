/**
 * What one Nostr identity operates — the mints and AI providers nagg ties to
 * the same npub — as a grouped list that links to each of their pages.
 *
 * Every info page in the app is about one of three things (a person, a mint,
 * a provider) and until now only linked one way: mint → operator, provider →
 * operator. The reverse edges, and the sideways ones (a mint's operator also
 * runs a provider), lived in nagg's identities map and nowhere on screen.
 * This section reads them from the single owner (the entity cache's profile
 * stats, which every nagg route now feeds) so the profile page, the mint page
 * and the provider page all show the same graph around the same key.
 *
 * Renders nothing when nothing is known: it sits below the page's fixed
 * blocks, so its absence never moves what the reader is looking at.
 */
import { ListGroup, PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import { useCachedProfileStats } from '@/shared/lib/nostr/useEntityCache';
import { extractDomain, normalizeMintUrlKey } from '@/shared/lib/url';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { ProviderAvatar } from '@/features/ai/components/ProviderAvatar';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Section } from '@/shared/ui/composed/Section';

interface OperatorRunsSectionProps {
  /** The operator, hex. Nothing renders without one. */
  pubkey: string | null | undefined;
  /** The page's own subject, left out so a mint page does not list itself. */
  excludeMintUrl?: string | null;
  excludeProviderUrl?: string | null;
  title?: string;
  testID?: string;
}

const sameUrl = (a: string, b: string) => normalizeMintUrlKey(a) === normalizeMintUrlKey(b);

export function OperatorRunsSection({
  pubkey,
  excludeMintUrl,
  excludeProviderUrl,
  title = 'Also runs',
  testID = 'operator-runs',
}: OperatorRunsSectionProps) {
  const stats = useCachedProfileStats(pubkey ?? undefined);
  const mints = (stats?.operatesMints ?? []).filter(
    (url) => !excludeMintUrl || !sameUrl(url, excludeMintUrl)
  );
  const providers = (stats?.operatesAiProviders ?? []).filter(
    (url) => !excludeProviderUrl || !sameUrl(url, excludeProviderUrl)
  );
  if (!pubkey || mints.length + providers.length === 0) return null;

  return (
    <Section title={title}>
      <ListGroup variant="secondary" testID={testID}>
        {mints.map((url) => (
          <RunsMintRow key={`mint:${url}`} mintUrl={url} />
        ))}
        {providers.map((url) => (
          <RunsProviderRow key={`provider:${url}`} baseUrl={url} />
        ))}
      </ListGroup>
    </Section>
  );
}

function RunsMintRow({ mintUrl }: { mintUrl: string }) {
  const muted = useThemeColor('muted');
  const meta = useCachedMintMetadata(mintUrl);
  const displayName = meta?.displayName ?? extractDomain(mintUrl);
  return (
    <PressableFeedback
      animation={false}
      accessibilityRole="button"
      accessibilityLabel={`Open mint ${displayName}`}
      testID={`operator-runs-mint:${mintUrl}`}
      onPress={() =>
        // Hand the page what this row already shows, so it paints at once.
        router.push(
          buildMintInfoHref(mintUrl, {
            displayName: meta?.displayName,
            iconUrl: meta?.iconUrl,
            kymScore: meta?.averageScore ?? undefined,
            reviewCount: meta?.reviewCount,
          })
        )
      }>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <MintIcon
              iconUrl={meta?.iconUrl}
              name={displayName}
              alt={`${displayName} icon`}
              size={28}
            />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{displayName}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>Mint · {extractDomain(mintUrl)}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <Icon name="mdi:chevron-right" size={20} color={muted} />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

function RunsProviderRow({ baseUrl }: { baseUrl: string }) {
  const muted = useThemeColor('muted');
  const known = useRoutstrStore((s) => s.knownProviders[baseUrl]);
  const displayName = known?.name ?? extractDomain(baseUrl);
  return (
    <PressableFeedback
      animation={false}
      accessibilityRole="button"
      accessibilityLabel={`Open AI provider ${displayName}`}
      testID={`operator-runs-provider:${baseUrl}`}
      onPress={() =>
        router.push(buildProviderInfoHref(baseUrl, { seedName: known?.name ?? undefined }))
      }>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <ProviderAvatar name={displayName} baseUrl={baseUrl} size={28} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{displayName}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>
              AI provider · {extractDomain(baseUrl)}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <Icon name="mdi:chevron-right" size={20} color={muted} />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}
