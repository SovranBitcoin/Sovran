/**
 * The in-app web embed shown behind the collapsible thread sheet.
 *
 * Security: this view renders untrusted external pages. It is deliberately kept
 * free of any bridge into app state — no `injectedJavaScript`, no `onMessage`
 * wired to wallet/identity surfaces, file access disabled, http(s) only. The
 * web view must never receive nsec / seed / profile data. See
 * `sovran-security`.
 */
import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { WebView, type WebViewProps } from 'react-native-webview';

import { isHttpNavigationUrl } from '@/shared/lib/url';

export const LinkEmbedView = React.memo(function LinkEmbedView({
  url,
  opacity: embedOpacity,
  onScroll,
  topInset,
}: {
  url: string;
  /** Web-view fade-in (0 at rest → 1 once the sheet reveals it). */
  opacity: SharedValue<number>;
  /** Reports page scroll so the sheet can lock to the inline snap. */
  onScroll: (offsetY: number) => void;
  /** Inset so the page clears the navigation header. */
  topInset: number;
}) {
  const fadeStyle = useAnimatedStyle(() => ({ opacity: embedOpacity.get() }));

  const handleScroll = useCallback<NonNullable<WebViewProps['onScroll']>>(
    (e) => {
      onScroll(e.nativeEvent.contentOffset.y);
    },
    [onScroll]
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
      <WebView
        source={{ uri: url }}
        style={[styles.webview, { marginTop: topInset }]}
        onScroll={handleScroll}
        // Security hardening: no app-state bridge, no popups, no local files.
        javaScriptEnabled
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        // `['*']` plus an explicit gate, NOT a narrow whitelist. In
        // react-native-webview a url that FAILS originWhitelist is not blocked —
        // WebViewShared hands it to `Linking.openURL(url)`. A narrow whitelist
        // therefore turns `intent://`, a custom app scheme or our own deep link,
        // reached from a relay-supplied page, into an OS open with no tap.
        // `onShouldStartLoadWithRequest` is only consulted for urls that already
        // passed, so widening the whitelist is what lets this gate see them.
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={(request) => isHttpNavigationUrl(request.url)}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
