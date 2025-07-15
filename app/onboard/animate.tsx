import React, { useState, useEffect, useRef } from 'react';
import { View, Animated, ScrollView, Dimensions, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedCircularProgress } from 'react-native-circular-progress';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Text } from 'components/common/Text';
import { getMint, restoreMint } from 'helper/cashuClient';
import { createStyles } from './helper';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { setCurrentProfile, setProfiles } from 'helper/redux/nostr';
import { store } from 'helper/redux/store';
import { addMints, appendProofsV2, increaseCounterV2, setSelectedMint } from 'helper/redux/cashu';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { MintItem } from './MintItem';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { SheetManager } from 'react-native-actions-sheet';
import _ from 'lodash';
import { getProfile } from './components/fetchAccountData';
import { Currency } from './components/CurrencyIcon';
import { TouchableOpacityProgress } from './components/TouchableOpacityProgress';
import { wordlist } from '@scure/bip39/wordlists/english';

const { height } = Dimensions.get('window');

const ensureCompleteStep = (currentSteps, newStepsOrUpdater) => {
  // Find existing complete step if it exists
  const completeStep = currentSteps.find((step) => step.type === 'complete');

  // Calculate new steps (handling both direct array and updater function)
  let updatedSteps;
  if (typeof newStepsOrUpdater === 'function') {
    updatedSteps = newStepsOrUpdater(currentSteps);
  } else {
    updatedSteps = newStepsOrUpdater;
  }

  // Remove any complete steps that might be in the updated array
  const stepsWithoutComplete = updatedSteps.filter((step) => step.type !== 'complete');

  // Add the complete step at the end
  if (completeStep) {
    return [...stepsWithoutComplete, completeStep];
  } else {
    // Create a default complete step if none exists
    return [...stepsWithoutComplete, { type: 'complete' }];
  }
};

