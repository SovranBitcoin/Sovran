import React, { useMemo } from 'react';
import { Text } from 'components/ui/Text';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventKind } from 'helper/constants';

export function UserNameProfiles({ pubkey }: { pubkey: string }) {
  const filters = useMemo(
    () => [
      {
        authors: [pubkey], // Filter profiles based on the provided pubkey
        kinds: [EventKind.Metadata], // Fetch metadata (profile details)
        limit: 1,
      },
    ],
    [pubkey]
  );

  const { events } = useSubscribe({ filters });

  const displayName = useMemo(() => {
    const latestEvent = events.reduce((latest: any, current: any) => {
      return latest?.created_at > current?.created_at ? latest : current;
    }, null);

    if (latestEvent?.content) {
      try {
        const metadata = JSON.parse(latestEvent.content);
        return metadata.displayName || metadata.name || 'Unknown User'; // Extract name or fallback
      } catch {}
    }
    return 'Unknown User';
  }, [events]);

  return (
    <Text className="text-primary-400" overpass bold size={14}>
      {displayName}
    </Text>
  );
}
