/**
 * @fileoverview "Share My Signer" — bunker:// pairing QR + secret management
 *
 * Every focus mints a FRESH one-time secret (single-use, 10-min TTL, ≤8
 * outstanding in SecureStore) and renders it as a `bunker://` QR advertising
 * the default signer relays. Focus also raises the requests-store hot flag so
 * the engine warms up and can answer the incoming `connect` immediately; blur
 * releases it (the service hook keeps running if real connections exist).
 *
 * "Rotate Secret" clears every outstanding secret then mints anew — old links
 * stop working for NEW connections, while already-paired apps are unaffected
 * (they no longer need a secret), which is exactly the confirm copy's claim.
 *
 * The bunker URI embeds the bearer secret: render + clipboard only, never
 * logged. Relay rows list the default signer relay set the QR advertises; they
 * deliberately assert no live connection state, since the dedicated signer pool
 * may not have dialed yet (or may be offline) at the moment the QR is shown — a
 * green "Connected" badge there would be misleading exactly when it matters.
 */

import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { Button as HerouiButton, ListGroup, Separator } from 'heroui-native';
import QRCode from 'react-native-qrcode-svg';

import Icon from 'assets/icons';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { clearSecrets, mintSecret } from '@/features/nostrSigner/lib/bunkerSecrets';
import { buildBunkerUri } from '@/features/nostrSigner/lib/nip46Uri';
import { LoadingIndicator } from '@/shared/blocks/status';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { nostrLog } from '@/shared/lib/logger';
import { popup } from '@/shared/lib/popup';
import { relays as defaultSignerRelays } from '@/shared/ndk';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';

const QR_SIZE = 220;

// ── Copy ────────────────────────────────────────────────────────

const SCREEN_TITLE = 'Share Remote Login';
const COPY_LINK_LABEL = 'Copy Link';
const RELAYS_SECTION_TITLE = 'Relays';
const SECRET_SECTION_TITLE = 'Secret';
const SECRET_BODY =
  'This link contains a one-time secret. It can connect one app and expires after 10 minutes.';
const ROTATE_SECRET_LABEL = 'Rotate Secret';
const ROTATE_CONFIRM_TITLE = 'Rotate Secret?';
const ROTATE_CONFIRM_BODY =
  'Apps connected with the old link keep working. Only new connections need the new link.';
const MINT_FAILED_MESSAGE = "Couldn't create a connection link.";
const TRY_AGAIN_LABEL = 'Try Again';

type ShareState = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'error' };

