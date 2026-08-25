import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Share } from 'react-native';

import { Button, Card, Switch as HeroSwitch } from 'heroui-native';
import * as Clipboard from 'expo-clipboard';
import {
  log,
  useLifecycleLogger,
  exportLogFile,
  clearLogFile,
  getLogFileInfo,
  type LogFileInfo,
} from '@/shared/lib/logger';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import {
  getFullAsyncStorageDump,
  getStorageInventorySnapshot,
  type ZustandInventory,
} from '@/shared/lib/debug/storageInventory';
import { buildCocoFeedbackReport } from '@/shared/lib/cashu/cocoFeedback';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const KEY_FONT_SIZE = 11;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
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
  useLifecycleLogger('SettingsStorageScreen');
  const profiles = useProfileStore((state) => state.profiles);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isCopyingLogs, setIsCopyingLogs] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [logFileInfo, setLogFileInfo] = useState<LogFileInfo>(() => getLogFileInfo());
  const [error, setError] = useState<string | null>(null);

  const fileLoggingEnabled = useSettingsStore((state) => state.fileLoggingEnabled);
  const setFileLoggingEnabled = useSettingsStore((state) => state.setFileLoggingEnabled);

  const refreshLogFileInfo = () => setLogFileInfo(getLogFileInfo());

  const handleToggleFileLogging = (next: boolean) => {
    setFileLoggingEnabled(next);
    refreshLogFileInfo();
  };

  const handleExportLogFile = async () => {
    setIsExportingLogs(true);
    try {
      const shared = await exportLogFile();
      if (!shared) {
        Alert.alert('No logs yet', 'Enable "Save logs to file", reproduce the issue, then export.');
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setIsExportingLogs(false);
      refreshLogFileInfo();
    }
  };

  const handleClearLogFile = () => {
    clearLogFile();
    refreshLogFileInfo();
  };
  const [zustandGroups, setZustandGroups] = useState<ZustandInventory>(EMPTY_ZUSTAND_GROUPS);
  const [secureStoreKeys, setSecureStoreKeys] = useState<string[]>([]);
  const [cocoDbFiles, setCocoDbFiles] = useState<string[]>([]);
  const [cocoBackupFiles, setCocoBackupFiles] = useState<string[]>([]);
  const [secureStoreMeta, setSecureStoreMeta] = useState({ existing: 0, total: 0 });

  // Identity contract, not an optimization: dep of the load effect below —
  // keyed on `profiles` so a plain render-scoped identity can't re-fire the
  // effect (and its setStates) every render. Compiler memoization is an
  // optimization, not a contract.
  // ast-grep-ignore: no-manual-memo-tsx
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
        setCocoBackupFiles(snapshot.cocoBackups);
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

  const handleShareDump = async () => {
    setIsSharing(true);
    try {
      const dump = await getFullAsyncStorageDump();
      const jsonString = JSON.stringify(dump, null, 2);
      await Share.share({ message: jsonString, title: 'AsyncStorage Full Dump' });
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Share failed');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyCocoReport = async () => {
    try {
      await Clipboard.setStringAsync(buildCocoFeedbackReport());
      Alert.alert('Copied', 'coco v2 feedback report copied — paste into a cashubtc/coco issue.');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copy failed');
    }
  };

  const handleCopyDebugLogs = async () => {
    setIsCopyingLogs(true);
    try {
      await Clipboard.setStringAsync(log.dumpForLLM());
      Alert.alert('Copied', 'Debug logs copied to clipboard.');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copy failed');
    } finally {
      setIsCopyingLogs(false);
    }
  };

  const subtitle = isLoading
    ? 'Loading storage inventory...'
    : 'Shows storage keys/files that currently exist on this device.';

  const secureStoreGrouped = {
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
  };

  const cocoGrouped = {
    mainDbFiles: cocoDbFiles.filter(
      (file) => !file.includes('-wal') && !file.includes('-shm') && !file.includes('-journal')
    ),
    sqliteSidecars: cocoDbFiles.filter(
      (file) => file.includes('-wal') || file.includes('-shm') || file.includes('-journal')
    ),
  };

  return (
    <ScreenWrapper name="SettingsStorageScreen" scroll="custom" safeArea>
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
            <View className="flex-row gap-2">
              <Button variant="secondary" size="sm" onPress={() => loadSnapshot(true)}>
                <Button.Label>Refresh</Button.Label>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={isSharing}
                onPress={handleShareDump}>
                <Button.Label>{isSharing ? 'Exporting...' : 'Share Full Dump'}</Button.Label>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={isCopyingLogs}
                onPress={handleCopyDebugLogs}>
                <Button.Label>{isCopyingLogs ? 'Copying...' : 'Copy Debug Logs'}</Button.Label>
              </Button>
              <Button variant="secondary" size="sm" onPress={handleCopyCocoReport}>
                <Button.Label>Copy coco v2 Report</Button.Label>
              </Button>
            </View>
            {error ? (
              <Text size={12} className="text-danger">
                Failed to refresh inventory: {error}
              </Text>
            ) : null}
          </Card.Body>
        </Card>

        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text bold size={16}>
                On-Device Log File
              </Text>
              <HeroSwitch
                isSelected={fileLoggingEnabled}
                onSelectedChange={handleToggleFileLogging}
              />
            </View>
            <Text size={12} className="text-foreground/70">
              Mirror logs to a file on the device so they survive offline, when the dev-server
              console is unreachable. Export the file and evaluate it later with log-doctor.
            </Text>
            <Text size={11} className="text-foreground/50">
              {fileLoggingEnabled ? 'Saving logs to file.' : 'Not saving.'}
              {logFileInfo.exists ? ` Stored: ${formatBytes(logFileInfo.bytes)}.` : ' No file yet.'}
            </Text>
            <View className="flex-row gap-2">
              <Button
                variant="secondary"
                size="sm"
                isDisabled={isExportingLogs || !logFileInfo.exists}
                onPress={handleExportLogFile}>
                <Button.Label>{isExportingLogs ? 'Exporting...' : 'Export Log File'}</Button.Label>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={!logFileInfo.exists}
                onPress={handleClearLogFile}>
                <Button.Label>Clear Log File</Button.Label>
              </Button>
            </View>
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
            { label: 'Pre-v2 backups (excluded from dumps)', items: cocoBackupFiles },
          ]}
          emptyLabel="No coco database files currently exist."
        />
      </ScrollView>
    </ScreenWrapper>
  );
};
