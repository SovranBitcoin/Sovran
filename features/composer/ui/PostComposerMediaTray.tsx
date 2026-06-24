/**
 * @fileoverview Composer media tray: horizontal strip of picked/uploading media.
 *
 * Extracted from `PostComposer` as a pure presentational seam. Probe
 * scope/component/itemKey strings are preserved so the content-shift log
 * taxonomy (`composer.*`) is unchanged. Rendered only when there is media.
 */
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from 'heroui-native';

import Icon from 'assets/icons';
import type { ComposerBlock } from '@/features/composer/config/types';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import type { VisualScrollMetricsReporter } from '@/shared/lib/contentShiftLog';

type Props = {
  scope: string;
  mediaBlocks: ComposerBlock[];
  scrollMetrics: VisualScrollMetricsReporter;
  mutedColor: string;
  onRemove: (id: string) => void;
};

export function PostComposerMediaTray({
  scope,
  mediaBlocks,
  scrollMetrics,
  mutedColor,
  onRemove,
}: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-3"
      onLayout={scrollMetrics.onLayout}
      onContentSizeChange={scrollMetrics.onContentSizeChange}
      onScroll={scrollMetrics.onScroll}
      scrollEventThrottle={250}>
      {mediaBlocks.map((block) =>
        block.kind === 'media' ? (
          <VisualLayoutProbe
            key={block.id}
            scope={scope}
            surface="composer"
            component="PostComposerMediaBlock"
            itemKey={block.id}
            itemType={block.mediaKind}
            className="mr-2"
            extra={{
              uploading: block.uploadProgress !== undefined,
              uploadProgress: block.uploadProgress ?? null,
            }}>
            <Image
              source={{ uri: block.localUri ?? block.descriptor?.url }}
              style={styles.media}
              contentFit="cover"
            />
            {block.uploadProgress !== undefined ? (
              <View
                className="absolute inset-0 items-center justify-center"
                style={styles.uploadScrim}>
                <VisualLayoutProbe
                  scope={scope}
                  surface="composer"
                  component="PostComposerMediaUploadIndicator"
                  itemKey={`media-upload:${block.id}`}
                  itemType="activity-indicator"
                  phase="uploading"
                  extra={{
                    mediaKind: block.mediaKind,
                    uploadProgress: block.uploadProgress ?? null,
                  }}>
                  <ActivityIndicator color={INVARIANT_WHITE} />
                </VisualLayoutProbe>
              </View>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onRemove(block.id)}
              accessibilityLabel="Remove media">
              <Icon name="mdi:close-circle" size={18} color={mutedColor} />
            </Button>
          </VisualLayoutProbe>
        ) : null
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  media: { width: 96, height: 96, borderRadius: 12 },
  uploadScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});
