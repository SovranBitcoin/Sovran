/** @jest-environment node */
import { intakeDmEcash, type DmEcashQueuePort } from '@/features/payments/lib/dmEcashIntake';

const mockClassify = jest.fn();
jest.mock('@/shared/stores/profile/nutDropRedeemQueueStore', () => ({
  NUT_DROP_QUEUE_LIMITS: { tokenHash: 64, token: 60_000, mintUrl: 2048, unit: 16 },
}));
jest.mock('wallet', () => ({
  classifyMeshToken: (...args: unknown[]) => mockClassify(...args),
  meshTokenDedupeKey: (token: string) => `hash:${token}`,
  // The fixture token is the only string that decodes.
  isValidEcashToken: (candidate: string) =>
    candidate === 'cashuBo2FteBtodHRwczovL21pbnQuZXhhbXBsZQ',
}));

const TOKEN = 'cashuBo2FteBtodHRwczovL21pbnQuZXhhbXBsZQ';
const SENDER = 'a'.repeat(64);
const ME = '02' + 'b'.repeat(64);

function queue() {
  const known = new Map<string, { status: string }>();
  const port: DmEcashQueuePort = {
    has: (hash) => known.has(hash),
    enqueue: jest.fn((hash) => {
      if (known.has(hash)) return false;
      known.set(hash, { status: 'pending' });
      return true;
    }),
    markSpent: jest.fn((hash) => {
      const entry = known.get(hash);
      if (entry) entry.status = 'spent';
    }),
    park: jest.fn((hash) => {
      const entry = known.get(hash);
      if (entry) entry.status = 'untrusted-mint';
    }),
  };
  return { port, known };
}

const dm = (over: Partial<{ content: string; isOwn: boolean }> = {}) => ({
  content: TOKEN,
  isOwn: false,
  senderPubkey: SENDER,
  ...over,
});

beforeEach(() => {
  mockClassify.mockReset();
  mockClassify.mockReturnValue({
    classification: 'bearer',
    mintUrl: 'https://mint.example',
    amount: 21,
    unit: 'sat',
  });
});

describe('ecash arriving as a Nostr message', () => {
  it('queues a token message from someone else as a Nostr-sourced entry', async () => {
    const { port } = queue();
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isSpent: async () => false,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('queued');
    expect(port.enqueue).toHaveBeenCalledWith(`hash:${TOKEN}`, {
      token: TOKEN,
      mintUrl: 'https://mint.example',
      amount: 21,
      unit: 'sat',
      source: 'nostr',
      senderPubkey: SENDER,
    });
  });

  it('ignores my own sent token, so sending never redeems back to me', async () => {
    const { port } = queue();
    const outcome = await intakeDmEcash(dm({ isOwn: true }), {
      myPubkey33: ME,
      queue: port,
      isSpent: async () => false,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('own-message');
    expect(port.enqueue).not.toHaveBeenCalled();
  });

  it.each(['hello', `here you go ${TOKEN}`, `${TOKEN} thanks`])(
    'treats a message that is not purely a token as conversation: %s',
    async (content) => {
      const { port } = queue();
      const outcome = await intakeDmEcash(dm({ content }), {
        myPubkey33: ME,
        queue: port,
        isSpent: async () => false,
        isTrustedMint: async () => true,
        stillCurrent: () => true,
      });
      expect(outcome).toBe('not-a-token');
      expect(port.enqueue).not.toHaveBeenCalled();
    }
  );

  it('ignores a token locked to someone else', async () => {
    mockClassify.mockReturnValue({ classification: 'locked-to-other', mintUrl: 'x', amount: 1 });
    const { port } = queue();
    expect(
      await intakeDmEcash(dm(), {
        myPubkey33: ME,
        queue: port,
        isSpent: async () => false,
        isTrustedMint: async () => true,
        stillCurrent: () => true,
      })
    ).toBe('locked-to-other');
    expect(port.enqueue).not.toHaveBeenCalled();
  });

  it('is idempotent across sweeps and never re-probes a known token', async () => {
    const { port } = queue();
    const isSpent = jest.fn(async () => false);
    await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isSpent,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    const again = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isSpent,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    expect(again).toBe('already-known');
    expect(port.enqueue).toHaveBeenCalledTimes(1);
    expect(isSpent).toHaveBeenCalledTimes(1);
  });

  it('records a token already redeemed from history as spent, never as pending', async () => {
    // The first sweep reads old messages. A token claimed weeks ago must not
    // raise a "receiving" toast and then fail.
    const { port, known } = queue();
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isSpent: async () => true,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('already-spent');
    expect(known.get(`hash:${TOKEN}`)).toEqual({ status: 'spent' });
  });

  it('queues the token when spent-ness cannot be established', async () => {
    // Not queueing would risk leaving real money unclaimed; the orchestrator
    // handles an already-spent token safely.
    const { port, known } = queue();
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isSpent: async () => null,
      isTrustedMint: async () => true,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('queued');
    expect(known.get(`hash:${TOKEN}`)).toEqual({ status: 'pending' });
  });

  it.each([false, true])(
    'writes nothing when the wallet changed during the spent probe (spent: %s)',
    async (spent) => {
      // The queue is profile-scoped and read at write time: after a switch it
      // is another wallet's queue.
      const { port } = queue();
      let current = true;
      const outcome = await intakeDmEcash(dm(), {
        myPubkey33: ME,
        queue: port,
        isSpent: async () => {
          current = false;
          return spent;
        },
        isTrustedMint: async () => true,
        stillCurrent: () => current,
      });
      expect(outcome).toBe('abandoned');
      expect(port.enqueue).not.toHaveBeenCalled();
      expect(port.markSpent).not.toHaveBeenCalled();
    }
  );

  it('parks a token from an untrusted mint without contacting that mint', async () => {
    // The mint URL is the sender's choice. A probe would reveal this wallet's
    // address to it and store its keysets, all before anyone agreed.
    const { port, known } = queue();
    const isSpent = jest.fn(async () => false);
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isTrustedMint: async () => false,
      isSpent,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('needs-review');
    expect(isSpent).not.toHaveBeenCalled();
    expect(known.get(`hash:${TOKEN}`)).toEqual({ status: 'untrusted-mint' });
  });

  it('queues unprobed when the wallet cannot say whether the mint is trusted', async () => {
    const { port } = queue();
    const isSpent = jest.fn(async () => false);
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isTrustedMint: async () => null,
      isSpent,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('queued');
    expect(isSpent).not.toHaveBeenCalled();
  });

  it('keeps a token the stored queue could not hold out of it', async () => {
    // One entry past a stored limit fails the whole queue's parse on the next
    // launch, and every other waiting token goes with it.
    mockClassify.mockReturnValue({
      classification: 'bearer',
      mintUrl: `https://mint.example/${'a'.repeat(3000)}`,
      amount: 21,
      unit: 'sat',
    });
    const { port } = queue();
    const isTrustedMint = jest.fn(async () => true);
    const outcome = await intakeDmEcash(dm(), {
      myPubkey33: ME,
      queue: port,
      isTrustedMint,
      isSpent: async () => false,
      stillCurrent: () => true,
    });
    expect(outcome).toBe('unsupported');
    expect(port.enqueue).not.toHaveBeenCalled();
    expect(isTrustedMint).not.toHaveBeenCalled();
  });
});
