import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { Button, Card, Input, Label, ListGroup, Separator, Switch, TextField } from 'heroui-native';
import { npubEncode } from 'nostr-tools/nip19';
import { Screen } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { useModerationActions } from '@/features/feed/hooks/useModerationActions';
import { popup } from '@/shared/lib/popup';

function BlockedPerson({
  pubkey,
  pending,
  blocked,
  onChange,
}: {
  pubkey: string;
  pending: boolean;
  blocked: boolean;
  onChange: (blocked: boolean) => Promise<void>;
}) {
  const { metadata } = useNostrProfileMetadata(pubkey);
  const name = metadata?.displayName || metadata?.name || 'Nostr account';
  const [syncing, setSyncing] = useState(false);
  const retry = async () => {
    if (syncing) return;
    setSyncing(true);
    await onChange(blocked).finally(() => setSyncing(false));
  };
  return (
    <View className="gap-2 px-4 py-3">
      <View className="flex-row items-center gap-3">
        <Avatar
          size={40}
          state={metadata?.picture ? 'image' : 'fallback'}
          picture={metadata?.picture}
          seed={pubkey}
          name={name}
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text size={15} medium numberOfLines={1}>
            {name}
          </Text>
          <Text
            size={12}
            className="text-muted"
            numberOfLines={1}
            ellipsizeMode="middle"
            selectable>
            {npubEncode(pubkey)}
          </Text>
        </View>
        {blocked && (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => onChange(false)}
            testID={`moderation-unblock-${pubkey}`}
            accessibilityLabel={`Unblock ${name}`}>
            <Button.Label>Unblock</Button.Label>
          </Button>
        )}
      </View>
      {pending && (
        <View className="flex-row items-center gap-2">
          <Text size={12} className="text-muted flex-1">
            {blocked
              ? 'Blocked on this device. Not synced yet.'
              : 'Unblocked on this device. Not synced yet.'}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            testID={`moderation-retry-${pubkey}`}
            onPress={retry}
            isDisabled={syncing}>
            <Button.Label>{syncing ? 'Syncing…' : 'Retry sync'}</Button.Label>
          </Button>
        </View>
      )}
    </View>
  );
}

export function SettingsModerationScreen() {
  const people = useFeedIgnoreStore((s) => s.ignoredPubkeys);
  const overrides = useFeedIgnoreStore((s) => s.blockOverrides);
  const enabled = useFeedIgnoreStore((s) => s.dmFilterEnabled);
  const words = useFeedIgnoreStore((s) => s.dmFilterWords);
  const setEnabled = useFeedIgnoreStore((s) => s.setDmFilterEnabled);
  const setWords = useFeedIgnoreStore((s) => s.setDmFilterWords);
  const [draft, setDraft] = useState(words.join('\n'));
  const [refreshing, setRefreshing] = useState(false);
  const { block, refresh } = useModerationActions();
  const pendingUnblocks = Object.keys(overrides).filter((pubkey) => !overrides[pubkey]);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await refresh().finally(() => setRefreshing(false));
  };
  const saveWords = () => {
    setWords(draft);
    setDraft(useFeedIgnoreStore.getState().dmFilterWords.join('\n'));
    popup({ message: 'Filtered words saved', type: 'success', variant: 'toast' });
  };
  return (
    <Screen name="SettingsModerationScreen" scroll="custom" safeArea>
      <ScreenScrollView
        className="px-4"
        bottomSpacing={32}
        testID="moderation-scroll"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            testID="moderation-refresh"
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }>
        <Section title="Blocked people">
          <ListGroup variant="secondary">
            {people.length === 0 ? (
              <ListGroup.Item>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>No blocked people</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    You can block someone from their profile, messages, or a post’s menu.
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            ) : (
              people.map((pubkey, index) => (
                <React.Fragment key={pubkey}>
                  {index > 0 && <Separator className="mx-4" />}
                  <BlockedPerson
                    pubkey={pubkey}
                    blocked
                    pending={overrides[pubkey] === true}
                    onChange={(value) => block(pubkey, value)}
                  />
                </React.Fragment>
              ))
            )}
          </ListGroup>
          <Text size={13} className="text-muted mt-2 px-3">
            Blocking takes effect immediately and syncs automatically with your Nostr account. If
            syncing fails, the block stays active on this device. Use Retry sync to try again.
            Blocked people can still see your public posts.
          </Text>
        </Section>
        {pendingUnblocks.length > 0 && (
          <Section title="Waiting to sync">
            <ListGroup variant="secondary">
              {pendingUnblocks.map((pubkey, index) => (
                <React.Fragment key={pubkey}>
                  {index > 0 && <Separator className="mx-4" />}
                  <BlockedPerson
                    pubkey={pubkey}
                    blocked={false}
                    pending
                    onChange={(value) => block(pubkey, value)}
                  />
                </React.Fragment>
              ))}
            </ListGroup>
          </Section>
        )}
        <Section title="Message filter">
          <ListGroup variant="secondary">
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Hide messages with filtered words</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Matching incoming messages stay hidden until you choose to reveal them.
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Switch
                  testID="moderation-filter-toggle"
                  accessibilityValue={{ text: enabled ? '1' : '0' }}
                  accessibilityLabel="Hide messages with filtered words"
                  isSelected={enabled}
                  onSelectedChange={setEnabled}
                />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
          {enabled && (
            <Card variant="secondary" className="mt-3">
              <Card.Body className="gap-3">
                <TextField>
                  <Label>Filtered words</Label>
                  <Input
                    testID="moderation-filter-words"
                    accessibilityLabel="Filtered words, one per line"
                    multiline
                    numberOfLines={5}
                    className="min-h-32"
                    textAlignVertical="top"
                    maxLength={10_100}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="One word or phrase per line"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </TextField>
                <Text size={13} className="text-muted">
                  Add up to 100 words or phrases. Matches ignore capitals and include parts of
                  words. Images aren’t checked.
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  testID="moderation-filter-save"
                  onPress={saveWords}
                  isDisabled={draft === words.join('\n')}>
                  <Button.Label>Save words</Button.Label>
                </Button>
              </Card.Body>
            </Card>
          )}
          <Text size={13} className="text-muted mt-2 px-3">
            This filter is off by default. Your words stay on this device, separately for each
            account.
          </Text>
        </Section>
      </ScreenScrollView>
    </Screen>
  );
}