function findAndInsertAfter(array, itemToFind, itemToInsert) {
  const _ = require('lodash');

  // Find the index of the item
  const index = _.findLastIndex(array, (item) => _.isEqual(item, itemToFind));

  // If item is found, insert the new item after it
  if (index !== -1) {
    // Create a new array with the item inserted
    const result = _.clone(array);

    // Use lodash's slice and concat to create a new array
    return _.concat(_.slice(result, 0, index + 1), [itemToInsert], _.slice(result, index + 1));
  }

  // If item is not found, return a copy of the original array
  return _.clone(array);
}
// Main animation component for restoring wallet/mints
const ChainLoadingAnimation = () => {
  async function* onMessage(message: { type: string }) {
    try {
      switch (message.type) {
        case 'processing': {
          const accountIndexes = [0, 1, 2];
          const profiles = [];

          // Fetch profiles and yield progress
          for (const index of accountIndexes) {
            const profile = await getProfile({ mnemonic, accountIndex: index });

            yield {
              label: 'PROFILE_FOUND',
              current: index + 1,
              max: accountIndexes.length,
            };

            if (profile) {
              profiles.push(profile);
            }
          }

          if (profiles.length === 0) {
            setSteps(
              ensureCompleteStep(
                steps,
                findAndInsertAfter(steps, message.payload, {
                  type: 'retry',
                  step: message.payload,
                })
              )
            );
            break;
          }

          // Generate HD root key
          const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));

          // Transform profiles with additional data
          const processedProfiles = profiles.map((profile, index) => {
            const DERIVATION_PATH = `m/44'/129372'`;
            const path = `${DERIVATION_PATH}/0'/${index}'/0/0`;
            const seed = root.derive(path);
            const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey, wordlist);

            return {
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
              nut13: derivedCashuMnemonic,
            };
          });

          // Create and add profile steps
          const profileSteps = processedProfiles.map((profile, index) => ({
            type: 'profile',
            label: 'Profile',
            icon: 'person',
            iconUrl: profile.profile?.image,
            profile,
            id: `profile-${index}`,
          }));

          setSteps(ensureCompleteStep(steps, [...steps, ...profileSteps]));

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
            const newSteps = ensureCompleteStep(steps, [
              ...steps.slice(0, currentProfileIndex + 1),
              step,
              ...steps.slice(currentProfileIndex + 1),
            ]);

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
              const units = mintInfo.nuts[4].methods
                .map((method) => ({
                  name: method.unit,
                  weight: 0.5,
                }))
                .filter((unit) =>
                  (mnemonic.trim() ===
                  'suit edge uphold icon modify more oak can zero legal sudden rival'
                    ? ['sat']
                    : ['sat']
                  ).includes(unit.name)
                );

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
            } catch {
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
          yield {
            label: 'WAITING_FOR_INPUT',
            message: "Sovran couldn't detect a mint. Please add the one your account was using.",
          };

          return {
            type: 'complete',
          };

        case 'mint-group':
          if (type === 'new') return { type: 'complete' };

          const profile = steps.find((step) => step.type === 'profile')?.profile;

          const mints = [];
          for (const mint of message.payload.mints) {
            const { mintUrl } = mint;
            const generator = await restoreMint({
              mintUrl,
              profile,
              allowedUnits:
                mnemonic.trim() ===
                'suit edge uphold icon modify more oak can zero legal sudden rival'
                  ? ['sat']
                  : ['sat'],
            });
            let result = await generator.next();

            while (!result.done) {
              result = await generator.next();
              yield result.value;
            }

            const { value: restoredMint } = result;
            const proofs = Object.values(restoredMint).flatMap((mint) => mint?.proofs || []);

            console.log('restoredMint', restoredMint);

            mints.push({
              profileId: mint.id,
              mintUrl,
              proofs,
              keysets: _.merge(
                {},
                ..._.map(_.values(restoredMint), (unit) => _.get(unit, 'keysets', {}))
              ),
            });
          }

          setSteps(
            steps.map((step) => {
              if (step.type === 'mint-group' && step.id === message.payload.id) {
                return {
                  ...step,
                  mints: step.mints.map((mint) => {
                    const mintData = mints.find((m) => m.profileId === mint.id);
                    return {
                      ...mint,
                      proofs: mintData?.proofs || [],
                      keysets: mintData?.keysets || [],
                    };
                  }),
                };
              }
              return step;
            })
          );
          return { type: 'complete' };
      }
    } catch {
      setSteps(
        ensureCompleteStep(
          steps,
          findAndInsertAfter(steps, message.payload, {
            type: 'retry',
            step: message.payload,
          })
        )
      );
    }
  }

  const { mnemonic, type } = useTypedRoute();

  // Initialize with processing step
  const [steps, setSteps] = useState([
    {
      type: 'processing',
      label: 'Processing',
      icon: 'settings',
      id: 0,
    },
    {
      type: 'complete',
      label: 'Complete',
      icon: 'checkmark',
    },
  ]);

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  // Animation states
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currencyIndex, setCurrencyIndex] = useState(0);
  const [connectingLines, setConnectingLines] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
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

  const navigation = useTypedNavigation();

  // Handle completion
  const handleComplete = () => {
    const profileSteps = _.filter(steps, { type: 'profile' });
    const uniqueProfiles = _.keyBy(profileSteps, 'id');
    const profiles = _.values(uniqueProfiles).map((profile) => profile.profile);

    store.dispatch(setProfiles(profiles));
    store.dispatch(setCurrentProfile(profiles[0]));

    // Find all mint groups in the steps
    const mintGroups = _.filter(steps, { type: 'mint-group' });

    // Process each mint group
    _.forEach(mintGroups, (mintGroup) => {
      const profileId = mintGroup.forProfileId;

      // Process each mint within the group
      _.forEach(mintGroup.mints, (mint) => {
        const mintUrl = mint.mintUrl;
        const proofs = mint.proofs || [];
        const keysets = mint.keysets || {};

        store.dispatch(addMints({ profileId, mints: [mintUrl] }));
        store.dispatch(setSelectedMint({ profileId, mintUrl }));

        // Only dispatch if there are proofs available
        if (proofs.length > 0) {
          store.dispatch(
            appendProofsV2({
              profileId: profileId,
              mintUrl: mintUrl,
              proofs: proofs,
            })
          );
        }
        if (!_.isEmpty(keysets)) {
          _.forEach(keysets, (value, key) => {
            console.log('add keyset', key, value);
            store.dispatch(
              increaseCounterV2({
                profileId,
                mintUrl,
                keysetId: key,
                amount: value,
              })
            );
          });
        }
      });
    });

    navigation?.goBack();
    navigation?.goBack();
    navigation?.goBack();
    navigation?.goBack();
    navigation?.goBack();
    navigation.navigate(
      '',
      {},
      {
        closeCurrentAndParents: true,
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
          case 'NO_PROFILES_FOUND': {
            setMessage('No profiles found');
            setError(true);
            break;
          }
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

            console.log('KEYSET_COMPLETE123123123', currentMint?.currencies, result?.value?.unit);
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
        setTimeout(() => {
          handleComplete();
        }, 1000);
      }
    });
  }, [steps[activeStep]]);

  // Get progress for a specific mint (global progress)
  const getMintProgress = (mintUrl: string) => {
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
    console.log(123213123, currencies, currencyIndex);
    if (currencyIndex < currencies.length) {
      return currencies[currencyIndex].name;
    }
    return '';
  };

  // Get progress for a specific currency
  const getCurrencyProgress = (mintUrl, unit) => {
    return progressObject[mintUrl]?.currencies?.[unit]?.progress || 0;
  };

  const renderRetryStep = (step, index) => {
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
                setSteps(ensureCompleteStep(steps, findAndInsertAfter(steps, step, step.step)));
                setTimeout(() => {
                  handleProfileAnimation();
                }, 1000);
              }}
              style={[styles.addButtonContainer, { backgroundColor: shades[300] }]}>
              <Icon size={32} name="ic:round-refresh" />
            </TouchableOpacity>
          </View>

          {/* Step label */}
          <Text style={styles.stepLabel}>Retry</Text>
          {/* <Text style={styles.stepMessage}>{message}</Text> */}
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
              testID="add-mint"
              onPress={() => {
                SheetManager.show('mint-adder', {
                  payload: {
                    currencies: ['SAT'],
                  },
                  async onClose(data) {
                    // data.mints

                    // add mints to profile step
                    setSteps(
                      ensureCompleteStep(steps, [
                        ...steps,
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
                      ])
                    );

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
        backgroundColor={greys(theme)[700]}
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
          <TouchableOpacityProgress
            ensureCompleteStep={ensureCompleteStep}
            isActive={isActive}
            progress={progress}
            isComplete={isComplete}
            renderProgressCircle={renderProgressCircle}
            step={step}
            setSteps={setSteps}
            handleProfileAnimation={handleProfileAnimation}
            steps={steps}
            setMessage={setMessage}
            setError={setError}
            error={error}
          />

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
                              <Currency currency={currency.name} size={32} />
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
                    : step.type === 'retry'
                      ? renderRetryStep(step, index)
                      : renderBasicStep(step, index)}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

// Profile retrieval component that initializes the animation
const GetProfile = () => {
  return <ChainLoadingAnimation />;
};

export default GetProfile;
