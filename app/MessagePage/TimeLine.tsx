import React from "react";
import MessageComponent from "./MessageComponent";
import EsimComponent from "./EsimComponent";
import TransactionComponent from "./TransactionComponent";
import { useNostr } from "helper/redux/nostr";
import EventComponent from "./EventsComponent";
import VpnComponent from "./VpnComponent";

const TimelineItem = ({ item, theme }) => {
  const { currentProfile } = useNostr();

  // Determine item type
  const isMessage = !!item.content;
  const isEvent = !!item.event;
  const isVPN = !!item?.cc;
  const isEsim = !!item.order?.ac;
  const isTransaction = !!item.unit;

  // Determine if message is received
  const isMessageReceived =
    isMessage && (item.receiver === currentProfile.pubkey || item.id === -1);
  const isTransactionReceived =
    isTransaction &&
    (item?.nostr?.pubkey === currentProfile.pubkey ||
      (item.receiver && item.receiver === currentProfile.pubkey));

  // Render appropriate component based on item type
  if (isMessage) {
    return (
      <MessageComponent
        message={item}
        theme={theme}
        isReceived={isMessageReceived}
      />
    );
  }

  if (isVPN) {
    return <VpnComponent esim={item} theme={theme} isReceived={isVPN} />;
  }

  if (isEsim) {
    return <EsimComponent esim={item} theme={theme} isReceived={isEsim} />;
  }

  if (isEvent) {
    return <EventComponent event={item} theme={theme} />;
  }

  if (isTransaction) {
    return (
      <TransactionComponent
        transaction={item}
        theme={theme}
        isReceived={isTransactionReceived}
      />
    );
  }

  return null;
};

export default TimelineItem;
