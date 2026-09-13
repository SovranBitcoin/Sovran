import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import * as ImagePicker from 'expo-image-picker';
import { Input, Label, TextField } from 'heroui-native';
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
  const [base, setBase] = useState<{ name: string; picture: string | null }>({
    name: cachedName ?? '',
    picture: cachedPicture ?? null,
  });
  const [name, setName] = useState(cachedName ?? '');
  const [picture, setPicture] = useState<string | null>(cachedPicture ?? null);
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
      const next = snapshot
        ? {
            name: textValue(snapshot.content.display_name) || textValue(snapshot.content.name),
            picture: textValue(snapshot.content.picture) || null,
          }
        : { name: cached.current.name ?? '', picture: cached.current.picture ?? null };
      setBase(next);
      setName(next.name);
      setPicture(next.picture);
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
  const save = useSingleFlight(async () => {
    if (!ndk || !ready || upload || !isOwner()) return;
    setSaving(true);
    const result = await publishOwnProfileMetadata({
      ndk,
      pubkey,
      accountIndex,
      initialLoad,
      patch: {
        ...(name !== base.name ? { name } : {}),
        ...(picture !== base.picture ? { picture } : {}),
      },
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
  const dirty = name !== base.name || picture !== base.picture;
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
              disabled={!ready || !dirty || !!upload || saving}
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
      <TextField isDisabled={!ready || saving}>
        <Label>Name</Label>
        <Input
          testID="edit-profile-name"
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          maxLength={64}
          returnKeyType="done"
          editable={ready && !saving}
        />
      </TextField>
    </Screen>
  );
}
