/**
 * @fileoverview Direct Messages screen
 *
 * Renders a NIP-17 gift-wrapped DM thread backed by nagg. History is fetched
 * (paginated, scroll-up = older) and decrypted client-side via `useDmThread`; a
 * just-sent message shows instantly via an optimistic echo keyed on the
 * self-copy wrap id, then dedups cleanly when nagg returns it on the next fetch.
 * Used by the standalone, user-flow, and mint-flow `userMessages` route wrappers
 * — `pubkey` is the recipient, validated as a 64-hex Schnorr key at the route
 * boundary. Legacy NIP-04 conversations are no longer surfaced.
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useFocusEffect } from 'expo-router';
import { staticPopup } from '@/shared/lib/popup';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { buildGiftWrappedDMPair } from '@/shared/lib/nostr/nip17';
import { buildNip04DM } from '@/shared/lib/nostr/nip04';
import type { DmProtocol } from '@/features/payments/data/dmDecryptPipeline';

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
import { useDmThread } from '@/features/payments/hooks/useDmThread';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { chatLog, log, useLifecycleLogger } from '@/shared/lib/logger';
import { LightningAddress } from '@sovranbitcoin/schemas';
import { Screen } from '@/shared/ui/composed/Screen';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
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
  /** Which Nostr DM protocol this thread uses. Threads are per-protocol. */
  protocol?: DmProtocol;
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

