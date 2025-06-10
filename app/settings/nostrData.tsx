import { useSelector } from 'react-redux';
import Container from 'components/layout/Container';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'components/common/Themed';
import * as Clipboard from 'expo-clipboard';
import _ from 'lodash';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventKind } from 'app/Profile';
import { greys } from 'helper/colors';
import Image from 'components/common/Image';
import { ScrollView } from 'react-native';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

export default function ModalScreen() {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const filters = useMemo(
    () => [
      {
        // authors: [currentProfile?.pubkey],
        kinds: [EventKind.Metadata, 37375],
        limit: 10,
      },
    ],
    [currentProfile?.pubkey]
  );

  const { events } = useSubscribe({ filters });

  // Filter events by kind
  const metadataEvents = useMemo(() => {
    return events?.filter((event) => event.kind === EventKind.Metadata) || [];
  }, [events]);

  const kind37375Events = useMemo(() => {
    return events?.filter((event) => event.kind === 37375) || [];
  }, [events]);

  // Define a type for Nostr events that's compatible with NDKEvent
  type NostrEvent = {
    kind?: number;
    content?: string;
    tags?: string[][];
    [key: string]: any;
  };

  const copyToClipboardKind = (eventsToDisplay: NostrEvent[]) => {
    if (eventsToDisplay && eventsToDisplay.length > 0) {
      Clipboard.setStringAsync(JSON.stringify(eventsToDisplay, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Parse the profile metadata content
  const parseProfileContent = (event: NostrEvent) => {
    try {
      if (event?.content) {
        return JSON.parse(event.content);
      }
    } catch (e) {
      return null;
    }
    return null;
  };

  // Extract important tags from kind 37375 event
  const extractImportantTags = (event: NostrEvent) => {
    if (!event?.tags) return {};

    const result: Record<string, string | string[]> = {};

    // For single value tags
    const singleValueTags = ['d', 'name', 'unit', 'description', 'alt'];
    singleValueTags.forEach((tagName) => {
      const tag = event.tags.find((t) => t[0] === tagName);
      if (tag && tag.length > 1) {
        result[tagName] = tag[1];
      }
    });

    // For multi-value tags
    const multiValueTags = ['mint', 'relay'];
    multiValueTags.forEach((tagName) => {
      const tags = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
      if (tags.length > 0) {
        result[tagName] = tags;
      }
    });

    return result;
  };

  const toggleView = () => {
    setShowJson(!showJson);
  };

  return (
    <Container>
      <ScrollView>
        {/* Toggle Button */}
        <View className="mb-4 flex flex-row justify-end">
          <TouchableOpacity
            style={{ backgroundColor: greys(theme)[2300] }}
            className="rounded-lg px-4 py-2"
            onPress={toggleView}>
            <Text className="text-white">{showJson ? 'Show Pretty View' : 'Show JSON View'}</Text>
          </TouchableOpacity>
        </View>

        {/* Metadata Section */}
        <View style={{ backgroundColor: greys(theme)[2300] }} className="mb-4 rounded-lg px-4 py-3">
          <Text className="text-lg font-bold text-white">Profile Metadata</Text>
        </View>

        {metadataEvents && metadataEvents.length > 0 ? (
          metadataEvents.map((event, index) => (
            <View
              key={`metadata-${index}`}
              style={{ backgroundColor: greys(theme)[1800] }}
              className="relative mb-4 rounded-lg p-4">
              {showJson ? (
                // JSON View
                <>
                  <View className="mb-2 flex flex-row items-center justify-between">
                    <Text
                      style={{ color: greys(theme)[0] }}
                      className="font-mono text-sm text-gray-400">
                      Metadata JSON Response
                    </Text>
                    <TouchableOpacity
                      style={{ backgroundColor: greys(theme)[2300] }}
                      className="rounded px-2 py-2"
                      onPress={() => copyToClipboardKind([event])}>
                      <Text style={{ color: greys(theme)[0] }} className="text-xs text-white">
                        {copied ? 'Copied!' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View className="overflow-hidden rounded">
                    <Text
                      style={{ color: greys(theme)[0] }}
                      className="whitespace-pre font-mono text-sm">
                      {JSON.stringify(event, null, 2)}
                    </Text>
                  </View>
                </>
              ) : (
                // Pretty View
                <>
                  <View className="mb-2 flex flex-row items-center justify-between">
                    <Text style={{ color: greys(theme)[0] }} className="text-lg font-semibold">
                      Profile Info
                    </Text>
                    <TouchableOpacity
                      style={{ backgroundColor: greys(theme)[2300] }}
                      className="rounded px-2 py-2"
                      onPress={() => copyToClipboardKind([event])}>
                      <Text style={{ color: greys(theme)[0] }} className="text-xs text-white">
                        {copied ? 'Copied!' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Profile Content Pretty View */}
                  {parseProfileContent(event) && (
                    <View className="mt-4">
                      {parseProfileContent(event).picture && (
                        <View className="mb-4 flex items-center justify-center">
                          <View
                            className="h-24 w-24 overflow-hidden rounded-full"
                            style={{ backgroundColor: greys(theme)[1500] }}>
                            <Image
                              source={{ uri: parseProfileContent(event).picture }}
                              style={{ height: 100, width: 100 }}
                            />
                          </View>
                        </View>
                      )}

                      <View className="mt-2">
                        <Text style={{ color: greys(theme)[600] }} className="text-sm">
                          Name
                        </Text>
                        <Text style={{ color: greys(theme)[0] }} className="text-lg font-semibold">
                          {parseProfileContent(event).name || 'Not set'}
                        </Text>
                      </View>

                      {parseProfileContent(event).about && (
                        <View className="mt-2">
                          <Text style={{ color: greys(theme)[600] }} className="text-sm">
                            About
                          </Text>
                          <Text style={{ color: greys(theme)[0] }}>
                            {parseProfileContent(event).about}
                          </Text>
                        </View>
                      )}

                      <View className="mt-4 flex flex-row justify-between">
                        <View className="flex-1">
                          <Text style={{ color: greys(theme)[600] }} className="text-sm">
                            Public Key
                          </Text>
                          <Text style={{ color: greys(theme)[0] }} className="font-mono text-xs">
                            {event.pubkey.substring(0, 10)}...
                            {event.pubkey.substring(event.pubkey.length - 10)}
                          </Text>
                        </View>
                        <View className="flex-1">
                          <Text style={{ color: greys(theme)[600] }} className="text-sm">
                            Created
                          </Text>
                          <Text style={{ color: greys(theme)[0] }} className="text-xs">
                            {new Date(event.created_at * 1000).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </>
              )}
            </View>
          ))
        ) : (
          <View style={{ backgroundColor: greys(theme)[1800] }} className="mb-4 rounded-lg p-4">
            <Text style={{ color: greys(theme)[0] }}>No metadata events found</Text>
          </View>
        )}

        {/* Cashu Wallet Section */}
        <View style={{ backgroundColor: greys(theme)[2300] }} className="mb-4 rounded-lg px-4 py-3">
          <Text className="text-lg font-bold text-white">Cashu Wallet Info</Text>
        </View>

        {kind37375Events && kind37375Events.length > 0 ? (
          kind37375Events.map((event, index) => (
            <View
              key={`wallet-${index}`}
              style={{ backgroundColor: greys(theme)[1800] }}
              className="relative mb-4 rounded-lg p-4">
              {showJson ? (
                // JSON View
                <>
                  <View className="mb-2 flex flex-row items-center justify-between">
                    <Text
                      style={{ color: greys(theme)[0] }}
                      className="font-mono text-sm text-gray-400">
                      Kind 37375 JSON Response
                    </Text>
                    <TouchableOpacity
                      style={{ backgroundColor: greys(theme)[2300] }}
                      className="rounded px-2 py-2"
                      onPress={() => copyToClipboardKind([event])}>
                      <Text style={{ color: greys(theme)[0] }} className="text-xs text-white">
                        {copied ? 'Copied!' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View className="overflow-hidden rounded">
                    <Text
                      style={{ color: greys(theme)[0] }}
                      className="whitespace-pre font-mono text-sm">
                      {JSON.stringify(event, null, 2)}
                    </Text>
                  </View>
                </>
              ) : (
                // Pretty View
                <>
                  <View className="mb-2 flex flex-row items-center justify-between">
                    <Text style={{ color: greys(theme)[0] }} className="text-lg font-semibold">
                      {extractImportantTags(event).name || 'Wallet Info'}
                    </Text>
                    <TouchableOpacity
                      style={{ backgroundColor: greys(theme)[2300] }}
                      className="rounded px-2 py-2"
                      onPress={() => copyToClipboardKind([event])}>
                      <Text style={{ color: greys(theme)[0] }} className="text-xs text-white">
                        {copied ? 'Copied!' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Wallet Info Pretty View */}
                  <View className="mt-2">
                    {extractImportantTags(event).description && (
                      <View className="mb-4">
                        <Text style={{ color: greys(theme)[0] }} className="italic">
                          {extractImportantTags(event).description}
                        </Text>
                      </View>
                    )}

                    {extractImportantTags(event).d && (
                      <View className="mb-2">
                        <Text style={{ color: greys(theme)[600] }} className="text-sm">
                          Wallet ID
                        </Text>
                        <Text style={{ color: greys(theme)[0] }} className="font-mono">
                          {extractImportantTags(event).d}
                        </Text>
                      </View>
                    )}

                    {extractImportantTags(event).unit && (
                      <View className="mb-2">
                        <Text style={{ color: greys(theme)[600] }} className="text-sm">
                          Unit
                        </Text>
                        <Text style={{ color: greys(theme)[0] }}>
                          {extractImportantTags(event).unit}
                        </Text>
                      </View>
                    )}

                    {/* Mints Section */}
                    {Array.isArray(extractImportantTags(event).mint) &&
                      extractImportantTags(event).mint.length > 0 && (
                        <View className="mt-4">
                          <Text style={{ color: greys(theme)[600] }} className="mb-1 text-sm">
                            Configured Mints
                          </Text>
                          {(extractImportantTags(event).mint as string[]).map((mint, mintIndex) => (
                            <View
                              key={`mint-${mintIndex}`}
                              style={{ backgroundColor: greys(theme)[1500] }}
                              className="mb-2 rounded p-2">
                              <Text
                                style={{ color: greys(theme)[200] }}
                                className="font-mono text-xs">
                                {mint}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}

                    {/* Relays Section - Collapsed by default */}
                    {Array.isArray(extractImportantTags(event).relay) &&
                      extractImportantTags(event).relay.length > 0 && (
                        <View className="mt-4">
                          <Text style={{ color: greys(theme)[600] }} className="mb-1 text-sm">
                            Connected Relays (
                            {(extractImportantTags(event).relay as string[]).length})
                          </Text>
                          <View
                            style={{ backgroundColor: greys(theme)[1500] }}
                            className="rounded p-2">
                            <Text style={{ color: greys(theme)[200] }} className="text-xs">
                              {(extractImportantTags(event).relay as string[])
                                .slice(0, 3)
                                .join(', ')}
                              {(extractImportantTags(event).relay as string[]).length > 3
                                ? ' ...'
                                : ''}
                            </Text>
                          </View>
                        </View>
                      )}

                    <View className="mt-4 flex flex-row justify-between">
                      <View className="flex-1">
                        <Text style={{ color: greys(theme)[600] }} className="text-sm">
                          Event ID
                        </Text>
                        <Text style={{ color: greys(theme)[0] }} className="font-mono text-xs">
                          {event.id.substring(0, 10)}...{event.id.substring(event.id.length - 10)}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text style={{ color: greys(theme)[600] }} className="text-sm">
                          Created
                        </Text>
                        <Text style={{ color: greys(theme)[0] }} className="text-xs">
                          {new Date(event.created_at * 1000).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  </View>
                </>
              )}
            </View>
          ))
        ) : (
          <View style={{ backgroundColor: greys(theme)[1800] }} className="mb-4 rounded-lg p-4">
            <Text style={{ color: greys(theme)[0] }}>No wallet events found</Text>
          </View>
        )}
      </ScrollView>
    </Container>
  );
}
