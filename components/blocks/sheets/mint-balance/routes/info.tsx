/**
 * @fileoverview InfoRoute - Detailed mint information and audit data
 *
 * @module components/blocks/sheets/mint-balance/routes/info
 *
 * @description
 * Displays comprehensive mint details including audit scores, contact info, stats,
 * and performance metrics. Users can view mint reliability, contact operators, and inspect details.
 *
 * **Navigation:**
 * - From: `router.navigate('info', {mintUrl})` from list route
 * - To: `router.goBack()` or external links (email, social, nostr)
 * - Close: `sheetRef.current?.hide()`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Optional mintUrl override
 * - Params: `{mintUrl: string}` - Passed via `router.navigate('info', {mintUrl})`
 *
 * **Flow:** Load mint info → display stats → show contact options → user interacts → close
 *
 * @see {@link ./list}
 * @see {@link ./add}
 */

import React, { useState, useEffect, useRef } from 'react';
import { ScrollView, Animated, Alert, Linking, Easing } from 'react-native';
import { useSheetRef, useSheetPayload, RouteScreenProps } from 'react-native-actions-sheet';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { VStack, Spacer, HStack, View } from 'components/ui/View';
import { npubToPubkey } from 'components/blocks/Transaction';
import { useMintManagement } from 'hooks/coco';
import { extractDomain } from '@/helper/url';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
import { useKYMMint } from 'hooks/coco/useKYMMint';
import { Card } from 'components/ui/Card';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { Badge } from 'components/ui/Badge';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import { getUsername } from '@/helper/username';
import { Skeleton } from '@/components/ui/Skeleton';

