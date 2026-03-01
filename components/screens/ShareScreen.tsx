/**
 * @fileoverview ShareScreen Component
 *
 * A reusable screen component for sharing Nostr public keys (npub) or P2PK keys
 * via QR code. Can be used standalone or within flow navigators.
 */

import React, { useCallback, useState } from 'react';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { View } from 'components/ui/View/View';
import * as Clipboard from 'expo-clipboard';
import { copyPopup } from '@/helper/popup';
import { truncateMiddle } from 'helper/strings';
import opacity from 'hex-color-opacity';
import { ModalLayoutWrapper } from 'app/debugModal';
import { Tabs } from 'components/ui/Tabs';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useThemeColor } from 'hooks/useThemeColor';

// Configuration for different share types
export const SHARE_CONFIGS = {
  profile: {
    title: 'Profile Details',
    sectionTitle: 'PROFILE',
    unit: 'nostr',
    copyTarget: 'npub' as const,
    dataKey: 'npub',
    iconCurrency: 'nostr',
    iconName: null,
  },
  p2pk: {
    title: 'P2PK Public Key',
    sectionTitle: 'PUBLIC KEY',
    unit: 'p2pk',
    copyTarget: 'p2pk' as const,
    dataKey: 'publicKey',
    iconCurrency: 'p2pk',
    iconName: null,
  },
  npub: {
    title: 'Nostr Public Key',
    sectionTitle: 'NPUB',
    unit: 'nostr',
    copyTarget: 'npub' as const,
    dataKey: 'npub',
    iconCurrency: 'nostr',
    iconName: null,
  },
  lud16: {
    title: 'Lightning Address',
    sectionTitle: 'LIGHTNING',
    unit: 'sat',
    copyTarget: 'lud16' as const,
    dataKey: 'lud16',
    iconCurrency: null,
    iconName: 'mdi:lightning-bolt',
  },
} as const;

export type ShareType = keyof typeof SHARE_CONFIGS;

export interface ShareScreenProps {
  /** The type of data being shared */
  type: ShareType;
  /** The main data string to share (npub, p2pk key, etc.) */
  data: string;
  /** Optional npub for showing tabs (used when type is 'p2pk') */
  npub?: string;
  /** Optional lud16 for showing tabs (used when type is 'npub') */
  lud16?: string;
  /** Callback when title changes (for parent to update header) */
  onTitleChange?: (title: string) => void;
}

export function ShareScreen({ type, data, npub, lud16, onTitleChange }: ShareScreenProps) {
  const foreground = useThemeColor('foreground');

  // Determine if we should show tabs
  const showP2pkTabs = type === 'p2pk' && npub;
  const showNpubTabs = type === 'npub' && lud16;
  const showTabs = showP2pkTabs || showNpubTabs;

  // Build tabs array based on available data
  const tabs = showP2pkTabs ? ['P2PK', 'NPUB'] : showNpubTabs ? ['NPUB', 'LIGHTNING'] : [];
  const [selectedTab, setSelectedTab] = useState(showP2pkTabs ? 'P2PK' : 'NPUB');

  // Get the config based on current selection
  const getActiveConfig = useCallback(() => {
    if (showP2pkTabs && selectedTab === 'NPUB') {
      return SHARE_CONFIGS.npub;
    }
    if (showNpubTabs && selectedTab === 'LIGHTNING') {
      return SHARE_CONFIGS.lud16;
    }
    return SHARE_CONFIGS[type];
  }, [showP2pkTabs, showNpubTabs, selectedTab, type]);

  // Get the active data based on current selection
  const getActiveData = useCallback(() => {
    if (showP2pkTabs && selectedTab === 'NPUB') {
      return npub || '';
    }
    if (showNpubTabs && selectedTab === 'LIGHTNING') {
      return lud16 || '';
    }
    return data;
  }, [showP2pkTabs, showNpubTabs, selectedTab, npub, lud16, data]);

  const config = getActiveConfig();
  const activeData = getActiveData();

  const handleTabPress = useCallback(
    (tab: string) => {
      setSelectedTab(tab);
      // Notify parent of title change
      if (onTitleChange) {
        let newConfig;
        if (tab === 'NPUB') {
          newConfig = SHARE_CONFIGS.npub;
        } else if (tab === 'LIGHTNING') {
          newConfig = SHARE_CONFIGS.lud16;
        } else if (tab === 'P2PK') {
          newConfig = SHARE_CONFIGS.p2pk;
        } else {
          newConfig = SHARE_CONFIGS[type];
        }
        onTitleChange(newConfig.title);
      }
    },
    [onTitleChange, type]
  );

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(activeData);
    copyPopup(config.copyTarget);
  }, [activeData, config.copyTarget]);

  return (
    <ModalLayoutWrapper>
      {/* Tab bar - only show if npub is available for p2pk type */}
      {showTabs && (
        <View style={{ marginBottom: 16 }}>
          <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
        </View>
      )}

      <PaymentInfo copyTarget={config.copyTarget} data={activeData} unit={config.unit} />

      <Section title={config.sectionTitle}>
        <ListGroup variant="secondary">
          <PressableFeedback animation={false} onPress={handleCopy}>
            <PressableFeedback.Scale>
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  {config.iconCurrency ? (
                    <CurrencyIcon
                      colors={[opacity(foreground, 0.4)]}
                      width={20}
                      currency={config.iconCurrency}
                    />
                  ) : config.iconName ? (
                    <Icon name={config.iconName} size={20} color={opacity(foreground, 0.4)} />
                  ) : undefined}
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{truncateMiddle(activeData, 10)}</ListGroup.ItemTitle>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <Icon name="lets-icons:copy" size={20} color={opacity(foreground, 0.4)} />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </PressableFeedback.Scale>
            <PressableFeedback.Ripple />
          </PressableFeedback>
        </ListGroup>
      </Section>
    </ModalLayoutWrapper>
  );
}
