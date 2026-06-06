import React, { useState, useEffect, useCallback } from 'react';
import { LoadingIndicator } from '@/shared/blocks/status';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { Badge } from '@/shared/ui/primitives/Badge';
import Icon from 'assets/icons';
import { useManager } from '@cashu/coco-react';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { actionMenuPopup, copyPopup, staticPopup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { Section } from '@/shared/ui/composed/Section';
import type { Keypair } from '@cashu/coco-core';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { getPublicKey, nip19 } from 'nostr-tools';
import { parseP2PKSecretInput } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import QRCode from 'react-native-qrcode-svg';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import opacity from 'hex-color-opacity';
import {
  Button,
  ListGroup,
  PressableFeedback,
  Separator,
  Switch as HeroSwitch,
} from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

/**
 * CurrentKeyItem - Featured display for the active/most recent key
 */
const CurrentKeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const muted = useThemeColor('muted');
  const [selectedTab, setSelectedTab] = useState('P2PK');

  const isDerived = keypair.derivationIndex !== undefined;

  const npubValue = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : undefined;

  const isNpubTab = selectedTab === 'NPUB' && !isDerived;
  const activeData = isNpubTab ? npubValue! : keypair.publicKeyHex;
  const displayKey = isDerived ? keypair.publicKeyHex : activeData;

  const handleTabPress = useCallback((tab: string) => {
    setSelectedTab(tab);
  }, []);

  const handleShowQR = () => {
    router.navigate({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
        ...(npubValue && { npub: npubValue }),
      },
    });
  };

  const handleCopy = useCallback(() => {
    onCopy(activeData);
  }, [activeData, onCopy]);

  return (
    <View className="p-4">
      {!isDerived && (
        <View className="mb-4">
          <UnderlineTabs
            tabs={['P2PK', 'NPUB']}
            selectedTab={selectedTab}
            handleTabPress={handleTabPress}
          />
        </View>
      )}

      <PressableFeedback
        onPress={handleShowQR}
        className="mb-4 self-center overflow-hidden rounded-xl">
        <PressableFeedback.Highlight />
        <View
          style={{
            alignItems: 'center',
            padding: 12,
            backgroundColor: INVARIANT_WHITE,
            borderRadius: 12,
          }}>
          {/* QR pinned to dark-on-white regardless of theme — scanners are
              strict and an inverted (light-on-dark) render is unreliable. */}
          <QRCode
            value={activeData}
            size={120}
            color={INVARIANT_BLACK}
            backgroundColor={INVARIANT_WHITE}
          />
        </View>
      </PressableFeedback>

      <HStack align="center" spacing={8} className="mb-3.5 flex-wrap gap-y-2">
        <Badge variant="success" icon="solar:key-bold" size={11}>
          ACTIVE
        </Badge>
        {!isDerived && (
          <Badge variant="primary" icon={isNpubTab ? 'ph:user-bold' : 'solar:key-bold'} size={11}>
            {isNpubTab ? 'NPUB' : 'P2PK'}
          </Badge>
        )}
        {isDerived && (
          <Badge variant="primary" icon="mdi:key-arrow-right" size={11}>
            DERIVED {keypair.derivationIndex}
          </Badge>
        )}
      </HStack>

      <View className="bg-surface rounded-xl px-3.5 py-3">
        <Text size={12} className="text-foreground">
          {displayKey}
        </Text>
      </View>

      <HStack spacing={10} className="mt-3.5">
        <Button variant="secondary" className="flex-1" onPress={handleCopy}>
          <Icon name="lets-icons:copy" size={16} color={muted} />
          <Button.Label style={{ color: muted }}>Copy</Button.Label>
        </Button>
        <Button variant="secondary" className="flex-1" onPress={handleShowQR}>
          <Icon name="stash:qr-code" size={16} color={muted} />
          <Button.Label style={{ color: muted }}>Show QR</Button.Label>
        </Button>
      </HStack>
    </View>
  );
};