// AnimatedAvatar component with badge pulse animation
const AnimatedAvatar = ({
  picture,
  name,
  alt,
  status,
  size = 70,
  onAnimationComplete,
  onResetRef,
  isLoading: externalLoading = false,
}: {
  picture?: string;
  name?: string;
  alt?: string;
  status?: string;
  size?: number;
  onAnimationComplete?: React.MutableRefObject<(() => void) | null>;
  onResetRef?: React.MutableRefObject<(() => void) | null>;
  isLoading?: boolean;
}) => {
  const { getPrimaryColor } = useTheme();
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const avatarOpacity = useRef(new Animated.Value(externalLoading ? 0.5 : 1)).current;

  // Get status badge configuration (matching Avatar component logic)
  const getStatusBadge = () => {
    if (!status) return null;

    const statusConfig: Record<
      string,
      { variant: 'success' | 'error' | 'secondary'; icon: string; badge: boolean }
    > = {
      OK: {
        variant: 'success' as const,
        icon: 'fluent:checkmark-16-filled',
        badge: true,
      },
      ERROR: {
        variant: 'error' as const,
        icon: 'nonicons:error-16',
        badge: true,
      },
      OFFLINE: {
        variant: 'secondary' as const,
        icon: 'feather:wifi',
        badge: true,
      },
      VERIFIED: {
        variant: 'success' as const,
        icon: 'material-symbols:verified-rounded',
        badge: false,
      },
    };

    return statusConfig[status];
  };

  const statusBadge = getStatusBadge();
  const statusIconSize = size * 0.33;

  // Track if badge animation has been triggered
  const badgeAnimatedRef = useRef(false);

  // Function to reset badge animation state
  const resetBadgeAnimation = React.useCallback(() => {
    badgeAnimatedRef.current = false;
    badgeOpacity.setValue(0);
    badgeScale.setValue(0);
  }, [badgeOpacity, badgeScale]);

  // Function to trigger badge animation (exposed via ref)
  const triggerBadgeAnimation = React.useCallback(() => {
    if (!status || !statusBadge) return;
    // Reset first if needed
    if (badgeAnimatedRef.current) {
      resetBadgeAnimation();
    }
    badgeAnimatedRef.current = true;
    // Small delay after donut completes, then pop badge into view
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(badgeOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(badgeScale, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, 100);
  }, [status, statusBadge, badgeOpacity, badgeScale, resetBadgeAnimation]);

  // Expose trigger function to parent via ref
  useEffect(() => {
    if (onAnimationComplete && 'current' in onAnimationComplete) {
      onAnimationComplete.current = triggerBadgeAnimation;
    }
    return () => {
      if (onAnimationComplete && 'current' in onAnimationComplete) {
        onAnimationComplete.current = null;
      }
    };
  }, [onAnimationComplete, triggerBadgeAnimation]);

  // Expose reset function to parent via ref
  useEffect(() => {
    if (onResetRef) {
      onResetRef.current = resetBadgeAnimation;
    }
    return () => {
      if (onResetRef) {
        onResetRef.current = null;
      }
    };
  }, [onResetRef, resetBadgeAnimation]);

  // Handle loading state transition
  useEffect(() => {
    if (!externalLoading) {
      Animated.timing(avatarOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [externalLoading, avatarOpacity]);

  return (
    <Animated.View
      style={{
        opacity: avatarOpacity,
        position: 'relative',
      }}>
      <Avatar
        picture={picture}
        size={size}
        variant="person"
        name={name}
        alt={alt}
        status={undefined} // Render badge separately with animation
        loading={externalLoading}
      />
      {/* Animated badge overlay */}
      {statusBadge && (
        <Animated.View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            zIndex: 50,
            opacity: badgeOpacity,
            transform: [{ scale: badgeScale }],
          }}>
          {statusBadge.badge ? (
            <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={statusIconSize} />
          ) : (
            <Icon name={statusBadge.icon} size={statusIconSize} color={getPrimaryColor('400')} />
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
};

// DonutChart component with animated segments
const DonutChart = ({
  strokeWidth = 2.5,
  sections = [],
  children,
  gap = 3.5,
  startAngle = 90,
  padding = 6,
  size,
  style,
  variant = 'mint',
  onTriggerAnimationRef,
  onAnimationComplete,
}: {
  strokeWidth?: number;
  sections?: { value: number; color: string }[];
  children?: React.ReactNode;
  gap?: number;
  startAngle?: number;
  padding?: number;
  size?: number;
  style?: any;
  variant?: 'round' | 'mint';
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
  onAnimationComplete?: () => void;
}) => {
  const { getPrimaryColor } = useTheme();
  const containerSize = size || 84;
  const center = containerSize / 2;
  const radius = (containerSize - strokeWidth) / 2;
  const innerRadius = radius - strokeWidth;

  // Determine if we have valid sections
  const hasSections = sections && sections.length > 0;
  const totalValue = hasSections ? sections.reduce((sum, section) => sum + section.value, 0) : 0;

  // Animation values for each segment (0 to 1 progress) using React Native Animated
  const segmentProgressesRef = useRef<Animated.Value[]>([]);

  // Ensure segmentProgresses array matches sections length
  const getSegmentProgresses = React.useCallback(() => {
    while (segmentProgressesRef.current.length < sections.length) {
      segmentProgressesRef.current.push(new Animated.Value(0));
    }
    while (segmentProgressesRef.current.length > sections.length) {
      const removed = segmentProgressesRef.current.pop();
      removed?.removeAllListeners();
    }
    return segmentProgressesRef.current;
  }, [sections.length]);

  // Store animated paths in state
  const [animatedPaths, setAnimatedPaths] = useState<any[]>([]);

  // Track if animation has been triggered
  const hasAnimatedRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const prevSectionsRef = useRef(sections);
  const listenersReadyRef = useRef(false);

  // Helper function to create a path for a segment at a given progress (0-1)
  const createSegmentPath = React.useCallback(
    (
      sectionIndex: number,
      progress: number,
      sections: { value: number; color: string }[],
      totalValue: number,
      gapRad: number,
      availableAngle: number,
      startAngleRad: number
    ) => {
      const section = sections[sectionIndex];
      const targetSectionAngle = (section.value / totalValue) * availableAngle;

      // Calculate cumulative start angle for this segment
      let cumulativeStartAngle = startAngleRad;
      for (let i = 0; i < sectionIndex; i++) {
        cumulativeStartAngle += (sections[i].value / totalValue) * availableAngle + gapRad;
      }

      const currentAngle = progress * targetSectionAngle;
      const currentEndAngle = cumulativeStartAngle + currentAngle;

      const path = Skia.Path.Make();

      // Start point
      const startX = center + radius * Math.cos(cumulativeStartAngle);
      const startY = center + radius * Math.sin(cumulativeStartAngle);
      path.moveTo(startX, startY);

      // Outer arc
      if (currentAngle > 0.001) {
        path.arcToOval(
          Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
          (cumulativeStartAngle * 180) / Math.PI,
          (currentAngle * 180) / Math.PI,
          false
        );

        // Line to inner radius
        const endX = center + innerRadius * Math.cos(currentEndAngle);
        const endY = center + innerRadius * Math.sin(currentEndAngle);
        path.lineTo(endX, endY);

        // Inner arc (reverse direction)
        path.arcToOval(
          Skia.XYWHRect(
            center - innerRadius,
            center - innerRadius,
            innerRadius * 2,
            innerRadius * 2
          ),
          (currentEndAngle * 180) / Math.PI,
          -(currentAngle * 180) / Math.PI,
          false
        );

        path.close();
      }

      return path;
    },
    [center, radius, innerRadius]
  );

  // Update paths when progress values change
  useEffect(() => {
    if (!hasSections || variant !== 'round') {
      setAnimatedPaths([]);
      return;
    }

    const segmentProgresses = getSegmentProgresses();
    const gapRad = (gap * Math.PI) / 180;
    const totalGapRad = gapRad * sections.length;
    const availableAngle = 2 * Math.PI - totalGapRad;
    const startAngleRad = (startAngle * Math.PI) / 180;

    const listeners: any[] = [];
    const paths: any[] = [];

    // Initialize paths - start at 0, will be updated by listeners
    sections.forEach((_, index) => {
      const path = createSegmentPath(
        index,
        0,
        sections,
        totalValue,
        gapRad,
        availableAngle,
        startAngleRad
      );
      paths.push(path);
    });

    setAnimatedPaths(paths);

    // Set up listeners for future updates
    sections.forEach((section, index) => {
      const progress = segmentProgresses[index] || new Animated.Value(0);

      // Create listener to update path
      const listener = progress.addListener(({ value }) => {
        const newPath = createSegmentPath(
          index,
          value,
          sections,
          totalValue,
          gapRad,
          availableAngle,
          startAngleRad
        );

        // Force re-render by updating paths array
        setAnimatedPaths((prev) => {
          const newPaths = [...prev];
          newPaths[index] = newPath;
          return newPaths;
        });
      });

      listeners.push(listener);
    });

    // Mark listeners as ready
    listenersReadyRef.current = true;

    return () => {
      listenersReadyRef.current = false;
      listeners.forEach((listener, index) => {
        segmentProgresses[index]?.removeListener(listener);
      });
    };
  }, [
    sections,
    hasSections,
    variant,
    gap,
    startAngle,
    totalValue,
    center,
    radius,
    innerRadius,
    getSegmentProgresses,
    createSegmentPath,
  ]);

  // Function to trigger animation sequence
  const triggerAnimation = React.useCallback(() => {
    if (!hasSections || sections.length === 0) return;

    const segmentProgresses = getSegmentProgresses();

    // Reset all segments to 0
    segmentProgresses.forEach((progress) => {
      progress.setValue(0);
    });

    // Track completed animations
    let completedCount = 0;
    const totalAnimations = sections.length;

    // Animate segments sequentially
    sections.forEach((_, index) => {
      const delay = index * 200; // Stagger delay: 200ms per segment
      const duration = 600; // 600ms per segment

      setTimeout(() => {
        const progress = segmentProgresses[index];
        if (progress) {
          Animated.timing(progress, {
            toValue: 1,
            duration,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false, // Can't use native driver for custom paths
          }).start(() => {
            completedCount++;
            // Ensure final state is set
            if (progress) {
              progress.setValue(1);
            }
            // After all animations complete, ensure all are at final state and trigger callback
            if (completedCount === totalAnimations) {
              segmentProgresses.forEach((p) => {
                if (p) {
                  p.setValue(1);
                }
              });
              // Trigger completion callback
              if (onAnimationComplete) {
                onAnimationComplete();
              }
            }
          });
        }
      }, delay);
    });
  }, [sections, hasSections, getSegmentProgresses, onAnimationComplete]);

  // Expose triggerAnimation to parent via ref
  useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
    }
    return () => {
      if (onTriggerAnimationRef) {
        onTriggerAnimationRef.current = null;
      }
    };
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animation when sections change or on mount (only if parent doesn't control via ref)
  useEffect(() => {
    // If parent provides onTriggerAnimationRef, don't auto-trigger - let parent handle it
    if (onTriggerAnimationRef) {
      return;
    }

    const sectionsChanged = JSON.stringify(prevSectionsRef.current) !== JSON.stringify(sections);

    // Ensure segmentProgresses array matches sections length
    getSegmentProgresses();

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      if (hasSections) {
        // Reset all segments to 0 first to ensure clean start
        const segmentProgresses = getSegmentProgresses();
        segmentProgresses.forEach((progress) => {
          progress.setValue(0);
        });

        // Wait for listeners to be ready, then trigger animation
        const checkAndAnimate = () => {
          if (listenersReadyRef.current) {
            triggerAnimation();
            hasAnimatedRef.current = true;
          } else {
            // Retry after a short delay if listeners aren't ready yet
            setTimeout(checkAndAnimate, 50);
          }
        };
        // Start checking after a brief delay to let effects run
        setTimeout(checkAndAnimate, 100);
      } else {
        // No sections, mark as animated to prevent issues
        hasAnimatedRef.current = true;
      }
    } else if (sectionsChanged && hasSections && hasAnimatedRef.current) {
      // Sections changed, re-animate
      // Reset first
      const segmentProgresses = getSegmentProgresses();
      segmentProgresses.forEach((progress) => {
        progress.setValue(0);
      });
      // Then animate
      setTimeout(() => {
        triggerAnimation();
      }, 50);
    }

    prevSectionsRef.current = sections;
  }, [sections, hasSections, triggerAnimation, getSegmentProgresses, onTriggerAnimationRef]);

  // Calculate border radius based on variant
  const borderRadius = variant === 'round' ? containerSize / 2 : containerSize * 0.25;

  return (
    <View
      style={{
        position: 'relative',
        width: containerSize,
        height: containerSize,
        borderRadius: borderRadius,
        ...style,
      }}>
      <Canvas style={{ width: containerSize, height: containerSize }}>
        <Group>
          {variant === 'round' && hasSections ? (
            // Animated round variant
            animatedPaths.map((path, index) => (
              <Path
                key={index}
                strokeJoin="round"
                path={path}
                color={sections[index]?.color || getPrimaryColor('600')}
              />
            ))
          ) : variant === 'round' ? (
            // Empty state for round variant
            <Group>
              <Path
                path={Skia.Path.Make().addCircle(center, center, radius)}
                color={getPrimaryColor('700')}
                style="stroke"
                strokeWidth={strokeWidth}
              />
            </Group>
          ) : hasSections ? (
            // Mint variant (not animated for now, can be enhanced later)
            <Group>
              <Path
                path={Skia.Path.Make().addRRect(
                  Skia.RRectXY(
                    Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
                    borderRadius,
                    borderRadius
                  )
                )}
                color={sections[0]?.color || getPrimaryColor('600')}
              />
              <Path
                path={Skia.Path.Make().addRRect(
                  Skia.RRectXY(
                    Skia.XYWHRect(
                      center - innerRadius,
                      center - innerRadius,
                      innerRadius * 2,
                      innerRadius * 2
                    ),
                    borderRadius * (innerRadius / radius),
                    borderRadius * (innerRadius / radius)
                  )
                )}
                color="transparent"
                blendMode="clear"
              />
            </Group>
          ) : (
            // Empty state for mint variant
            <Group>
              <Path
                path={Skia.Path.Make().addRRect(
                  Skia.RRectXY(
                    Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
                    borderRadius,
                    borderRadius
                  )
                )}
                color={getPrimaryColor('700')}
                style="stroke"
                strokeWidth={strokeWidth}
              />
            </Group>
          )}
        </Group>
      </Canvas>

      <View
        style={{
          position: 'absolute',
          top: padding,
          left: padding,
          right: padding,
          bottom: padding,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        {children}
      </View>
    </View>
  );
};

// StatsGrid component
const StatsGrid = ({
  successRate,
  avgResponse,
  mintSpeed,
  totalMints,
  totalMelts,
  onTriggerAnimationRef,
}: {
  successRate?: number;
  avgResponse?: number;
  mintSpeed?: number;
  totalMints?: number;
  totalMelts?: number;
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
}) => {
  const { getPrimaryColor } = useTheme();

  // Calculate target values for animations
  const targetValues = React.useMemo(() => {
    return {
      successRate: successRate ? successRate * 100 : 0, // Convert to percentage
      mintSpeed: mintSpeed || (avgResponse ? avgResponse / 1000 : 0), // Convert to seconds
      totalMints: totalMints || 0,
      totalMelts: totalMelts || 0,
    };
  }, [successRate, avgResponse, mintSpeed, totalMints, totalMelts]);

  // Check if we have any data
  const hasData =
    successRate !== undefined ||
    mintSpeed !== undefined ||
    avgResponse !== undefined ||
    totalMints !== undefined ||
    totalMelts !== undefined;

  // Animation values - one set per stat
  const skeletonOpacities = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;
  const contentOpacities = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  // Value counting animations (one per stat)
  const valueAnimations = useRef([
    new Animated.Value(0), // Success Rate
    new Animated.Value(0), // Mint Speed
    new Animated.Value(0), // Total Mints
    new Animated.Value(0), // Total Melts
  ]).current;

  // Trigger animation function
  const triggerAnimation = React.useCallback(() => {
    // Stop any ongoing animations
    valueAnimations.forEach((anim) => {
      anim.stopAnimation();
    });

    // Reset values
    skeletonOpacities.forEach((opacity) => opacity.setValue(1));
    contentOpacities.forEach((opacity) => opacity.setValue(0));
    valueAnimations.forEach((anim) => anim.setValue(0));

    // Start animations
    requestAnimationFrame(() => {
      // Fade out skeletons and fade in content
      const opacityAnimations = skeletonOpacities.map((skeletonOpacity, index) =>
        Animated.parallel([
          Animated.timing(skeletonOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(contentOpacities[index], {
            toValue: 1,
            duration: 300,
            delay: 50,
            useNativeDriver: true,
          }),
        ])
      );

      // Value counting animations
      const countingAnimations = [
        Animated.timing(valueAnimations[0], {
          toValue: targetValues.successRate,
          duration: 1000,
          delay: 100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(valueAnimations[1], {
          toValue: targetValues.mintSpeed,
          duration: 1000,
          delay: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(valueAnimations[2], {
          toValue: targetValues.totalMints,
          duration: 1000,
          delay: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(valueAnimations[3], {
          toValue: targetValues.totalMelts,
          duration: 1000,
          delay: 250,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
      ];

      // Start all animations
      Animated.parallel([...opacityAnimations, ...countingAnimations]).start();
    });
  }, [targetValues, skeletonOpacities, contentOpacities, valueAnimations]);

  // Expose triggerAnimation via ref
  React.useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
    }
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animation when data becomes available (only if parent doesn't control via ref)
  const isInitialMount = useRef(true);
  React.useEffect(() => {
    // If parent provides onTriggerAnimationRef, don't auto-trigger - let parent handle it
    if (onTriggerAnimationRef) {
      return;
    }

    if (hasData) {
      if (isInitialMount.current) {
        isInitialMount.current = false;
        // Delay initial animation to ensure component is fully rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            triggerAnimation();
          }, 100);
        });
      } else {
        // Data changed, trigger animation again
        triggerAnimation();
      }
    }
  }, [hasData, triggerAnimation, onTriggerAnimationRef]);

  // State for animated values (updated via listeners)
  const [displayValues, setDisplayValues] = React.useState([0, 0, 0, 0]);

  // Set up listeners for animated values
  React.useEffect(() => {
    const listeners = valueAnimations.map((anim, index) => {
      return anim.addListener(({ value }) => {
        setDisplayValues((prev) => {
          const next = [...prev];
          next[index] = value;
          return next;
        });
      });
    });

    return () => {
      valueAnimations.forEach((anim, index) => {
        anim.removeListener(listeners[index]);
      });
    };
  }, [valueAnimations]);

  // Stats configuration
  const stats = [
    {
      label: 'Success Rate',
      accent: true,
      description: 'Successful rate of transactions',
      formatValue: (value: number) => `${value.toFixed(1)}%`,
      hasData: successRate !== undefined,
      getDisplayValue: () => displayValues[0],
    },
    {
      label: 'Mint Speed',
      accent: true,
      description: 'Typical processing time',
      formatValue: (value: number) => `${value.toFixed(1)}s`,
      hasData: mintSpeed !== undefined || avgResponse !== undefined,
      getDisplayValue: () => displayValues[1],
    },
    {
      label: 'Total Mints',
      accent: false,
      description: 'Total mint operations',
      formatValue: (value: number) => Math.round(value).toString(),
      hasData: totalMints !== undefined,
      getDisplayValue: () => displayValues[2],
    },
    {
      label: 'Total Melts',
      accent: false,
      description: 'Total melt operations',
      formatValue: (value: number) => Math.round(value).toString(),
      hasData: totalMelts !== undefined,
      getDisplayValue: () => displayValues[3],
    },
  ];

  return (
    <HStack wrap="wrap" className="-m-1.5 mt-2">
      {stats.map((stat, index) => {
        const isLoading = !stat.hasData;
        const displayValue = stat.getDisplayValue();

        return (
          <View key={index} className="w-1/2 p-1.5">
            <VStack
              justify="space-between"
              className="rounded-xl border border-primary-700 bg-primary-800 p-4"
              style={{
                shadowColor: getPrimaryColor('950'),
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 3,
              }}>
              {/* Label Skeleton */}
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  opacity: skeletonOpacities[index],
                  pointerEvents: isLoading ? 'auto' : 'none',
                }}>
                <Skeleton className="mb-1 h-[14px] w-[80px] bg-primary-700" />
              </Animated.View>

              {/* Label */}
              <Animated.View
                style={{
                  opacity: contentOpacities[index],
                }}>
                <Text
                  bold
                  overpass
                  size={12}
                  className="mb-1 uppercase tracking-wide text-primary-200">
                  {stat.label}
                </Text>
              </Animated.View>

              {/* Value Skeleton */}
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 32,
                  left: 16,
                  opacity: skeletonOpacities[index],
                  pointerEvents: isLoading ? 'auto' : 'none',
                }}>
                <Skeleton
                  className={`mb-0.5 h-[28px] bg-primary-700 ${
                    stat.accent ? 'w-[100px]' : 'w-[60px]'
                  }`}
                />
              </Animated.View>

              {/* Animated Value */}
              <Animated.View
                style={{
                  opacity: contentOpacities[index],
                }}>
                <Text
                  bold
                  overpass
                  size={stat.accent ? 24 : 20}
                  className={`mb-0.5 leading-7 tracking-tight text-primary-0 ${
                    stat.accent ? 'text-2xl leading-8' : ''
                  }`}>
                  {stat.formatValue(displayValue)}
                </Text>
              </Animated.View>

              {/* Description Skeleton */}
              <Animated.View
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: 16,
                  opacity: skeletonOpacities[index],
                  pointerEvents: isLoading ? 'auto' : 'none',
                }}>
                <Skeleton className="h-[14px] w-[120px] bg-primary-700" />
              </Animated.View>

              {/* Description */}
              <Animated.View
                style={{
                  opacity: contentOpacities[index],
                }}>
                <Text
                  bold
                  overpass
                  size={12}
                  className="leading-4 tracking-wide text-primary-300 opacity-80">
                  {stat.description}
                </Text>
              </Animated.View>
            </VStack>
          </View>
        );
      })}
    </HStack>
  );
};

// RatingDisplay component
const RatingDisplay = ({
  score = -1,
  recommendations,
  onTriggerAnimationRef,
}: {
  score?: number;
  recommendations?: any[];
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
}) => {
  const { getPrimaryColor, getYellowColor } = useTheme();

  // If score is -1 (not loaded), don't show any gold stars
  const isValidScore = score >= 0;

  // Determine which row should show gold stars
  // Use ceiling so that scores like 1.1 go to the 2-star row, 2.3 goes to 3-star row, etc.
  const targetRow = isValidScore ? Math.max(1, Math.min(5, Math.ceil(score))) : -1;

  // Calculate the percentage of gold for the target row (score / rowStars)
  // This gives us the fraction of that row that should be gold
  const goldPercentage = isValidScore ? Math.min(1, score / targetRow) : 0;

  // Calculate review distribution (5 stars down to 1 star) - memoized to prevent unnecessary recalculations
  const distribution = React.useMemo(() => {
    return [5, 4, 3, 2, 1].map((starRating) => {
      if (!recommendations || recommendations.length === 0) {
        return { stars: starRating, percentage: 0 };
      }
      const count = recommendations.filter((rec) => Math.round(rec.score) === starRating).length;
      const percentage = recommendations.length > 0 ? count / recommendations.length : 0;
      return { stars: starRating, percentage };
    });
  }, [recommendations]);

  // Animation values
  const skeletonOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const scoreScale = useRef(new Animated.Value(0.8)).current;

  // Bar width animations (one for each distribution row - always 5 rows)
  const barWidths = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;

  // Star bounce animations (one for each possible star position - always 5 stars max)
  const starBounces = useRef(Array.from({ length: 5 }, () => new Animated.Value(1))).current;

  // Constant animated value for non-bouncing stars
  const noBounceScale = useRef(new Animated.Value(1)).current;

  // Track previous score to detect when data loads
  const prevScoreRef = useRef(score);
  const hasAnimatedRef = useRef(false);
  const isInitialMount = useRef(true);

  // Function to trigger animation sequence (for testing)
  const triggerAnimation = React.useCallback(() => {
    if (!isValidScore || targetRow <= 0) {
      // Fallback: if animation can't run, at least show the content
      skeletonOpacity.setValue(0);
      contentOpacity.setValue(1);
      scoreScale.setValue(1);
      return;
    }

    // Reset all animation values
    skeletonOpacity.setValue(1);
    contentOpacity.setValue(0);
    scoreScale.setValue(0.8);

    // Stop any ongoing animations first to prevent conflicts
    barWidths.forEach((bar) => {
      bar.stopAnimation(() => {
        // Reset after stopping
        bar.setValue(0);
      });
    });
    starBounces.forEach((star) => {
      star.stopAnimation(() => {
        // Reset after stopping
        star.setValue(1);
      });
    });

    // Use requestAnimationFrame to ensure animations are stopped before starting new ones
    requestAnimationFrame(() => {
      // Start bar animations
      const barAnimations = distribution.map(({ stars, percentage }, index) => {
        const isTargetRow = stars === targetRow;
        const targetWidth = isTargetRow ? goldPercentage * 100 : percentage * 100;

        return Animated.timing(barWidths[index], {
          toValue: targetWidth,
          duration: 800,
          delay: index * 50, // Stagger bars slightly
          easing: Easing.out(Easing.ease), // Ease-out for smooth fill
          useNativeDriver: true, // Can use native driver with scaleX transform
        });
      });

      // Calculate star bounce triggers based on bar progress
      const starBounceAnimations: Animated.CompositeAnimation[] = [];
      const fullGoldStars = Math.floor(goldPercentage * targetRow);
      const hasPartialStar = goldPercentage * targetRow > fullGoldStars;

      // Bounce each full star as bar reaches its threshold
      for (let i = 0; i < fullGoldStars; i++) {
        const starIndex = i;
        const threshold = (starIndex + 1) / targetRow;
        const delay = 800 * threshold; // Trigger when bar reaches this percentage

        starBounceAnimations.push(
          Animated.sequence([
            Animated.delay(delay),
            Animated.spring(starBounces[starIndex], {
              toValue: 1.3,
              friction: 3,
              tension: 100,
              useNativeDriver: true,
            }),
            Animated.spring(starBounces[starIndex], {
              toValue: 1,
              friction: 4,
              tension: 200,
              useNativeDriver: true,
            }),
          ])
        );
      }

      // Handle partial star bounce
      if (hasPartialStar) {
        const partialIndex = fullGoldStars;
        const threshold = (partialIndex + 0.5) / targetRow;
        const delay = 800 * threshold;

        starBounceAnimations.push(
          Animated.sequence([
            Animated.delay(delay),
            Animated.spring(starBounces[partialIndex], {
              toValue: 1.2,
              friction: 3,
              tension: 100,
              useNativeDriver: true,
            }),
            Animated.spring(starBounces[partialIndex], {
              toValue: 1,
              friction: 4,
              tension: 200,
              useNativeDriver: true,
            }),
          ])
        );
      }

      // Start bar animations (these can run in parallel)
      Animated.parallel(barAnimations).start();

      // Start star bounce animations (these have delays, run separately)
      starBounceAnimations.forEach((animation) => {
        animation.start();
      });

      // Fade out skeleton and fade in content (run separately to avoid conflicts)
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 400,
            delay: 100,
            useNativeDriver: true,
          }),
          Animated.spring(scoreScale, {
            toValue: 1,
            friction: 4,
            tension: 100,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    });
  }, [
    isValidScore,
    targetRow,
    goldPercentage,
    distribution,
    skeletonOpacity,
    contentOpacity,
    scoreScale,
    barWidths,
    starBounces,
  ]);

  // Expose triggerAnimation to parent via ref
  useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
    }
    return () => {
      if (onTriggerAnimationRef) {
        onTriggerAnimationRef.current = null;
      }
    };
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animations when score changes from -1 to valid value (only if parent doesn't control via ref)
  useEffect(() => {
    // If parent provides onTriggerAnimationRef, don't auto-trigger - let parent handle it
    if (onTriggerAnimationRef) {
      return;
    }

    const wasLoading = prevScoreRef.current === -1;
    const isLoaded = isValidScore && score >= 0;
    const isNowLoading = score === -1;

    // Handle initial mount: always trigger animation if data is loaded
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (isLoaded && isValidScore && targetRow > 0) {
        // Data already loaded on mount - trigger animation for better UX
        hasAnimatedRef.current = true;

        // Reset all animation values to starting state
        skeletonOpacity.setValue(1);
        contentOpacity.setValue(0);
        scoreScale.setValue(0.8);

        // Stop any ongoing animations first
        barWidths.forEach((bar) => {
          bar.stopAnimation();
          bar.setValue(0);
        });
        starBounces.forEach((star) => {
          star.stopAnimation();
          star.setValue(1);
        });

        // Use requestAnimationFrame to ensure component is fully rendered before animating
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Start bar animations
            const barAnimations = distribution.map(({ stars, percentage }, index) => {
              const isTargetRow = stars === targetRow;
              const targetWidth = isTargetRow ? goldPercentage * 100 : percentage * 100;

              return Animated.timing(barWidths[index], {
                toValue: targetWidth,
                duration: 800,
                delay: index * 50,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true, // Can use native driver with scaleX transform
              });
            });

            // Calculate star bounce triggers
            const starBounceAnimations: Animated.CompositeAnimation[] = [];
            const fullGoldStars = Math.floor(goldPercentage * targetRow);
            const hasPartialStar = goldPercentage * targetRow > fullGoldStars;

            for (let i = 0; i < fullGoldStars; i++) {
              const starIndex = i;
              const threshold = (starIndex + 1) / targetRow;
              const delay = 800 * threshold;

              starBounceAnimations.push(
                Animated.sequence([
                  Animated.delay(delay),
                  Animated.spring(starBounces[starIndex], {
                    toValue: 1.3,
                    friction: 3,
                    tension: 100,
                    useNativeDriver: true,
                  }),
                  Animated.spring(starBounces[starIndex], {
                    toValue: 1,
                    friction: 4,
                    tension: 200,
                    useNativeDriver: true,
                  }),
                ])
              );
            }

            if (hasPartialStar) {
              const partialIndex = fullGoldStars;
              const threshold = (partialIndex + 0.5) / targetRow;
              const delay = 800 * threshold;

              starBounceAnimations.push(
                Animated.sequence([
                  Animated.delay(delay),
                  Animated.spring(starBounces[partialIndex], {
                    toValue: 1.2,
                    friction: 3,
                    tension: 100,
                    useNativeDriver: true,
                  }),
                  Animated.spring(starBounces[partialIndex], {
                    toValue: 1,
                    friction: 4,
                    tension: 200,
                    useNativeDriver: true,
                  }),
                ])
              );
            }

            // Fade out skeleton and fade in content
            // Start bar animations (these can run in parallel)
            Animated.parallel(barAnimations).start();

            // Start star bounce animations (these have delays, run separately)
            starBounceAnimations.forEach((animation) => {
              animation.start();
            });

            // Fade out skeleton and fade in content (run separately to avoid conflicts)
            Animated.parallel([
              Animated.timing(skeletonOpacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }),
              Animated.parallel([
                Animated.timing(contentOpacity, {
                  toValue: 1,
                  duration: 400,
                  delay: 100,
                  useNativeDriver: true,
                }),
                Animated.spring(scoreScale, {
                  toValue: 1,
                  friction: 4,
                  tension: 100,
                  useNativeDriver: true,
                }),
              ]),
            ]).start();
          });
        });
      } else if (isLoaded) {
        // Fallback: if we can't animate, at least show the content
        skeletonOpacity.setValue(0);
        contentOpacity.setValue(1);
        scoreScale.setValue(1);
        hasAnimatedRef.current = true;

        // Set bar widths immediately
        distribution.forEach(({ stars, percentage }, index) => {
          const isTargetRow = stars === targetRow;
          const targetWidth = isTargetRow ? goldPercentage * 100 : percentage * 100;
          barWidths[index].setValue(targetWidth);
        });
      }
      // If loading on mount, keep skeleton visible (already set to opacity 1)
      prevScoreRef.current = score;
      return;
    }

    // Reset animation state if score goes back to loading
    if (isNowLoading && hasAnimatedRef.current) {
      hasAnimatedRef.current = false;
      skeletonOpacity.setValue(1);
      contentOpacity.setValue(0);
      scoreScale.setValue(0.8);
      barWidths.forEach((bar) => bar.setValue(0));
      starBounces.forEach((star) => star.setValue(1));
    }

    if (wasLoading && isLoaded && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      triggerAnimation();
    } else if (isLoaded && hasAnimatedRef.current) {
      // Update bar widths if score changes after initial load
      // Stop any ongoing animations first to prevent conflicts
      distribution.forEach(({ stars, percentage }, index) => {
        const isTargetRow = stars === targetRow;
        const targetWidth = isTargetRow ? goldPercentage * 100 : percentage * 100;

        // Stop any ongoing animation
        barWidths[index].stopAnimation();

        Animated.timing(barWidths[index], {
          toValue: targetWidth,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true, // Can use native driver with scaleX transform
        }).start();
      });
    }

    prevScoreRef.current = score;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, isValidScore, targetRow, goldPercentage, distribution, onTriggerAnimationRef]);

  const displayScore = score % 1 === 0 ? score.toString() : score.toFixed(1);
  const isLoading = score === -1;

  return (
    <HStack align="flex-start" gap={16} className="w-full px-4">
      {/* Large score display on the left */}
      <VStack align="center" spacing={0}>
        {/* Skeleton overlay */}
        <Animated.View
          style={{
            position: 'absolute',
            opacity: skeletonOpacity,
            pointerEvents: isLoading ? 'auto' : 'none',
          }}>
          <Skeleton className="my-[3px] h-[32px] w-[48px] bg-primary-700" />
        </Animated.View>

        {/* Actual score content */}
        <Animated.View
          style={{
            opacity: contentOpacity,
            transform: [{ scale: scoreScale }],
          }}>
          <Text mono size={32} heavy className="text-primary-0">
            {isLoading ? '0.0' : Number(displayScore).toFixed(1)}
          </Text>
        </Animated.View>

        {/* Skeleton for "out of 5" */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 35,
            opacity: skeletonOpacity,
            pointerEvents: isLoading ? 'auto' : 'none',
          }}>
          <Skeleton className="my-1 h-[14px] w-[40px] bg-primary-700" />
        </Animated.View>

        {/* Actual "out of 5" text */}
        <Animated.View
          style={{
            marginTop: 4,
            opacity: contentOpacity,
          }}>
          <Text size={12} className="text-primary-300">
            out of 5
          </Text>
        </Animated.View>
      </VStack>

      {/* Star distribution bars on the right */}
      <VStack spacing={4} className="flex-1" style={{ flex: 1, minWidth: 0 }}>
        {distribution.map(({ stars, percentage }, distIndex) => {
          const isTargetRow = stars === targetRow;
          // Calculate how many full stars should be gold (e.g., 1.1 in 2-star row = 1 full star)
          const fullGoldStars = isTargetRow ? Math.floor(goldPercentage * stars) : 0;
          // Calculate if there's a partial star (e.g., 1.1 in 2-star row has 0.1 of second star)
          const hasPartialStar = isTargetRow && goldPercentage * stars > fullGoldStars;

          // Use scaleX transform for smooth native driver animation
          // Interpolate from 0-100 to 0-1 for scaleX
          const animatedScaleX = barWidths[distIndex].interpolate({
            inputRange: [0, 100],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          });

          return (
            <HStack
              key={stars}
              align="center"
              gap={4}
              className="w-full"
              style={{ flex: 1, minWidth: 0 }}>
              {/* Star rating label */}
              <HStack align="center" gap={2} style={{ flexShrink: 0 }}>
                {[5, 4, 3, 2, 1].slice(0, stars).map((_, idx) => {
                  const isFullGold = isTargetRow && idx < fullGoldStars;
                  const isPartialGold = isTargetRow && idx === fullGoldStars && hasPartialStar;

                  // Use bounce animation for stars in target row that should be gold
                  const bounceScale =
                    isTargetRow && (isFullGold || isPartialGold) ? starBounces[idx] : noBounceScale;

                  return (
                    <Animated.View
                      key={idx}
                      style={{
                        transform: [{ scale: bounceScale }],
                      }}>
                      <Icon
                        name="ic:round-star"
                        size={12}
                        color={
                          isFullGold
                            ? getYellowColor('300')
                            : isPartialGold
                              ? getYellowColor('500')
                              : getPrimaryColor('400')
                        }
                        style={
                          isPartialGold
                            ? { opacity: goldPercentage * stars - fullGoldStars }
                            : undefined
                        }
                      />
                    </Animated.View>
                  );
                })}
              </HStack>

              {/* Distribution bar directly after stars */}
              <View
                className="h-2 flex-1 overflow-hidden rounded-full"
                style={{
                  flex: 1,
                  minWidth: 0,
                  backgroundColor: isTargetRow
                    ? getYellowColor('500') // Off-gold background for gold bar
                    : getPrimaryColor('700'),
                }}>
                <Animated.View
                  className="h-full rounded-full"
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: isTargetRow
                      ? getYellowColor('300')
                      : percentage > 0
                        ? getPrimaryColor('400')
                        : 'transparent',
                    // alignSelf: 'flex-start',
                    transform: [
                      {
                        translateX: animatedScaleX.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['-50%', '0%'],
                        }),
                      },
                      { scaleX: animatedScaleX },
                    ],
                  }}
                />
              </View>
            </HStack>
          );
        })}
      </VStack>
    </HStack>
  );
};

