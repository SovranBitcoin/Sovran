import { BalanceResponse, Signer, TokenReponse } from './types';
import { authedJsonRequest, createAuthHeader, createAuthTemplate } from './utils';

export class NCSDK {
  baseUrl: string;
  signer: Signer;

  constructor(baseUrl: string, signer: Signer) {
    this.baseUrl = baseUrl;
    this.signer = signer;
  }

  async getInfo() {
    const url = `${this.baseUrl}/api/v2/user/info`;
    const method = 'GET';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    const res = await authedJsonRequest(url, authHeader);
    const data = await res.json();
    return data;
  }

  async getToken() {
    const url = `${this.baseUrl}/api/v2/claim`;
    const method = 'GET';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    const res = await authedJsonRequest(url, authHeader);
    const data = (await res.json()) as TokenReponse;
    if (data.error) {
      throw new Error(data.message);
    }
    return data.data.token;
  }
  async getWithdraw() {
    const url = `${this.baseUrl}/api/v2/withdrawals`;
    const method = 'GET';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    const res = await authedJsonRequest(url, authHeader);
    const data = (await res.json()) as TokenReponse;
    if (data.error) {
      throw new Error(data.message);
    }
    return data;
  }

  async setMint(mintUrl: string) {
    const url = `${this.baseUrl}/api/v2/user/mint`;
    const method = 'PATCH';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    const res = await authedJsonRequest(url, authHeader, {
      method,
      body: JSON.stringify({ mint_url: mintUrl }),
    });
    const data = await res.json();
    console.log(12763, data);
    if (data.error) {
      console.log(19287, data);
      throw new Error(data.message);
    }
    this.baseUrl = mintUrl;
  }

  async getQuotes({ since }: { since?: number }) {
    const url = `${this.baseUrl}/api/v2/wallet/quotes`;
    const method = 'GET';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    const res = await authedJsonRequest(url + (since ? `?since=${since}` : ''), authHeader);
    const data = (await res.json()) as BalanceResponse;
    if (data.error) {
      console.log(2329837, data);
      throw new Error(data.message);
    }
    return data.data;
  }

  setUsername(
    username: string,
    paymentToken: undefined
  ): Promise<{
    error: true;
    message: string;
    data: { paymentToken: string; paymentRequest: string };
  }>;
  setUsername(
    username: string,
    paymentToken: string
  ): Promise<{ error: true; message: string } | { error: false }>;
  async setUsername(username: string, paymentToken: string | undefined) {
    const url = `${this.baseUrl}/api/v2/info/username`;
    const method = 'PUT';
    const authTemplate = createAuthTemplate(url, method);
    const signedAuthEvent = await this.signer.signEvent(authTemplate);
    const authHeader = createAuthHeader(signedAuthEvent);
    if (paymentToken) {
      const body = {
        username,
        paymentToken,
      };
      const res = await authedJsonRequest(url, authHeader, {
        method,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return data as {
        error: true;
        message: string;
        data: { paymentToken: string; paymentRequest: string };
      };
    } else {
      const body = {
        username,
      };
      const res = await authedJsonRequest(url, authHeader, {
        method,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return data as { error: boolean; message?: string };
    }
  }
}
