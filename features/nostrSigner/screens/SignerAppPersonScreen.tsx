/**
 * @fileoverview Per-person decrypt access for ONE connected app
 *
 * Opened from the Private Data people list. Shows who this person is
 * (kind-0 cache + nagg fallback), whether the app may decrypt conversations
 * with them without asking (persistent grant switch), any active temporary
 * access (session grants — until the signer restarts), and a Danger-Zone
 * styled Revoke that clears both.
 *
 * Route params: `clientPubkey` + `peer` (both 64-hex).
 */

import React, { useCallback, useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ListGroup, PressableFeedback, Switch as HeroSwitch } from 'heroui-native';
import { z } from 'zod';

import Icon from 'assets/icons';
import { shortPubkey } from '@/features/nostrSigner/components/display';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { useNostrPersonDisplay } from '@/shared/hooks/useNostrPersonDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nostrLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { popup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const ALLOW_TITLE = 'Allow decrypting messages';
const ALLOW_DESCRIPTION = 'Decrypt without asking, for this person only.';
const TEMPORARY_TITLE = 'Temporary access';
const TEMPORARY_DESCRIPTION = 'This session — until Sovran restarts';
const REVOKE_TITLE = 'Revoke Access';
const REVOKED_TOAST = 'Access revoked';

const ParamsSchema = z.object({
  clientPubkey: z.string().refine(isNostrPubkeyHex),
  peer: z.string().refine(isNostrPubkeyHex),
});

export function SignerAppPersonScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ clientPubkey?: string; peer?: string }>();
  const parsed = ParamsSchema.safeParse(params);
  const clientPubkey = parsed.success ? parsed.data.clientPubkey : undefined;
  const peer = parsed.success ? parsed.data.peer.toLowerCase() : undefined;

  const app = useNip46ConnectionsStore((s) =>
    clientPubkey === undefined ? undefined : s.apps[clientPubkey]
  );
  const setPeerDecryptGrant = useNip46ConnectionsStore((s) => s.setPeerDecryptGrant);
  const revokePeerDecryptGrant = useNip46ConnectionsStore((s) => s.revokePeerDecryptGrant);
  const revokeSessionGrant = useNip46RequestsStore((s) => s.revokeSessionGrant);
  const sessionGrants = useNip46RequestsStore((s) => s.sessionGrants);

  const person = useNostrPersonDisplay(peer);
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);

  const hasSessionAccess = useMemo(
    () =>
      clientPubkey !== undefined &&
      peer !== undefined &&
      sessionGrants.some((g) => g.clientPubkey === clientPubkey && g.peerPubkey === peer),
    [sessionGrants, clientPubkey, peer]
  );

  const hasPersistentGrant = peer !== undefined && app?.peerDecryptGrants[peer] !== undefined;

  const onToggleAllow = useCallback(
    (selected: boolean) => {
      if (clientPubkey === undefined || peer === undefined) return;
      if (!selected) {
        revokePeerDecryptGrant(clientPubkey, peer);
        return;
      }
      let failed = 0;
      for (const method of ['nip04_decrypt', 'nip44_decrypt'] as const) {
        const result = setPeerDecryptGrant(clientPubkey, peer, method, { peerIsSelf: false });
        if (result.isErr()) failed += 1;
      }
      if (failed > 0) {
        nostrLog.warn('nostr.signer.app_person.grant_failed', { failed });
      }
    },
    [clientPubkey, peer, setPeerDecryptGrant, revokePeerDecryptGrant]
  );

  const revokeAll = useCallback(() => {
    if (clientPubkey === undefined || peer === undefined) return;
    revokePeerDecryptGrant(clientPubkey, peer);
    revokeSessionGrant(clientPubkey, undefined, peer);
    popup({ message: REVOKED_TOAST, type: 'success', variant: 'toast', duration: 1500 });
    router.back();
  }, [clientPubkey, peer, revokePeerDecryptGrant, revokeSessionGrant]);

  if (clientPubkey === undefined || peer === undefined || app === undefined) {
    return (
      <Screen name="SignerAppPersonScreen">
        <View />
      </Screen>
    );
  }

  const name = person.name ?? shortPubkey(peer);

  return (
    <Screen name="SignerAppPersonScreen">
      <VStack spacing={14} className="pb-8 pt-3">
        {/* Person identity */}
        <HStack gap={14} style={{ alignItems: 'center' }}>
          <Avatar
            state={person.picture ? 'image' : 'fallback'}
            picture={person.picture}
            seed={peer}
            fallbackVariant="beam"
            size={64}
            alt={name}
          />
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={18} bold color={foreground} numberOfLines={1}>
              {name}
            </Text>
            <Text size={12} color={muted} numberOfLines={1}>
              {shortPubkey(peer)}
            </Text>
          </VStack>
        </HStack>

        {/* Access */}
        <ListGroup variant="secondary">
          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{ALLOW_TITLE}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{ALLOW_DESCRIPTION}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <HeroSwitch isSelected={hasPersistentGrant} onSelectedChange={onToggleAllow} />
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
          {hasSessionAccess ? (
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{TEMPORARY_TITLE}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{TEMPORARY_DESCRIPTION}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Icon name="mdi:clock-outline" size={18} color={muted} />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          ) : null}
        </ListGroup>

        {/* Danger zone */}
        <Section title="Danger Zone" isDanger>
          <ListGroup variant="secondary">
            <PressableFeedback animation={false} onPress={revokeAll}>
              <PressableFeedback.Scale>
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>
                      <Text style={{ color: danger }}>{REVOKE_TITLE}</Text>
                    </ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="mdi:chevron-right" size={18} color={muted} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          </ListGroup>
        </Section>
      </VStack>
    </Screen>
  );
}
