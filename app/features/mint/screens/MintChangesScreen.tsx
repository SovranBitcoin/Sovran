/**
 * Every recorded revision of one mint's info — what a row on Notifications →
 * Mints opens into. Same plain-language sentences as the row, but all of them,
 * dated, with the precise value (a version string, the full notice) underneath
 * where there is room for it.
 *
 * Reads the same cached changelog response as the list, so opening a row costs
 * no fetch.
 */
import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { z } from 'zod';

import { MintChangeGlyph } from '@/features/mint/components/mintChanges/MintChangeRow';
import { useMintChangeRevisions } from '@/features/mint/hooks/useMintChanges';
import type { MintChangeRevision } from '@/features/mint/lib/mintChanges/groupEntries';
import { capitalize, type MintChangePhrase } from '@/features/mint/lib/mintChanges/phrase';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { alpha, fontSize, spacing } from '@/shared/styles/tokens';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const ParamsSchema = z.object({
  mintUrl: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^https?:\/\//, 'mintUrl must be http(s)'),
});

const HOUR_SECONDS = 3600;
/** Matches the glyph the same update wears on the Notifications row. */
const GLYPH_SIZE = 34;

/**
 * `previousLastSeenAt` bounds when a change really happened: somewhere inside
 * that window, not necessarily at the recorded timestamp. Say so.
 */
function checkWindowLabel(sincePrevious: number | undefined): string | null {
  if (!sincePrevious || sincePrevious <= 0) return null;
  const hours = Math.round(sincePrevious / HOUR_SECONDS);
  if (hours < 1) return 'within minutes of the previous check';
  if (hours < 48) return `within ${hours}h of the previous check`;
  return `within ${Math.round(hours / 24)}d of the previous check`;
}

/**
 * One update, in the Receive hub's row grammar: a tinted glyph on the left, the
 * sentence as the title, and the precise value (a version, the full notice) as
 * the subtitle. Same `ListRow` the payment surfaces use, so the spacing and
 * type scale can't drift from them.
 */
function UpdateRow({ phrase }: { phrase: MintChangePhrase }) {
  const foreground = useThemeColor('foreground');
  return (
    <ListRow
      padding="compact"
      leading={<MintChangeGlyph icon={phrase.icon} tone={phrase.tone} size={GLYPH_SIZE} />}
      // A sentence can run past one line, so the title is a node: `ListRow`
      // ellipsizes plain-string titles to keep name rows aligned.
      title={
        <Text bold size={fontSize.lg} style={{ color: foreground }}>
          {capitalize(phrase.text)}
        </Text>
      }
      {...(phrase.detail ? { subtitle: phrase.detail, wrapSubtitle: true } : {})}
    />
  );
}

function RevisionSection({ revision }: { revision: MintChangeRevision }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const { entry, phrases } = revision;
  const window = checkWindowLabel(entry.sincePrevious);

  return (
    <VStack gap={spacing.xs} style={styles.section}>
      <HStack align="baseline" justify="space-between" gap={spacing.sm} style={styles.sectionHead}>
        <Text bold size={fontSize.md} style={{ color: foreground }}>
          {formatDate(entry.at * 1000, 'short-date-time')}
        </Text>
        <Text size={fontSize.sm} style={{ color: muted }}>
          {formatRelative(entry.at * 1000, 'compact')}
        </Text>
      </HStack>
      {window ? (
        <Text size={fontSize.sm} style={[styles.sectionHead, { color: muted }]}>
          {window}
        </Text>
      ) : null}
      <VStack>
        {phrases.map((phrase, index) => (
          <UpdateRow key={`${entry.hash}:${index}`} phrase={phrase} />
        ))}
        {phrases.length === 0 ? (
          <Text size={fontSize.lg} style={[styles.sectionHead, { color: muted }]}>
            Protocol details only
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}

export function MintChangesScreen() {
  useLifecycleLogger('MintChangesScreen');
  const params = useRouteParams(ParamsSchema, { where: 'notifications.mint-changes' });
  const mintUrl = params?.mintUrl;
  const revisions = useMintChangeRevisions(mintUrl);
  const metadata = useCachedMintMetadata(mintUrl);
  const [foreground, muted, surface, separator] = useThemeColor([
    'foreground',
    'muted',
    'surface',
    'separator-secondary',
  ] as const);

  const name = revisions[0]?.entry.name ?? metadata?.displayName ?? '';
  const host = revisions[0]?.entry.host ?? mintUrl ?? '';

  const listHeader = useMemo(
    () => (
      <HStack align="center" gap={spacing.md} style={styles.header}>
        <MintIcon iconUrl={metadata?.iconUrl} name={name} size={48} />
        <VStack gap={2} flex={1}>
          <Text bold numberOfLines={1} size={fontSize['2xl']} style={{ color: foreground }}>
            {name || host}
          </Text>
          <Text numberOfLines={1} size={fontSize.sm} style={{ color: muted }}>
            {revisions.length === 1 ? '1 update' : `${revisions.length} updates`}
            {'  ·  '}
            {host}
          </Text>
        </VStack>
      </HStack>
    ),
    [metadata?.iconUrl, name, host, revisions.length, foreground, muted]
  );

  const renderItem = useCallback(
    ({ item }: { item: MintChangeRevision }) => <RevisionSection revision={item} />,
    []
  );

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: separator }]} />,
    [separator]
  );

  return (
    <Screen name="MintChangesScreen" scroll="custom" bgColor={surface}>
      <Log name="MintChangesContent" style={styles.root}>
        <FlatList
          testID="mint-changes-detail"
          data={revisions}
          keyExtractor={(revision) => revision.entry.hash}
          ListHeaderComponent={revisions.length > 0 ? listHeader : null}
          ItemSeparatorComponent={renderSeparator}
          ListEmptyComponent={
            <EmptyState
              icon="mingcute:bank-fill"
              title="No updates recorded"
              subtitle="Nothing has changed for this mint since it was first seen."
            />
          }
          contentContainerStyle={[
            styles.listContent,
            revisions.length === 0 && styles.emptyListContent,
          ]}
          renderItem={renderItem}
        />
      </Log>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  section: {
    // `ListRow` owns its own horizontal padding, so only the date band is
    // inset here — otherwise every update sits twice as far in as it should.
    paddingVertical: spacing.lg,
  },
  sectionHead: {
    paddingHorizontal: spacing.xl,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.xl,
    opacity: alpha.prominent,
  },
  listContent: {
    paddingBottom: spacing['3xl'],
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