export function UserMessagesScreen({
  pubkey,
  protocol = 'nip17',
  onBack,
}: UserMessagesScreenProps) {
  useLifecycleLogger('UserMessagesScreen');

  const [shade400, background] = useThemeColor(['shade-400', 'background'] as const);
  const { keys: nostrKeys } = useNostrKeysContext();
  const { ndk } = useNDK();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });

  // Mock-mode short-circuit: if this DM is with one of the demo contacts,
  // serve the seeded thread and disable the server fetch / publish. These
  // pubkeys are real npubs the user pasted as demo seeds.
  const mockMode = useSettingsStore((s) => s.mockMode);
  const isMockThread = mockMode && isMockContactPubkey(pubkey);

  // Counterparty kind-0 metadata is served from the shared SWR cache. First
  // open of a conversation per session pays one round-trip; subsequent opens
  // are instant (the cache is shared across surfaces + persisted).
  const { metadata: counterpartyMetadata } = useNostrProfileMetadata(pubkey);

  // Server-backed thread history (paginated, NIP-17 only). Mock threads serve
  // from local state, so the hook is disabled with an empty counterparty.
  const {
    messages: threadMessages,
    loading: threadLoading,
    hasMore,
    loadMore,
    refresh,
    error: threadError,
  } = useDmThread(isMockThread ? '' : pubkey, nostrKeys?.pubkey, nostrKeys?.privateKey, protocol);

  // Local messages = optimistic sent echoes (real threads) OR the seeded mock
  // thread. Echoes are keyed on the self-copy wrap id so they dedup against the
  // server copy nagg later returns.
  const [localMessages, setLocalMessages] = useState<DmMessage[]>([]);

  // Reset local state when the conversation changes.
  useEffect(() => {
    setLocalMessages([]);
  }, [pubkey]);

  // Seed the mock thread (after the reset effect on the same [pubkey] change).
  useEffect(() => {
    if (!isMockThread) return;
    const thread = getMockDmThread(pubkey) ?? [];
    setLocalMessages(thread.map((m) => ({ ...m })));
  }, [isMockThread, pubkey]);

  // Pull anything that landed while we were away (incoming arrives on nagg's
  // next index, not via a live sub). Skip the first focus — the hook already
  // fetched on mount — and only re-fetch on RE-focus.
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (isMockThread) return;
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      refresh();
    }, [isMockThread, refresh])
  );

  // Merge server history with optimistic echoes (deduped by id). Once nagg
  // returns the self-copy of an echoed message (same wrap id), the echo drops.
  const messages = useMemo<DmMessage[]>(() => {
    if (isMockThread) return localMessages;
    const serverIds = new Set(threadMessages.map((m) => m.id));
    const server: DmMessage[] = threadMessages.map((m) => ({
      id: m.id,
      content: m.content,
      isOwn: m.isOwn,
      created_at: m.createdAt,
      pubkey: m.senderPubkey,
    }));
    const pending = localMessages.filter((m) => !serverIds.has(m.id));
    return [...server, ...pending].sort((a, b) => a.created_at - b.created_at);
  }, [isMockThread, threadMessages, localMessages]);

  const isLoading = !isMockThread && threadLoading && messages.length === 0;

  const displayName = resolveIdentityName({ pubkey, nostrProfile: counterpartyMetadata });
  const userPicture = counterpartyMetadata?.picture;
  // lud16 is relay-supplied kind:0 metadata — validate the `name@host` shape
  // before plumbing it into router params / colada. A malformed value should
  // hide the Send Money affordance, not surface as a confusing error inside
  // LNURL resolution.
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

  const handleNostrDMSend = useCallback(
    async (text: string) => {
      // Mock thread: append locally and stop. Publishing here would broadcast
      // actual DMs to the real npubs seeded as demo contacts.
      if (isMockThread) {
        const timestamp = Math.floor(Date.now() / 1000);
        setLocalMessages((prev) => [
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
      const myPubkey = nostrKeys?.pubkey;
      const myPrivateKey = nostrKeys?.privateKey;
      if (!ndk || !myPrivateKey || !myPubkey || !pubkey) {
        log.error('dm.send.missing_data', {
          hasNdk: !!ndk,
          hasPrivateKey: !!myPrivateKey,
          hasPubkey: !!pubkey,
        });
        staticPopup('send-message-failed');
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);

      // NIP-04 (legacy): a single signed kind-4 event authored by us and
      // addressed to the recipient via a `p` tag. No gift wrap / self-copy —
      // nagg re-fetches our sent copy via the `authors` filter, so the echo
      // dedups on its event id.
      if (protocol === 'nip04') {
        let nip04EchoId: string | undefined;
        try {
          const dm = buildNip04DM({
            content: text,
            senderPrivateKey: myPrivateKey,
            recipientPublicKey: pubkey,
          });
          nip04EchoId = dm.id;
          setLocalMessages((prev) => [
            ...prev,
            {
              id: dm.id,
              content: text,
              isOwn: true,
              isSending: true,
              created_at: timestamp,
              pubkey: myPubkey,
            },
          ]);

          const event = new NDKEvent(ndk);
          event.kind = dm.kind;
          event.content = dm.content;
          event.tags = dm.tags;
          event.created_at = dm.created_at;
          event.pubkey = dm.pubkey;
          event.id = dm.id;
          event.sig = dm.sig;
          await event.publish();

          log.info('dm.send.complete', {
            eventId: dm.id,
            protocol: 'nip04',
            total_ms: Math.round(performance.now() - dmStart),
          });
          setLocalMessages((prev) =>
            prev.map((msg) => (msg.id === nip04EchoId ? { ...msg, isSending: false } : msg))
          );
        } catch (error) {
          log.error('dm.send.failed', {
            error,
            protocol: 'nip04',
            total_ms: Math.round(performance.now() - dmStart),
          });
          setLocalMessages((prev) => prev.filter((msg) => msg.id !== nip04EchoId));
          staticPopup('send-message-failed');
        }
        return;
      }

      let echoId: string | undefined;
      try {
        // Build NIP-17 gift-wrapped DM pair: one for the recipient, one self-copy.
        const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
          content: text,
          senderPrivateKey: myPrivateKey,
          recipientPublicKey: pubkey,
        });

        // Optimistic echo keyed on the SELF-COPY wrap id — that's the id nagg
        // returns for our own sent message (the self-copy lands in our inbox),
        // so the server copy dedups this echo on the next fetch with no double.
        echoId = senderWrap.id;
        setLocalMessages((prev) => [
          ...prev,
          {
            id: senderWrap.id,
            content: text,
            isOwn: true,
            isSending: true,
            created_at: timestamp,
            pubkey: myPubkey,
          },
        ]);

        const wrapEvent = new NDKEvent(ndk);
        wrapEvent.kind = recipientWrap.kind;
        wrapEvent.content = recipientWrap.content;
        wrapEvent.tags = recipientWrap.tags;
        wrapEvent.created_at = recipientWrap.created_at;
        wrapEvent.pubkey = recipientWrap.pubkey;
        wrapEvent.id = recipientWrap.id;
        wrapEvent.sig = recipientWrap.sig;

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

        await selfWrapEvent.publish().catch((err: unknown) => {
          log.warn('dm.send.self_copy_failed', { error: err });
        });

        log.info('dm.send.complete', {
          eventId: wrapEvent.id,
          total_ms: Math.round(performance.now() - dmStart),
        });

        setLocalMessages((prev) =>
          prev.map((msg) => (msg.id === echoId ? { ...msg, isSending: false } : msg))
        );
      } catch (error) {
        log.error('dm.send.failed', { error, total_ms: Math.round(performance.now() - dmStart) });
        setLocalMessages((prev) => prev.filter((msg) => msg.id !== echoId));
        staticPopup('send-message-failed');
      }
    },
    [ndk, nostrKeys?.privateKey, nostrKeys?.pubkey, pubkey, isMockThread, protocol]
  );

  const handleSendMoney = useCallback(() => {
    log.debug('user.messages.send_money', {
      lud16,
      userName: counterpartyMetadata?.name,
    });
    if (!lud16 || !counterpartyMetadata) return;

    // Enter through colada's normal Send entrypoint so no-balance and
    // multi-mint selection behavior stays identical to the wallet Send button.
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
        onStartReached={hasMore ? loadMore : undefined}
        onStartReachedThreshold={0.3}
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
        counterpartyAvatar={counterpartyAvatar}
        isLoading={isLoading}
        loadingContent={
          <Text size={16} style={{ color: shade400, textAlign: 'center', paddingTop: 50 }}>
            Loading messages...
          </Text>
        }
        emptyContent={
          <Text size={16} style={{ color: shade400, textAlign: 'center' }}>
            {threadError
              ? "Couldn't load messages. Pull to refresh or try again."
              : 'No messages yet. Start the conversation!'}
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
