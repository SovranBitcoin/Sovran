import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import "react-native-get-random-values";
import { Animated, Platform, StyleSheet } from "react-native";

import { Text, View } from "components/common/Themed";
import {
  BitcoinMaskIcon,
  DollarMaskIcon,
  EuroMaskIcon,
  PoundMaskIcon,
} from "assets/icons";
import { PrimaryBalance } from "components/layout/PrimaryBalance";

import { setSelectedMint } from "helper/redux/cashu";
import { greys, shades } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";
import SelectedMintDisplay, { sovran } from "components/layout/sheets/mints";
import { useTypedNavigation } from "helper/navigation/hooks/useTypedNavigation";
import { NonGestureView } from "./NonGestureView";

export function Account({ accounts, account, keysets, proofs, goToIndex }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const n = useTypedNavigation();

  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1250,
        useNativeDriver: true,
      })
    );
    spin.start();
  }, [spinValue]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.9,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const profileId = useSelector(
    (state: any) => state.nostr?.currentProfile?.id
  );

  const dispatch = useDispatch();
  const handleMintSelected = async (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => {
    try {
      // Update selected mint in Redux
      dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
      // Update account unit
      const index = accounts.findIndex((a) => a.unit === mint.unit);
      goToIndex(index);
    } catch (error) {
      
      throw error;
    }
  };

  return (
    <NonGestureView key={account.key} index={0} style={styles.nonGestureView}>
      <View style={styles.transparentBackground}>
        <View style={styles.transparentBackgroundWithPadding}></View>
        <View style={styles.transparentBackgroundRow}>
          <View
            style={[
              styles.accountUnitContainer,
              sovran.backgroundSolid,
              sovran.borderSubtle,
            ]}
          >
            <Text style={styles.accountUnitText} weight="bold">
              {account.unit === "sat" ? "BTC" : account.unit.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.transparentBackgroundRowCenter}>
          <SelectedMintDisplay
            onMintSelected={handleMintSelected}
            unit={account.unit}
          />
        </View>
        <PrimaryBalance account={account} proofs={proofs} keysets={keysets} />
      </View>

      <View style={styles.maxWidthContainer}>
        <View style={styles.transparentBackgroundRow}></View>

        <View style={styles.transparentBackgroundRow}>
          {"•"
            .repeat(accounts.filter((acc) => acc.type === "onchain").length)
            .split("")
            .map((dot, index) => {
              return (
                <Text
                  key={index}
                  weight={
                    index ===
                    accounts.findIndex(
                      (a) => a.unit === account.unit && a.type === account.type
                    )
                      ? "bold"
                      : "regular"
                  }
                  size={16}
                  style={{
                    color:
                      index ===
                      accounts.findIndex(
                        (a) =>
                          a.unit === account.unit &&
                          a.type === account.type &&
                          a.key === account.key
                      )
                        ? greys(theme)[0]
                        : greys(theme)[1500],
                    marginLeft: 1,
                    marginRight: 1,
                    marginTop: 3,
                  }}
                >
                  •
                </Text>
              );
            })}
          <Text
            weight="bold"
            size={10}
            style={{
              color: greys(theme)[1000],
              marginLeft: 4,
              marginRight: 4,
              marginTop: 6,
            }}
          >
            {" "}
          </Text>
          {"•"
            .repeat(accounts.filter((acc) => acc.type !== "onchain").length)
            .split("")
            .map((dot, index) => {
              return (
                <Text
                  key={
                    accounts.filter((acc) => acc.type === "onchain").length +
                    index
                  }
                  weight={
                    accounts.filter((acc) => acc.type === "onchain").length +
                      index ===
                    accounts.findIndex(
                      (a) => a.unit === account.unit && a.type === account.type
                    )
                      ? "bold"
                      : "regular"
                  }
                  size={16}
                  style={{
                    color:
                      accounts.filter((acc) => acc.type === "onchain").length +
                        index ===
                      accounts.findIndex(
                        (a) =>
                          a.unit === account.unit && a.type === account.type
                      )
                        ? greys(theme)[0]
                        : greys(theme)[1500],
                    marginLeft: 1,
                    marginRight: 1,
                    marginTop: 3,
                  }}
                >
                  •
                </Text>
              );
            })}
        </View>
      </View>

      <View style={styles.absoluteBottomBorder}></View>

      <View style={styles.absoluteRightBottomBorder}>
        <View style={styles.bottomNegative}>
          {account.unit === "sat" ? (
            <BitcoinMaskIcon />
          ) : account.unit === "usd" ? (
            <DollarMaskIcon />
          ) : account.unit === "eur" ? (
            <EuroMaskIcon />
          ) : account.unit === "gbp" ? (
            <PoundMaskIcon />
          ) : null}
        </View>
      </View>
    </NonGestureView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    scrollView: {
      marginTop: -38,
      marginBottom: -24,
      backgroundColor: greys(theme)[2300],
    },
    safeAreaView: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
    },
    nonGestureView: {
      backgroundColor: greys(theme)[2300],
      overflow: "hidden",
      zIndex: 1,
      height: 335,
      width: "100%",
    },
    transparentBackground: {
      backgroundColor: "transparent",
    },
    transparentBackgroundWithPadding: {
      backgroundColor: "transparent",
      padding: 16,
      marginTop: Platform.OS === "web" ? 64 : 16,
      paddingBottom: 0,
      flexDirection: "row",
      alignItems: "center",
      paddingTop: 16,
      zIndex: 9,
      justifyContent: "space-around",
    },
    transparentBackgroundRow: {
      flexDirection: "row",
      backgroundColor: "transparent",
    },
    accountUnitContainer: {
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 99999,
      elevation: 1,
      zIndex: 1,
      backgroundColor: greys(theme)[2300],
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      margin: "auto",
      marginBottom: 8,
    },
    accountUnitText: {
      color: greys(theme)[200],
    },
    transparentBackgroundRowCenter: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "transparent",
    },
    maxWidthContainer: {
      width: "max-width",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-around",
      backgroundColor: "transparent",
      alignSelf: "center",
    },
    absoluteBottomBorder: {
      position: "absolute",
      bottom: Platform.OS === "web" ? 28.8 : 64 + 28.8,
      borderBottomColor: greys(theme)[1300],
      borderBottomWidth: 0.2,
      zIndex: -1,
      height: 1,
      backgroundColor: "transparent",
      overflow: "hidden",
      width: "100%",
    },
    absoluteRightBottomBorder: {
      position: "absolute",
      right: -8,
      bottom: Platform.OS === "web" ? 28.8 : 64 + 28.8,
      borderBottomColor: greys(theme)[1300],
      borderBottomWidth: 0.2,
      zIndex: -1,
      height: 128,
      backgroundColor: "transparent",
      overflow: "hidden",
    },
    bottomNegative: {
      bottom: -16,
      backgroundColor: "transparent",
    },
    accountPagerView: {
      display: "flex",
      height: 300,
      width: "100%",
    },
    swiperView: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: greys(theme)[2300],
    },
    absoluteTop: {
      position: "absolute",
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-around",
      top: Platform.OS === "web" ? 159 + 64 : 159,
      padding: 0,
      margin: 0,
      zIndex: 3,
      height: 130,
      backgroundColor: "transparent",
      paddingLeft: 16,
      paddingRight: 16,
    },
    touchableOpacity: {
      flex: 1,
      maxWidth: "auto",
      zIndex: -1,
      backgroundColor: "transparent",
    },
    cameraButton: {
      maxWidth: 64,
      zIndex: 10000,
      shadowColor: shades[200],
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.75,
      shadowRadius: 8,
      elevation: 5,
      borderRadius: 10000,
      borderColor: shades[200],
      borderWidth: 0.5,
    },
    receiveButton: {
      marginRight: -8,
    },
    sendButton: {
      marginLeft: -8,
    },
    cameraGradient: {
      padding: 8,
      borderRadius: 1000,
    },
    iconContainer: {
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    iconView: {
      alignContent: "center",
      flexDirection: "row",
      padding: 12,
      minWidth: 90,
      width: "100%",
      justifyContent: "center",
      alignItems: "center",
    },
    cameraIconView: {
      backgroundColor: "transparent",
      borderRadius: 1000,
    },
    receiveIconView: {
      backgroundColor: greys(theme)[1800],
      borderBottomLeftRadius: 1000,
      borderTopLeftRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[1400],
    },
    sendIconView: {
      backgroundColor: greys(theme)[1800],
      borderBottomRightRadius: 1000,
      borderTopRightRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[1400],
    },
    iconText: {
      color: greys(theme)[0],
    },
  });
