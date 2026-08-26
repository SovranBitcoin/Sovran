/**
 * Optional ecash memo sheet. This intentionally uses the custom-sheet lane
 * instead of `actionMenuPopup` so it stacks above send-flow route modals.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  type KeyboardEvent,
  type ScrollViewProps,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from 'assets/icons';
import { Button } from '@/shared/ui/primitives/Button';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { ContactRow, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { List } from '@/shared/ui/composed/List';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { relays as defaultRelays } from '@/shared/ndk';
import {
  CONTACT_SEARCH_MIN_LENGTH,
  useContactSearch,
  type DisplayResult,
} from '@/features/payments/hooks/useContactSearch';

import { showActionSheet } from './bridge';
import {
  createMemoMentionNprofile,
  findActiveMemoMention,
  insertMemoMentionProfile,
  reconcileMemoMentionEntities,
  serializeMemoWithMentions,
  type MemoMentionEntity,
} from './sendMemoMention';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

const MENTION_PANEL_MIN_HEIGHT = 180;
const MENTION_PANEL_KEYBOARD_MIN_HEIGHT = 120;
const MENTION_SHEET_VERTICAL_RESERVE = 72;
const MENTION_CHROME_FALLBACK_HEIGHT = 96;
const MENTION_PLACEHOLDER_PUBKEYS = Array.from({ length: 4 }, (_, index) => `placeholder-${index}`);

interface SendMemoContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['send-memo'];
}

type MentionSearchResult = DisplayResult & {
  profile: NonNullable<DisplayResult['profile']>;
};
type TextSelection = { start: number; end: number };

function isMentionSearchResult(result: DisplayResult): result is MentionSearchResult {
  return !!result.profile && !!result.pubkey && !result.pubkey.startsWith('placeholder-');
}

const mentionKeyExtractor = (item: MentionSearchResult) => item.pubkey;

function renderMentionScrollComponent(props: ScrollViewProps) {
  // This list is nested inside a fixed-height panel. Avoid BottomSheetScrollView
  // here because its content-size setter can shrink the whole dynamic sheet
  // when the search returns only one or two rows.
  return <GestureScrollView {...props} nestedScrollEnabled />;
}

export function submitSendMemo(
  machine: ActionSheetPayloads['send-memo']['machine'],
  memo: string | undefined
): void {
  Keyboard.dismiss();
  const trimmed = memo?.trim();
  void machine.submitSendMemo(trimmed && trimmed.length > 0 ? trimmed : undefined);
}

export function getSendMemoMentionPanelHeight({
  windowHeight,
  insetTop,
  keyboardHeight,
  chromeHeight,
}: {
  windowHeight: number;
  insetTop: number;
  keyboardHeight: number;
  chromeHeight: number;
}): number {
  const fixedChromeHeight = chromeHeight || MENTION_CHROME_FALLBACK_HEIGHT;
  const visibleWindowHeight = Math.max(0, windowHeight - keyboardHeight);
  const available =
    visibleWindowHeight - insetTop - fixedChromeHeight - MENTION_SHEET_VERTICAL_RESERVE;
  const minHeight =
    keyboardHeight > 0 ? MENTION_PANEL_KEYBOARD_MIN_HEIGHT : MENTION_PANEL_MIN_HEIGHT;
  return Math.max(minHeight, available);
}

export function SendMemoContent({ payload, close }: SendMemoContentProps): React.ReactElement {
  const initialMemo = payload.memo ?? '';
  const inputRef = useRef<React.ElementRef<typeof BottomSheetTextInput> | undefined>(undefined);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [memo, setMemo] = useState(initialMemo);
  const [selection, setSelection] = useState(() => ({
    start: initialMemo.length,
    end: initialMemo.length,
  }));
  const [selectionOverride, setSelectionOverride] = useState<TextSelection | undefined>();
  const [chromeHeight, setChromeHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [mentionEntities, setMentionEntities] = useState<MemoMentionEntity[]>([]);
  const [foreground, background, defaultBg, defaultBorder, accentBorder, placeholder] =
    useThemeColor([
      'foreground',
      'background',
      'default',
      'default',
      'accent',
      'field-placeholder',
    ] as const);
  const [isFocused, setIsFocused] = useState(false);
  const canSubmit = memo.trim().length > 0;
  const mentionToken =
    selection.start === selection.end ? findActiveMemoMention(memo, selection.start) : null;

  const submit = () => {
    if (!canSubmit) return;
    submitSendMemo(payload.machine, serializeMemoWithMentions(memo, mentionEntities));
    close();
  };

  const skip = () => {
    submitSendMemo(payload.machine, undefined);
    close();
  };

  const handleMemoChange = (nextMemo: string) => {
    setMentionEntities((current) => reconcileMemoMentionEntities(memo, nextMemo, current));
    setMemo(nextMemo);
  };

  const handleSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) => {
    setSelection(event.nativeEvent.selection);
    setSelectionOverride(undefined);
  };

  const handleChromeLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setChromeHeight((current) => (Math.abs(current - nextHeight) <= 1 ? current : nextHeight));
  };

  useEffect(() => {
    const onKeyboardShow = (event: KeyboardEvent) => {
      const screenY = event.endCoordinates?.screenY ?? windowHeight;
      setKeyboardHeight(Math.max(0, windowHeight - screenY));
    };
    const onKeyboardHide = () => setKeyboardHeight(0);
    const willShow = Keyboard.addListener('keyboardWillShow', onKeyboardShow);
    const didShow = Keyboard.addListener('keyboardDidShow', onKeyboardShow);
    const willHide = Keyboard.addListener('keyboardWillHide', onKeyboardHide);
    const didHide = Keyboard.addListener('keyboardDidHide', onKeyboardHide);

    return () => {
      willShow.remove();
      didShow.remove();
      willHide.remove();
      didHide.remove();
    };
  }, [windowHeight]);

  const mentionPanelHeight = getSendMemoMentionPanelHeight({
    windowHeight,
    insetTop: insets.top,
    keyboardHeight,
    chromeHeight,
  });

  const insertMention = (result: MentionSearchResult) => {
    if (!mentionToken) return;

    const nprofile = createMemoMentionNprofile(result.pubkey, defaultRelays);
    const displayName = resolveIdentityName({
      pubkey: result.pubkey,
      nostrProfile: result.profile,
    });
    const next = insertMemoMentionProfile(
      memo,
      mentionToken,
      { displayName, nprofile },
      mentionEntities
    );
    const nextSelection = { start: next.cursor, end: next.cursor };
    setMemo(next.value);
    setMentionEntities(next.entities);
    setSelection(nextSelection);
    setSelectionOverride(nextSelection);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: isFocused ? accentBorder : defaultBorder,
      backgroundColor: defaultBg,
      color: foreground,
    },
  ];

  const sendButtonStyle = [
    styles.sendButton,
    {
      backgroundColor: foreground,
      opacity: canSubmit ? 1 : 0.5,
    },
  ];

  const sendIconColor = background;

  return (
    <View>
      <View onLayout={handleChromeLayout}>
        <BottomSheet.Title className="text-foreground -mt-2 mb-1 ml-3 text-lg font-bold">
          Add memo
        </BottomSheet.Title>
        <View style={styles.inputWrap}>
          <BottomSheetTextInput
            ref={inputRef}
            value={memo}
            selection={selectionOverride}
            onChangeText={handleMemoChange}
            onSelectionChange={handleSelectionChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Optional note for recipient"
            placeholderTextColor={placeholder}
            autoCapitalize="sentences"
            autoCorrect
            returnKeyType="send"
            onSubmitEditing={submit}
            style={inputStyle}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send memo"
            testID="send-memo-add"
            haptics
            disabled={!canSubmit}
            onPress={submit}
            style={sendButtonStyle}>
            <Icon name="iconamoon:send-fill" size={21} color={sendIconColor} />
          </Pressable>
        </View>
      </View>
      {mentionToken ? (
        <MentionSearchResults
          query={mentionToken.query}
          height={mentionPanelHeight}
          onSelectResult={insertMention}
        />
      ) : (
        <Button
          text="Skip"
          variant="underline"
          size="compact"
          testID="send-memo-skip"
          accessibilityLabel="Skip memo"
          haptics
          onPress={skip}
          style={styles.skipButton}
        />
      )}
    </View>
  );
}

export function sendMemoPopup(payload: ActionSheetPayloads['send-memo']): void {
  showActionSheet('send-memo', payload);
}

function MentionSearchResults({
  query,
  height,
  onSelectResult,
}: {
  query: string;
  height: number;
  onSelectResult: (result: MentionSearchResult) => void;
}): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const { displayResults, searchLoading, hasSearched } = useContactSearch(query);
  const trimmedQuery = query.trim();
  const rawResults = displayResults.filter(isMentionSearchResult);
  const resultPubkeys = rawResults.map((result) => result.pubkey);
  const { metadata: cachedMetadata } = useNostrProfileMetadataMany(resultPubkeys);
  const results = rawResults.map((result) => {
    const cached = cachedMetadata.get(result.pubkey);
    if (!cached) return result;
    return {
      ...result,
      profile: {
        ...result.profile,
        displayName: cached.displayName ?? result.profile.displayName,
        name: cached.name ?? result.profile.name,
        picture: cached.picture ?? result.profile.picture ?? result.profile.image,
        nip05: cached.nip05 ?? result.profile.nip05,
        banner: cached.banner ?? result.profile.banner,
        lud16: cached.lud16 ?? result.profile.lud16,
        about: cached.about ?? result.profile.about,
        website: cached.website ?? result.profile.website,
      },
    };
  });
  const isShortQuery = trimmedQuery.length > 0 && trimmedQuery.length < CONTACT_SEARCH_MIN_LENGTH;
  const showSkeletons =
    trimmedQuery.length >= CONTACT_SEARCH_MIN_LENGTH &&
    results.length === 0 &&
    (searchLoading || !hasSearched);
  const renderResult = ({ item }: { item: MentionSearchResult }) => (
    <ContactRow
      identity={nostrIdentity(item.pubkey, item.profile)}
      trailingVariant="none"
      onPress={() => onSelectResult(item)}
      testID={`send-memo-mention:${item.pubkey}`}
    />
  );

  let content: React.ReactNode;
  if (trimmedQuery.length === 0) {
    content = (
      <MentionEmptyState
        icon="mdi:at"
        title="Search with @"
        body="Type a name after @ to add someone."
        foreground={foreground}
      />
    );
  } else if (isShortQuery) {
    content = (
      <MentionEmptyState
        icon="mdi:magnify"
        title="Keep typing"
        body={`Enter at least ${CONTACT_SEARCH_MIN_LENGTH} characters to search.`}
        foreground={foreground}
      />
    );
  } else if (showSkeletons) {
    content = (
      <SkeletonContentCrossfade
        loading
        exit="none"
        visualKey="mention-results"
        visualSurface="send-memo"
        renderSkeleton={() => <MentionSkeletonRows />}
        renderContent={() => null}
      />
    );
  } else if (results.length === 0) {
    content = (
      <MentionEmptyState
        icon="mdi:magnify"
        title={`No one matches "${trimmedQuery}"`}
        body="Check the spelling, or try another name."
        foreground={foreground}
      />
    );
  } else {
    content = (
      <List<MentionSearchResult>
        data={results}
        keyExtractor={mentionKeyExtractor}
        renderItem={renderResult}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        style={styles.mentionList}
        contentContainerStyle={styles.mentionListContent}
        renderScrollComponent={renderMentionScrollComponent}
      />
    );
  }

  return (
    <View testID="send-memo-mention-results" style={[styles.mentionPanel, { height }]}>
      {content}
    </View>
  );
}

function MentionSkeletonRows(): React.ReactElement {
  return (
    <View style={styles.mentionSkeletonRows}>
      {MENTION_PLACEHOLDER_PUBKEYS.map((pubkey) => (
        <ContactRow
          key={pubkey}
          identity={nostrIdentity(pubkey, undefined, { isLoadingProfile: true })}
          trailingVariant="none"
        />
      ))}
    </View>
  );
}

function MentionEmptyState({
  icon,
  title,
  body,
  foreground,
}: {
  icon: string;
  title: string;
  body: string;
  foreground: string;
}): React.ReactElement {
  return (
    <View style={styles.mentionEmpty}>
      <Icon name={icon} size={30} color={withAlpha(foreground, 0.3)} />
      <Text size={16} bold style={{ color: withAlpha(foreground, 0.7), textAlign: 'center' }}>
        {title}
      </Text>
      <Text size={14} style={{ color: withAlpha(foreground, 0.5), textAlign: 'center' }}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    paddingHorizontal: 12,
  },
  input: {
    height: 56,
    paddingLeft: 12,
    paddingRight: 64,
    paddingVertical: 0,
    borderRadius: 16,
    borderWidth: 1.5,
    fontSize: 16,
    borderCurve: 'continuous',
  },
  skipButton: {
    alignSelf: 'center',
    marginTop: 6,
  },
  mentionPanel: {
    marginTop: 8,
    overflow: 'hidden',
  },
  mentionList: {
    flex: 1,
    minHeight: '100%',
  },
  mentionListContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  mentionSkeletonRows: {
    flex: 1,
    paddingBottom: 16,
  },
  mentionEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  sendButton: {
    position: 'absolute',
    right: 22,
    bottom: 7,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
