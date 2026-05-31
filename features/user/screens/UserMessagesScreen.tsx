/**
 * @fileoverview Direct Messages screen
 *
 * Renders a NIP-17 gift-wrapped DM thread with NIP-04 fallback for legacy
 * peers. Used by the standalone, user-flow, and mint-flow `userMessages`
 * route wrappers — `pubkey` is the recipient and is validated as a 64-hex
 * Schnorr key at the route boundary.
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { router } from 'expo-router';
import { staticPopup } from '@/shared/lib/popup';
import {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKUser,
  useNDK,
  useSubscribe,
} from '@nostr-dev-kit/ndk-mobile';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { buildGiftWrappedDMPair } from '@/shared/lib/nostr/nip17';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';

import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { isMockContactPubkey, getMockDmThread } from '@/shared/stores/runtime/mockDataStore';

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Button } from '@/shared/ui/primitives/Button';
import {
  ChatScreen,
  DmChatHeader,
  extractCashuToken,
  type ChatBubbleMessage,
} from '@/shared/ui/composed/chat';
import { resolveIdentityName } from '@/shared/lib/identity';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { chatLog, log, useLifecycleLogger } from '@/shared/lib/logger';
import { LightningAddress } from '@sovranbitcoin/schemas';
import { Screen } from '@/shared/ui/composed/Screen';
import { usePaymentFlowMachine } from 'colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

const SURFACE = 'nostr-dm' as const;

/** Internal DM record. Maps to ChatBubbleMessage at render time. */
interface DmMessage {
  id: string;
  content: string;
  isOwn: boolean;
  /** True only on optimistic bubbles between dispatch and publish ack. */
  isSending?: boolean;
  created_at: number;
  pubkey: string;
}

interface UserMessagesScreenProps {
  pubkey: string;
  /** Optional callback for back navigation - if not provided, uses router.back() */
  onBack?: () => void;
}

type SendMoneyPaymentMachine = {
  startSendEcash: (opts?: {
    reset?: boolean;
    meltTarget?: string;
    recipientPubkey?: string;
  }) => Promise<void>;
};

