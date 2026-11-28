/**
 * Every recorded revision of one mint's info — what a row on Notifications →
 * Mints opens into. Same plain-language sentences as the row, but all of them,
 * dated, with the precise value (a version string, the full notice) underneath
 * where there is room for it.
 *
 * Reads the history this phone recorded (`mint-history-store`), so nothing is
 * fetched to show it. Pull to refresh, or Retry, asks the mint now and records
 * any change it finds.
 */
import { StyleSheet } from 'react-native';
import { z } from 'zod';

import { MintChangeGlyph } from '@/features/mint/components/mintChanges/MintChangeGlyph';
import { useMintChangeRevisions } from '@/features/mint/hooks/useMintChanges';
import type { MintChangeRevision } from '@/features/mint/lib/mintChanges/groupEntries';
import { capitalize, type MintChangePhrase } from '@/features/mint/lib/mintChanges/phrase';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate, formatRelativeUnixSeconds } from '@/shared/lib/date';
import { Log, useLifecycleLogger } from '@/shared/lib/logger';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { alpha, fontSize, spacing } from '@/shared/styles/tokens';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { List } from '@/shared/ui/composed/List';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Notice } from '@/shared/ui/composed/Notice';
import { Button } from '@/shared/ui/primitives/Button';
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
    <VStack testID={`mint-change-revision-${entry.hash}`} gap={spacing.xs} style={styles.section}>
      <HStack align="baseline" justify="space-between" gap={spacing.sm} style={styles.sectionHead}>
        <Text bold size={fontSize.md} style={{ color: foreground }}>
          {formatDate(entry.at * 1000, 'short-date-time')}
        </Text>
        <Text size={fontSize.sm} style={{ color: muted }}>
          {formatRelativeUnixSeconds(entry.at)}
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
            {entry.oversized
              ? 'Details too large to record on this device'
              : 'Protocol details only'}
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}

export function MintChangesScreen() {
  useLifecycleLogger('MintChangesScreen');
  const params = useRouteParams(ParamsSchema, { where: 'mint-changes' });
  const mintUrl = params?.mintUrl;
  const { revisions, status, isLoading, isRefreshing, errorMessage, refresh } =
    useMintChangeRevisions(mintUrl);
  const metadata = useCachedMintMetadata(mintUrl);
  const [foreground, muted, surface, separator] = useThemeColor([
    'foreground',
    'muted',
    'surface',
    'separator-secondary',
  ] as const);

  const name = revisions[0]?.entry.name ?? metadata?.displayName ?? '';
  const host = revisions[0]?.entry.host ?? mintUrl ?? '';

  const listHeader = (
    <VStack>
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
      {/* A failed check keeps the saved history on screen and says so. */}
      {errorMessage ? (
        <View className="px-5 pb-3">
          <Notice
            status="warning"
            description={errorMessage}
            testID="mint-changes-refresh-failed"
            action={<Button text="Retry" variant="secondary" size="compact" onPress={refresh} />}
          />
        </View>
      ) : null}
    </VStack>
  );

  const renderItem = ({ item }: { item: MintChangeRevision }) => (
    <RevisionSection revision={item} />
  );

  const renderSeparator = () => <View style={[styles.separator, { backgroundColor: separator }]} />;

  return (
    <Screen name="MintChangesScreen" scroll="custom" safeArea="scroll" bgColor={surface}>
      {revisions.length > 0 && (
        <E2EAccessibilityProbe
          testID="mint-changes-populated"
          accessibilityLabel="Mint update history loaded"
        />
      )}
      <Log name="MintChangesContent" style={styles.root}>
        <List
          screen
          testID="mint-changes-detail"
          data={revisions}
          keyExtractor={(revision) => revision.entry.hash}
          // `entry.hash` is the revision id here (unique even for A → B → A).
          ListHeaderComponent={revisions.length > 0 ? listHeader : null}
          ItemSeparatorComponent={renderSeparator}
          refreshing={isRefreshing && revisions.length > 0}
          onRefresh={refresh}
          ListEmptyComponent={
            isLoading ? (
              <Spinner size={22} color={foreground} />
            ) : status === 'waiting' ? (
              <EmptyState
                testID="mint-changes-waiting"
                icon={errorMessage ? 'mdi:alert-circle-outline' : 'mdi:clock-outline'}
                title="Waiting for first check"
                subtitle={
                  errorMessage ??
                  'This phone has not heard from this mint yet. Its changes are recorded from the first answer on.'
                }
                action={<Button text="Retry" variant="secondary" onPress={refresh} />}
              />
            ) : (
              <EmptyState
                testID="mint-changes-none"
                icon="mingcute:bank-fill"
                title="No changes observed on this device"
                subtitle={
                  errorMessage ??
                  'Nothing this mint publishes about itself has changed since this phone first checked it.'
                }
                action={
                  errorMessage ? (
                    <Button text="Retry" variant="secondary" onPress={refresh} />
                  ) : undefined
                }
              />
            )
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
