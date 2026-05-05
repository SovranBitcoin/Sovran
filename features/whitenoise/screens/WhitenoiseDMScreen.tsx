import React, { useMemo } from 'react';
import { router } from 'expo-router';
import { wnLog, useLifecycleLogger } from '@/shared/lib/logger';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import {
  ChatScreen,
  DmChatHeader,
  extractCashuToken,
  type ChatBubbleMessage,
} from '@/shared/ui/composed/chat';
import { Screen } from '@/shared/ui/composed/Screen';
import { useWhitenoiseDM, type WhitenoiseDmMessage } from '../hooks/useWhitenoiseDM';
import { MarmotIcon } from '../components/MarmotIcon';

const SURFACE = 'whitenoise' as const;

/**
 * White Noise (MLS) 1:1 DM. Visually identical to the other DM surfaces;
 * the transport identity surfaces only as the composer's leading Marmot
 * icon and the group-creation pending state.
 */
export function WhitenoiseDMScreen({ pubkey }: { pubkey: string }) {
  useLifecycleLogger('WhitenoiseDMScreen');

  const { metadata } = useNostrProfileMetadata(pubkey);
  const { isLoading, isCreatingGroup, error, hasGroup, messages, send, isClientReady } =
    useWhitenoiseDM(pubkey);

  const [shade400, shade500, danger] = useThemeColor(['shade-400', 'shade-500', 'danger'] as const);

  const peerName = resolveIdentityName({ pubkey, nostrProfile: metadata });
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(() => messages.map(toBubble), [messages]);

  return (
    <Screen name="WhitenoiseDMScreen" scroll="none">
      <DmChatHeader pubkey={pubkey} onBack={() => router.back()} />
      <ChatScreen
        surface={SURFACE}
        log={wnLog}
        messages={bubbleMessages}
        onSend={send}
        composerDisabled={!isClientReady || isCreatingGroup}
        composerPlaceholder={isCreatingGroup ? 'Creating encrypted group…' : 'Write here'}
        composerTestID="whitenoise-dm-input"
        banner={
          error ? (
            <Text size={13} style={{ color: danger, padding: 12 }}>
              {error}
            </Text>
          ) : null
        }
        isLoading={false}
        historyExtras={(last) => ({
          lastIsOwn: last?.isOwn ?? null,
          lastDeliveryStatus: last?.deliveryStatus ?? null,
        })}
        emptyContent={
          <VStack align="center" spacing={12}>
            <MarmotIcon size={48} />
            <Text size={16} style={{ color: shade400, textAlign: 'center' }}>
              {!isClientReady
                ? 'White Noise is not available yet.'
                : isLoading
                  ? 'Loading…'
                  : !hasGroup
                    ? `Start an MLS-encrypted chat with ${peerName}.`
                    : `No messages yet. Say hi to ${peerName}!`}
            </Text>
            <Text size={13} style={{ color: shade500, textAlign: 'center' }}>
              End-to-end encrypted via the Marmot Protocol (MLS).
            </Text>
          </VStack>
        }
      />
    </Screen>
  );
}

function toBubble(m: WhitenoiseDmMessage): ChatBubbleMessage {
  return {
    id: m.id,
    content: m.content,
    senderId: m.authorPubkey,
    timestamp: m.createdAt * 1000,
    isOwn: m.isSelf,
    deliveryStatus: m.isSelf ? (m.isPending ? 'sending' : 'sent') : undefined,
    cashuToken: extractCashuToken(m.content) ?? undefined,
  };
}
