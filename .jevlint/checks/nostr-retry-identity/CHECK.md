Where can retrying publication of an event re-sign or alter it, creating a different event id?

Find the publish and retry paths (app/shared/lib/nostr/publish/publishEvent.ts owns retries) and
where events are signed or finalized relative to the retry loop. A retry must resend the same
signed event with its original id. Signing a genuinely new user action is correct.
