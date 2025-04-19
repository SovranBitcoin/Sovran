import React, { useState, useEffect, useRef } from 'react';
import { View, Animated, ScrollView, Dimensions, Easing, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedCircularProgress } from 'react-native-circular-progress';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Text } from 'components/common/Themed';
import { getMint, restoreMint } from 'helper/cashu';
import { fetchEventFromRelays } from 'helper/nostr/cashu';
import { getPublicKey, nip19 } from 'nostr-tools';
import * as nip06 from 'node_modules/nostr-tools/lib/cjs/nip06';
import { createStyles } from './helper';
import { FlagIcon } from 'assets/icons/flag';
import { CurrencyIcon } from 'assets/icons';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { useNostr } from 'helper/redux/nostr';
import { store } from 'helper/redux/store';
import { appendProofsV2 } from 'helper/redux/cashu';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { MintItem } from './MintItem';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { SheetManager } from 'react-native-actions-sheet';

const { height } = Dimensions.get('window');

// Main animation component for restoring wallet/mints
const ChainLoadingAnimation = () => {
  async function* onMessage(message: { type: string }) {
    switch (message.type) {
      case 'processing': {
        const accountIndexes = [0, 1, 2];
        const profiles = [];

        // Fetch profiles and yield progress
        for (const index of accountIndexes) {
          const profile = await getProfile(index);

          yield {
            label: 'PROFILE_FOUND',
            current: index + 1,
            max: accountIndexes.length,
          };

          if (profile) {
            profiles.push(profile);
          }
        }

        // Generate HD root key
        const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));

        // Transform profiles with additional data
        const processedProfiles = profiles.map((profile) => ({
          ...profile,
          id: profile.id,
          pubkey: profile.pubkey,
          picture: profile.profile?.image,
          npub: profile.npub,
          nsec: profile.nsec,
          mnemonic,
          root: {
            xpub: root.publicExtendedKey,
            xpriv: root.privateExtendedKey,
          },
        }));

        // Create and add profile steps
        const profileSteps = processedProfiles.map((profile, index) => ({
          type: 'profile',
          label: 'Profile',
          icon: 'person',
          iconUrl: profile.profile?.image,
          profile,
          id: `profile-${index}`,
        }));

        setSteps([...steps, ...profileSteps]);

        return { type: 'complete' };
      }

      case 'profile': {
        // Extract profile data
        const { id: profileId, mints: mintsToProcess } = message.payload.profile;

        // Find the corresponding profile step
        const currentProfileIndex = steps.findLastIndex(
          (step) => step.type === 'profile' && step.profile?.id === profileId
        );

        if (currentProfileIndex === -1) return { type: 'complete' };

        // Helper function to create add button step
        const createAddButtonStep = () => ({
          id: `add-mint-${profileId}`,
          type: 'add-button',
          label: 'Add Mint',
          icon: 'add-circle',
          forProfileId: profileId,
        });

        // Helper function to insert step after profile
        const insertStepAfterProfile = (step) => {
          const newSteps = [
            ...steps.slice(0, currentProfileIndex + 1),
            step,
            ...steps.slice(currentProfileIndex + 1),
          ];
          setSteps(newSteps);
          return { type: 'complete', payload: newSteps };
        };

        // Handle case when no mints are provided
        if (!mintsToProcess?.length) {
          return insertStepAfterProfile(createAddButtonStep());
        }

        // Process each mint
        const mints = [];
        for (let index = 0; index < mintsToProcess.length; index++) {
          const mint = mintsToProcess[index];
          try {
            const mintInfo = await (await getMint({ mintUrl: mint })).getInfo();
            const units = mintInfo.nuts[4].methods.map((method) => ({
              name: method.unit,
              weight: 0.5,
            }));

            mints.push({
              id: `mint-${profileId}-${index}`,
              label: mintInfo.name,
              iconUrl: mintInfo.icon_url,
              mintUrl: mint,
              currencies: units,
            });

            yield {
              label: 'MINT_FOUND',
              current: index + 1,
              max: mintsToProcess.length,
            };
          } catch (error) {
            // Silently handle mint processing errors
          }
        }

        // If we successfully processed any mints, create a mint group
        if (mints.length > 0) {
          const mintGroup = {
            id: `mintgroup-${profileId}`,
            type: 'mint-group',
            label: 'Loading Mint',
            icon: 'person',
            mints,
            forProfileId: profileId,
          };
          return insertStepAfterProfile(mintGroup);
        }

        // If no mints were successfully processed, add the button step
        return insertStepAfterProfile(createAddButtonStep());
      }

      case 'add-button':
        // This case will handle the button click event
        // For now, we'll just yield a complete message
        // You would implement the actual functionality here
        Alert.alert('add mint', 'add mint');
        yield {
          label: 'WAITING_FOR_INPUT',
          message: "Sovran couldn't detect a mint. Please add the one your account was using.",
        };

        return {
          type: 'complete',
        };

      case 'mint-group':
        Alert.alert('mint group', 'mint group');
        const profile = steps.find((step) => step.type === 'profile')?.profile;

        for (const mint of message.payload.mints) {
          const { mintUrl } = mint;
          const generator = await restoreMint({ mintUrl, profile });
          let result = await generator.next();

          while (!result.done) {
            result = await generator.next();
            yield result.value;
          }

          const { value: restoredMint } = result;
          const proofs = Object.values(restoredMint).flatMap((mint) => mint?.proofs || []);

          store.dispatch(
            appendProofsV2({
              profileId: profile.id,
              mintUrl,
              proofs,
            })
          );
        }

        return { type: 'complete' };
    }
  }

  const { mnemonic } = useTypedRoute();
  async function getProfile(accountIndex: number) {
    const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
      mnemonic,
      undefined,
      accountIndex
    );

    let nsec = nip19.nsecEncode(sk);
    const profileData = await fetchAccountData({ nsec });

    if (profileData?.profile?.created_at) {
      const mintsInfo = await fetchEventFromRelays(pk);

      const mints = mintsInfo?.tags.filter((tag) => tag[0] === 'mint').map((tag) => tag[1]) || [];

      return { ...profileData, mints, mnemonic, id: accountIndex, nsec };
    } else {
      return null;
    }
  }

  // Initialize with processing step
  const [steps, setSteps] = useState([
    {
      type: 'processing',
      label: 'Processing',
      icon: 'settings',
      id: 0,
    },
  ]);

  const { setProfiles, setCurrentProfile } = useNostr();

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  // Animation states
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currencyIndex, setCurrencyIndex] = useState(0);
  const [connectingLines, setConnectingLines] = useState({});
  const [message, setMessage] = useState('');
  const [progressObject, setProgressObject] = useState({});

  // References
  const scrollViewRef = useRef(null);
  const lineScaleY = useRef({}).current;
  const mintPosition = useRef(new Animated.Value(0)).current;

  // Track mint groups and active mint in each group
  const [activeMints, setActiveMints] = useState({});

  // Initialize animation values for connection lines
  useEffect(() => {
    steps.forEach((step, index) => {
      if (index < steps.length - 1) {
        lineScaleY[index] = new Animated.Value(0);
      }
    });
  }, [steps]);

  // Initialize active mints for each mint group
  // useEffect(() => {
  //   const initialActiveMints = {};
  //   steps.forEach((step) => {
  //     if (step.type === 'mint-group' && step.mints.length > 0) {
  //       initialActiveMints[step.id] = step.mints[0].id;
  //     }
  //   });
  //   setActiveMints(initialActiveMints);
  // }, [steps]);

  // Scroll to active step
  useEffect(() => {
    if (scrollViewRef.current) {
      const stepHeight = height;
      const scrollTo = activeStep * stepHeight;
      scrollViewRef.current.scrollTo({ y: scrollTo, animated: true });
    }
  }, [activeStep, activeMints]);

  // Animate the connecting line between steps
  const animateConnectingLine = (stepIndex) => {
    setConnectingLines((prev) => ({
      ...prev,
      [stepIndex]: true,
    }));

    Animated.timing(lineScaleY[stepIndex], {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  };

  // Handle profile animation
  const handleProfileAnimation = () => {
    animateConnectingLine(activeStep);

    // Wait for line animation to complete before moving to next step
    setTimeout(() => {
      setProgress(0);
      setCurrencyIndex(0);
      setActiveStep((prevStep) => prevStep + 1);
    }, 500);
  };

  // const handleProfileAnimationBackwards = () => {
  //   animateConnectingLine(activeStep);

  //   // Wait for line animation to complete before moving to next step
  //   setTimeout(() => {
  //     setProgress(0);
  //     setCurrencyIndex(0);
  //     setActiveStep((prevStep) => prevStep - 1);
  //   }, 500);
  // };

  const navigation = useTypedNavigation();

  // Handle completion
  const handleComplete = () => {
    navigation.navigate(
      '',
      {},
      {
        closeParents: true,
      }
    );
  };

  // Corrected function for calculating global progress
  const calculateGlobalProgress = (currencyIndex, currencyProgress, totalCurrencies) => {
    if (totalCurrencies <= 0) return 0;

    // Special case for a single currency
    if (totalCurrencies === 1) {
      return currencyProgress; // For single currency, global progress equals currency progress
    }

    // For multiple currencies, calculate proportionally
    const completedCurrenciesProgress = currencyIndex / totalCurrencies;
    const currentCurrencyContribution = currencyProgress / totalCurrencies;

    return completedCurrenciesProgress + currentCurrencyContribution;
  };

  // Process messages from the animation flow
  useEffect(() => {
    requestAnimationFrame(async () => {
      const generator = await onMessage({
        type: steps[activeStep].type,
        payload: steps[activeStep],
      });

      let result = await generator.next();

      while (!result.done) {
        const currentStep = steps[activeStep];
        setMessage(result.value.message);
        const mintUrl = result?.value?.mintUrl;
        const currentMint = currentStep?.mints?.find((m) => m?.mintUrl === mintUrl);

        const totalCurrencies = currentMint?.currencies?.length || 1;

        switch (result.value.label) {
          case 'PROFILE_FOUND': {
            // Calculate progress based on current index and maximum accounts
            const currentIndex = result.value.current;
            const maxAccounts = result.value.max;

            // Calculate progress percentage (0-1)
            const profileProgress = currentIndex / maxAccounts;

            // Update the progress for the current step
            setProgress(profileProgress);

            // Update message to show progress
            setMessage(`Finding profiles: ${currentIndex} of ${maxAccounts}`);
            break;
          }
          case 'MINT_FOUND': {
            // Calculate progress based on current index and maximum mints
            const currentIndex = result.value.current;
            const maxMints = result.value.max;

            // Calculate progress percentage (0-1)
            const mintProgress = currentIndex / maxMints;

            // Update the progress for the current step
            setProgress(mintProgress);

            // Update message to show progress
            setMessage(`Finding mints: ${currentIndex} of ${maxMints}`);
            break;
          }
          case 'INIT':
            setCurrencyIndex(
              currentMint?.currencies?.findIndex((c) => c?.name === result?.value?.unit)
            );

            setProgressObject((prev) => ({
              ...prev,
              [result?.value?.mintUrl]: {
                progress: 0, // Global progress for the entire mint
                currencies: {
                  ...(prev?.[result?.value?.mintUrl]?.currencies || {}),
                  [result?.value?.unit]: {
                    progress: 0, // Currency-specific progress
                  },
                },
              },
            }));
            break;

          case 'RESTORING KEYSET':
            setProgressObject((prev) => ({
              ...prev,
              [result?.value?.mintUrl]: {
                progress: calculateGlobalProgress(
                  currentMint?.currencies?.findIndex((c) => c?.name === result?.value?.unit),
                  0.1,
                  totalCurrencies
                ),
                currencies: {
                  ...(prev?.[result?.value?.mintUrl]?.currencies || {}),
                  [result?.value?.unit]: {
                    progress: 0.1, // Currency-specific progress
                  },
                },
              },
            }));
            break;

          case 'RESTORING BATCH':
            const batchProgress = Math.max(0.1, result.value.batchStart / result.value.batchEnd);

            const gp = calculateGlobalProgress(
              currentMint?.currencies?.findIndex((c) => c?.name === result?.value?.unit),
              batchProgress,
              totalCurrencies
            );

            setProgressObject((prev) => ({
              ...prev,
              [result?.value?.mintUrl]: {
                progress: gp,
                currencies: {
                  ...(prev?.[result?.value?.mintUrl]?.currencies || {}),
                  [result?.value?.unit]: {
                    progress: batchProgress, // Currency-specific progress
                  },
                },
              },
            }));
            break;

          case 'KEYSET_COMPLETE':
            setProgressObject({
              ...progressObject,
              [result?.value?.mintUrl]: {
                progress: calculateGlobalProgress(
                  currentMint?.currencies?.findIndex((c) => c?.name === result?.value?.unit),
                  1,
                  totalCurrencies
                ),
                currencies: {
                  ...(progressObject?.[result?.value?.mintUrl]?.currencies || {}),
                  [result?.value?.unit]: {
                    progress: 1, // Currency-specific progress
                  },
                },
              },
            });

            setCurrencyIndex(
              currentMint?.currencies?.findIndex((c) => c?.name === result?.value?.unit)
            );
            break;

          case 'COMPLETE':
            if (currentStep.type === 'mint-group') {
              const mintIndex = currentStep.mints.findIndex((m) => m.id === currentMint?.id);

              // Check if there's a next mint to transition to
              if (mintIndex < currentStep.mints.length - 1) {
                setCurrencyIndex(0);

                setActiveMints((prev) => ({
                  ...prev,
                  [currentStep.id]: currentStep.mints[mintIndex + 1].id,
                }));
              }
            }
            break;
        }

        result = await generator.next();
      }

      // Handle different step types completion
      if (steps[activeStep].type === 'processing') {
        setTimeout(() => {
          handleProfileAnimation();
        }, 1000);
      } else if (steps[activeStep].type === 'profile') {
        setTimeout(() => {
          handleProfileAnimation();
        }, 1000);
      } else if (steps[activeStep].type === 'mint-group') {
        setTimeout(() => {
          handleProfileAnimation();
        }, 1000);
      } else if (steps[activeStep].type === 'complete') {
        handleComplete();
      }
    });
  }, [steps[activeStep]]);

  // Get progress for a specific mint (global progress)
  const getMintProgress = (mintUrl, unit) => {
    // We no longer need the unit parameter for global progress
    return progressObject[mintUrl]?.progress || 0;
  };

  // Get current mint info
  const getCurrentMint = (stepIndex) => {
    const step = steps[stepIndex];
    if (step.type !== 'mint-group') return null;

    const activeMintId = activeMints[step.id] || step.mints[0].id;
    const mintIndex = step.mints.findIndex((mint) => mint.id === activeMintId);
    return {
      mint: step.mints[mintIndex],
      index: mintIndex,
      isLast: mintIndex === step.mints.length - 1,
    };
  };

  // Step state helpers
  const isStepActive = (index) => index === activeStep;
  const isStepComplete = (index) => index < activeStep;
  const isMintComplete = (stepIndex, mintIndex) => {
    const step = steps[stepIndex];
    if (stepIndex < activeStep) return true;
    if (stepIndex > activeStep) return false;

    // For the active step, check if we've moved past this mint
    const activeMintId = activeMints[step.id];
    const activeMintIndex = step.mints.findIndex((mint) => mint.id === activeMintId);
    return mintIndex < activeMintIndex;
  };

  // Get current currency name
  const getCurrentCurrencyName = () => {
    const currentMintInfo = getCurrentMint(activeStep);
    if (!currentMintInfo) return '';

    const currencies = currentMintInfo.mint.currencies;
    if (currencyIndex < currencies.length) {
      return currencies[currencyIndex].name;
    }
    return '';
  };

  // Get progress for a specific currency
  const getCurrencyProgress = (mintUrl, unit) => {
    return progressObject[mintUrl]?.currencies?.[unit]?.progress || 0;
  };

  console.log(JSON.stringify(steps, null, 2));

  const renderAddButtonStep = (step, index) => {
    const isActive = isStepActive(index);
    const isComplete = isStepComplete(index);
    const opacity = isComplete ? 0.7 : isActive ? 1 : 0.5;
    const styles = createStyles(theme);
    return (
      <View style={[styles.stepContainer, { opacity }]}>
        <View style={styles.stepContent}>
          {/* Step icon and button */}
          <View style={[styles.iconContainer, { justifyContent: 'center', alignItems: 'center' }]}>
            <TouchableOpacity
              onPress={() => {
                SheetManager.show('mint-adder', {
                  async onClose(data) {
                    // data.mints

                    // add mints to profile step
                    setSteps([
                      ...steps,

                      // get step for profile we currently are on
                      {
                        ...steps.find(
                          (s) => s.type === 'profile' && s.profile?.id === step.forProfileId
                        ),
                        profile: {
                          ...steps.find(
                            (s) => s.type === 'profile' && s.profile?.id === step.forProfileId
                          ).profile,
                          mints: data.mints,
                        },
                      },
                    ]);

                    // go to next step
                    setTimeout(() => {
                      handleProfileAnimation();
                    }, 1000);
                  },
                });
              }}
              style={[styles.addButtonContainer, { backgroundColor: shades[300] }]}>
              <Icon size={32} name="fluent:add-24-filled" />
            </TouchableOpacity>
          </View>

          {/* Step label */}
          <Text style={styles.stepLabel}>{step.label}</Text>
          <Text style={styles.stepMessage}>{message}</Text>
        </View>

        {/* Connecting line */}
        {index < steps.length - 1 && (
          <Animated.View
            style={[
              styles.connectingLine,
              {
                backgroundColor: isComplete || connectingLines[index] ? '#ED0C46' : '#444444',
                transform: [{ scaleY: lineScaleY[index] || 0 }],
              },
            ]}
          />
        )}
      </View>
    );
  };

  // Render progress circle
  const renderProgressCircle = (currentProgress, size = 100, theme) => {
    return (
      <AnimatedCircularProgress
        size={size}
        width={3}
        fill={currentProgress * 100}
        tintColor={shades[300]}
        backgroundColor={greys(theme)[1500]}
        duration={600}
        easing={Easing.out(Easing.ease)}
        rotation={360}
      />
    );
  };

  // Render Profile or Complete Step
  const renderBasicStep = (step, index) => {
    const isActive = isStepActive(index);
    const isComplete = isStepComplete(index);
    const opacity = isComplete ? 0.7 : isActive ? 1 : 0.5;

    return (
      <View style={[styles.stepContainer, { opacity }]}>
        <View style={styles.stepContent}>
          {/* Step icon and progress */}
          <View style={styles.iconContainer}>
            {renderProgressCircle(isActive ? progress : isComplete ? 1 : 0, 100, theme)}

            {/* Icon */}
            <View style={styles.iconOverlay}>
              {step.type === 'profile' ? (
                <Image
                  source={{
                    uri: step.iconUrl,
                  }}
                  style={styles.profileIcon}
                />
              ) : (
                <Ionicons
                  name={step.icon}
                  size={24}
                  color={
                    isComplete
                      ? '#ED0C46'
                      : isActive && step.type === 'complete'
                        ? '#10B981'
                        : 'white'
                  }
                />
              )}
            </View>
          </View>

          {/* Step label */}
          <Text style={styles.stepLabel}>{step.label}</Text>
          <Text style={styles.stepMessage}>{message}</Text>
        </View>

        {/* Connecting line */}
        {index < steps.length - 1 && (
          <Animated.View
            style={[
              styles.connectingLine,
              {
                backgroundColor: isComplete || connectingLines[index] ? '#ED0C46' : '#444444',
                transform: [{ scaleY: lineScaleY[index] || 0 }],
              },
            ]}
          />
        )}
      </View>
    );
  };

  // Render Mint Group
  const renderMintGroup = (step, index) => {
    const isActive = isStepActive(index);
    const isComplete = isStepComplete(index);
    const opacity = isComplete ? 0.7 : isActive ? 1 : 0.5;

    return (
      <View style={[styles.stepContainer, { opacity }]}>
        <Animated.View>
          <View>
            {/* Horizontal Mints */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 100,
              }}>
              {/* Animate all mints */}
              {step.mints.map((mint, mintIndex) => {
                const activeMintId = activeMints[step.id] || step.mints[0].id;
                // Create an array of mint IDs for position calculation
                const mintIndices = step.mints.map((m) => m.id);

                return (
                  <MintItem
                    key={mint.id}
                    mint={mint}
                    mintIndex={mintIndex}
                    activeMintId={activeMintId}
                    mintIndices={mintIndices}
                    renderProgressCircle={renderProgressCircle}
                    getMintProgress={getMintProgress}
                    stepIndex={index}
                    theme={theme}
                  />
                );
              })}
            </View>
          </View>
        </Animated.View>
        <View style={styles.mintGroupContainer}>
          {/* Horizontal Mints */}
          {step.mints.map((mint, mintIndex) => {
            const activeMintId = activeMints[step.id] || step.mints[0].id;
            const position = mintIndex - step.mints.findIndex((m) => m.id === activeMintId);

            const isMintActive = activeMintId === mint.id && isActive;
            const isMintCompleted = isMintComplete(index, mintIndex);

            return (
              <Animated.View
                key={mint.id}
                style={[
                  styles.mintContainer,
                  {
                    transform: [{ translateX: mintPosition }, { translateX: position * 16 }],
                    opacity: position === 0 ? 1 : position > 0 ? 0.4 : 0,
                    zIndex: position === 0 ? 1 : 0,
                  },
                ]}>
                {/* Currency progress */}
                {isMintActive && (
                  <>
                    <Text style={styles.mintLabel} weight="bold">
                      {mint.label}
                    </Text>
                    <Text style={styles.mintUrl}>{mint.mintUrl}</Text>
                    <View style={styles.currencyCard}>
                      <Text style={styles.currencyStatus}>
                        {isMintCompleted ? 'Complete' : `Loading ${getCurrentCurrencyName()}...`}
                      </Text>

                      <Text style={styles.message}>{message}</Text>

                      <View style={styles.currenciesContainer}>
                        {mint.currencies.map((currency) => {
                          const currencyProgress = getCurrencyProgress(mint.mintUrl, currency.name);
                          return (
                            <View key={currency.name} style={styles.currencyRow}>
                              {currency.name === 'usd' ||
                              currency.name === 'eur' ||
                              currency.name === 'gbp' ? (
                                <FlagIcon
                                  country={
                                    currency.name === 'usd'
                                      ? 'US'
                                      : currency.name === 'eur'
                                        ? 'EU'
                                        : 'GB'
                                  }
                                  height={32}
                                  width={32}
                                />
                              ) : (
                                <CurrencyIcon currency={currency.name.toLowerCase()} />
                              )}
                              <View style={styles.progressBarContainer}>
                                <View
                                  style={[
                                    styles.progressBar,
                                    { width: `${currencyProgress * 100}%` },
                                  ]}
                                />
                              </View>
                              {currencyProgress >= 1 && (
                                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </>
                )}
              </Animated.View>
            );
          })}
        </View>

        {/* Connecting line */}
        {index < steps.length - 1 && (
          <Animated.View
            style={[
              styles.connectingLine,
              {
                backgroundColor: isComplete || connectingLines[index] ? '#ED0C46' : '#444444',
                transform: [{ scaleY: lineScaleY[index] || 0 }],
              },
            ]}
          />
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Chain Loading Animation</Text>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}>
          <View style={styles.stepsContainer}>
            {steps.map((step, index) => (
              <View key={step.id} style={styles.stepWrapper}>
                {step.type === 'mint-group'
                  ? renderMintGroup(step, index)
                  : step.type === 'add-button'
                    ? renderAddButtonStep(step, index)
                    : renderBasicStep(step, index)}
              </View>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.remainingSteps}>
          {7 - activeStep - 1} more step
          {7 - activeStep - 1 === 1 ? '' : 's'}
        </Text>
      </View>
    </View>
  );
};

export const fetchAccountData = async ({ nsec }) => {
  let { data: sk } = nip19.decode(nsec);
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);

  const signer = new NDKPrivateKeySigner(nsec);
  const ndk = new NDK({
    signer: signer,
    explicitRelayUrls: [
      'wss://relay.primal.net',
      'wss://relay.damus.io',
      'wss://relay.8333.space/',
      'wss://relay.snort.social',
      'wss://nostr.mutinywallet.com',
      'wss://nos.lol',
    ],
  });

  await ndk.connect();

  const pablo = ndk.getUser({ npub });
  return { profile: await pablo.fetchProfile(), pubkey: pk, npub, nsec };
};

// Profile retrieval component that initializes the animation
const GetProfile = () => {
  return <ChainLoadingAnimation />;
};

export default GetProfile;
