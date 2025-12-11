import React, { useState } from 'react';
import { Button } from 'components/ui/Button';
import { ScrollView, Switch } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';

const terms = `IMPORTANT NOTICE: THESE TERMS OF SERVICE INCLUDE A MEDIATION-FIRST CLAUSE REQUIRING MEDIATION BEFORE ARBITRATION OR LITIGATION. PLEASE READ THESE TERMS CAREFULLY. IF YOU DO NOT AGREE, DO NOT USE SOVRAN.

ALL REFERENCES TO LAW, REGULATION, AND JURISDICTION IN THESE TERMS REFER TO THE LAWS AND REGULATIONS OF THE USER'S JURISDICTION. USERS ARE RESPONSIBLE FOR DETERMINING THE LEGALITY AND REGULATORY COMPLIANCE OF THEIR ACTIVITIES.

SOVRAN DOES NOT HOLD USERS' ECASH, DOES NOT EXECUTE AND CANNOT MONITOR TRANSACTIONS, AND DOES NOT OPERATE OR VERIFY ANY MINTS.

These Terms of Service (these "Terms") constitute the entire agreement and understanding between you ("you" or "your") and Sovran ("Sovran," "we," "us," or "our") regarding your use of the Sovran mobile application and any related applications, software, code, or services (collectively, the "App" or "Services"). By accessing or using the App or Services, you acknowledge that you have read, understand, and agree to be bound by these Terms. If you do not agree, do not access or use the App or Services.

1. Nature of the Services

1.1 Non-Custodial Application: Sovran provides a non-custodial application ("wallet") that is executed entirely on your device. Our App merely makes available client-side code implementing the open-source Cashu protocol. We do not run a server that holds your ecash or executes transactions on your behalf.

1.2 No Control Over Mints: Sovran does not issue ecash and does not operate or control any Mint. The choice of any Mint and any transaction or relationship you establish with that Mint is solely between you and that Mint. Sovran has no involvement, responsibility, or liability in any such interaction.

1.3 No Funds Access: At no time does Sovran have custody, possession, or control of your ecash. Transactions occur solely by your actions and through your chosen Mint. We do not monitor, verify, or facilitate transfers between you and any Mint or other parties.

1.4 Server Operations: Sovran does not operate any servers except those providing functionality to purchase eSIMs. The application is executed entirely on your device. Once the code is served, all logic executes locally and Sovran has no control over the application.

1.5 Open Source Code: The application code is open source, meaning it can be self-hosted. Sovran has no control over, and does not endorse or assume responsibility for, any instances of the code running outside of Sovran service. Your use of any such third-party instances is at your own risk.

1.6 Code Disclaimer: The open-source code is provided without any guarantee of security, error-free operation, or technical support. Users must independently verify the authenticity, security, and integrity of the open-source code prior to use.

2. User Responsibilities & Disclaimers

2.1 User's Sole Responsibility: You understand and agree that you use the App and Services at your own risk and for your own account. You alone are fully responsible for selecting Mints, conducting transactions, and safeguarding your ecash and secret values. Sovran is not a party to and disclaims any responsibility for any agreements, terms, or disputes between you and any Mint.

2.2 No Partnership with Mints: Sovran is not affiliated with, endorsed by, or responsible for any Mint. We make no representations, warranties, or guarantees about any Mint's integrity, legality, liquidity, or functionality. Your relationship with any Mint, including the issuance, redemption, or valuation of ecash, is solely a matter between you and that Mint. Sovran is not a party to any transaction between you and any Mint or third party. No agency, partnership, or joint venture relationship is formed by your use of the App.

2.3 Risk of Ecash: Ecash is an experimental, bearer-like digital asset that may not be recognized as money, currency, or a store of value. Anyone with the secret value has control over the ecash. You agree to review and understand all risks disclosed in our Risk Disclosure Statement before using ecash.

3. Modifications to Terms

We may amend or update these Terms at any time without notice. You are advised to review these Terms periodically. Your continued use of the App or Services after any modifications constitutes acceptance of the updated Terms. If you do not agree, discontinue your use.

4. Compliance with Laws

4.1 Legal Compliance: Your use of the App and any Services is void where prohibited by law. You must determine whether your use of ecash and related activities are lawful. You are solely responsible for compliance with all applicable laws, taxes, and regulations.

4.2 Not Financial Services: The Services are not intended to constitute regulated financial, banking, e-money, or payment services. You are solely responsible for determining whether your use of ecash or related activities requires any form of license, registration, or compliance with financial regulations in your jurisdiction.

5. License to Use the App

Subject to your compliance with these Terms, we grant you a limited, personal, non-exclusive, non-transferable, revocable license to use the App. We may suspend or terminate your access at our sole discretion.

6. Risks and Limitation of Liability

6.1 No Liability for Interactions with Mints: Sovran is not liable for any transactions, disputes, or issues arising from your dealings with Mints.

6.2 Assumption of Risk: You acknowledge ecash-related activities involve significant risks, including market volatility, theft, and regulatory uncertainty.

6.3 Waiver of Accountability: By using the App, you waive any right to hold Sovran accountable for any damages, losses, or disputes arising from your use of the App or Services.

6.4 No Warranties: THE APP AND SERVICES ARE PROVIDED "AS IS" WITHOUT ANY WARRANTIES. WE DISCLAIM ALL WARRANTIES TO THE MAXIMUM EXTENT PERMITTED BY LAW.

6.5 Limitation of Liability: TO THE FULLEST EXTENT PERMITTED BY LAW, SOVRAN IS NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO THESE TERMS, THE APP, OR THE SERVICES.

6.6 Maximum Liability: To the maximum extent permitted by applicable law, the App and Services are provided 'as is' without warranties of any kind. This does not affect any statutory warranties or rights which cannot be excluded under your jurisdiction's law.

7. Indemnification and Release

You agree to indemnify and hold harmless Sovran and its affiliates from claims arising out of your use of the App or Services. If you have a dispute with any Mint or third party, you release Sovran from all related claims.

8. Mediation and Dispute Resolution

8.1 Mediation Requirement: If a dispute arises out of or relates to these Terms, the App, or the Services, the parties agree to first attempt to resolve the dispute through good-faith mediation administered by a reputable mediation provider. Each party shall bear its own costs for the mediation, and the costs of the mediator shall be shared equally.

8.2 Arbitration Option: If mediation does not resolve the dispute within 30 days (or a mutually agreed period), either party may initiate final and binding arbitration administered by a reputable arbitration provider within the user's jurisdiction. Arbitration shall be conducted on an individual basis, and class actions or collective proceedings are not permitted.

8.3 Waiver of Jury Trial: If arbitration is not invoked and the dispute proceeds to court, you waive your right to a trial by jury to the fullest extent permitted by the governing law of your jurisdiction.

8.4 EU Consumer Rights: If you are residing in the EU, any mandatory statutory rights regarding dispute resolution procedures remain unaffected by this clause. Nothing in this Section 8 shall limit or affect any mandatory rights you may have under EU consumer protection or other applicable statutory laws.

9. Prohibited Uses

You may not use the App or Services for unlawful activities, to violate applicable laws, or to engage in market manipulation. We may suspend or terminate access for prohibited uses. You agree not to use the App or Services to engage in any activity that violates applicable anti-money laundering (AML), counter-terrorism financing (CTF), or other financial crime regulations. Any use of the App or Services for unlawful or fraudulent purposes is strictly prohibited.

10. Privacy and Data Protection

10.1 GDPR Compliance: Sovran does not collect or store any personal data, including IP addresses. No data is shared with third parties. As such, Sovran does not engage in data processing activities that would subject it to GDPR or similar regulations. Users remain responsible for ensuring their own device's security and verifying the authenticity of the code they run.

10.2 Security: Because the code executes entirely on your device and no personal data is collected, Sovran does not perform any data processing activities that would fall under the GDPR or similar data protection laws.

10.3 Local Data: Any data or information stored locally on your device, including browser storage, cookies, or application state, is controlled by you and not transmitted to or accessible by Sovran.

11. Your Representations and Warranties

You represent and warrant you have the right and authority to enter into these Terms and that your use of the App will be lawful.

12. No Investment Advice

Sovran does not provide investment, legal, or tax advice. No fiduciary, advisory, or trust relationship is formed between you and Sovran by using the App or Services.

13. No Waiver

No failure or delay to exercise any right by Sovran shall constitute a waiver of that right.

14. Force Majeure

Sovran is not liable for delays or failures due to events beyond our reasonable control.

15. Assignment

You may not assign your rights without our consent. We may assign our rights freely.

16. Severability

If any provision is deemed invalid, remaining provisions remain in effect.

17. Electronic Communications; Language

By using the App or Services, you consent to receive communications electronically. We will communicate in English.

18. Governing Law

18.1 Choice of Law: These Terms and any dispute arising from or related to these Terms, the App, or the Services shall be governed by the applicable laws of your jurisdiction, without regard to conflict of law principles.

18.2 Consumer Rights: Nothing in these Terms shall exclude or limit any rights you may have under applicable mandatory consumer protection laws or regulations in your jurisdiction, including any rights under EU law that cannot be lawfully limited or disclaimed.

19. E-Sign Consent Policy

By using the App, you consent to receive all communications electronically.

20. Risk Disclosure Statement

Using ecash involves significant risks including legal, market, liquidity, counterparty, and operational risks. You acknowledge and accept these risks.

21. Entire Agreement

These Terms represent the entire agreement between you and Sovran.`;

