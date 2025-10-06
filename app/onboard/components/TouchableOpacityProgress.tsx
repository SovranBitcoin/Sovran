import React from 'react';
import { View, Image } from 'react-native';

import { useTheme } from 'providers/ThemeProvider';
import { createStyles } from '../helper';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';

interface TouchableOpacityProgressProps {
  error: boolean;
  handleProfileAnimation: () => void;
  isActive: boolean;
  isComplete: boolean;
  progress: number;
  renderProgressCircle: (progress: number, size: number, theme: Theme) => React.ReactNode;
  setError: (error: boolean) => void;
  setMessage: (message: string) => void;
  setSteps: (steps: any[]) => void;
  step: any;
  steps: any[];
  ensureCompleteStep: (steps: any[], newStepsOrUpdater: any[]) => any[];
}

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
}: TouchableOpacityProgressProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const styles = createStyles(getPrimaryColor);

  return (
    <View style={styles.iconContainer}>
      {renderProgressCircle(
        step.type === 'complete' ? 100 : isActive ? progress : isComplete ? 1 : 0,
        100,
        getPrimaryColor
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
              <Icon
                name={step.icon}
                size={24}
                color={
                  isComplete
                    ? '#ED0C46'
                    : isActive && step.type === 'complete'
                      ? getShadeColor('300')
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
