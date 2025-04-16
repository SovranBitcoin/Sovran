import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { greys, shades } from "helper/colors";
import { convertTime } from "helper/time";

const EVENT_TYPES = {
  invoice_created: "Invoice created",
  invoice_update: "Invoice updated",
  payment_intent: "Payment intent",
  invoice_complete: "Invoice complete",
};

const EventComponent = ({ event, theme, isReceived = true }) => {
  const styles = createStyles(theme, isReceived);
  const eventTitle = EVENT_TYPES[event.event] || event.event;

  return (
    <View style={styles.eventWrapper}>
      <View style={styles.arrow}></View>
      <LinearGradient
        colors={
          isReceived
            ? [greys(theme)[1000], greys(theme)[1200]]
            : [shades[100], shades[300]]
        }
        style={styles.eventContainer}
      >
        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>{eventTitle}</Text>
        </View>

        {event.paymentAmount && (
          <Text style={styles.infoText}>
            Amount: {event.paymentAmount} {event.paymentCurrency}
          </Text>
        )}
        {event.paymentMethod && (
          <Text style={styles.infoText}>Method: {event.paymentMethod}</Text>
        )}
        {event.status && (
          <Text style={styles.infoText}>Status: {event.status}</Text>
        )}

        <View style={styles.footer}>
          <Text style={styles.timestamp}>
            {convertTime(new Date(event.date))}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme, isReceived) =>
  StyleSheet.create({
    eventWrapper: {
      marginVertical: 8,
      position: "relative",
      backgroundColor: "transparent",
      alignSelf: isReceived ? "flex-start" : "flex-end",
    },
    eventContainer: {
      padding: 16,
      borderRadius: 16,
      maxWidth: "75%",
    },
    arrow: {
      position: "absolute",
      bottom: -4,
      ...(isReceived
        ? { left: 16, backgroundColor: greys(theme)[1200] }
        : { right: 16, backgroundColor: shades[300] }),
      width: 8,
      height: 8,
      transform: [{ rotate: "45deg" }],
    },
    titleContainer: {
      backgroundColor: "rgba(0,0,0,0.25)",
      padding: 4,
      marginBottom: 4,
      borderRadius: 16,
    },
    titleText: {
      fontFamily: "OverpassBold",
      fontSize: 14,
      textAlign: "center",
      color: greys(theme)[0],
    },
    infoText: {
      fontFamily: "OverpassBold",
      fontSize: 14,
      marginBottom: 4,
      color: greys(theme)[0],
    },
    footer: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
    },
    timestamp: {
      color: greys(theme)[0],
      opacity: 0.75,
      fontFamily: "OverpassBold",
      fontSize: 12,
    },
  });

export default EventComponent;