/**
 * KeyItem - Individual key display component using PressableFeedback
 */
const KeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const foreground = useThemeColor('foreground');

  const isDerived = keypair.derivationIndex !== undefined;

  const displayKey = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : keypair.publicKeyHex;

  const handleShowQR = () => {
    const npubValue = !isDerived
      ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
      : undefined;

    router.navigate({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
        ...(npubValue && { npub: npubValue }),
      },
    });
  };

  return (
    <PressableFeedback onPress={() => onCopy(keypair.publicKeyHex)}>
      <PressableFeedback.Highlight />
      <View className="flex-row items-center gap-3 p-4">
        <View className="bg-default items-center justify-center rounded-lg p-2">
          <Icon
            name={isDerived ? 'mdi:key-arrow-right' : 'ph:user-bold'}
            size={16}
            color={opacity(foreground, 0.5)}
          />
        </View>
        <ListGroup.ItemContent>
          <Text size={11} style={{ color: foreground }}>
            {truncateMiddle(displayKey, 7)}
          </Text>
          <Text size={10} className="mt-0.5" style={{ color: opacity(foreground, 0.4) }}>
            {isDerived ? `Derived Key ${keypair.derivationIndex}` : 'Imported'}
          </Text>
        </ListGroup.ItemContent>
        <HStack spacing={4}>
          <Button variant="ghost" size="sm" isIconOnly onPress={() => onCopy(keypair.publicKeyHex)}>
            <Icon name="lets-icons:copy" size={16} />
          </Button>
          <Button variant="ghost" size="sm" isIconOnly onPress={handleShowQR}>
            <Icon name="stash:qr-code" size={16} />
          </Button>
        </HStack>
      </View>
    </PressableFeedback>
  );
};

/**
 * KeyringSettings - P2PK key management page
 */
