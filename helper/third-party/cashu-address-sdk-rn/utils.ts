export function createRandomString() {
  if (typeof window === 'undefined') {
    require('crypto').randomBytes(16).toString('hex');
  } else {
    const array = new Uint8Array(16);
    return [...window.crypto.getRandomValues(array)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  }
}

export async function authedJsonRequest(url: string, authHeader: string, options?: RequestInit) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader,
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
  });
}

export function createAuthTemplate(url: string, method: string) {
  const event = {
    content: '',
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
  };
  return event;
}

export function createAuthHeader(signedEvent: any) {
  if (typeof window === 'undefined') {
    return `Nostr ${Buffer.from(JSON.stringify(signedEvent)).toString('base64')}`;
  } else {
    return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
  }
}
