import { Children, useCallback, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { Input, ListGroup, PressableFeedback, Separator, TextField } from 'heroui-native';
import { relayEditCopy as copy } from 'copy/prompts';
import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuPopup } from '@/shared/lib/popup';
import { urlHostLabel } from '@/shared/lib/url';
import { Notice } from '@/shared/ui/composed/Notice';
import { Section } from '@/shared/ui/composed/Section';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import type { RelayHealth } from '@/shared/hooks/useRelayHealth';
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
  const setPermissions = (url: string, read: boolean, write: boolean) =>
    change(entries.map((e) => (e.url === url ? { ...e, read, write } : e)));
  // One menu per relay while editing, in place of two switches and a Remove link.
  const openRelayMenu = (entry: RelayListEntry) =>
    actionMenuPopup({
      title: urlHostLabel(entry.url),
      buttons: [
        {
          text: copy.readWrite,
          testID: `settings-network-relay-read-write-${entry.url}`,
          selected: entry.read && entry.write,
          onPress: () => setPermissions(entry.url, true, true),
        },
        {
          text: copy.readOnly,
          testID: `settings-network-relay-read-${entry.url}`,
          selected: entry.read && !entry.write,
          onPress: () => setPermissions(entry.url, true, false),
        },
        {
          text: copy.writeOnly,
          testID: `settings-network-relay-write-${entry.url}`,
          selected: !entry.read && entry.write,
          onPress: () => setPermissions(entry.url, false, true),
        },
        {
          text: copy.removed,
          testID: `settings-network-relay-remove-${entry.url}`,
          accessibilityLabel: copy.remove(entry.url),
          variant: 'dangerous',
          separator: true,
          onPress: () => change(entries.filter((e) => e.url !== entry.url)),
        },
      ],
    });
  const notice =
    state.kind === 'loading'
      ? { text: copy.loading, testID: 'settings-network-relay-loading' }
      : 'message' in state && state.message
        ? { text: state.message, testID: 'settings-network-relay-message' }
        : null;
  return (
    <Section title={reviewing ? copy.reviewTitle : copy.title}>
      <View className="gap-3">
        {state.kind === 'idle' && source === 'local' ? (
          <Notice status="info" description={copy.pending} />
        ) : null}
        {notice ? <Notice status="info" description={notice.text} testID={notice.testID} /> : null}
        {editing ? <Notice status="info" description={copy.draft} /> : null}
        {reviewing ? (
          <RelayChanges review={state.review} />
        ) : (
          <ListGroup variant="secondary">
            {[...entries]
              .sort((a, b) => a.url.localeCompare(b.url))
              .map((entry, index) => (
                <View key={entry.url}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <RelayRow
                    entry={entry}
                    health={health?.[entry.url]}
                    onOpenMenu={editing ? () => openRelayMenu(entry) : undefined}
                  />
                </View>
              ))}
          </ListGroup>
        )}
        {editing ? (
          <>
            {state.editor.savedProposal ? (
              <>
                <Notice status="info" description={copy.pending} />
                <RelayButton
                  id="relay-use-saved"
                  label={copy.applySaved}
                  onPress={() => change(state.editor.savedProposal ?? [])}
                />
              </>
            ) : null}
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
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
              </View>
              <RelayButton id="relay-add" label={copy.add} onPress={add} size="compact" />
            </View>
            {error ? (
              <Notice status="warning" description={error} testID="settings-network-relay-error" />
            ) : null}
            <RelayButton
              id="relay-review"
              label={copy.review}
              variant="primary"
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
            <ButtonPair>
              <RelayButton
                id="restore-defaults"
                label={copy.defaults}
                onPress={() => change(defaultEntries())}
              />
              <RelayButton id="relay-cancel" label={copy.cancel} onPress={reset} />
            </ButtonPair>
          </>
        ) : null}
        {reviewing ? (
          <>
            <RelayButton
              id="publish"
              variant="primary"
              busy={state.kind === 'publishing'}
              label={state.kind === 'publishing' ? copy.publishing : copy.publish}
              onPress={publish}
              disabled={state.kind === 'publishing'}
            />
            <ButtonPair>
              <RelayButton
                id="relay-back"
                label={copy.back}
                onPress={() =>
                  setState({ kind: 'editing', editor: state.editor, entries: state.review.entries })
                }
                disabled={state.kind === 'publishing'}
              />
              <RelayButton
                id="relay-cancel"
                label={copy.cancel}
                onPress={reset}
                disabled={state.kind === 'publishing'}
              />
            </ButtonPair>
          </>
        ) : null}
        {state.kind === 'idle' ? (
          <RelayButton
            id="relay-edit"
            label={copy.edit}
            onPress={() => start()}
            disabled={!ndk || !pubkey}
          />
        ) : null}
        {state.kind === 'waiting' || state.kind === 'loading' ? (
          <ButtonPair>
            {state.kind === 'waiting' ? (
              <RelayButton
                id="relay-reload"
                label={copy.reload}
                onPress={() => start(state.entries)}
              />
            ) : null}
            <RelayButton id="relay-cancel" label={copy.cancel} onPress={reset} />
          </ButtonPair>
        ) : null}
        {!editing && error ? (
          <Notice status="warning" description={error} testID="settings-network-relay-error" />
        ) : null}
      </View>
    </Section>
  );
}

