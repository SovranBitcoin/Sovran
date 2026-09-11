import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { Card } from 'heroui-native';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { legalDocuments, type LegalDocumentId } from '@/shared/lib/legal/legalDocuments';

/** Bundled plain text: works offline and cannot run HTML from a remote policy. */
export function LegalDocumentScreen({
  documentId,
  step,
  children,
  navigation,
}: {
  documentId: LegalDocumentId;
  step?: string;
  children?: ReactNode;
  navigation?: ReactNode;
}) {
  const document = legalDocuments[documentId];
  const operator = legalDocuments.operator;
  const lastParagraph = document.sections.at(-1)?.paragraphs.at(-1);
  return (
    <Screen name="LegalDocumentScreen" scroll="custom" safeArea>
      <VStack className="flex-1 gap-4 p-4">
        <VStack className="gap-1">
          <Text
            testID={step ? 'legal-review-title' : undefined}
            size={32}
            bold
            className="text-center"
            accessibilityRole="header">
            {documentId === 'terms' ? 'Terms' : 'Privacy'}
          </Text>
          {step && <Text className="text-muted text-center">{step}</Text>}
        </VStack>
        <Card variant="secondary" className="flex-1 p-0">
          <ScrollView
            key={documentId}
            testID={`legal-document-${documentId}`}
            className="flex-1"
            contentContainerClassName="px-3 py-4">
            <VStack className="gap-5">
              <Text size={18} bold>
                {document.title}
              </Text>
              <Text className="text-muted">Updated {document.updated}</Text>
              {!legalDocuments.publicationReady && (
                <Text className="text-danger">
                  Draft for review. Operator details and operational practices must be confirmed
                  before publication.
                </Text>
              )}
              <Text selectable>
                {operator.name}
                {'\n'}
                {operator.country}
                {'\n'}
                {operator.address}
                {'\n'}
                {operator.email}
              </Text>
              {document.sections.map((section) => (
                <VStack key={section.title} className="gap-3">
                  <Text size={18} bold accessibilityRole="header">
                    {section.title}
                  </Text>
                  {section.paragraphs.map((paragraph) => (
                    <Text
                      key={paragraph}
                      testID={
                        paragraph === lastParagraph ? `legal-document-end-${documentId}` : undefined
                      }
                      size={14}
                      selectable
                      className="leading-[22px]">
                      {paragraph}
                    </Text>
                  ))}
                </VStack>
              ))}
            </VStack>
          </ScrollView>
        </Card>
        {children}
        {navigation}
      </VStack>
    </Screen>
  );
}