// AnimatedMintName component
const AnimatedMintName = ({
  mintInfo,
  auditMintInfo,
  auditInfo,
  mintUrl,
  isLoading,
  onTriggerAnimationRef,
}: {
  mintInfo?: any;
  auditMintInfo?: any;
  auditInfo?: any;
  mintUrl?: string;
  isLoading?: boolean;
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
}) => {
  // Calculate display name with fallback logic
  const displayName = React.useMemo(() => {
    return (
      mintInfo?.name ||
      auditMintInfo?.name ||
      auditInfo?.auditorData?.name ||
      mintUrl?.split('//')[1]?.split('/')[0] ||
      'Unknown Mint'
    );
  }, [mintInfo?.name, auditMintInfo?.name, auditInfo?.auditorData?.name, mintUrl]);

  // Check if we have name data
  const hasData = !isLoading && (mintInfo || auditMintInfo || auditInfo || mintUrl);

  // Animation values
  const skeletonOpacity = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  // Trigger animation function
  const triggerAnimation = React.useCallback(() => {
    // Reset values
    skeletonOpacity.setValue(1);
    textOpacity.setValue(0);

    // Start animations
    requestAnimationFrame(() => {
      // Fade out skeleton and fade in text
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 300,
          delay: 50,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [skeletonOpacity, textOpacity]);

  // Expose triggerAnimation via ref
  React.useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
    }
    return () => {
      if (onTriggerAnimationRef) {
        onTriggerAnimationRef.current = null;
      }
    };
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animation when data becomes available (only if parent doesn't control via ref)
  const isInitialMount = useRef(true);
  React.useEffect(() => {
    // If parent provides onTriggerAnimationRef, don't auto-trigger - let parent handle it
    if (onTriggerAnimationRef) {
      return;
    }

    if (hasData) {
      if (isInitialMount.current) {
        isInitialMount.current = false;
        // Delay initial animation to ensure component is fully rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            triggerAnimation();
          }, 100);
        });
      } else {
        // Data changed, trigger animation again
        triggerAnimation();
      }
    }
  }, [hasData, triggerAnimation, onTriggerAnimationRef]);

  const showSkeleton = isLoading || !hasData;

  return (
    <View style={{ position: 'relative', alignItems: 'center', marginBottom: 4 }}>
      {/* Skeleton */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          opacity: skeletonOpacity,
          pointerEvents: showSkeleton ? 'auto' : 'none',
        }}>
        <Skeleton className="mb-1 h-[32px] w-[200px] bg-primary-700" />
      </Animated.View>

      {/* Text */}
      <Animated.View
        style={{
          opacity: textOpacity,
        }}>
        <Text size={24} bold className="mb-1 text-center font-bold text-primary-0">
          {displayName}
        </Text>
      </Animated.View>
    </View>
  );
};

