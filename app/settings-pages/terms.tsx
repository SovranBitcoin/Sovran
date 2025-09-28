import React from 'react';
import TermsAndConditions from 'components/ui/TermsAndConditions';

interface TermsConditionsScreenProps {
  onClose: () => void;
}

export default function TermsConditionsScreen({ onClose }: TermsConditionsScreenProps) {
  return <TermsAndConditions onClose={onClose} />;
}