export const SettingsKeyringScreen: React.FC = () => {
  useLifecycleLogger('SettingsKeyringScreen');
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);
  const manager = useManager();
  const { keys: nostrKeys, isReady: nostrKeysReady } = useNostrKeysContext();

  const [keypairs, setKeypairs] = useState<Keypair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImportingCurrentNsec, setIsImportingCurrentNsec] = useState(false);

  // Quick access setting from settings store
  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);
  const setQuickAccessP2PK = useSettingsStore((state) => state.setQuickAccessP2PK);
  const regenerateP2PKOnReceive = useSettingsStore((state) => state.regenerateP2PKOnReceive);
  const setRegenerateP2PKOnReceive = useSettingsStore((state) => state.setRegenerateP2PKOnReceive);

  /**
   * Loads all keypairs from the keyring
   */
  const loadKeypairs = useCallback(async () => {
    if (!manager) return;

    try {
      setIsLoading(true);
      const allKeys = await manager.keyring.getAllKeyPairs();
      setKeypairs(allKeys);
    } catch (error) {
      log.error('settings.keyring.load_failed', { error });
      staticPopup('keys-load-failed');
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  useEffect(() => {
    void loadKeypairs();
  }, [loadKeypairs]);

  /**
   * Generates a new keypair. `isGenerating` is React state and lands too
   * late to block a rapid double-tap on Generate, which would otherwise
   * write two new keypairs into the secure-store keyring.
   */
  const handleGenerateKey = useSingleFlight(async () => {
    if (!manager) return;

    try {
      setIsGenerating(true);
      await manager.keyring.generateKeyPair();
      staticPopup('key-generated');
      await loadKeypairs();
    } catch (error) {
      log.error('settings.keyring.generate_failed', { error });
      staticPopup('key-generate-failed');
    } finally {
      setIsGenerating(false);
    }
  });

  /**
   * Try to import a key with multiple strategies without manipulating the input.
   */
  const tryImportKey = async (input: string): Promise<boolean> => {
    if (!manager) return false;

    const parsed = parseP2PKSecretInput(input);
    if (!parsed.success) {
      log.warn('settings.keyring.import.invalid_input', { error: parsed.error });
      return false;
    }

    const keypair = await manager.keyring.addKeyPair(parsed.secretKey);
    log.info('settings.keyring.import.key_imported', {
      publicKeyHex: keypair.publicKeyHex,
      source: parsed.source,
    });
    return true;
  };

  /**
   * Imports an existing private key (nsec or hex format). The single-flight
   * guard wraps the whole prompt → submit → addKeyPair lifecycle so a
   * double-tap on the Import row before the menu renders cannot stack two
   * `addKeyPair` writes against the same nsec. Uses the canonical
   * `actionMenuPopup` surface (mirrors profile-switcher's nsec import) so
   * the flow renders cross-platform — `Alert.prompt` is iOS-only.
   */
  const handleImportNsec = useSingleFlight(
    () =>
      new Promise<void>((resolve) => {
        let didFinalize = false;
        const finalize = () => {
          if (didFinalize) return;
          didFinalize = true;
          resolve();
        };
        actionMenuPopup({
          title: 'Import Private Key',
          inputs: [
            {
              id: 'key',
              placeholder: 'nsec1... or 64-char hex',
              secureTextEntry: true,
              autoCapitalize: 'none',
              autoCorrect: false,
              description: 'Paste an existing P2PK key — nsec or 64-character hex.',
            },
          ],
          primaryAction: {
            text: 'Import',
            loadingText: 'Importing...',
            icon: 'mdi:key-arrow-right',
            testID: 'keyring-import-submit',
            isDisabled: (v) => !v.key.trim(),
            onPress: async (values, { setError, close }) => {
              if (!manager) {
                setError('Wallet not ready.');
                return;
              }
              const trimmedValue = values.key.trim();
              try {
                const success = await tryImportKey(trimmedValue);
                if (!success) {
                  setError('Enter nsec or 64-character hex key.');
                  return;
                }
                staticPopup('key-imported');
                await loadKeypairs();
              } catch (error) {
                log.error('settings.keyring.import_failed', { error });
                staticPopup('key-import-failed');
              } finally {
                // Host suppresses `onDismiss` once an action commits, so
                // release the single-flight guard explicitly here.
                finalize();
                close();
              }
            },
          },
          onDismiss: finalize,
        });
      })
  );

  /**
   * Adds the active Sovran/Nostr identity key to Coco's P2PK keyring. Coco
   * stores P2PK public keys as SEC1-compressed strings with the Nostr x-only
   * key prefixed by `02`, matching KeyRingService.getPublicKeyHex().
   */
  const handleImportCurrentNsec = useSingleFlight(async () => {
    if (!manager) {
      staticPopup('wallet-still-loading');
      return;
    }

    if (!nostrKeys?.privateKey) {
      staticPopup('key-import-failed', {
        text: 'Current Nostr key is not ready yet.',
      });
      return;
    }

    try {
      setIsImportingCurrentNsec(true);
      const publicKeyHex = `02${getPublicKey(nostrKeys.privateKey)}`;
      const existingKeypairs = await manager.keyring.getAllKeyPairs();

      if (existingKeypairs.some((keypair) => keypair.publicKeyHex === publicKeyHex)) {
        setKeypairs(existingKeypairs);
        staticPopup('key-imported', {
          text: 'Your active Nostr key is already available for P2PK-locked ecash.',
        });
        return;
      }

      const keypair = await manager.keyring.addKeyPair(nostrKeys.privateKey);
      log.info('settings.keyring.import_current_nsec.key_imported', {
        publicKeyHex: keypair.publicKeyHex,
      });
      staticPopup('key-imported', {
        text: 'Your active Nostr key can now receive P2PK-locked ecash.',
      });
      await loadKeypairs();
    } catch (error) {
      log.error('settings.keyring.import_current_nsec_failed', { error });
      staticPopup('key-import-failed', {
        text: 'Failed to add your current Nostr key.',
      });
    } finally {
      setIsImportingCurrentNsec(false);
    }
  });

  const handleCopyKey = async (publicKey: string) => {
    await Clipboard.setStringAsync(publicKey);
    copyPopup('publicKey');
  };

  const canImportCurrentNsec = !!manager && nostrKeysReady && !!nostrKeys?.privateKey;
  const isKeyringActionPending = isGenerating || isImportingCurrentNsec;

  return (
    <Screen name="SettingsKeyringScreen">
      <Stack.Screen
        options={{
          title: 'P2PK Keys',
          headerRight: () => (
            <HStack spacing={4}>
              <Pressable
                onPress={handleImportNsec}
                style={{ padding: 8 }}
                disabled={isKeyringActionPending}
                testID="keyring-import-trigger">
                <Icon name="mdi:key-arrow-right" size={22} color={foreground} />
              </Pressable>
              <Pressable
                onPress={handleGenerateKey}
                style={{ padding: 8 }}
                disabled={isKeyringActionPending}>
                {isGenerating ? (
                  <LoadingIndicator size={22} phase="loading" color={foreground} />
                ) : (
                  <Icon name="mdi:key-plus" size={22} color={foreground} />
                )}
              </Pressable>
            </HStack>
          ),
        }}
      />
      {/* Quick Access Toggle */}
      <Section title="Preferences">
        <ListGroup variant="secondary">
          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Quick Access to Lock</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                Show your latest P2PK locking key in the receive ecash menu
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <HeroSwitch
                isSelected={quickAccessP2PK ?? false}
                onSelectedChange={setQuickAccessP2PK}
              />
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
          <Separator className="mx-4" />
          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Regenerate Key on Receive</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                Automatically generate a new P2PK key after redeeming a locked token for improved
                privacy
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <HeroSwitch
                isSelected={regenerateP2PKOnReceive ?? true}
                onSelectedChange={setRegenerateP2PKOnReceive}
              />
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
          <Separator className="mx-4" />
          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Use Current Nostr Key</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                Add your active nsec as a P2PK receive key
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={!canImportCurrentNsec || isImportingCurrentNsec}
                onPress={handleImportCurrentNsec}
                testID="keyring-import-current-nsec">
                {isImportingCurrentNsec ? (
                  <LoadingIndicator size={16} phase="loading" color={foreground} />
                ) : (
                  <Icon name="mdi:key-chain" size={16} color={foreground} />
                )}
                <Button.Label>Add</Button.Label>
              </Button>
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        </ListGroup>
      </Section>

      {/* Keys List */}
      <Section title={`Your Keys (${keypairs.length})`}>
        <ListGroup variant="secondary">
          {isLoading ? (
            <VStack align="center" className="p-6">
              <LoadingIndicator size={20} phase="loading" color={opacity(foreground, 0.4)} />
              <Text size={14} className="mt-2" style={{ color: opacity(foreground, 0.4) }}>
                Loading keys...
              </Text>
            </VStack>
          ) : keypairs.length === 0 ? (
            <VStack align="center" className="p-6">
              <Icon name="mdi:key-variant" size={40} color={defaultColor} />
              <Text
                size={14}
                className="mt-3 text-center"
                style={{ color: opacity(foreground, 0.4) }}>
                Generate or import a key to get started with P2PK-locked ecash
              </Text>
            </VStack>
          ) : (
            [...keypairs].reverse().map((keypair, index) => (
              <React.Fragment key={keypair.publicKeyHex}>
                {index > 0 && <Separator className="mx-4" />}
                {index === 0 ? (
                  <CurrentKeyItem keypair={keypair} onCopy={handleCopyKey} />
                ) : (
                  <KeyItem keypair={keypair} onCopy={handleCopyKey} />
                )}
              </React.Fragment>
            ))
          )}
        </ListGroup>
      </Section>

      <Spacer size={32} />
    </Screen>
  );
};
