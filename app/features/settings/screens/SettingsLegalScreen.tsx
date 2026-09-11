import { LegalDocumentScreen } from '@/shared/blocks/LegalDocumentScreen';
import type { LegalDocumentId } from '@/shared/lib/legal/legalDocuments';

export function SettingsLegalScreen({ documentId }: { documentId: LegalDocumentId }) {
  return <LegalDocumentScreen documentId={documentId} />;
}