// AnimatedReviewsButton component
const AnimatedReviewsButton = ({
  recommendations,
  loading,
  showReviews,
  onToggleReviews,
  onTriggerAnimationRef,
}: {
  recommendations?: any[];
  loading?: boolean;
  showReviews: boolean;
  onToggleReviews: () => void;
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
}) => {
  const { getYellowColor } = useTheme();

  // Calculate target count
  const targetCount = recommendations?.length || 0;
  const hasData = !loading && recommendations !== undefined;
  const hasReviews = targetCount > 0;

  // Animation values
  const skeletonOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const countAnimation = useRef(new Animated.Value(0)).current;

  // State for animated count (updated via listener)
  const [displayCount, setDisplayCount] = React.useState(0);

  // Set up listener for animated count
  React.useEffect(() => {
    const listener = countAnimation.addListener(({ value }) => {
      setDisplayCount(Math.round(value));
    });

    return () => {
      countAnimation.removeListener(listener);
    };
  }, [countAnimation]);

  // Trigger animation function
  const triggerAnimation = React.useCallback(() => {
    // Stop any ongoing animations
    countAnimation.stopAnimation();

    // Reset values
    skeletonOpacity.setValue(1);
    contentOpacity.setValue(0);
    countAnimation.setValue(0);

    // Start animations
    requestAnimationFrame(() => {
      // Fade out skeleton and fade in content
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 300,
          delay: 50,
          useNativeDriver: true,
        }),
      ]).start();

      // Count animation
      Animated.timing(countAnimation, {
        toValue: targetCount,
        duration: 1000,
        delay: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });
  }, [targetCount, skeletonOpacity, contentOpacity, countAnimation]);

  // Expose triggerAnimation via ref
  React.useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
    }
    return () => {
      if (onTriggerAnimationRef) {
        onTriggerAnimationRef.current = null;
      }
    };
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animation when data becomes available (only if parent doesn't control via ref)
  const isInitialMount = useRef(true);
  React.useEffect(() => {
    // If parent provides onTriggerAnimationRef, don't auto-trigger - let parent handle it
    if (onTriggerAnimationRef) {
      return;
    }

    if (hasData) {
      if (isInitialMount.current) {
        isInitialMount.current = false;
        // Delay initial animation to ensure component is fully rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            triggerAnimation();
          }, 100);
        });
      } else {
        // Data changed, trigger animation again
        triggerAnimation();
      }
    }
  }, [hasData, triggerAnimation, onTriggerAnimationRef]);

  // Format text with proper pluralization
  const formatText = (count: number) => {
    if (count === 0) {
      return 'No reviews';
    }
    return `Show ${count} review${count !== 1 ? 's' : ''}`;
  };

  // Button is clickable if we have reviews, regardless of loading state
  // (content opacity will handle visibility)
  const isClickable = hasReviews;

  return (
    <>
      <Spacer size={8} />
      {!showReviews ? (
        <View className="w-full px-4">
          <HStack justify="flex-end" className="w-full">
            <View style={{ position: 'relative' }}>
              {/* Skeleton */}
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  opacity: skeletonOpacity,
                  pointerEvents: 'none', // Never block clicks - skeleton is just visual
                }}>
                <Skeleton className="h-[20px] w-[120px] bg-primary-700" />
              </Animated.View>

              {/* Content */}
              <Animated.View
                style={{
                  opacity: contentOpacity,
                }}>
                <Text
                  size={14}
                  bold
                  style={{
                    color: isClickable ? getYellowColor('300') : getYellowColor('500'),
                    textDecorationLine: isClickable ? 'underline' : 'none',
                    opacity: isClickable ? 1 : 0.5,
                  }}
                  onPress={isClickable ? onToggleReviews : undefined}>
                  {formatText(displayCount)}
                </Text>
              </Animated.View>
            </View>
          </HStack>
        </View>
      ) : (
        <>
          <View className="w-full px-4">
            <HStack justify="flex-end" className="w-full">
              <Text
                size={14}
                bold
                style={{
                  color: getYellowColor('300'),
                  textDecorationLine: 'underline',
                }}
                onPress={onToggleReviews}>
                Hide reviews
              </Text>
            </HStack>
          </View>
          {hasReviews && <ReviewsList recommendations={recommendations} />}
        </>
      )}
    </>
  );
};

