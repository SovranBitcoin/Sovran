import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import Container from '@/shared/blocks/Container';
import {
  getStorageInventorySnapshot,
  type ZustandInventory,
} from '@/shared/lib/debug/storageInventory';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const KEY_FONT_SIZE = 11;
const EMPTY_ZUSTAND_GROUPS: ZustandInventory = {
  existingGlobalStoreKeys: [],
  existingProfileStoreKeys: [],
  existingLegacyBareProfileKeys: [],
  existingUncategorizedStoreKeys: [],
};

interface SectionProps {
  title: string;
  subtitle: string;
  countLabel: string;
  items: string[];
  emptyLabel: string;
}

const InventorySection: React.FC<SectionProps> = ({
  title,
  subtitle,
  countLabel,
  items,
  emptyLabel,
}) => {
  return (
    <View className="mb-4">
      <View className="mb-2 ml-2 flex-row items-center justify-between">
        <Text bold size={12} className="uppercase tracking-wide">
          {title}
        </Text>
        <Text size={11} className="text-foreground/50 mr-1">
          {items.length}
        </Text>
      </View>
      <Card variant="secondary">
        <Card.Body className="gap-3">
          <View>
            <Text medium size={11} className="text-foreground/70">
              {subtitle}
            </Text>
            <Text size={11} className="text-foreground/50 mt-1">
              {countLabel}
            </Text>
          </View>

          {items.length === 0 ? (
            <Text size={12} className="text-foreground/60">
              {emptyLabel}
            </Text>
          ) : (
            <View className="gap-2">
              {items.map((item, index) => (
                <View key={item} className="bg-surface-tertiary/35 rounded-lg px-2 py-1.5">
                  <Text size={10} className="text-foreground/45 font-mono">
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <Text size={KEY_FONT_SIZE} className="text-foreground/90 font-mono">
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card.Body>
      </Card>
    </View>
  );
};

interface GroupedSectionProps {
  title: string;
  subtitle: string;
  groups: { label: string; items: string[] }[];
  emptyLabel: string;
}

const GroupedInventorySection: React.FC<GroupedSectionProps> = ({
  title,
  subtitle,
  groups,
  emptyLabel,
}) => {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (total === 0) {
    return (
      <InventorySection
        title={title}
        subtitle={subtitle}
        countLabel="0 items found"
        items={[]}
        emptyLabel={emptyLabel}
      />
    );
  }

  return (
    <View className="mb-4">
      <View className="mb-2 ml-2 flex-row items-center justify-between">
        <Text bold size={12} className="uppercase tracking-wide">
          {title}
        </Text>
        <Text size={11} className="text-foreground/50 mr-1">
          {total}
        </Text>
      </View>
      <Card variant="secondary">
        <Card.Body className="gap-3">
          <Text medium size={11} className="text-foreground/70">
            {subtitle}
          </Text>

          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <View key={group.label} className="gap-2">
                <View className="flex-row items-center justify-between px-1">
                  <Text size={11} bold className="text-foreground/70 uppercase tracking-wide">
                    {group.label}
                  </Text>
                  <Text size={10} className="text-foreground/45">
                    {group.items.length}
                  </Text>
                </View>
                <View className="gap-2">
                  {group.items.map((item) => (
                    <View key={item} className="bg-surface-tertiary/35 rounded-lg px-2 py-1.5">
                      <Text size={10} className="text-foreground/55">
                        Key
                      </Text>
                      <Text size={KEY_FONT_SIZE} className="text-foreground font-mono">
                        {item}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
        </Card.Body>
      </Card>
    </View>
  );
};

export const SettingsStorageScreen = () => {
  const profiles = useProfileStore((state) => state.profiles);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zustandGroups, setZustandGroups] = useState<ZustandInventory>(EMPTY_ZUSTAND_GROUPS);
  const [secureStoreKeys, setSecureStoreKeys] = useState<string[]>([]);
  const [cocoDbFiles, setCocoDbFiles] = useState<string[]>([]);
  const [secureStoreMeta, setSecureStoreMeta] = useState({ existing: 0, total: 0 });

  const loadSnapshot = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        setError(null);
        const snapshot = await getStorageInventorySnapshot(profiles);

        const secureEntries = snapshot.secureStore
          .filter((entry) => entry.exists)
          .map((entry) => entry.key)
          .sort();

        setZustandGroups(snapshot.zustand);
        setSecureStoreKeys(secureEntries);
        setCocoDbFiles(snapshot.cocoDatabases);
        setSecureStoreMeta({
          existing: secureEntries.length,
          total: snapshot.secureStore.length,
        });
      } catch (snapshotError) {
        setError(snapshotError instanceof Error ? snapshotError.message : 'Unknown error');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [profiles]
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const subtitle = useMemo(() => {
    if (isLoading) {
      return 'Loading storage inventory...';
    }
    return 'Shows storage keys/files that currently exist on this device.';
  }, [isLoading]);

  const secureStoreGrouped = useMemo(
    () => ({
      static: secureStoreKeys.filter(
        (key) => key === 'user_mnemonic' || key === 'migrations_complete'
      ),
      migrationFlags: secureStoreKeys.filter((key) => key.startsWith('migrations_complete_')),
      derivedCaches: secureStoreKeys.filter(
        (key) => key.startsWith('derived_keys_') || key.startsWith('cashu_mnemonic_')
      ),
      importedNsec: secureStoreKeys.filter((key) => key.startsWith('imported_nsec_')),
      other: secureStoreKeys.filter(
        (key) =>
          key !== 'user_mnemonic' &&
          key !== 'migrations_complete' &&
          !key.startsWith('migrations_complete_') &&
          !key.startsWith('derived_keys_') &&
          !key.startsWith('cashu_mnemonic_') &&
          !key.startsWith('imported_nsec_')
      ),
    }),
    [secureStoreKeys]
  );

  const cocoGrouped = useMemo(
    () => ({
      mainDbFiles: cocoDbFiles.filter(
        (file) => !file.includes('-wal') && !file.includes('-shm') && !file.includes('-journal')
      ),
      sqliteSidecars: cocoDbFiles.filter(
        (file) => file.includes('-wal') || file.includes('-shm') || file.includes('-journal')
      ),
    }),
    [cocoDbFiles]
  );

  return (
    <Container>
      <ScrollView
        className="px-4"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => loadSnapshot(true)} />
        }>
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3">
            <Text bold size={16}>
              Storage Inventory
            </Text>
            <Text size={12} className="text-foreground/70">
              {subtitle}
            </Text>
            <Text size={11} className="text-foreground/50">
              SecureStore cannot enumerate all keys. This probes deterministic keys from known
              profile/account data and reports which currently exist.
            </Text>
            <Button variant="secondary" size="sm" onPress={() => loadSnapshot(true)}>
              <Button.Label>Refresh</Button.Label>
            </Button>
            {error ? (
              <Text size={12} className="text-danger">
                Failed to refresh inventory: {error}
              </Text>
            ) : null}
          </Card.Body>
        </Card>

        <GroupedInventorySection
          title="Zustand / AsyncStorage"
          subtitle="Persisted Zustand keys grouped by storage contract."
          groups={[
            { label: 'Global stores', items: [...zustandGroups.existingGlobalStoreKeys].sort() },
            {
              label: 'Profile-scoped keys',
              items: [...zustandGroups.existingProfileStoreKeys].sort(),
            },
            {
              label: 'Legacy bare profile keys',
              items: [...zustandGroups.existingLegacyBareProfileKeys].sort(),
            },
            {
              label: 'Uncategorized known keys',
              items: [...zustandGroups.existingUncategorizedStoreKeys].sort(),
            },
          ]}
          emptyLabel="No persisted Zustand keys found."
        />

        <GroupedInventorySection
          title="SecureStore"
          subtitle={`${secureStoreMeta.existing} of ${secureStoreMeta.total} probed keys currently exist, grouped by key type.`}
          groups={[
            { label: 'Static keys', items: secureStoreGrouped.static },
            { label: 'Migration flags', items: secureStoreGrouped.migrationFlags },
            { label: 'Derived caches', items: secureStoreGrouped.derivedCaches },
            { label: 'Imported nsec keys', items: secureStoreGrouped.importedNsec },
            { label: 'Other keys', items: secureStoreGrouped.other },
          ]}
          emptyLabel="No probed SecureStore keys currently exist."
        />

        <GroupedInventorySection
          title="Coco SQLite Files"
          subtitle="Existing wallet SQLite files grouped by main database files vs sidecars."
          groups={[
            { label: 'Main DB files', items: cocoGrouped.mainDbFiles },
            { label: 'SQLite sidecars', items: cocoGrouped.sqliteSidecars },
          ]}
          emptyLabel="No coco database files currently exist."
        />
      </ScrollView>
    </Container>
  );
};
