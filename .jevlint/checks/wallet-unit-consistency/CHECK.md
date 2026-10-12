Where is the wallet's unit pinned, switched or overridden, and do the balances, mint choice and amounts used with it belong to the same unit?

Find setUnitOverride and the pin stack (wallet/src/react/unitPins.ts,
wallet/src/react/ColadaProvider.tsx), the screens that pin a unit, and the NFC and nearby-send
flows that switch unit mid-flow. Concerns: a pin released by value instead of by its owner, so one
screen leaving clears another screen's pin; a hook pinning sat over a screen that chose another
unit; balances or mint selection still read for the old unit after a switch; a UI gate such as a
Next menu reading a different snapshot than the payment machine acts on.
