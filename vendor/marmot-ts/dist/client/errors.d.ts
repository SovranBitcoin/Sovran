/** An error that is thrown when a group has no relays available to send messages. */
export declare class NoGroupRelaysError extends Error {
    constructor();
}
/** An error that is thrown the client is unable to find the MarmotGroupData in the ClientState of a group. */
export declare class NoMarmotGroupDataError extends Error {
    constructor();
}
/** An error that is thrown if no relay received an event. */
export declare class NoRelayReceivedEventError extends Error {
    constructor(eventId: string);
}
