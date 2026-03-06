import { Proof } from '@cashu/cashu-ts';

const id = 0;
const mnemonic = undefined; // 'crumble stamp weapon meadow tilt logic winter mean tooth bracket wool fire';

export const nostrState = {
  profiles: [
    {
      id,
      mnemonic,
    },
  ],
  currentProfile: {
    id,
    mnemonic,
  },
};

const mintAToken = undefined; // 'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWN1c2RhdIGiYWlIAMB0uWx-Kw5hcIakYWEYQGFzeEBkMmJhOGNhMzUzNDQxMDIzMDBiMmUzNTM4OGI1NjMwOTMyNDQ5YjkzNGFhYjEzMDFiMjI0YWFlYzY3YjYzNGJlYWNYIQPYbav6VZekE2kd5gFEi-6zYdoXHb6Uoep1R-z6-yVuIWFko2FlWCAGFY0Yrmhv3_MuQbIM3JGRFQAFbWQLdZ5zpNAMd3VZA2FzWCAD-c30XB1HaoNpZViBjF5mZoHLQ-I5g41MP36nsMCDAmFyWCBUYffqkCs0XhEfBiGfPy8tWtKghEChQeKbVgSqy3rCdKRhYRBhc3hAMDE0NmNmZWU4ODI2MzQ0YzhlMDYxZWExM2EwMjMyZTU0ZDVmM2NkNzVhZDIzZGU0MWEzOGZiNDM2NTE5Y2I4ZGFjWCECHR2ETAEFvRGofDj2c2VZDU3AAI8QhPj2UPOiZax9SwthZKNhZVggtoDpHu-PcjDNglwa-oRYoHbaUtT1lLE7ErKrLbpFKnphc1ggeA-m-DEm0na_L-y2u9zdMMVJ8w_JXbphN48_xZ4GhmhhclggWpfGRnSOMUl7YenB1pkk6v3LiKXelfr7hWZXiMJF5E2kYWEQYXN4QDZhMGQzZjM3MWUyMjE5ZjVhN2JiYzBkZTBmZTkzZWFmNWY1YjA4NjljNmQ1MTNhOGVkNDRlZDZmMmE5MzNmZTNhY1ghAr_OTP7lT6X0vVqezA2JdptYjDtuo-uI-e93Ce38Q0zMYWSjYWVYIOLf9d1J-NF906IE_r8igzRfwtgZEPdUa92oz1PjL93gYXNYINDfO3VylWvGAkePiduG6A1ljNzcXtnhm-9131ehlE7ZYXJYIAx7bGXSg7_Kka6r-pHmmY-VyW6VoI8t19NwjNJhvNerpGFhAmFzeEBiY2UxNzExNmIxZWZkMmY3MGU2YjQ1YTAwZWRjOWM0ZTVhY2E2YjgwOTUxOThlZmVmYjgwOWQ3Mjk2ZTA0OTllYWNYIQIjReL5rwNJSHdQQSEnRie2crZJp4vyYivpUguJv2laoGFko2FlWCDQZZvYdrTvziJ4LQivxjSNizTIEe_lA5nTJpbv5AxROWFzWCAJ-lcZBuG24w9qmD2Cl65T45XdN8CLfR5eIUqCNFEvBWFyWCA0aDLmFAcF9kIg4aU3j4d3cfmvWS-VS_0XS2ry7bReuaRhYQFhc3hAYzhlNDk2OGM4OWMzOTg0MjRiYWZhOTMxMGUzOGIzYzY0N2MzMDIxNDE3YzNkNDc0MTQ1NWI2NjI0NGQ2ZDJhNWFjWCEDc9K21A6OOPZ-tZHQxzBdkyAJCA1ndhxI9ynIbWILgQdhZKNhZVggZs5lOwBNiIJPk4CqQN41hstH1AOIReMd76wSMIAegb5hc1ggxgsmJ92E1bjs7L5_UfUMF_4JNy_ofBbqUh95JTrw511hclggJrUmFPrg6VKjfN4vwCNOq7IQ_Niey4svGWXpenBiQ_6kYWEBYXN4QDY4YTFiMGMwYmI0ZmJlODZmMzA2OTYyZDYwMjZkNjU4MTJmMGU1NzdiYTZmY2VjYmIyMWZmOTMwMzA0MTk3YzNhY1ghAinsDc1YOTj_3F3Hiu_9YbIRzx3kamgXEYFP38-xGQpCYWSjYWVYID_yNplssQD7JGW7lfv1UJyEDRBSdNJDmt-uZpM8c7ViYXNYICK46IsyGF_W8lv9fSpAwcCD-QMaOZUJNzsSI6HsnnLvYXJYIEG0OsMPM-3M-Wn6kR1tfOl6iTGw78cLXM8lKYd_J41h';
type DecodedToken = { mint: string; proofs: Proof[] };
const decodedMintAToken: DecodedToken | undefined = undefined; //getDecodedToken(mintAToken);

// Extract values to avoid TypeScript narrowing issues
// Use explicit type guard to help TypeScript
let mintUrl: string | undefined = undefined;
let proofs: Proof[] | undefined = undefined;
if (decodedMintAToken !== undefined && decodedMintAToken !== null) {
  const token: DecodedToken = decodedMintAToken;
  mintUrl = token.mint;
  proofs = token.proofs;
}

export const cashuState = {
  selectedMint: mintUrl,
  profiles: {
    mints: mintUrl ? [mintUrl] : [],
    counters:
      mintUrl && proofs
        ? {
            [mintUrl]: Object.fromEntries(proofs.map((proof: Proof) => [proof.id, 100])),
          }
        : {},
    proofs:
      mintUrl && proofs
        ? {
            [mintUrl]: proofs,
          }
        : {},
  },
};