export function UserMessagesScreen({ pubkey, onBack }: UserMessagesScreenProps) {
  useLifecycleLogger('UserMessagesScreen');

  const [shade400, background] = useThemeColor(['shade-400', 'background'] as const);
  const { keys: nostrKeys } = useNostrKeysContext();
  const { ndk } = useNDK();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Mock-mode short-circuit: if this DM is with one of the demo contacts,
  // serve the seeded thread and disable relay subscriptions / publish.
  // The actual `setMessages` happens further down so it runs AFTER the
  // pubkey-reset effect — otherwise the reset would wipe the seed.
  const mockMode = useSettingsStore((s) => s.mockMode);
  const isMockThread = mockMode && isMockContactPubkey(pubkey);

  // Counterparty kind-0 metadata is served from the shared SWR cache.
  // First open of a conversation per session pays one round-trip; every
  // subsequent open is instant because the cache is shared across surfaces
  // (this screen, contact picker, feed reactions, etc.) and persists across
  // app launches via profile-scoped AsyncStorage.
  const { metadata: counterpartyMetadata } = useNostrProfileMetadata(pubkey);

  const dmFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    // Mock thread is served entirely from local state — no relay traffic.
    if (isMockThread) return null;
    return [
      {
        kinds: [EncryptedDirectMessage],
        authors: [nostrKeys.pubkey],
        '#p': [pubkey],
      },
      {
        kinds: [EncryptedDirectMessage],
        '#p': [nostrKeys.pubkey],
        authors: [pubkey],
      },
    ];
  }, [pubkey, nostrKeys?.pubkey, isMockThread]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // NIP-17: subscribe to gift-wrapped events (kind 1059) addressed to us.
  const giftWrapFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    if (isMockThread) return null;
    return [
      {
        kinds: [1059 as number],
        '#p': [nostrKeys.pubkey],
      },
    ];
  }, [nostrKeys?.pubkey, isMockThread]);

  const { events: giftWrapEvents } = useSubscribe({ filters: giftWrapFilters });

  const unwrappedGiftWrapMessages = useMemo(() => {
    if (!giftWrapEvents?.length || !nostrKeys?.privateKey || !nostrKeys?.pubkey) return [];

    return giftWrapEvents
      .map((event) => {
        const unwrapped = giftWrapCache.unwrap(nostrKeys.pubkey, event, nostrKeys.privateKey);
        if (!unwrapped) return null;

        const isFromCounterparty =
          unwrapped.senderPubkey === pubkey &&
          unwrapped.recipientPubkeys.includes(nostrKeys.pubkey);
        const isFromMe =
          unwrapped.senderPubkey === nostrKeys.pubkey &&
          unwrapped.recipientPubkeys.includes(pubkey);

        if (!isFromCounterparty && !isFromMe) return null;

        return {
          wrapId: event.id,
          ...unwrapped,
        };
      })
      .filter((dm): dm is NonNullable<typeof dm> => dm !== null);
  }, [giftWrapEvents, nostrKeys?.privateKey, nostrKeys?.pubkey, pubkey]);

  const displayName = resolveIdentityName({ pubkey, nostrProfile: counterpartyMetadata });
  const userPicture = counterpartyMetadata?.picture;
  // lud16 is relay-supplied kind:0 metadata — validate the `name@host` shape
  // before plumbing it into router params / colada. A malformed
  // value should hide the Send Money affordance, not surface as a confusing
  // error inside LNURL resolution.
  const rawLud16 = counterpartyMetadata?.lud16;
  const lud16 = rawLud16 && LightningAddress.safeParse(rawLud16).success ? rawLud16 : undefined;
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      messages.map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.isOwn ? '' : m.pubkey,
        sender: m.isOwn ? undefined : displayName,
        timestamp: m.created_at * 1000,
        isOwn: m.isOwn,
        deliveryStatus: m.isOwn ? (m.isSending ? 'sending' : 'sent') : undefined,
        cashuToken: extractCashuToken(m.content) ?? undefined,
      })),
    [messages, displayName]
  );

  const counterpartyAvatar = useMemo(
    () => (
      <Avatar
        state={userPicture ? 'image' : 'fallback'}
        size={32}
        picture={userPicture}
        seed={pubkey}
        name={displayName}
      />
    ),
    [userPicture, pubkey, displayName]
  );

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  }, [onBack]);

  const processedEventIds = useRef<Set<string>>(new Set());

  // Reset processed events when conversation changes.
  useEffect(() => {
    processedEventIds.current.clear();
    setMessages([]);
    setIsLoading(true);
  }, [pubkey]);

  // Seed the mock thread after the pubkey-reset effect so it isn't wiped.
  // Runs after both effects on the same `[pubkey]` change.
  useEffect(() => {
    if (!isMockThread) return;
    const thread = getMockDmThread(pubkey) ?? [];
    setMessages(thread.map((m) => ({ ...m })));
    setIsLoading(false);
  }, [isMockThread, pubkey]);

  // Process NIP-04 DM events - deferred to avoid blocking navigation.
  useEffect(() => {
    if (!dmEvents || !nostrKeys?.pubkey || !nostrKeys?.privateKey || !pubkey) {
      setIsLoading(false);
      return;
    }

    if (dmEvents.length === 0) {
      setIsLoading(false);
      return;
    }

    const newEvents = dmEvents.filter((event) => !processedEventIds.current.has(event.id));

    if (newEvents.length === 0) {
      setIsLoading(false);
      return;
    }

    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const myPubkey = nostrKeys.pubkey;
        const processedMessages = await Promise.all(
          newEvents.map(async (event) => {
            try {
              if (nip04Cache.isKnownFailed(myPubkey, event.id)) {
                processedEventIds.current.add(event.id);
                return null;
              }
              const cached = nip04Cache.get(myPubkey, event.id);
              if (cached !== undefined) {
                event.content = cached;
              } else {
                const counterparty = new NDKUser({ pubkey: pubkey });
                const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);
                await event.decrypt(counterparty, signer);
                nip04Cache.put(myPubkey, event.id, event.content);
              }
              const isOwn = event.pubkey === myPubkey;
              const senderPubkey = isOwn ? myPubkey : event.pubkey;

              processedEventIds.current.add(event.id);

              return {
                id: event.id,
                content: event.content,
                isOwn,
                created_at: event.created_at || 0,
                pubkey: senderPubkey,
              } satisfies DmMessage;
            } catch (error) {
              log.error('user.messages.nip04_decrypt_failed', { error });
              nip04Cache.markFailed(nostrKeys.pubkey, event.id);
              processedEventIds.current.add(event.id);
              return null;
            }
          })
        );

        const validNewMessages = processedMessages.filter(
          (msg): msg is NonNullable<typeof msg> => msg !== null
        );

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const existingContentKeys = new Set(
            prev.map((m) => `${m.content}-${m.created_at}-${m.isOwn}`)
          );

          const uniqueNewMessages = validNewMessages.filter((m) => {
            if (existingIds.has(m.id)) return false;
            const contentKey = `${m.content}-${m.created_at}-${m.isOwn}`;
            if (existingContentKeys.has(contentKey)) return false;
            return true;
          });

          const merged = [...prev, ...uniqueNewMessages];
          return merged.sort((a, b) => a.created_at - b.created_at);
        });
      } catch (error) {
        log.error('user.messages.nip04_process_failed', { error });
      } finally {
        setIsLoading(false);
      }
    });

    return () => handle.cancel();
  }, [dmEvents, nostrKeys?.pubkey, nostrKeys?.privateKey, pubkey]);

  // Process NIP-17 gift-wrapped DM events (already decrypted by unwrapGiftWrap).
  useEffect(() => {
    if (!nostrKeys?.pubkey) return;
    if (unwrappedGiftWrapMessages.length === 0) return;

    const newMessages = unwrappedGiftWrapMessages.filter(
      (dm) => !processedEventIds.current.has(dm.wrapId)
    );

    if (newMessages.length === 0) return;

    const formatted: DmMessage[] = newMessages.map((dm) => {
      processedEventIds.current.add(dm.wrapId);
      const isOwn = dm.senderPubkey === nostrKeys.pubkey;

      return {
        id: dm.wrapId,
        content: dm.content,
        isOwn,
        created_at: dm.created_at,
        pubkey: dm.senderPubkey,
      };
    });

    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const existingContentKeys = new Set(
        prev.map((m) => `${m.content}-${m.created_at}-${m.isOwn}`)
      );

      const uniqueNewMessages = formatted.filter((m) => {
        if (existingIds.has(m.id)) return false;
        const contentKey = `${m.content}-${m.created_at}-${m.isOwn}`;
        if (existingContentKeys.has(contentKey)) return false;
        return true;
      });

      if (uniqueNewMessages.length === 0) return prev;

      const merged = [...prev, ...uniqueNewMessages];
      return merged.sort((a, b) => a.created_at - b.created_at);
    });

    setIsLoading(false);
  }, [unwrappedGiftWrapMessages, nostrKeys?.pubkey]);

  const handleNostrDMSend = useCallback(
    async (text: string) => {
      // Mock thread: append locally and stop. These pubkeys are real npubs the
      // user pasted as demo seeds — publishing here would broadcast actual
      // DMs to those Nostr users.
      if (isMockThread) {
        const timestamp = Math.floor(Date.now() / 1000);
        setMessages((prev) => [
          ...prev,
          {
            id: `demo-dm-local-${timestamp}`,
            content: text,
            isOwn: true,
            created_at: timestamp,
            pubkey: '',
          },
        ]);
        return;
      }
      const dmStart = performance.now();
      log.info('dm.send.start', {
        messageLength: text.length,
        hasNdk: !!ndk,
        hasPubkey: !!pubkey,
      });
      if (!ndk || !nostrKeys?.privateKey || !nostrKeys?.pubkey || !pubkey) {
        log.error('dm.send.missing_data', {
          hasNdk: !!ndk,
          hasPrivateKey: !!nostrKeys?.privateKey,
          hasPubkey: !!pubkey,
        });
        staticPopup('send-message-failed');
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const tempMessageId = `temp-${timestamp}`;

      const optimisticMessage: DmMessage = {
        id: tempMessageId,
        content: text,
        isOwn: true,
        isSending: true,
        created_at: timestamp,
        pubkey: nostrKeys.pubkey,
      };
      setMessages((prev) => [...prev, optimisticMessage]);

      try {
        // Build NIP-17 gift-wrapped DM pair: one for the recipient, one self-copy.
        // Both share the same rumor (with the counterparty in the `p` tag) per NIP-17.
        const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
          content: text,
          senderPrivateKey: nostrKeys.privateKey,
          recipientPublicKey: pubkey,
        });

        const wrapEvent = new NDKEvent(ndk);
        wrapEvent.kind = recipientWrap.kind;
        wrapEvent.content = recipientWrap.content;
        wrapEvent.tags = recipientWrap.tags;
        wrapEvent.created_at = recipientWrap.created_at;
        wrapEvent.pubkey = recipientWrap.pubkey;
        wrapEvent.id = recipientWrap.id;
        wrapEvent.sig = recipientWrap.sig;

        processedEventIds.current.add(wrapEvent.id);

        setMessages((prev) =>
          prev.map((msg) => (msg.id === tempMessageId ? { ...msg, id: wrapEvent.id } : msg))
        );

        await wrapEvent.publish();

        log.info('dm.send.published', {
          eventId: wrapEvent.id,
          duration_ms: Math.round(performance.now() - dmStart),
        });

        // Publish the self-copy so we can retrieve our own sent messages later.
        const selfWrapEvent = new NDKEvent(ndk);
        selfWrapEvent.kind = senderWrap.kind;
        selfWrapEvent.content = senderWrap.content;
        selfWrapEvent.tags = senderWrap.tags;
        selfWrapEvent.created_at = senderWrap.created_at;
        selfWrapEvent.pubkey = senderWrap.pubkey;
        selfWrapEvent.id = senderWrap.id;
        selfWrapEvent.sig = senderWrap.sig;

        processedEventIds.current.add(selfWrapEvent.id);

        await selfWrapEvent.publish().catch((err: unknown) => {
          log.warn('dm.send.self_copy_failed', { error: err });
        });

        log.info('dm.send.complete', {
          eventId: wrapEvent.id,
          total_ms: Math.round(performance.now() - dmStart),
        });

        setMessages((prev) =>
          prev.map((msg) => (msg.id === wrapEvent.id ? { ...msg, isSending: false } : msg))
        );
      } catch (error) {
        log.error('dm.send.failed', { error, total_ms: Math.round(performance.now() - dmStart) });
        setMessages((prev) => prev.filter((msg) => msg.id !== tempMessageId));
        staticPopup('send-message-failed');
      }
    },
    [ndk, nostrKeys?.privateKey, nostrKeys?.pubkey, pubkey, isMockThread]
  );

  const handleSendMoney = useCallback(() => {
    log.debug('user.messages.send_money', {
      lud16,
      userName: counterpartyMetadata?.name,
    });
    if (!lud16 || !counterpartyMetadata) return;

    // Enter through colada's normal Send entrypoint so no-balance
    // and multi-mint selection behavior stays identical to the wallet Send
    // button. The chat-specific fields are carried into amount entry so the
    // Lightning variant remains available at Next time.
    void (machine as SendMoneyPaymentMachine).startSendEcash({
      reset: true,
      meltTarget: lud16,
      recipientPubkey: pubkey,
    });
  }, [counterpartyMetadata, lud16, machine, pubkey]);

  return (
    <Screen name="UserMessagesScreen" scroll="none">
      <DmChatHeader pubkey={pubkey} onBack={handleBack} />
      <ChatScreen
        surface={SURFACE}
        log={chatLog}
        messages={bubbleMessages}
        onSend={handleNostrDMSend}
        composerPlaceholder="Write here"
        composerActions={
          lud16 ? (
            <Button
              text="Send money"
              variant="primary"
              size="compact"
              icon={<Icon name="mingcute:lightning-fill" size={16} color={background} />}
              onPress={handleSendMoney}
            />
          ) : null
        }
        // contentBottomPadding={16}
        counterpartyAvatar={counterpartyAvatar}
        isLoading={isLoading}
        loadingContent={
          <Text size={16} style={{ color: shade400, textAlign: 'center', paddingTop: 50 }}>
            Loading messages...
          </Text>
        }
        emptyContent={
          <Text size={16} style={{ color: shade400 }}>
            No messages yet. Start the conversation!
          </Text>
        }
        historyExtras={(last) => ({
          lastIsOwn: last?.isOwn ?? null,
          lastDeliveryStatus: last?.deliveryStatus ?? null,
        })}
      />
    </Screen>
  );
}
