import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import documents from './documents.json';

export { documents as legalDocuments };
export type LegalDocumentId = 'terms' | 'privacy';
type LegalDocument = typeof documents.terms;

/** Fingerprint the actual notice, including operator identity; never rely on a manual version bump. */
export function legalRevision(document: LegalDocument, operator = documents.operator): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({ operator, document, publicationReady: documents.publicationReady })
      )
    )
  );
}

export const legalRevisions = {
  terms: legalRevision(documents.terms),
  privacy: legalRevision(documents.privacy),
};

export interface LegalAcceptance {
  termsRevision: string;
  privacyRevision: string;
  acceptedAt: string;
}

export function hasCurrentLegalAcceptance(acceptance: LegalAcceptance | null): boolean {
  return (
    acceptance?.termsRevision === legalRevisions.terms &&
    acceptance.privacyRevision === legalRevisions.privacy
  );
}
