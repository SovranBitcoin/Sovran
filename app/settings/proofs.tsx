import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Button } from 'components/common/Button';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';

import Container from 'components/layout/Container';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, greys, reds } from 'helper/colors';
import { getWallet } from 'helper/cashu';
import { removeProofs } from 'helper/redux/cashu'; // Import the removeProofs action
import { ScrollView } from 'react-native';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

export default function ModalScreen() {
  const dispatch = useDispatch(); // Add dispatch hook
  const [proofStates, setProofStates] = useState({});
  const [checkingSpent, setCheckingSpent] = useState(false);
  const [removingSpent, setRemovingSpent] = useState(false);
  const [error, setError] = useState(null);
  const [activeMintsData, setActiveMintsData] = useState([]);

  const theme = useSelector(memoizedGetTheme);
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const profileId = useSelector((state) => state.nostr?.currentProfile?.id);

  // Improved selectors to get all data we need
  const selectedMint = useSelector((state) => state.cashu?.profiles?.[profileId]?.selectedMint);
  const allMints = useSelector((state) => state.cashu?.profiles?.[profileId]?.mints || []);
  const allProofs = useSelector((state) => state.cashu?.profiles?.[profileId]?.proofs || {});

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
    async (mintUrl) => {
      const mintProofs = allProofs[mintUrl];

      if (!mintProofs || mintProofs.length === 0) {
        setError(`No proofs available for mint: ${mintUrl}`);
        return;
      }

      setCheckingSpent(true);
      setError(null);

      try {
        const wallet = await getWallet({ unit: 'sat', mintUrl, profile: currentProfile });

        // Make sure proofs are in the correct format before checking
        const validProofs = mintProofs.filter(
          (proof) => proof && typeof proof === 'object' && proof.id && proof.C
        );

        if (validProofs.length === 0) {
          throw new Error(`No valid proofs found for mint: ${mintUrl}`);
        }

        const states = await wallet.checkProofsStates(validProofs);

        // Update proof states for this mint
        setProofStates((prevStates) => ({
          ...prevStates,
          [mintUrl]: states,
        }));
      } catch (err) {
        console.error(`Error checking spent status for ${mintUrl}:`, err);
        setError(`Error for ${mintUrl}: ${err.message || JSON.stringify(err)}`);
      } finally {
        setCheckingSpent(false);
      }
    },
    [allProofs, currentProfile]
  );

  // Function to check all mints
  const checkAllMints = useCallback(async () => {
    setCheckingSpent(true);
    setError(null);

    for (const mintUrl of allMints) {
      try {
        await checkProofSpentStatus(mintUrl);
      } catch (err) {
        console.error(`Failed to check mint ${mintUrl}:`, err);
        // Continue with other mints even if one fails
      }
    }

    setCheckingSpent(false);
  }, [allMints, checkProofSpentStatus, setCheckingSpent, setError]);

  // Function to remove spent proofs for a specific mint
  const removeSpentProofsForMint = async (mintUrl) => {
    setRemovingSpent(true);
    setError(null);

    const spentProofs = activeMintsData
      .find((mintData) => mintData.url === mintUrl)
      ?.proofs?.filter((proof, index) => proofStates[mintUrl][index].state === 'SPENT');

    if (spentProofs?.length > 0) {
      dispatch(removeProofs({ profileId, mintUrl, proofs: spentProofs }));
    }

    setRemovingSpent(false);
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

  // Helper function to count spent proofs for a mint
  const getSpentProofCount = (mintUrl) => {
    const states = proofStates[mintUrl] || [];
    return states.filter((state) => state?.state === 'SPENT').length;
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
        <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>Proof Status</Text>

        {error && <Text style={{ color: reds[300], marginBottom: 12 }}>{error}</Text>}

        <Button text="Refresh All Proofs" onPress={checkAllMints} disabled={checkingSpent} />

        {checkingSpent && <Text style={{ marginTop: 10 }}>Checking proof status...</Text>}
        {removingSpent && <Text style={{ marginTop: 10 }}>Removing spent proofs...</Text>}

        {activeMintsData.map((mintData) => {
          const spentProofCount = getSpentProofCount(mintData.url);

          return (
            <View
              key={mintData.url}
              style={{
                marginTop: 16,
                padding: 10,
                borderWidth: 1,
                borderColor: greys(theme)[1800],
                backgroundColor: greys(theme)[2000],
                borderRadius: 8,
              }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text
                  style={{ fontWeight: 'bold', flex: 1 }}
                  numberOfLines={1}
                  ellipsizeMode="middle">
                  {mintData.url}
                </Text>
                <Text style={{ fontWeight: 'bold' }}>Total: {mintData.totalAmount} sats</Text>
              </View>

              <Button
                text={`Check ${mintData.proofs.length} Proofs`}
                onPress={() => checkProofSpentStatus(mintData.url)}
                disabled={checkingSpent}
                style={{ marginBottom: 10 }}
              />

              {mintData.proofs.length > 0 && (
                <View>
                  {mintData.proofs.map((proof, index) => {
                    const states = proofStates[mintData.url] || [];
                    const state = states[index];
                    const isSpent = state?.state === 'SPENT';
                    const isPending = state?.state === 'PENDING';
                    const statusColor = isSpent ? reds[300] : isPending ? 'orange' : greens[300];

                    return (
                      <View
                        key={`${proof.id}-${index}`}
                        style={{
                          flexDirection: 'row',
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
                      </View>
                    );
                  })}

                  {/* Add Remove Spent Proofs button at the bottom of the list */}
                  <Button
                    text={`Remove ${spentProofCount} Spent Proofs`}
                    onPress={() => removeSpentProofsForMint(mintData.url)}
                    disabled={removingSpent || spentProofCount === 0}
                    style={{
                      marginTop: 10,
                      backgroundColor: spentProofCount > 0 ? reds[300] : undefined,
                    }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Container>
  );
}
