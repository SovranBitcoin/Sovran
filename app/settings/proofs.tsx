import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Button } from 'components/common/Button';
import { VStack, HStack, View } from 'components/common/View';
import { Text } from 'components/common/Text';

import Container from 'components/layout/Container';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, greys, reds } from 'helper/colors';
import { getWallet } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import { removeProofs } from 'helper/redux/cashu'; // Import the removeProofs action
import { ScrollView } from 'react-native';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { RootState } from 'helper/redux/store/reducer';
import { Proof, ProofState } from '@cashu/cashu-ts';

export default function ModalScreen() {
  const dispatch = useDispatch(); // Add dispatch hook
  const [proofStates, setProofStates] = useState<{ [key: string]: ProofState[] }>({});
  const [checkingSpent, setCheckingSpent] = useState(false);
  const [removingSpent, setRemovingSpent] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMintsData, setActiveMintsData] = useState<
    {
      url: string;
      isSelected: boolean;
      proofs: Proof[];
      totalAmount: number;
    }[]
  >([]);

  const theme = useSelector(memoizedGetTheme);
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const profileId = useSelector((state: RootState) => state.nostr?.currentProfile?.id);

  // Improved selectors to get all data we need
  const selectedMint = useSelector(
    (state: RootState) => state.cashu?.profiles?.[profileId]?.selectedMint
  );
  const allMints = useSelector(
    (state: RootState) => state.cashu?.profiles?.[profileId]?.mints || []
  );
  const allProofs = useSelector(
    (state: RootState) => state.cashu?.profiles?.[profileId]?.proofs || {}
  );

  console.log(JSON.stringify(allProofs, null, 2));
  // Prepare data structure for display
  useEffect(() => {
    const mintsData = [];

    for (const mintUrl of allMints) {
      const mintProofs = allProofs[mintUrl] || [];
      mintsData.push({
        url: mintUrl,
        isSelected: mintUrl === selectedMint,
        proofs: mintProofs,
        totalAmount: mintProofs.reduce((sum, proof) => sum + (proof.amount || 0), 0),
      });
    }

    setActiveMintsData(mintsData);
  }, [allMints, allProofs, selectedMint]);

  // Function to check proof spent status for a specific mint
  const checkProofSpentStatus = useCallback(
    async (mintUrl: string) => {
      const mintProofs = allProofs[mintUrl];

      if (!mintProofs || mintProofs.length === 0) {
        setError(`No proofs available for mint: ${mintUrl}`);
        return;
      }

      setCheckingSpent(true);
      setError(null);

      const walletResult = await getWallet({ unit: 'sat', mintUrl, profile: currentProfile });
      if (walletResult.isErr()) {
        console.error(`Error checking spent status for ${mintUrl}:`, walletResult.error);
        setError(`Error for ${mintUrl}: ${walletResult.error.message}`);
        setCheckingSpent(false);
        return;
      }

      const wallet = walletResult.value;

      const validProofs = mintProofs.filter(
        (proof) => proof && typeof proof === 'object' && proof.id && proof.C
      );

      if (validProofs.length === 0) {
        setError(`No valid proofs found for mint: ${mintUrl}`);
        setCheckingSpent(false);
        return;
      }

      const statesResult = await toResult(wallet.checkProofsStates(validProofs));
      if (statesResult.isErr()) {
        console.error(`Error checking spent status for ${mintUrl}:`, statesResult.error);
        setError(`Error for ${mintUrl}: ${statesResult.error.message}`);
        setCheckingSpent(false);
        return;
      }

      const states = statesResult.value;

      setProofStates((prevStates) => ({
        ...prevStates,
        [mintUrl]: states,
      }));
      setCheckingSpent(false);
    },
    [allProofs, currentProfile]
  );

  // Function to check all mints
  const checkAllMints = useCallback(async () => {
    setCheckingSpent(true);
    setError(null);

    for (const mintUrl of allMints) {
      await checkProofSpentStatus(mintUrl);
    }

    setCheckingSpent(false);
  }, [allMints, checkProofSpentStatus, setCheckingSpent, setError]);

  // Function to remove spent or pending proofs for a specific mint
  const removeSpentOrPendingProofsForMint = async (mintUrl: string) => {
    setRemovingSpent(true);
    setError(null);

    const spentOrPendingProofs = activeMintsData
      .find((mintData) => mintData.url === mintUrl)
      ?.proofs?.filter((proof, index) => {
        const state = proofStates[mintUrl]?.[index]?.state;
        return state === 'SPENT' || state === 'PENDING';
      });

    if (spentOrPendingProofs && spentOrPendingProofs.length > 0) {
      dispatch(removeProofs({ profileId, mintUrl, proofs: spentOrPendingProofs }));
    }

    setRemovingSpent(false);
  };

  // Function to remove ALL proofs for a specific mint
  const removeAllProofsForMint = async (mintUrl: string) => {
    setRemovingAll(true);
    setError(null);

    const proofsForMint = activeMintsData.find((mintData) => mintData.url === mintUrl)?.proofs;

    if (proofsForMint && proofsForMint.length > 0) {
      dispatch(removeProofs({ profileId, mintUrl, proofs: proofsForMint }));
    }

    setRemovingAll(false);
  };

  // Check proofs when component mounts - only once
  useEffect(() => {
    let isMounted = true;

    if (allMints.length > 0 && isMounted) {
      // Using a setTimeout to ensure it doesn't cause an immediate rerender cycle
      const timer = setTimeout(() => {
        if (isMounted && Object.keys(proofStates).length === 0) {
          checkAllMints();
        }
      }, 100);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }
  }, [allMints.length, checkAllMints, proofStates]);

  // Helper function to count spent or pending proofs for a mint
  const getSpentOrPendingProofCount = (mintUrl: string) => {
    const states = proofStates[mintUrl] || [];
    return states.filter((state) => state?.state === 'SPENT' || state?.state === 'PENDING').length;
  };

  if (allMints.length === 0) {
    return (
      <Container>
        <Text style={{ textAlign: 'center', padding: 20 }}>No mints available</Text>
      </Container>
    );
  }

  return (
    <Container>
      <ScrollView>
        <VStack spacing={16}>
          <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Proof Status</Text>

          <VStack spacing={12}>
            {error && <Text style={{ color: reds[300] }}>{error}</Text>}

            <Button
              variant="primary"
              text="Refresh All Proofs"
              onPress={checkAllMints}
              disabled={checkingSpent}
            />
          </VStack>

          <VStack spacing={10}>
            {checkingSpent && <Text>Checking proof status...</Text>}
            {removingSpent && <Text>Removing spent proofs...</Text>}
            {removingAll && <Text>Removing all proofs...</Text>}
          </VStack>
        </VStack>

        {activeMintsData.map((mintData) => {
          const spentOrPendingProofCount = getSpentOrPendingProofCount(mintData.url);

          return (
            <View
              key={mintData.url}
              style={{
                marginTop: 16,
                padding: 10,
                borderWidth: 1,
                borderColor: greys(theme)[800],
                backgroundColor: greys(theme)[900],
                borderRadius: 8,
              }}>
              <VStack spacing={8}>
                <HStack justify="space-between">
                  <Text
                    style={{ fontWeight: 'bold', flex: 1 }}
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {mintData.url}
                  </Text>
                  <Text style={{ fontWeight: 'bold' }}>Total: {mintData.totalAmount} sats</Text>
                </HStack>

                <Button
                  variant="primary"
                  text={`Check ${mintData.proofs.length} Proofs`}
                  onPress={() => checkProofSpentStatus(mintData.url)}
                  disabled={checkingSpent}
                />
              </VStack>

              {mintData.proofs.length > 0 && (
                <View>
                  {mintData.proofs.map((proof, index) => {
                    const states = proofStates[mintData.url] || [];
                    const state = states[index];
                    const isSpent = state?.state === 'SPENT';
                    const isPending = state?.state === 'PENDING';
                    const statusColor = isSpent ? reds[300] : isPending ? 'orange' : greens[300];

                    return (
                      <HStack
                        key={`${proof.id}-${index}`}
                        style={{
                          padding: 8,
                          marginBottom: 4,
                          borderRadius: 4,
                        }}>
                        <Text style={{ flex: 0.15 }}>#{index + 1}</Text>
                        <Text style={{ flex: 0.2 }}>{proof.amount} sats</Text>
                        <Text style={{ flex: 0.35, color: statusColor, fontWeight: 'bold' }}>
                          {state?.state || 'UNKNOWN'}
                        </Text>
                        <Text
                          style={{ flex: 0.3, fontFamily: 'monospace', fontSize: 10 }}
                          numberOfLines={1}>
                          {proof?.id ? `${proof.id.substring(0, 8)}...` : 'N/A'}
                        </Text>
                      </HStack>
                    );
                  })}

                  {/* Add Remove Spent or Pending Proofs button at the bottom of the list */}
                  <VStack spacing={10} style={{ marginTop: 10 }}>
                    <Button
                      variant="primary"
                      text={`Delete ${spentOrPendingProofCount} Spent or Pending Proofs`}
                      onPress={() => removeSpentOrPendingProofsForMint(mintData.url)}
                      disabled={removingSpent || removingAll || spentOrPendingProofCount === 0}
                      style={{
                        backgroundColor: spentOrPendingProofCount > 0 ? reds[300] : undefined,
                      }}
                    />
                    <Button
                      variant="primary"
                      text={`Delete All (${mintData.proofs.length}) Proofs`}
                      onPress={() => removeAllProofsForMint(mintData.url)}
                      disabled={removingAll || removingSpent || mintData.proofs.length === 0}
                      style={{
                        backgroundColor: mintData.proofs.length > 0 ? reds[300] : undefined,
                      }}
                    />
                  </VStack>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Container>
  );
}