interface TermsAndConditionsProps {
  onClose: () => void;
  title?: string;
  buttonText?: string;
  checkboxText?: string;
  showCheckbox?: boolean;
}

export default function TermsAndConditions({
  onClose,
  title = 'Terms',
  buttonText = 'Next',
  checkboxText = 'I have read and agree to the Terms and Conditions',
  showCheckbox = true,
}: TermsAndConditionsProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const [isChecked, setIsChecked] = useState(false);

  const toggleCheckbox = () => setIsChecked(!isChecked);

  return (
    <Container className="bg-primary-900">
      <VStack spacing={16} flex={1} className="p-4">
        {/* Header - fixed at top */}
        <Text overpass bold size={32} className="py-2 text-center text-primary-50">
          {title}
        </Text>

        {/* Scrollable terms content */}
        <ScrollView
          style={{
            flex: 1,
            backgroundColor: getPrimaryColor('800'),
            borderRadius: 12,
          }}
          contentContainerStyle={{ padding: 16 }}>
          <Text overpass size={14} className="leading-[22px] text-primary-0">
            {terms}
          </Text>
        </ScrollView>

        {/* Fixed bottom section */}
        <VStack spacing={16}>
          {showCheckbox && (
            <TouchableOpacity onPress={toggleCheckbox}>
              <HStack align="center" spacing={12}>
                <Switch
                  value={isChecked}
                  onValueChange={toggleCheckbox}
                  trackColor={{
                    false: getPrimaryColor('700'),
                    true: getShadeColor('300'),
                  }}
                  thumbColor={getPrimaryColor('0')}
                />
                <Text id="terms-checkbox" overpass size={14} className="flex-1 text-primary-0">
                  {checkboxText}
                </Text>
              </HStack>
            </TouchableOpacity>
          )}

          <Button
            variant="primary"
            text={buttonText}
            onPress={onClose}
            disabled={showCheckbox ? !isChecked : false}
          />
        </VStack>
      </VStack>
    </Container>
  );
}
