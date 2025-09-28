import React from 'react';
import { View } from 'react-native';
import { ImageContainer } from './ImageContainer';
import { VideoScreen } from './VideoPlayer';
import { ExternalLink } from './ExternalLink';

interface UrlProcessorProps {
  urls: string[];
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(url);
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|ogg|mov|bin)$/i.test(url);
}

export function UrlProcessor({ urls }: UrlProcessorProps) {
  return (
    <View>
      {urls?.map((url) =>
        isImageUrl(url) ? (
          <ImageContainer key={url} url={url} />
        ) : isVideoUrl(url) ? (
          <VideoScreen key={url} videoSource={url} />
        ) : !isVideoUrl(url) && !isImageUrl(url) ? (
          <ExternalLink key={url} url={url} />
        ) : null
      )}
    </View>
  );
}
