import {
  Event,
  EventTemplate,
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
} from "nostr-tools";
import { Signer } from "./types";
import { createRandomString } from "./utils";

export class NsecSigner implements Signer {
  secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error("Expected secret key of 32 bytes");
    }
    this.secretKey = secretKey;
  }
  async signEvent(e: EventTemplate) {
    return finalizeEvent(e, this.secretKey);
  }
}

export class Nip07Signer implements Signer {
  async signEvent(e: EventTemplate) {
    return window.nostr.signEvent(e);
  }
}

export class Nip46Signer implements Signer {
  isConnected: boolean = false;
  clientSecretKey: Uint8Array;
  clientPublicKey: string;
  connectionString: URL;
  signerKey: string;
  relay: string;
  pool: SimplePool;

  constructor(connectionString: string, clientKey?: Uint8Array) {
    this.pool = new SimplePool();
    this.clientSecretKey = clientKey ? clientKey : generateSecretKey();
    this.clientPublicKey = getPublicKey(this.clientSecretKey);
    const parsedConnectionString = new URL(connectionString);
    this.connectionString = parsedConnectionString;
    this.signerKey =
      parsedConnectionString.hostname ||
      parsedConnectionString.pathname.slice(2);
    const relay = parsedConnectionString.searchParams.get("relay");
    if (!relay) {
      throw new Error("Connection String is missing relay param...");
    }
    this.relay = relay;
  }

  async signEvent(e: EventTemplate) {
    if (!this.isConnected) {
      throw new Error(
        "Not connected to signer. Please make sure to call connect() first",
      );
    }
    return this.createSignRequest(e);
  }

  async connect() {
    const id = createRandomString();
    const requestJson = JSON.stringify({
      id: id,
      method: "connect",
      params: [this.clientPublicKey],
    });
    const encryptedRequestJson = await nip04.encrypt(
      this.clientSecretKey,
      this.signerKey,
      requestJson,
    );
    let eventTemplate: EventTemplate = {
      kind: 24133,
      tags: [["p", this.signerKey]],
      content: encryptedRequestJson,
      created_at: Math.floor(Date.now() / 1000),
    };
    const event = finalizeEvent(eventTemplate, this.clientSecretKey);
    const res = await new Promise((res, rej) => {
      const timer = setTimeout(() => {
        sub.close();
        rej("Signer request timed out...");
      }, 60000);
      const sub = this.pool.subscribeMany(
        [this.relay],
        [{ authors: [this.signerKey], "#p": [this.clientPublicKey] }],
        {
          onevent: async (e) => {
            try {
              const decrypted = await nip04.decrypt(
                this.clientSecretKey,
                e.pubkey,
                e.content,
              );
              const resultJSON = JSON.parse(decrypted);
              if (resultJSON.id === id && resultJSON.result === "ack") {
                this.isConnected = true;
                sub.close();
                clearTimeout(timer);
                res("yay");
              }
            } catch (e) {
              // 
            }
          },
        },
      );
      this.pool.publish([this.relay], event);
    });
    return res;
  }

  async createSignRequest(event: EventTemplate): Promise<Event> {
    const id = createRandomString();
    const requestJson = JSON.stringify({
      id: id,
      method: "sign_event",
      params: [JSON.stringify(event)],
    });
    const encryptedRequestJson = await nip04.encrypt(
      this.clientSecretKey,
      this.signerKey,
      requestJson,
    );
    const signRequest: EventTemplate = {
      kind: 24133,
      tags: [["p", this.signerKey]],
      content: encryptedRequestJson,
      created_at: Math.floor(Date.now() / 1000),
    };
    return new Promise<Event>(async (res, rej) => {
      const timer = setTimeout(() => {
        sub.close();
        rej("Signer request timed out...");
      }, 60000);
      const finalizedEvent = finalizeEvent(signRequest, this.clientSecretKey);
      const sub = this.pool.subscribeMany(
        [this.relay],
        [{ "#p": [this.clientPublicKey], authors: [this.signerKey] }],
        {
          onevent: async (e) => {
            const decrypted = await nip04.decrypt(
              this.clientSecretKey,
              e.pubkey,
              e.content,
            );
            const resultJSON = JSON.parse(decrypted);
            if (
              !resultJSON.error &&
              resultJSON.result &&
              resultJSON.id === id
            ) {
              sub.close();
              clearTimeout(timer);
              res(JSON.parse(resultJSON.result));
            }
          },
        },
      );
      this.pool.publish([this.relay], finalizedEvent);
    });
  }
}
