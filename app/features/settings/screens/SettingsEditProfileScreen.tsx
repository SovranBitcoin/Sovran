import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import * as ImagePicker from 'expo-image-picker';
import { Description, Input, Label, TextField } from 'heroui-native';
import * as nip19 from 'nostr-tools/nip19';
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import Svg, { Circle } from 'react-native-svg';
import Icon from '@/assets/icons';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrNDKContext } from '@/shared/providers/NostrNDKProvider';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';
import {
  useOwnProfileMetadataStore,
  type ProfileHistoryField,
} from '@/shared/stores/profile/ownProfileMetadataStore';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { getNpcAddress } from '@/shared/lib/cashu/npc';
import {
  checkAbout,
  checkLud16,
  checkNip05,
  ABOUT_MAX_LENGTH,
  type ProfileFieldCheck,
} from '@/shared/lib/nostr/profile/profileFieldValidation';
import {
  ingestOwnProfileMetadata,
  loadOwnProfileMetadata,
  publishOwnProfileMetadata,
  type OwnProfileLoadResult,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import { uploadMedia } from '@/shared/lib/nostr/media/mediaUpload';
import { getMediaServer } from '@/shared/lib/nostr/media/mediaServerStore';
import { extractOwnedBlobsFromDescriptors } from '@/shared/lib/nostr/media/ownedBlobs';
import { actionMenuPopup, paramPopup, popup } from '@/shared/lib/popup';
import { nostrLog } from '@/shared/lib/logger';

const ImageUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:');
const textValue = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The editable kind-0 fields, as the editor holds them (empty = absent). */
interface ProfileDraft {
  name: string;
  picture: string | null;
  lud16: string;
  nip05: string;
  about: string;
}
function draftFromContent(content: Record<string, unknown>): ProfileDraft {
  return {
    name: textValue(content.display_name) || textValue(content.name),
    picture: textValue(content.picture) || null,
    lud16: textValue(content.lud16),
    nip05: textValue(content.nip05),
    about: textValue(content.about),
  };
}
/** Empty string → key removed (`null`); unchanged fields are left out. */
function patchBetween(base: ProfileDraft, next: ProfileDraft) {
  const text = (field: 'lud16' | 'nip05' | 'about') =>
    next[field] !== base[field] ? { [field]: next[field] || null } : {};
  return {
    ...(next.name !== base.name ? { name: next.name } : {}),
    ...(next.picture !== base.picture ? { picture: next.picture } : {}),
    ...text('lud16'),
    ...text('nip05'),
    ...text('about'),
  };
}

/** Previous values of one field as one-tap chips (newest first). */
function HistoryChips({
  field,
  current,
  disabled,
  onPick,
}: {
  field: ProfileHistoryField;
  current: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  const entries = useOwnProfileMetadataStore((s) => s.history[field]);
  const muted = useThemeColor('muted');
  const choices = (entries ?? []).filter((entry) => entry.value !== current);
  if (choices.length === 0) return null;
  // Read as recall, not as a selected option: a "Previously used" caption,
  // a clock glyph and muted content on every chip; tapping one fills the
  // field above, nothing is "on".
  return (
    <View className="mt-2 gap-1.5">
      <View className="flex-row items-center gap-1">
        <Icon name="mdi:clock-outline" size={12} color={muted} />
        <Text size={12} className="text-muted">
          Previously used
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {choices.map((entry, index) => (
          <CapsuleButton
            key={entry.value}
            label={entry.value}
            icon="mdi:clock-outline"
            color={muted}
            fitContent
            height={32}
            iconSize={13}
            textSize={13}
            labelNumberOfLines={1}
            accessibilityLabel={`Previously used ${field}: ${entry.value}`}
            testID={`edit-profile-history-${field}-${index}`}
            onPress={() => {
              if (!disabled) onPick(entry.value);
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function SettingsEditProfileScreen() {
  const profile = useProfileStore((s) => s.getActiveProfile());
  // Remount the draft and abort old I/O if identity changes while this route is open.
  return profile ? (
    <ProfileEditor
      key={profile.pubkey}
      pubkey={profile.pubkey}
      accountIndex={profile.accountIndex}
      cachedName={profile.cachedDisplayName}
      cachedPicture={profile.cachedPicture}
    />
  ) : null;
}

function ProfileEditor({
  pubkey,
  accountIndex,
  cachedName,
  cachedPicture,
}: {
  pubkey: string;
  accountIndex: number;
  cachedName?: string;
  cachedPicture?: string;
}) {
  const { ndk } = useNDK();
  const { isInitialized } = useNostrNDKContext();
  const foreground = useThemeColor('foreground');
  const cachedDraft: ProfileDraft = {
    name: cachedName ?? '',
    picture: cachedPicture ?? null,
    lud16: '',
    nip05: '',
    about: '',
  };
  const [base, setBase] = useState<ProfileDraft>(cachedDraft);
  const [draft, setDraft] = useState<ProfileDraft>(cachedDraft);
  const { name, picture, lud16, nip05, about } = draft;
  const setField = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) =>
    setDraft((previous) => ({ ...previous, [field]: value }));
  const setName = (value: string) => setField('name', value);
  const setPicture = (value: string | null) => setField('picture', value);
  const [ready, setReady] = useState(false);
  const [missingBase, setMissingBase] = useState(false);
  const [initialLoad, setInitialLoad] = useState<OwnProfileLoadResult>({ status: 'unavailable' });
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{ uri: string; progress: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const isOwner = () =>
    mounted.current && useProfileStore.getState().getActiveProfile()?.pubkey === pubkey;

  const cached = useLatestRef({ name: cachedName, picture: cachedPicture });
  useEffect(() => {
    mounted.current = true;
    nostrLog.info('nostr.profile.edit.open');
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    if (!ndk || !isInitialized) return;
    void loadOwnProfileMetadata(ndk, pubkey).then((loaded) => {
      if (canceled) return;
      setInitialLoad(loaded);
      const snapshot = loaded.status === 'found' ? loaded.snapshot : null;
      if (snapshot) ingestOwnProfileMetadata(snapshot, pubkey, accountIndex);
      const next: ProfileDraft = snapshot
        ? draftFromContent(snapshot.content)
        : {
            name: cached.current.name ?? '',
            picture: cached.current.picture ?? null,
            lud16: '',
            nip05: '',
            about: '',
          };
      setBase(next);
      setDraft(next);
      setMissingBase(
        loaded.status === 'unavailable' ||
          (!snapshot && (cached.current.name !== undefined || cached.current.picture !== undefined))
      );
      setReady(true);
    });
    return () => {
      canceled = true;
    };
    // Cached display updates must not overwrite an in-progress draft, so the
    // effect reads them through a ref instead of depending on them.
  }, [ndk, pubkey, isInitialized, accountIndex, cached]);

  const retryBase = useSingleFlight(async () => {
    if (!ndk || saving || !isOwner()) return;
    setRetrying(true);
    const loaded = await loadOwnProfileMetadata(ndk, pubkey);
    if (!isOwner()) return;
    setInitialLoad(loaded);
    if (loaded.status === 'found') ingestOwnProfileMetadata(loaded.snapshot, pubkey, accountIndex);
    setMissingBase(
      loaded.status === 'unavailable' ||
        (loaded.status === 'absent' &&
          (cached.current.name !== undefined || cached.current.picture !== undefined))
    );
    setRetrying(false);
  });

  function cancelUpload() {
    controller.current?.abort();
    controller.current = null;
    setUpload(null);
  }
  const chooseLibrary = async () => {
    cancelUpload();
    const current = new AbortController();
    controller.current = current;
    const picked = await ResultAsync.fromPromise(
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        exif: false,
      }),
      () => ({ type: 'picker-failed' })
    );
    if (!isOwner() || current.signal.aborted) return;
    if (picked.isErr()) {
      popup({ message: 'Couldn’t open your photo library. Try again.', type: 'error' });
      return;
    }
    if (picked.value.canceled || !picked.value.assets[0] || !ndk) return;
    const asset = picked.value.assets[0];
    setUpload({ uri: asset.uri, progress: 0 });
    nostrLog.info('nostr.media.avatar.upload', { phase: 'start' });
    const result = await uploadMedia({
      ndk,
      asset: { ...asset, mimeType: asset.mimeType ?? 'image/jpeg' },
      server: getMediaServer(),
      forceImageReencode: true,
      signal: current.signal,
      onProgress: (progress) => {
        if (isOwner() && !current.signal.aborted) setUpload({ uri: asset.uri, progress });
      },
    });
    if (!isOwner() || current.signal.aborted) return;
    setUpload(null);
    if (result.isErr()) {
      nostrLog.warn('nostr.media.avatar.upload', { phase: 'failed' });
      popup({ message: 'Media upload failed. Try again.', type: 'error' });
      return;
    }
    useOwnedMediaStore
      .getState()
      .recordBlobs(extractOwnedBlobsFromDescriptors([result.value]), undefined, 'avatar');
    setPicture(result.value.url);
    nostrLog.info('nostr.media.avatar.upload', { phase: 'ok' });
  };
  function pasteUrl() {
    actionMenuPopup({
      title: 'Paste image URL',
      inputs: [
        {
          id: 'edit-profile-picture-url',
          label: 'Image URL',
          autoCapitalize: 'none',
          autoCorrect: false,
        },
      ],
      primaryAction: {
        text: 'Use picture',
        testID: 'edit-profile-picture-url-save',
        onPress: (values, { setError, close }) => {
          const parsed = ImageUrlSchema.safeParse(values['edit-profile-picture-url']?.trim());
          if (!parsed.success) {
            setError('Enter an HTTPS image URL.');
            return;
          }
          if (!isOwner()) {
            close();
            return;
          }
          cancelUpload();
          setPicture(parsed.data);
          close();
        },
      },
    });
  }
  function changePicture() {
    actionMenuPopup({
      title: 'Profile picture',
      buttons: [
        {
          text: 'Choose from library',
          testID: 'edit-profile-picture-library',
          onPress: (close) => {
            close();
            return chooseLibrary();
          },
        },
        {
          text: 'Paste image URL',
          testID: 'edit-profile-picture-url',
          keepOpen: true,
          onPress: pasteUrl,
        },
        ...(picture
          ? [
              {
                text: 'Remove picture',
                testID: 'edit-profile-picture-remove',
                variant: 'dangerous' as const,
                onPress: () => {
                  if (isOwner()) {
                    cancelUpload();
                    setPicture(null);
                  }
                },
              },
            ]
          : []),
      ],
    });
  }
  // Sanity checks run on every keystroke; Save stays disabled until each
  // address parses. Normalised values (lowercase) are what gets published.
  const checks: Record<'lud16' | 'nip05' | 'about', ProfileFieldCheck> = {
    lud16: checkLud16(lud16),
    nip05: checkNip05(nip05),
    about: checkAbout(about),
  };
  const invalid = Object.values(checks).some((check) => !check.ok);
  const npub = nip19.npubEncode(pubkey);
  const npcAddress = getNpcAddress(undefined, npub);
  const save = useSingleFlight(async () => {
    if (!ndk || !ready || upload || invalid || !isOwner()) return;
    setSaving(true);
    const normalized: ProfileDraft = {
      ...draft,
      name: name.trim(),
      lud16: checks.lud16.ok ? checks.lud16.value : lud16,
      nip05: checks.nip05.ok ? checks.nip05.value : nip05,
      about: checks.about.ok ? checks.about.value : about,
    };
    const result = await publishOwnProfileMetadata({
      ndk,
      pubkey,
      accountIndex,
      initialLoad,
      patch: patchBetween(base, normalized),
    });
    if (!isOwner()) return;
    setSaving(false);
    if (result.isOk()) router.back();
    else if (result.error.type === 'base-unavailable') setMissingBase(true);
    else
      paramPopup('engagement-update-failed', 'profile', {
        failure: { service: 'nostr', error: result.error },
      });
  });
  const preview = upload?.uri ?? picture ?? undefined;
  const dirty = Object.keys(patchBetween(base, draft)).length > 0;
  const fieldsLocked = !ready || saving;
  return (
    <Screen
      name="SettingsEditProfileScreen"
      contentPadding={16}
      footer={
        <BottomButtons>
          <View className="gap-2 p-4">
            <Button
              text="Save"
              testID="edit-profile-save"
              onPress={save}
              loading={saving}
              disabled={!ready || !dirty || !!upload || saving || invalid}
            />
            {ready && missingBase && (
              <>
                <Text size={13} className="text-muted" accessibilityRole="alert">
                  {
                    "Couldn't load your current profile. Retry before saving to preserve your other fields."
                  }
                </Text>
                <Button
                  text="Retry"
                  testID="edit-profile-base-retry"
                  variant="secondary"
                  onPress={retryBase}
                  loading={retrying}
                  disabled={saving || retrying}
                />
              </>
            )}
          </View>
        </BottomButtons>
      }>
      <View className="items-center py-6">
        <Pressable
          testID="edit-profile-avatar"
          accessibilityRole="button"
          accessibilityLabel="Change picture"
          accessibilityState={{ disabled: !ready || saving }}
          disabled={!ready || saving}
          onPress={changePicture}
          className="relative items-center justify-center p-1">
          <Avatar
            size={96}
            state={preview ? 'image' : 'fallback'}
            picture={preview}
            name={name}
            seed={pubkey}
          />
          {upload && (
            <View
              pointerEvents="none"
              className="absolute inset-0"
              accessibilityRole="progressbar"
              accessibilityLabel="Uploading picture"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(upload.progress * 100) }}>
              <Svg width={104} height={104}>
                <Circle
                  cx={52}
                  cy={52}
                  r={50}
                  fill="none"
                  stroke={foreground}
                  strokeWidth={2}
                  strokeDasharray={Math.PI * 100}
                  strokeDashoffset={Math.PI * 100 * (1 - upload.progress)}
                  rotation={-90}
                  origin="52, 52"
                />
              </Svg>
            </View>
          )}
          <View
            pointerEvents="none"
            className="bg-surface absolute bottom-0 right-0 rounded-full p-2">
            <Icon name="mdi:pencil" size={16} color={foreground} />
          </View>
        </Pressable>
      </View>
      <View className="gap-5">
        <TextField isDisabled={fieldsLocked}>
          <Label>Name</Label>
          <Input
            testID="edit-profile-name"
            accessibilityLabel="Name"
            value={name}
            onChangeText={setName}
            maxLength={64}
            returnKeyType="done"
            editable={!fieldsLocked}
          />
          <HistoryChips field="name" current={name} disabled={fieldsLocked} onPick={setName} />
        </TextField>

        <TextField isDisabled={fieldsLocked}>
          <Label>About</Label>
          <Input
            testID="edit-profile-about"
            accessibilityLabel="About"
            value={about}
            onChangeText={(value) => setField('about', value)}
            maxLength={ABOUT_MAX_LENGTH}
            multiline
            numberOfLines={3}
            editable={!fieldsLocked}
          />
          {!checks.about.ok ? (
            <Text size={12} className="text-danger mt-1" accessibilityRole="alert">
              {checks.about.message}
            </Text>
          ) : null}
          <HistoryChips
            field="about"
            current={about}
            disabled={fieldsLocked}
            onPick={(value) => setField('about', value)}
          />
        </TextField>

        <TextField isDisabled={fieldsLocked}>
          <Label>Lightning address</Label>
          <Input
            testID="edit-profile-lud16"
            accessibilityLabel="Lightning address"
            value={lud16}
            onChangeText={(value) => setField('lud16', value)}
            placeholder="name@domain.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={256}
            editable={!fieldsLocked}
          />
          {!checks.lud16.ok ? (
            <Text size={12} className="text-danger mt-1" accessibilityRole="alert">
              {checks.lud16.message}
            </Text>
          ) : (
            <Description>Where people can pay you over Lightning.</Description>
          )}
          {lud16.trim().toLowerCase() !== npcAddress ? (
            // One tap: the npub.cash address every Sovran account already has
            // (ecash arrives in this wallet, no server account needed).
            <View className="mt-2 flex-row">
              <CapsuleButton
                label="Use my npub.cash address"
                icon="mdi:lightning-bolt"
                fitContent
                height={32}
                textSize={13}
                testID="edit-profile-lud16-npc"
                onPress={() => {
                  if (!fieldsLocked) setField('lud16', npcAddress);
                }}
              />
            </View>
          ) : null}
          <HistoryChips
            field="lud16"
            current={lud16}
            disabled={fieldsLocked}
            onPick={(value) => setField('lud16', value)}
          />
        </TextField>

        <TextField isDisabled={fieldsLocked}>
          <Label>Nostr address</Label>
          <Input
            testID="edit-profile-nip05"
            accessibilityLabel="Nostr address"
            value={nip05}
            onChangeText={(value) => setField('nip05', value)}
            placeholder="name@domain.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={256}
            editable={!fieldsLocked}
          />
          {!checks.nip05.ok ? (
            <Text size={12} className="text-danger mt-1" accessibilityRole="alert">
              {checks.nip05.message}
            </Text>
          ) : (
            <Description>
              A NIP-05 name the domain has published for your key. It only verifies once the domain
              lists this public key.
            </Description>
          )}
          <HistoryChips
            field="nip05"
            current={nip05}
            disabled={fieldsLocked}
            onPick={(value) => setField('nip05', value)}
          />
        </TextField>
      </View>
    </Screen>
  );
}