// ReviewsList component
const ReviewsList = ({ recommendations }: { recommendations?: any[] }) => {
  const { getPrimaryColor, getYellowColor } = useTheme();
  const [currentPage, setCurrentPage] = useState(0);
  const reviewsPerPage = 3;

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  // Calculate pagination
  const totalPages = Math.ceil(recommendations.length / reviewsPerPage);
  const startIndex = currentPage * reviewsPerPage;
  const endIndex = Math.min(startIndex + reviewsPerPage, recommendations.length);
  const currentReviews = recommendations.slice(startIndex, endIndex);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <VStack spacing={12} className="w-full px-4">
      {/* Reviews */}
      <VStack spacing={0} className="w-full">
        {currentReviews.map((review, index) => {
          // Extract review data - adjust property names based on actual KYM structure
          const reviewText = review.comment;
          const reviewScore = review.score;

          // Determine display name - prefer name, fallback to truncated npub
          const displayName = getUsername(review.pubkey);

          return (
            <View key={index} style={{ width: '100%' }}>
              {index > 0 && (
                <View
                  className="h-px w-full"
                  style={{ backgroundColor: getPrimaryColor('700'), marginVertical: 16 }}
                />
              )}
              <HStack align="flex-start" gap={12} style={{ width: '100%', flex: 1 }}>
                {/* Avatar */}
                <View style={{ flexShrink: 0 }}>
                  <Avatar seed={review.pubkey} size={40} variant="person" />
                </View>

                {/* Review content */}
                <VStack spacing={4} className="flex-1" style={{ flex: 1, minWidth: 0 }}>
                  {/* User identifier and date */}
                  <HStack
                    align="center"
                    justify="space-between"
                    className="w-full"
                    style={{ flex: 1, minWidth: 0 }}>
                    <HStack align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        size={14}
                        bold
                        className="text-primary-0"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ flex: 1, minWidth: 0 }}>
                        {displayName}
                      </Text>
                    </HStack>
                  </HStack>

                  {/* Star rating */}
                  <HStack align="center" gap={2} style={{ flexShrink: 0 }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        name="ic:round-star"
                        size={14}
                        color={
                          star <= Math.round(reviewScore)
                            ? getYellowColor('300')
                            : getPrimaryColor('600')
                        }
                      />
                    ))}
                  </HStack>

                  {/* Review text */}
                  {reviewText && (
                    <Text
                      size={14}
                      className="text-primary-200"
                      numberOfLines={10}
                      ellipsizeMode="tail"
                      style={{ flex: 1, minWidth: 0 }}>
                      {reviewText}
                    </Text>
                  )}
                </VStack>
              </HStack>
            </View>
          );
        })}
      </VStack>

      {/* Pagination Controls */}
      <View
        className="w-full rounded-full border border-primary-600 bg-primary-900 px-4"
        style={{ position: 'relative' }}>
        <HStack align="center" className="w-full">
          {/* Previous Button - 50% width */}
          <View
            className="flex-1 p-3"
            style={{
              width: '50%',
              opacity: currentPage === 0 ? 0.5 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onTouchEnd={() => currentPage > 0 && handlePrevPage()}>
            <Icon name="fa6-solid:chevron-left" size={12} color={getPrimaryColor('200')} />
          </View>

          <Text size={12} bold className="text-primary-200">
            {currentPage + 1} / {totalPages}
          </Text>

          {/* Next Button - 50% width */}
          <View
            className="flex-1 p-3"
            style={{
              width: '50%',
              opacity: currentPage === totalPages - 1 ? 0.5 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onTouchEnd={() => currentPage < totalPages - 1 && handleNextPage()}>
            <Icon name="fa6-solid:chevron-right" size={12} color={getPrimaryColor('200')} />
          </View>
        </HStack>
      </View>
    </VStack>
  );
};

/**
 * InfoRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'info'>} props
 * @returns {JSX.Element}
 */
const InfoRoute = ({ params }: RouteScreenProps<'mint-balance', 'info'>) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getMintInfo } = useMintManagement();

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReviews, setShowReviews] = useState(false);

  // Refs for triggering animations from parent
  const donutAnimationRef = useRef<(() => void) | null>(null);
  const ratingAnimationRef = useRef<(() => void) | null>(null);
  const statsAnimationRef = useRef<(() => void) | null>(null);
  const reviewsButtonAnimationRef = useRef<(() => void) | null>(null);
  const mintNameAnimationRef = useRef<(() => void) | null>(null);

  // Ref for badge animation trigger
  const badgeAnimationRef = useRef<(() => void) | null>(null);
  const badgeResetRef = useRef<(() => void) | null>(null);

  // Animation values for the subtle pulsating effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  // Get mintUrl from route params, global variable, or payload
  const mintUrl = params?.mintUrl || (global as any).currentMintUrl || payload?.mintUrl;

  console.log('🔍 INFO PAGE DEBUG:');
  console.log('📋 Params:', params);
  console.log('📋 Params mintUrl:', params?.mintUrl);
  console.log('📋 Payload mintUrl:', payload?.mintUrl);
  console.log('📋 Final mintUrl:', mintUrl);

  // Use audited mint hook to get audit data for this specific mint
  const {
    auditInfo,
    mintInfo: auditMintInfo,
    loading: auditLoading,
    error: auditError,
  } = useAuditedMint(mintUrl);

  // Fetch KYM rating data
  const {
    score: kymScore,
    recommendations: kymRecommendations,
    loading: kymLoading,
  } = useKYMMint(mintUrl);
  /**
   * Handles text copying to clipboard
   *
   * @async
   * @description Copies text to clipboard with error handling
   *
   * **Process:** Clipboard.setStringAsync() → show alert on error
   * **Effects:** Clipboard write, error alerts
   *
   * @param {string} text - Text to copy
   */
  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  /**
   * Handles contact method interactions
   *
   * @async
   * @description Opens appropriate app/link based on contact method, falls back to clipboard
   *
   * **Process:** switch method → openURL/navigate → fallback to clipboard
   * **Effects:** External app opens, navigation, clipboard write, sheet close
   *
   * @param {string} method - Contact method (email, twitter, nostr, etc.)
   * @param {string} info - Contact information
   */
  const handleContactPress = async (method: string, info: string) => {
    try {
      switch (method.toLowerCase()) {
        case 'email':
          await Linking.openURL(`mailto:${info}`);
          break;
        case 'twitter':
        case 'x':
          // Remove @ symbol if present and open X app
          const username = info.replace('@', '');
          await Linking.openURL(`https://x.com/${username}`);
          break;
        case 'nostr':
          // Convert npub to pubkey if needed and navigate to userMessages
          const pubkey = npubToPubkey(info);
          router.push({
            pathname: '/userMessages',
            params: {
              pubkey: pubkey,
            },
          });
          // Close the current sheet
          sheetRef.current?.hide();
          break;
        default:
          // Fallback to copying to clipboard
          await handleCopy(info);
      }
    } catch (error) {
      console.error('Error opening contact link:', error);
      // Fallback to copying to clipboard if opening fails
      Alert.alert('Unable to open', 'Copying to clipboard instead', [
        {
          text: 'OK',
          onPress: () => handleCopy(info),
        },
      ]);
    }
  };

  // Start the subtle heartbeat animation
  useEffect(() => {
    const startSubtleHeartbeat = () => {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.66,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(600),
      ]).start(() => {
        startSubtleHeartbeat();
      });
    };

    startSubtleHeartbeat();
  }, [pulseAnim, opacityAnim]);

  useEffect(() => {
    const fetchMintInfo = async () => {
      if (!mintUrl) {
        setError('No mint URL provided');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch mint info using Coco - audit data comes from useDiscoveredMints
        const mintInfoData = await getMintInfo(mintUrl);
        setMintInfo(mintInfoData);
      } catch (err) {
        console.error('Failed to fetch mint info:', err);
        setError('Failed to load mint information');
      } finally {
        setLoading(false);
      }
    };

    fetchMintInfo();
  }, [mintUrl, getMintInfo]);

  // Callback for when donut animation completes - trigger badge animation
  const handleDonutAnimationComplete = React.useCallback(() => {
    if (badgeAnimationRef.current) {
      badgeAnimationRef.current();
    }
  }, []);

  // Combined loading state - show loading if either mint info or audit data is loading
  const isLoading = loading || auditLoading;

  // Function to trigger all animations
  const triggerAllAnimations = React.useCallback(() => {
    // Reset badge animation first
    badgeResetRef.current?.();
    // Trigger donut animation (which will trigger badge when complete)
    donutAnimationRef.current?.();
    // Trigger rating animation
    ratingAnimationRef.current?.();
    // Trigger stats animation
    statsAnimationRef.current?.();
    // Trigger reviews button animation
    reviewsButtonAnimationRef.current?.();
    // Trigger mint name animation
    mintNameAnimationRef.current?.();
  }, []);

  // Track if we've triggered the initial animation
  const hasTriggeredInitialAnimation = useRef(false);

  // Centralized effect to trigger all animations once data is loaded
  React.useEffect(() => {
    // Wait for all data to be ready
    const dataReady =
      !isLoading &&
      mintInfo &&
      donutAnimationRef.current &&
      ratingAnimationRef.current &&
      statsAnimationRef.current &&
      reviewsButtonAnimationRef.current &&
      mintNameAnimationRef.current &&
      !hasTriggeredInitialAnimation.current;

    if (dataReady) {
      hasTriggeredInitialAnimation.current = true;

      // Use requestAnimationFrame to ensure DOM is ready, then add a small delay
      requestAnimationFrame(() => {
        setTimeout(() => {
          console.log('🎬 Triggering initial animations');
          triggerAllAnimations();
        }, 200); // 200ms delay to ensure all components are mounted and refs are set
      });
    }
  }, [isLoading, mintInfo, triggerAllAnimations]);

  // Reset on unmount to handle navigation back to the page
  React.useEffect(() => {
    return () => {
      hasTriggeredInitialAnimation.current = false;
    };
  }, []);

  if (false) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <VStack align="center" className="py-6 pb-8">
            <VStack align="center" className="mb-4">
              <View style={{ position: 'relative', width: 84, height: 84 }}>
                <DonutChart
                  size={84}
                  variant="round"
                  sections={[
                    {
                      value: 5,
                      color: getPrimaryColor('600'),
                    },
                    {
                      value: 5,
                      color: getPrimaryColor('700'),
                    },
                  ]}
                  onAnimationComplete={handleDonutAnimationComplete}
                />
                {/* Persistent Avatar positioned absolutely over donut */}
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 84,
                    height: 84,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                  <AnimatedAvatar
                    picture={mintInfo?.icon_url || auditMintInfo?.icon_url}
                    name={mintInfo?.name || auditMintInfo?.name || extractDomain(mintUrl || '')}
                    alt={`${mintInfo?.name || auditMintInfo?.name || 'Mint'} icon`}
                    status={auditInfo?.auditorData?.state}
                    size={70}
                    isLoading={isLoading}
                    onAnimationComplete={badgeAnimationRef}
                    onResetRef={badgeResetRef}
                  />
                </View>
              </View>
            </VStack>
            <Text size={24} bold className="mb-1 text-center font-bold text-primary-0">
              {mintInfo?.name || 'Loading...'}
            </Text>
            {/* {mintInfo?.version && (
              <Text className="text-center text-sm text-primary-100">{mintInfo.version}</Text>
            )} */}
            {/* Rating Display - Always render to prevent jarring appearance */}
            <Spacer size={16} />
            <RatingDisplay score={kymScore ?? -1} recommendations={kymRecommendations} />
          </VStack>
        </ScrollView>
      </Wrapper>
    );
  }

  const hasError = error || auditError || !mintInfo;

  // Calculate stats from audit data
  const totalMints = auditInfo?.auditorData?.mints;
  const totalMelts = auditInfo?.auditorData?.melts;
  const totalErrors = auditInfo?.auditorData?.errors;

  // Calculate success rate: prefer KYM score, fallback to error-based calculation
  const successRate = auditInfo?.score
    ? auditInfo.score / 5 // KYM score is 0-5, normalize to 0-1
    : (() => {
        const totalOps = (totalMints || 0) + (totalMelts || 0);
        return totalOps > 0 ? 1 - (totalErrors || 0) / totalOps : undefined;
      })();

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      {/* Dev button to test all animations */}
      {__DEV__ && (
        <View
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1000,
          }}>
          <View
            onTouchEnd={triggerAllAnimations}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: getPrimaryColor('600'),
              borderRadius: 8,
              borderWidth: 1,
              borderColor: getPrimaryColor('500'),
            }}>
            <Text size={12} bold className="text-primary-0">
              Test Animations
            </Text>
          </View>
        </View>
      )}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Mint Header with integrated stats */}
        <VStack align="center" className="py-6 pb-8">
          <VStack align="center" className="mb-4">
            <View style={{ position: 'relative', width: 84, height: 84 }}>
              <DonutChart
                size={84}
                variant="round"
                sections={[
                  {
                    value: hasError ? 3 : (successRate || 0.5) * 10,
                    color: hasError ? getPrimaryColor('600') : getGreenColor('300'),
                  },
                  {
                    value: hasError ? 7 : (1 - (successRate || 0.5)) * 10,
                    color: hasError ? getPrimaryColor('700') : getRedColor('300'),
                  },
                ]}
                onTriggerAnimationRef={donutAnimationRef}
                onAnimationComplete={handleDonutAnimationComplete}
              />
              {/* Persistent Avatar positioned absolutely over donut */}
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: 84,
                  height: 84,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                <AnimatedAvatar
                  picture={mintInfo?.icon_url || auditMintInfo?.icon_url}
                  name={mintInfo?.name || auditMintInfo?.name || extractDomain(mintUrl || '')}
                  alt={`${mintInfo?.name || auditMintInfo?.name || 'Mint'} icon`}
                  status={auditInfo?.auditorData?.state}
                  size={70}
                  isLoading={isLoading}
                  onAnimationComplete={badgeAnimationRef}
                  onResetRef={badgeResetRef}
                />
              </View>
            </View>
          </VStack>
          <AnimatedMintName
            mintInfo={mintInfo}
            auditMintInfo={auditMintInfo}
            auditInfo={auditInfo}
            mintUrl={mintUrl}
            isLoading={isLoading}
            onTriggerAnimationRef={mintNameAnimationRef}
          />
          {/* {mintInfo?.version && (
            <Text className="text-center text-sm text-primary-100">{mintInfo.version}</Text>
          )} */}

          {/* Rating Display - Always render to prevent jarring appearance */}
          <Spacer size={16} />
          <RatingDisplay
            score={kymScore ?? -1}
            recommendations={kymRecommendations}
            onTriggerAnimationRef={ratingAnimationRef}
          />

          {/* Reviews Button - Always render with skeleton loading state */}
          <AnimatedReviewsButton
            recommendations={kymRecommendations}
            loading={kymLoading}
            showReviews={showReviews}
            onToggleReviews={() => setShowReviews(!showReviews)}
            onTriggerAnimationRef={reviewsButtonAnimationRef}
          />

          {/* Stats Grid */}
          <StatsGrid
            successRate={successRate}
            mintSpeed={auditInfo?.speedIndex}
            totalMints={totalMints}
            totalMelts={totalMelts}
            onTriggerAnimationRef={statsAnimationRef}
          />
        </VStack>

        {/* Description Card */}
        {mintInfo?.description && (
          <>
            <Card variant="info" message={mintInfo.description} />
            <Spacer size={12} />
          </>
        )}

        {/* Long Description */}
        {mintInfo?.description_long && (
          <>
            <Card variant="warning" message={mintInfo.description_long} />
            <Spacer size={12} />
          </>
        )}

        {/* Message of the Day */}
        {mintInfo?.motd && (
          <>
            <Card variant="warning" message={`Message: ${mintInfo.motd}`} />
            <Spacer size={12} />
          </>
        )}

        {/* Contact Section - only show if we have contact info */}
        {mintInfo?.contact && mintInfo.contact.length > 0 && (
          <Section title="Contact">
            {mintInfo.contact.map((contact: any, index: number) => (
              <RowButton
                isFirst={index === 0}
                key={index}
                label={
                  contact.method.toUpperCase() === 'NOSTR' ? (
                    <HStack align="center" gap={8}>
                      <CurrencyIcon
                        colors={[getPrimaryColor('400')]}
                        width={20}
                        currency={'nostr'}
                      />
                      <Text className="text-primary-50" bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </HStack>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <HStack align="center" gap={8}>
                      <Icon name="hugeicons:new-twitter" size={20} color={getPrimaryColor('400')} />
                      <Text className="text-primary-50" bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <HStack align="center" gap={8}>
                      <Icon name="mdi:at" size={20} color={getPrimaryColor('400')} />
                      <Text className="text-primary-50" bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : (
                    <HStack align="center">
                      <Text className="text-primary-50" bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  )
                }
                onPress={() => handleContactPress(contact.method, contact.info)}
              />
            ))}
          </Section>
        )}
      </ScrollView>
    </Wrapper>
  );
};

export default InfoRoute;
