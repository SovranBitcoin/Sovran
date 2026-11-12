import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { Input, ListGroup, Separator, TextField } from 'heroui-native';
import { relayEditCopy as copy } from 'copy/prompts';
import { Section } from '@/shared/ui/composed/Section';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { Badge } from '@/shared/ui/primitives/Badge';
import type { RelayHealth } from '@/shared/hooks/useRelayHealth';
import { Switch } from '@/shared/ui/primitives/Switch';
import {
  defaultEntries,
  MAX_RELAYS,
  useRelayListStore,
} from '@/shared/lib/nostr/outbox/relayListStore';
import { safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import type { RelayListEntry } from '@/shared/lib/nostr/outbox/nip65';
import {
  beginRelayListEdit,
  type RelayListEditor,
  type RelayListReview,
} from '@/shared/lib/nostr/outbox/publishOwnRelayList';

type State =
  | { kind: 'idle'; message?: string }
  | { kind: 'loading' }
  | { kind: 'waiting'; entries: readonly RelayListEntry[]; message: string }
  | { kind: 'editing'; editor: RelayListEditor; entries: readonly RelayListEntry[] }
  | {
      kind: 'reviewing' | 'publishing';
      editor: RelayListEditor;
      review: RelayListReview;
      message?: string;
    };

export function RelayListSettings({
  ndk,
  pubkey,
  health,
}: {
  ndk: NDK | undefined;
  pubkey: string | undefined;
  health?: Record<string, RelayHealth>;
}) {
  const saved = useRelayListStore((state) => state.entries);
  const source = useRelayListStore((state) => state.source);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const active = useRef<RelayListEditor | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const reset = useCallback(() => {
    generation.current++;
    active.current?.dispose();
    active.current = null;
    busy.current = false;
    setState({ kind: 'idle' });
    setUrl('');
    setError(null);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!ndk || !pubkey) return;
      return reset;
    }, [reset, ndk, pubkey])
  );

  const start = async (proposal?: readonly RelayListEntry[]) => {
    if (!ndk || !pubkey || busy.current) return;
    busy.current = true;
    const started = ++generation.current;
    setState({ kind: 'loading' });
    const result = await beginRelayListEdit(ndk, pubkey);
    if (started !== generation.current) {
      if (result.isOk()) result.value.dispose();
      return;
    }
    busy.current = false;
    if (result.isErr()) {
      setState(
        proposal
          ? { kind: 'waiting', entries: proposal, message: copy.waiting }
          : { kind: 'idle', message: copy.waiting }
      );
      return;
    }
    active.current = result.value;
    setState(
      proposal
        ? {
            kind: 'reviewing',
            editor: result.value,
            review: result.value.review(proposal),
            message: copy.changed,
          }
        : { kind: 'editing', editor: result.value, entries: result.value.base }
    );
  };
  const change = (entries: readonly RelayListEntry[]) => {
    if (state.kind === 'editing') setState({ ...state, entries });
    setError(null);
  };
  const add = () => {
    if (state.kind !== 'editing') return;
    const normalized = safeNormalizeRelay(url.trim());
    if (!normalized || !/^wss?:\/\//.test(normalized)) {
      setError(copy.invalidUrl);
      return;
    }
    if (state.entries.some((entry) => entry.url === normalized)) {
      setUrl('');
      return;
    }
    if (state.entries.length >= MAX_RELAYS) {
      setError(copy.limit(MAX_RELAYS));
      return;
    }
    change([...state.entries, { url: normalized, read: true, write: true }]);
    setUrl('');
  };
  const publish = async () => {
    if (state.kind !== 'reviewing' || busy.current) return;
    busy.current = true;
    const started = generation.current;
    setState({ ...state, kind: 'publishing' });
    const result = await state.review.publish();
    if (started !== generation.current) return;
    busy.current = false;
    if (result.isOk()) {
      state.editor.dispose();
      active.current = null;
      setState({ kind: 'idle', message: copy.success(result.value.accepted) });
    } else if (result.error.type === 'changed') {
      setState({
        kind: 'reviewing',
        editor: state.editor,
        review: state.editor.review(state.review.entries),
        message: copy.changed,
      });
    } else if (result.error.type === 'no-write-relay') {
      setState({ kind: 'editing', editor: state.editor, entries: state.review.entries });
      setError(copy.noWrite);
    } else {
      state.editor.dispose();
      active.current = null;
      setState({ kind: 'waiting', entries: state.review.entries, message: copy.failed });
    }
  };
  const editing = state.kind === 'editing';
  const reviewing = state.kind === 'reviewing' || state.kind === 'publishing';
  const entries =
    editing || state.kind === 'waiting' ? state.entries : reviewing ? state.review.entries : saved;
  return (
    <Section title={reviewing ? copy.reviewTitle : copy.title}>
      <View className="gap-3">
        {state.kind === 'idle' && source === 'local' ? <Text>{copy.pending}</Text> : null}
        {state.kind === 'loading' ? (
          <Text testID="settings-network-relay-loading">{copy.loading}</Text>
        ) : null}
        {'message' in state && state.message ? (
          <Text testID="settings-network-relay-message">{state.message}</Text>
        ) : null}
        {editing ? <Text>{copy.draft}</Text> : null}
        {reviewing ? (
          <RelayChanges review={state.review} />
        ) : (
          <ListGroup variant="secondary">
            {[...entries]
              .sort((a, b) => a.url.localeCompare(b.url))
              .map((entry, index) => (
                <View key={entry.url}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{entry.url}</ListGroup.ItemTitle>
                      {health?.[entry.url] && health[entry.url] !== 'connecting' ? (
                        <Badge
                          variant={health[entry.url] === 'connected' ? 'success' : 'error'}
                          size={11}>
                          {health[entry.url] === 'connected' ? copy.online : copy.offline}
                        </Badge>
                      ) : null}
                      {editing ? (
                        <View className="flex-row items-center gap-3">
                          <Text>{copy.read}</Text>
                          <Switch
                            testID={`settings-network-relay-read-${entry.url}`}
                            accessibilityLabel={copy.readFrom(entry.url)}
                            isSelected={entry.read}
                            onSelectedChange={(read) =>
                              change(entries.map((e) => (e.url === entry.url ? { ...e, read } : e)))
                            }
                          />
                          <Text>{copy.write}</Text>
                          <Switch
                            testID={`settings-network-relay-write-${entry.url}`}
                            accessibilityLabel={copy.writeTo(entry.url)}
                            isSelected={entry.write}
                            onSelectedChange={(write) =>
                              change(
                                entries.map((e) => (e.url === entry.url ? { ...e, write } : e))
                              )
                            }
                          />
                        </View>
                      ) : (
                        <ListGroup.ItemDescription>{permissions(entry)}</ListGroup.ItemDescription>
                      )}
                    </ListGroup.ItemContent>
                    {editing ? (
                      <ListGroup.ItemSuffix>
                        <Button
                          variant="underline"
                          size="compact"
                          text={copy.removed}
                          testID={`settings-network-relay-remove-${entry.url}`}
                          accessibilityLabel={copy.remove(entry.url)}
                          onPress={() => change(entries.filter((e) => e.url !== entry.url))}
                        />
                      </ListGroup.ItemSuffix>
                    ) : null}
                  </ListGroup.Item>
                </View>
              ))}
          </ListGroup>
        )}
        {editing ? (
          <>
            {state.editor.savedProposal ? (
              <>
                <Text>{copy.pending}</Text>
                <RelayButton
                  id="relay-use-saved"
                  label={copy.applySaved}
                  onPress={() => change(state.editor.savedProposal ?? [])}
                />
              </>
            ) : null}
            <TextField>
              <Input
                testID="settings-network-relay-input"
                accessibilityLabel={copy.url}
                value={url}
                onChangeText={setUrl}
                placeholder="wss://relay.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={add}
              />
            </TextField>
            <RelayButton id="relay-add" label={copy.add} onPress={add} />
            <RelayButton
              id="restore-defaults"
              label={copy.defaults}
              onPress={() => change(defaultEntries())}
            />
            <RelayButton
              id="relay-review"
              label={copy.review}
              onPress={() => {
                if (!state.entries.some((entry) => entry.write)) {
                  setError(copy.noWrite);
                  return;
                }
                setState({
                  kind: 'reviewing',
                  editor: state.editor,
                  review: state.editor.review(state.entries),
                });
              }}
            />
          </>
        ) : null}
        {reviewing ? (
          <>
            <RelayButton
              id="publish"
              busy={state.kind === 'publishing'}
              label={state.kind === 'publishing' ? copy.publishing : copy.publish}
              onPress={publish}
              disabled={state.kind === 'publishing'}
            />
            <RelayButton
              id="relay-back"
              label={copy.back}
              onPress={() =>
                setState({ kind: 'editing', editor: state.editor, entries: state.review.entries })
              }
              disabled={state.kind === 'publishing'}
            />
          </>
        ) : null}
        {state.kind === 'idle' ? (
          <RelayButton
            id="relay-edit"
            label={copy.edit}
            onPress={() => start()}
            disabled={!ndk || !pubkey}
          />
        ) : (
          <RelayButton
            id="relay-cancel"
            label={copy.cancel}
            onPress={reset}
            disabled={state.kind === 'publishing'}
          />
        )}
        {state.kind === 'waiting' ? (
          <RelayButton id="relay-reload" label={copy.reload} onPress={() => start(state.entries)} />
        ) : null}
        {error ? <Text testID="settings-network-relay-error">{error}</Text> : null}
      </View>
    </Section>
  );
}

