import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';

const STEP_DURATION_MS = 2200;

/** Profile-style row: SAME chrome in both branches (only the `loading` bars
 *  differ), so the crossfade reveals content under a fading skeleton with zero
 *  layout shift. */
function DemoProfileRow({ loading, pictureUrl }: { loading: boolean; pictureUrl?: string }) {
  return (
    <HStack align="center" gap={12}>
      <Avatar
        state={loading ? 'loading' : pictureUrl ? 'image' : 'fallback'}
        size={44}
        picture={pictureUrl}
        name="Sovran"
      />
      <VStack spacing={4} className="flex-1">
        <Text loading={loading} placeholder="Display Name" bold size={15}>
          Satoshi Nakamoto
        </Text>
        <Text loading={loading} placeholder="@handle@relay.example" size={13}>
          @satoshi@sovran.money
        </Text>
      </VStack>
    </HStack>
  );
}

export function SettingsDesignSystemSkeletonCrossfadeScreen() {
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  // Bust expo-image's cache each cycle so the avatar performs a real load and
  // fades in independently of the data crossfade.
  const [imageSeed, setImageSeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!auto) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => {
      setLoading((prev) => {
        const next = !prev;
        if (!next) setImageSeed((s) => s + 1);
        return next;
      });
    }, STEP_DURATION_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [auto]);

  const toggle = useCallback(() => {
    setAuto(false);
    setLoading((prev) => {
      const next = !prev;
      if (!next) setImageSeed((s) => s + 1);
      return next;
    });
  }, []);

  const pictureUrl = loading ? undefined : `https://picsum.photos/seed/sovran-${imageSeed}/88`;

  return (
    <ScreenWrapper name="SettingsDesignSystemSkeletonCrossfadeScreen" scroll="custom" safeArea>
      <ScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          The canonical{' '}
          <Text size={12} bold className="text-foreground">
            SkeletonContentCrossfade
          </Text>
          . While loading, a sizeable region shows the wave; on data arrival the skeleton fades out
          and content fades in. Images fade in independently (their own expo-image transition), and
          system Reduce Motion turns the wave + fade into an instant swap.
        </Text>

        {/* 1 — Region wave + crossfade */}
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3 py-5">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              REGION WAVE + CROSSFADE
            </Text>
            <SkeletonContentCrossfade
              loading={loading}
              wave="region"
              renderSkeleton={() => <DemoProfileRow loading />}
              renderContent={() => <DemoProfileRow loading={false} pictureUrl={pictureUrl} />}
            />
          </Card.Body>
        </Card>

        {/* 2 — Inline (no wave) */}
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3 py-5">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              INLINE — PULSE, NO WAVE
            </Text>
            <Text size={12} className="text-foreground/60">
              Compact swaps keep the cheap pulse and skip the sweep.
            </Text>
            <SkeletonContentCrossfade
              loading={loading}
              wave="none"
              renderSkeleton={() => (
                <Text loading placeholder="1,000 sats" bold size={20} />
              )}
              renderContent={() => (
                <Text bold size={20} className="text-foreground">
                  21,000 sats
                </Text>
              )}
            />
          </Card.Body>
        </Card>

        {/* 3 — Independent image fade */}
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3 py-5">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              INDEPENDENT IMAGE FADE
            </Text>
            <Text size={12} className="text-foreground/60">
              Text settles immediately; the avatar image fades in on its own when it finishes
              loading — the crossfade never waits on it.
            </Text>
            <DemoProfileRow loading={false} pictureUrl={pictureUrl} />
          </Card.Body>
        </Card>

        {/* Controls */}
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              STATE: {loading ? 'LOADING' : 'LOADED'}
            </Text>
            <Button variant="secondary" size="sm" onPress={toggle}>
              <Button.Label>{loading ? 'Show content' : 'Show skeleton'}</Button.Label>
            </Button>
            <Button variant={auto ? 'primary' : 'secondary'} size="sm" onPress={() => setAuto((v) => !v)}>
              <Button.Label>{auto ? 'Stop auto-cycle' : 'Start auto-cycle'}</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}
