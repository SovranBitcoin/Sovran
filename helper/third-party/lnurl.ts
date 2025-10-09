// from enuts

import bolt11 from 'light-bolt11-decoder';
import { getProtocolForUrl } from '../url';
const LNURL_REGEX = /^(?:http.*[&?]lightning=|lightning:)?(lnurl[0-9]{1,}[02-9ac-hj-np-z]+)/;

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

export interface LightningAddress {
  username: string;
  domain: string;
}

/**
 * Parse an url and return a bech32 encoded url (lnurl)
 * @method parseLnUrl
 * @param  url string to parse
 * @return  bech32 encoded url (lnurl) or null if is an invalid url
 */
export const parseLnUrl = (url: string): string | null => {
  if (!url) {
    return null;
  }
  const result = LNURL_REGEX.exec(url.toLowerCase());
  return result ? result[1] : null;
};

export function isLightningInvoice(invoice: string) {
  try {
    bolt11.decode(invoice);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify if a string is a lightning adress
 * @method isLightningAddress
 * @param  address string to validate
 * @return  true if is a lightning address
 */
export const isLightningAddress = (address: string): boolean => {
  if (!address) {
    return false;
  }
  return LN_ADDRESS_REGEX.test(address);
};

/**
 * Parse an address and return username and domain
 * @method parseLightningAddress
 * @param  address string to parse
 * @return  LightningAddress { username, domain }
 */
export const parseLightningAddress = (address: string): LightningAddress | null => {
  if (!address) {
    return null;
  }
  const result = LN_ADDRESS_REGEX.exec(address);
  return result ? { username: result[1], domain: result[2] } : null;
};

/**
 * Verify if a string is a lnurlp url
 * @method isLnurlp
 * @param  url string to validate
 * @return  true if is a lnurlp url
 */
export const isLnurlp = (url: string): boolean => {
  if (!url) {
    return false;
  }
  return LNURLP_REGEX.test(url);
};

/**
 * Parse a lnurlp url and return an url with the proper protocol
 * @method parseLnurlp
 * @param  url string to parse
 * @return  url (http or https) or null if is an invalid lnurlp
 */
export const parseLnurlp = (url: string): string | null => {
  if (!url) {
    return null;
  }
  const parsedUrl = url.toLowerCase();
  if (!LNURLP_REGEX.test(parsedUrl)) {
    return null;
  }
  const protocol = getProtocolForUrl(parsedUrl);
  return parsedUrl.replace('lnurlp://', protocol);
};

export function lnTrim(str: string) {
  if (!str || !isStr(str)) {
    return '';
  }
  str = str.trim().toLowerCase();
  const uriPrefixes = [
    'lightning:',
    'lightning=',
    'lightning://',
    'lnurlp://',
    'lnurlp=',
    'lnurlp:',
    'lnurl:',
    'lnurl=',
    'lnurl://',
  ];
  uriPrefixes.forEach((prefix) => {
    if (!str.startsWith(prefix)) {
      return;
    }
    str = str.slice(prefix.length).trim();
  });
  return str.trim();
}

export function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