function permissions(entry: RelayListEntry) {
  return (
    [entry.read ? copy.read : '', entry.write ? copy.write : ''].filter(Boolean).join(', ') ||
    copy.neither
  );
}
function RelayChanges({ review }: { review: RelayListReview }) {
  const urls = [...new Set([...review.base, ...review.entries].map((entry) => entry.url))].sort();
  const changes = urls.flatMap((url) => {
    const before = review.base.find((entry) => entry.url === url);
    const after = review.entries.find((entry) => entry.url === url);
    if (before && after && before.read === after.read && before.write === after.write) return [];
    const label = !before ? copy.added : !after ? copy.removed : copy.permissions;
    return [{ url, label, before, after }];
  });
  return (
    <View testID="settings-network-relay-comparison" accessible className="gap-2">
      {changes.length === 0 ? (
        <Text>{copy.unchanged}</Text>
      ) : (
        changes.map(({ url, label, before, after }) => (
          <ListGroup key={url} variant="secondary">
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>
                  {label}: {url}
                </ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {before ? permissions(before) : copy.neither} →{' '}
                  {after ? permissions(after) : copy.neither}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
            </ListGroup.Item>
          </ListGroup>
        ))
      )}
    </View>
  );
}

function RelayButton({
  id,
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  id: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Button
      testID={`settings-network-${id}`}
      accessibilityLabel={label}
      text={label}
      variant="secondary"
      disabled={disabled}
      loading={busy}
      onPress={onPress}
    />
  );
}