/**
 * One relay: a health dot, the host, and what the wallet uses it for. While
 * editing the row opens that relay's menu; otherwise it only reads.
 */
function RelayRow({
  entry,
  health,
  onOpenMenu,
}: {
  entry: RelayListEntry;
  health: RelayHealth | undefined;
  onOpenMenu?: () => void;
}) {
  const muted = useThemeColor('muted');
  // Unchecked and still-connecting relays are not called offline.
  const known = health && health !== 'connecting' ? health : undefined;
  const dot = known === 'connected' ? 'bg-success' : known ? 'bg-danger' : 'bg-muted';
  const word = known === 'connected' ? copy.online : known ? copy.offline : undefined;
  const label = [entry.url, permissions(entry), word].filter(Boolean).join(', ');
  const item = (
    <ListGroup.Item disabled={onOpenMenu !== undefined}>
      <ListGroup.ItemPrefix>
        <View
          className={`h-2 w-2 rounded-full ${dot}`}
          testID={`settings-network-relay-dot-${entry.url}`}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{urlHostLabel(entry.url)}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{permissions(entry)}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      {onOpenMenu ? (
        <ListGroup.ItemSuffix>
          <Icon name="tabler:dots" size={20} color={muted} />
        </ListGroup.ItemSuffix>
      ) : null}
    </ListGroup.Item>
  );
  if (!onOpenMenu) {
    return (
      <View accessible accessibilityLabel={label}>
        {item}
      </View>
    );
  }
  return (
    <PressableFeedback
      animation={false}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.options(entry.url)}
      testID={`settings-network-relay-row-${entry.url}`}
      onPress={onOpenMenu}>
      <PressableFeedback.Scale>{item}</PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

/** Secondary actions side by side, sharing the line evenly. */
function ButtonPair({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-2">
      {Children.toArray(children).map((child, index) => (
        <View key={index} className="flex-1">
          {child}
        </View>
      ))}
    </View>
  );
}

function permissions(entry: RelayListEntry) {
  if (entry.read && entry.write) return copy.readWrite;
  if (entry.read) return copy.readOnly;
  if (entry.write) return copy.writeOnly;
  return copy.neither;
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
  variant = 'secondary',
  size,
}: {
  id: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
  size?: 'compact';
}) {
  return (
    <Button
      testID={`settings-network-${id}`}
      accessibilityLabel={label}
      text={label}
      variant={variant}
      size={size}
      disabled={disabled}
      loading={busy}
      onPress={onPress}
    />
  );
}