export function ShareSignerScreen(): React.ReactElement {
  useScreenOptions(() => ({ title: SCREEN_TITLE }), []);
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);
  const { keys } = useNostrKeysContext();
  const [state, setState] = useState<ShareState>({ status: 'loading' });

  const regenerate = (rotate: boolean) => {
    const pubkey = keys?.pubkey;
    if (pubkey === undefined) return; // keys still deriving — refires below
    setState({ status: 'loading' });
    const minted = rotate
      ? clearSecrets(pubkey).andThen(() => mintSecret(pubkey))
      : mintSecret(pubkey);
    void minted.match(
      (secret) => {
        setState({
          status: 'ready',
          uri: buildBunkerUri({
            signerPubkey: pubkey,
            relays: [...defaultSignerRelays],
            secret,
          }),
        });
      },
      (error) => {
        // Error type only — the secret is a bearer credential.
        nostrLog.error('nostr.signer.share_mint_failed', { error: error.type });
        setState({ status: 'error' });
      }
    );
  };

  // Fresh secret on every focus; hot engine while visible so the incoming
  // `connect` is answered without a cold start. The callback identity changes
  // when keys finish deriving, which re-runs the focus effect — that is the
  // keys-arrived-while-focused path.
  useFocusEffect(() => {
    useNip46RequestsStore.getState().setServiceHotRequested(true);
    regenerate(false);
    return () => {
      useNip46RequestsStore.getState().setServiceHotRequested(false);
    };
  });

  const copyLink = useSingleFlight(async () => {
    if (state.status !== 'ready') return;
    await Clipboard.setStringAsync(state.uri);
    popup({ message: 'Copied', type: 'success', variant: 'toast', duration: 1500 });
  });

  const confirmRotate = () => {
    popup({
      message: ROTATE_CONFIRM_TITLE,
      text: ROTATE_CONFIRM_BODY,
      buttons: [{ text: ROTATE_SECRET_LABEL, onPress: () => regenerate(true) }, { text: 'Cancel' }],
    });
  };

  return (
    <Screen name="ShareSignerScreen">
      {/* QR pinned dark-on-white regardless of theme — scanners are strict
          and an inverted (light-on-dark) render is unreliable. Recipe from
          SettingsKeyringScreen. */}
      <View className="items-center pt-2">
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backgroundColor: INVARIANT_WHITE,
            borderRadius: 16,
          }}>
          {state.status === 'ready' ? (
            <QRCode
              value={state.uri}
              size={QR_SIZE}
              color={INVARIANT_BLACK}
              backgroundColor={INVARIANT_WHITE}
            />
          ) : (
            <View
              style={{
                width: QR_SIZE,
                height: QR_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {state.status === 'loading' ? (
                <LoadingIndicator size={28} phase="loading" color={INVARIANT_BLACK} />
              ) : (
                <Icon name="mdi:alert-circle-outline" size={32} color={INVARIANT_BLACK} />
              )}
            </View>
          )}
        </View>
      </View>
      {state.status === 'error' ? (
        <VStack align="center" spacing={10} className="px-5 pt-4">
          <Text size={14} color={danger} style={{ textAlign: 'center' }}>
            {MINT_FAILED_MESSAGE}
          </Text>
          <HerouiButton
            variant="secondary"
            size="sm"
            onPress={() => regenerate(false)}
            accessibilityLabel={TRY_AGAIN_LABEL}>
            <Icon name="mdi:refresh" size={16} color={muted} />
            <HerouiButton.Label style={{ color: muted }}>{TRY_AGAIN_LABEL}</HerouiButton.Label>
          </HerouiButton>
        </VStack>
      ) : (
        <View className="px-5 pt-4">
          <HerouiButton
            variant="secondary"
            isDisabled={state.status !== 'ready'}
            onPress={() => void copyLink()}
            accessibilityLabel={COPY_LINK_LABEL}>
            <Icon name="lets-icons:copy" size={16} color={muted} />
            <HerouiButton.Label style={{ color: muted }}>{COPY_LINK_LABEL}</HerouiButton.Label>
          </HerouiButton>
        </View>
      )}
      <Section title={RELAYS_SECTION_TITLE}>
        <ListGroup variant="secondary">
          {defaultSignerRelays.map((relay, index) => (
            <React.Fragment key={relay}>
              {index > 0 ? <Separator className="mx-4" /> : null}
              <ListRow
                iconCircle={{ icon: 'mdi:broadcast', color: muted, size: 40 }}
                title={relay.replace(/^wss:\/\//, '')}
                accessibilityLabel={relay}
              />
            </React.Fragment>
          ))}
        </ListGroup>
      </Section>
      <Section title={SECRET_SECTION_TITLE}>
        <ListGroup variant="secondary">
          <View className="p-4" style={{ gap: 12 }}>
            <Text size={13} color={muted} style={{ lineHeight: 19 }}>
              {SECRET_BODY}
            </Text>
            <HerouiButton
              variant="secondary"
              size="sm"
              isDisabled={state.status === 'loading'}
              onPress={confirmRotate}
              accessibilityLabel={ROTATE_SECRET_LABEL}>
              <Icon name="mdi:shield-refresh" size={16} color={foreground} />
              <HerouiButton.Label>{ROTATE_SECRET_LABEL}</HerouiButton.Label>
            </HerouiButton>
          </View>
        </ListGroup>
      </Section>
      <Spacer size={32} />
    </Screen>
  );
}
