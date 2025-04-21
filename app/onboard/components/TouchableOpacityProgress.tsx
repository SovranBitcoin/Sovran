import React from 'react';
import { View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { createStyles } from '../helper';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';

export function TouchableOpacityProgress({
  error,
  handleProfileAnimation,
  isActive,
  isComplete,
  progress,
  renderProgressCircle,
  setError,
  setMessage,
  setSteps,
  step,
  steps,
  ensureCompleteStep,
}) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={styles.iconContainer}>
      {renderProgressCircle(
        step.type === 'complete' ? 100 : isActive ? progress : isComplete ? 1 : 0,
        100,
        theme
      )}

      {/* Icon */}
      <TouchableOpacity
        onPress={() => {
          // if (error) {
          setSteps(ensureCompleteStep(steps, [...steps, step]));
          // go to next step
          setTimeout(() => {
            handleProfileAnimation();
            setMessage('');
            setError(false);
          }, 1000);
          // }
        }}
        style={styles.iconOverlay}>
        {error ? (
          <Icon size={32} name="ic:round-refresh" />
        ) : (
          <>
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
                      ? shades[300]
                      : 'white'
                }
              />
            )}
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}
