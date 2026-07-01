type MintInfoHref = {
  pathname: '/(mint-flow)/info';
  params: {
    mintInfoEntry: string;
  };
};

export function getProfileMintInfoUrl(
  profileMintUrl: unknown,
  routeMintUrl: string | undefined
): string | undefined {
  if (typeof profileMintUrl === 'string' && profileMintUrl.length > 0) {
    return profileMintUrl;
  }
  return routeMintUrl;
}

export function buildMintInfoHref(mintUrl: string): MintInfoHref {
  return {
    pathname: '/(mint-flow)/info',
    params: {
      mintInfoEntry: JSON.stringify({ mintUrl }),
    },
  };
}
